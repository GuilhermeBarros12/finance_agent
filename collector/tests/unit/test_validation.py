"""Testes da T14: comparabilidade, tolerância, estados e freshness. Dados sintéticos."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from decimal import Decimal

import pytest
import yaml
from collector.contracts import (
    FieldValidation,
    Freshness,
    Metric,
    Observation,
    Unit,
    ValidationStatus,
)
from collector.settings import DEFAULT_METHODOLOGIES_PATH, Methodologies, load_methodologies
from collector.validation.comparability import check_comparability
from collector.validation.engine import (
    InvalidRecord,
    business_days_between,
    compute_freshness,
    validate_field,
    validate_snapshot,
)
from collector.validation.tolerance import (
    DEFAULT_TOLERANCES_PATH,
    Tolerances,
    compute_tolerance,
    load_tolerances,
    within_tolerance,
)
from pydantic import ValidationError

# Sexta-feira 2026-09-18, 21h UTC (18h em Brasília).
COLLECTED = datetime(2026, 9, 18, 21, 0, tzinfo=UTC)
NOW = COLLECTED
D = Decimal


def _obs(
    source: str,
    value: str,
    *,
    asset: str = "AAAA3",
    metric: Metric = Metric.PRICE_TO_BOOK,
    unit: Unit | None = None,
    reference_at: str | None = "2026-09-18",
    period: tuple[str, str] | None = None,
    methodology_id: str = "m1",
) -> Observation:
    units = {
        Metric.QUOTE_PRICE: Unit.BRL,
        Metric.PRICE_TO_BOOK: Unit.RATIO,
        Metric.PRICE_TO_EARNINGS: Unit.RATIO,
        Metric.DIVIDEND_YIELD: Unit.PERCENT,
        Metric.ROE: Unit.PERCENT,
    }
    unit = unit or units[metric]
    data = {
        "observation_id": f"{source}-{asset}-{metric.value}",
        "asset_id": asset,
        "asset_class": "stock",
        "metric": metric.value,
        "raw_value": value,
        "value_decimal": value,
        "unit": unit.value,
        "currency": "BRL" if metric is Metric.QUOTE_PRICE else None,
        "reference_at": reference_at,
        "collected_at": "2026-09-18T21:00:00Z",
        "source_id": source,
        "source_url": f"https://exemplo.invalid/{source}/{asset.lower()}",
        "methodology_id": methodology_id,
        "run_id": "run-1",
        "parser_version": "t14-teste",
        "raw_content_hash": "0" * 64,
    }
    if period:
        data["period_start"], data["period_end"] = period
    return Observation.model_validate(data)


def _methodologies(verdict: str = "comparable", *, window_b: str = "ttm") -> Methodologies:
    """Metodologia de TESTE (não a real): veredito configurável para os quatro indicadores."""
    data = yaml.safe_load(DEFAULT_METHODOLOGIES_PATH.read_text(encoding="utf-8"))
    data = copy.deepcopy(data)
    for name in ("price_to_book", "price_to_earnings", "dividend_yield", "roe"):
        data["metrics"][name]["verdict"] = verdict
        for source, window in (("fundamentus", "ttm"), ("statusinvest", window_b)):
            data["metrics"][name]["sources"][source] = {
                "methodology_id": "m1",
                "formula": "f",
                "window": window,
                "basis": "final",
                "reference_date_available": True,
            }
    return Methodologies.model_validate(data)


def _tol(calibration: bool = False) -> Tolerances:
    tol = load_tolerances()
    return tol.model_copy(
        update={"validation": tol.validation.model_copy(update={"calibration_mode": calibration})}
    )


def _run(obs, *, metric=Metric.PRICE_TO_BOOK, calibration=False, methodologies=None, **kw):
    return validate_field(
        "AAAA3",
        metric,
        obs,
        methodologies=methodologies or _methodologies(),
        tolerances=_tol(calibration),
        snapshot_collected_at=COLLECTED,
        now=NOW,
        **kw,
    )


# --- Tolerância (README 7.4) ------------------------------------------------------------


def test_exemplo_readme_dentro_da_tolerancia():
    assert within_tolerance(D("1.00"), D("1.01"), atol=D("0.02"), rtol=D("0.02"))


def test_exemplo_readme_fora_da_tolerancia():
    assert not within_tolerance(D("8.50"), D("9.10"), atol=D("0.20"), rtol=D("0"))


def test_limite_e_o_maior_entre_atol_e_relativo():
    r = compute_tolerance(D("100"), D("101"), atol=D("0.05"), rtol=D("0.005"))
    assert r.limit == D("0.505")  # rtol * max = 0.005 * 101
    assert r.delta_abs == D("1")
    assert not r.within


def test_fronteira_delta_igual_ao_limite_e_verified():
    assert within_tolerance(D("1.00"), D("1.20"), atol=D("0.20"), rtol=D("0"))
    assert not within_tolerance(D("1.00"), D("1.21"), atol=D("0.20"), rtol=D("0"))


def test_decimal_sem_erro_de_binario():
    # Em float, 0.1 + 0.2 != 0.3; em Decimal, a diferença 0.3 - 0.1 é exatamente 0.2.
    r = compute_tolerance(D("0.3"), D("0.1"), atol=D("0.2"), rtol=D("0"))
    assert r.delta_abs == D("0.2")
    assert r.within


def test_tolerancia_rejeita_float_negativo_e_nao_finito():
    with pytest.raises(TypeError):
        within_tolerance(1.0, D("1"), atol=D("0.1"), rtol=D("0"))  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        within_tolerance(D("1"), D("NaN"), atol=D("0.1"), rtol=D("0"))
    with pytest.raises(ValueError):
        within_tolerance(D("1"), D("1"), atol=D("-0.1"), rtol=D("0"))


def test_tolerances_yaml_real():
    tol = load_tolerances(DEFAULT_TOLERANCES_PATH)
    assert tol.version == "draft-1"
    assert tol.validation.calibration_mode is True
    assert tol.metrics[Metric.QUOTE_PRICE].atol == D("0.05")
    assert tol.metrics[Metric.QUOTE_PRICE].rtol == D("0.005")
    assert tol.metrics[Metric.PRICE_TO_BOOK].rtol == D("0.02")
    assert tol.metrics[Metric.PRICE_TO_EARNINGS].atol == D("0.10")
    assert tol.metrics[Metric.DIVIDEND_YIELD].atol == D("0.20")
    assert tol.metrics[Metric.ROE].atol == D("0.50")


def test_tolerances_extra_forbid_e_unidade_errada():
    data = yaml.safe_load(DEFAULT_TOLERANCES_PATH.read_text(encoding="utf-8"))
    with pytest.raises(ValidationError):
        Tolerances.model_validate({**data, "campo_novo": 1})
    bad = copy.deepcopy(data)
    bad["metrics"]["roe"]["unit"] = "ratio"
    with pytest.raises(ValidationError):
        Tolerances.model_validate(bad)
    floaty = copy.deepcopy(data)
    floaty["metrics"]["roe"]["atol"] = 0.5
    with pytest.raises(ValidationError):
        Tolerances.model_validate(floaty)


# --- Comparabilidade --------------------------------------------------------------------


def test_metodologia_real_e_unknown_metadata():
    real = load_methodologies()
    r = check_comparability(
        _obs("fundamentus", "1.00"), _obs("statusinvest", "1.00"), real.metrics["price_to_book"]
    )
    assert not r.comparable
    assert r.reason == "unknown_metadata"


def test_unidades_diferentes_incomparable():
    # O contrato rejeita unidade errada por métrica; a comparação ainda checa a moeda/unidade.
    a = _obs("fundamentus", "1.00")
    b = _obs("statusinvest", "1.00").model_copy(update={"unit": Unit.PERCENT})
    r = check_comparability(a, b, _methodologies().metrics["price_to_book"])
    assert not r.comparable and r.reason == "unit_mismatch"
    res = _run([a, b])
    assert res.validation.status is ValidationStatus.INCOMPARABLE
    assert res.validation.reason == "unit_mismatch"


def test_datas_incompativeis_incomparable():
    a = _obs("fundamentus", "1.00", reference_at="2026-09-18")
    b = _obs("statusinvest", "1.00", reference_at="2026-09-17")
    res = _run([a, b])
    assert res.validation.status is ValidationStatus.INCOMPARABLE
    assert res.validation.reason == "date_mismatch"


def test_uma_data_conhecida_e_outra_nao_incomparable():
    res = _run([_obs("fundamentus", "1.00"), _obs("statusinvest", "1.00", reference_at=None)])
    assert res.validation.status is ValidationStatus.INCOMPARABLE
    assert res.validation.reason == "reference_date_unknown"


def test_instante_vira_dia_de_brasilia():
    a = _obs("fundamentus", "1.00", reference_at="2026-09-19T01:00:00Z")  # 22h do dia 18 em BRT
    b = _obs("statusinvest", "1.00", reference_at="2026-09-18")
    assert _run([a, b]).validation.status is ValidationStatus.VERIFIED


def test_janela_diferente_incomparable():
    res = _run(
        [_obs("fundamentus", "1.00"), _obs("statusinvest", "1.00")],
        methodologies=_methodologies(window_b="12m"),
    )
    assert res.validation.status is ValidationStatus.INCOMPARABLE
    assert res.validation.reason == "methodology_mismatch"


def test_periodos_diferentes_incomparable():
    a = _obs("fundamentus", "1.00", period=("2025-01-01", "2025-12-31"))
    b = _obs("statusinvest", "1.00", period=("2025-04-01", "2026-03-31"))
    res = _run([a, b])
    assert res.validation.reason == "period_mismatch"


def test_methodology_id_da_observacao_precisa_bater_com_config():
    a = _obs("fundamentus", "1.00")
    b = _obs("statusinvest", "1.00", methodology_id="outro")
    assert _run([a, b]).validation.reason == "unknown_metadata"
    c = _obs("statusinvest", "1.00", methodology_id="unknown")
    assert _run([a, c]).validation.reason == "unknown_metadata"


def test_not_comparable_e_single_source_viram_incomparable():
    res = _run(
        [_obs("fundamentus", "1.00"), _obs("statusinvest", "1.00")],
        methodologies=_methodologies("not_comparable"),
    )
    assert res.validation.reason == "not_comparable_metric"


# --- Os sete estados ---------------------------------------------------------------------


def test_missing():
    res = _run([], missing_reason="falha de coleta: timeout")
    v = res.validation
    assert v.status is ValidationStatus.MISSING
    assert v.observation_ids == [] and v.selected_observation_id is None and v.comparison is None
    assert v.freshness is Freshness.UNKNOWN_REFERENCE_DATE
    assert v.reason == "falha de coleta: timeout"


def test_invalid():
    rec = InvalidRecord("AAAA3", Metric.PRICE_TO_BOOK, "fundamentus", "valor não numérico")
    v = _run([], invalid=[rec]).validation
    assert v.status is ValidationStatus.INVALID
    assert v.observation_ids == [] and v.selected_observation_id is None
    assert v.reason == "valor não numérico"


def test_invalid_de_uma_fonte_e_observacao_boa_da_outra_e_single_source():
    rec = InvalidRecord("AAAA3", Metric.PRICE_TO_BOOK, "fundamentus", "valor não numérico")
    v = _run([_obs("statusinvest", "1.00")], invalid=[rec]).validation
    assert v.status is ValidationStatus.SINGLE_SOURCE
    assert v.observation_ids == ["statusinvest-AAAA3-price_to_book"]
    assert "valor não numérico" in (v.reason or "")


def test_single_source():
    v = _run([_obs("statusinvest", "1.00")]).validation
    assert v.status is ValidationStatus.SINGLE_SOURCE
    assert v.observation_ids == ["statusinvest-AAAA3-price_to_book"]
    assert v.selected_observation_id is None and v.comparison is None
    assert v.freshness is Freshness.FRESH


def test_incomparable_com_metodologia_real():
    res = _run(
        [_obs("fundamentus", "1.00"), _obs("statusinvest", "1.00")],
        methodologies=load_methodologies(),
    )
    v = res.validation
    assert v.status is ValidationStatus.INCOMPARABLE
    assert v.reason == "unknown_metadata"
    assert v.status not in (ValidationStatus.VERIFIED, ValidationStatus.DIVERGENT)
    assert len(v.observation_ids) == 2 and v.comparison is None


def test_verified_seleciona_fundamentus():
    v = _run([_obs("statusinvest", "1.01"), _obs("fundamentus", "1.00")]).validation
    assert v.status is ValidationStatus.VERIFIED
    assert v.selected_observation_id == "fundamentus-AAAA3-price_to_book"
    assert set(v.observation_ids) == {
        "fundamentus-AAAA3-price_to_book",
        "statusinvest-AAAA3-price_to_book",
    }
    c = v.comparison
    assert c is not None
    assert c.delta_abs == D("0.01") and c.limit == D("0.0202") and c.tolerance_version == "draft-1"
    assert c.delta_abs <= c.limit


def test_divergent_nao_escolhe_lado_nem_media():
    v = _run(
        [
            _obs("fundamentus", "8.50", metric=Metric.DIVIDEND_YIELD),
            _obs("statusinvest", "9.10", metric=Metric.DIVIDEND_YIELD),
        ],
        metric=Metric.DIVIDEND_YIELD,
    ).validation
    assert v.status is ValidationStatus.DIVERGENT
    assert v.selected_observation_id is None
    assert v.comparison is not None and v.comparison.delta_abs > v.comparison.limit
    assert v.comparison.delta_abs == D("0.60") and v.comparison.limit == D("0.20")


def test_fronteira_no_motor_e_verified():
    v = _run(
        [
            _obs("fundamentus", "1.00", metric=Metric.DIVIDEND_YIELD),
            _obs("statusinvest", "1.20", metric=Metric.DIVIDEND_YIELD),
        ],
        metric=Metric.DIVIDEND_YIELD,
    ).validation
    assert v.status is ValidationStatus.VERIFIED
    assert v.comparison.delta_abs == v.comparison.limit


def test_not_applicable():
    v = _run([], not_applicable_reason="banco não tem esse indicador").validation
    assert v.status is ValidationStatus.NOT_APPLICABLE
    assert v.observation_ids == [] and v.selected_observation_id is None and v.comparison is None
    assert v.reason == "banco não tem esse indicador"


def test_quote_price_so_brapi_e_single_source():
    v = _run(
        [_obs("brapi", "10.50", metric=Metric.QUOTE_PRICE)],
        metric=Metric.QUOTE_PRICE,
        methodologies=load_methodologies(),
    ).validation
    assert v.status is ValidationStatus.SINGLE_SOURCE


def test_resultado_serializa_como_json_e_volta():
    v = _run([_obs("fundamentus", "1.00"), _obs("statusinvest", "1.01")]).validation
    dumped = v.model_dump(mode="json")
    assert isinstance(dumped["comparison"]["delta_abs"], str)
    assert FieldValidation.model_validate(dumped) == v


def test_observacao_de_outro_ativo_ou_metrica_e_erro():
    with pytest.raises(ValueError):
        _run([_obs("fundamentus", "1.00", asset="BBBB3")])
    with pytest.raises(ValueError):
        _run([_obs("fundamentus", "1.00", metric=Metric.ROE)])


def test_fonte_repetida_vira_invalid_sem_publicar_nada():
    a = _obs("fundamentus", "1.00")
    res = _run([a, a])
    assert res.validation.status is ValidationStatus.INVALID
    assert res.validation.observation_ids == []
    assert res.unpublished_observation_ids == (a.observation_id, a.observation_id)


# --- Calibragem --------------------------------------------------------------------------


@pytest.mark.parametrize(("a", "b"), [("1.00", "1.01"), ("1.00", "5.00")])
def test_calibragem_ligada_nunca_verified_nem_divergent(a, b):
    res = _run([_obs("fundamentus", a), _obs("statusinvest", b)], calibration=True)
    v = res.validation
    assert v.status is ValidationStatus.SINGLE_SOURCE
    assert v.comparison is None and v.selected_observation_id is None
    assert v.observation_ids == ["fundamentus-AAAA3-price_to_book"]
    assert res.unpublished_observation_ids == ("statusinvest-AAAA3-price_to_book",)
    assert (v.reason or "").startswith("uncalibrated:")
    assert "delta_abs=" in v.reason and "limit=" in v.reason


def test_calibragem_registra_delta_e_limite_no_reason():
    v = _run(
        [_obs("fundamentus", "1.00"), _obs("statusinvest", "1.01")], calibration=True
    ).validation
    assert "delta_abs=0.01" in v.reason and "within_limit=true" in v.reason
    assert "tolerance_version=draft-1" in v.reason


def test_calibragem_nao_esconde_incomparable():
    res = _run(
        [_obs("fundamentus", "1.00", reference_at="2026-09-17"), _obs("statusinvest", "1.00")],
        calibration=True,
    )
    assert res.validation.status is ValidationStatus.INCOMPARABLE


def test_modo_de_calibragem_comeca_ligado_por_padrao():
    assert load_tolerances().validation.calibration_mode is True


def test_snapshot_com_calibragem_ligada_nao_gera_selo():
    obs = [
        _obs("fundamentus", "1.00"),
        _obs("statusinvest", "1.00"),
        _obs("fundamentus", "5.00", metric=Metric.DIVIDEND_YIELD),
        _obs("statusinvest", "9.00", metric=Metric.DIVIDEND_YIELD),
    ]
    results = validate_snapshot(
        ["AAAA3"],
        obs,
        methodologies=_methodologies(),
        tolerances=_tol(True),
        snapshot_collected_at=COLLECTED,
        now=NOW,
    )
    assert len(results) == len(Metric)
    assert all(
        r.validation.status not in (ValidationStatus.VERIFIED, ValidationStatus.DIVERGENT)
        for r in results
    )


# --- Isolamento entre campos ---------------------------------------------------------------


def test_ativo_com_uma_metrica_boa_e_outra_ruim():
    obs = [
        _obs("fundamentus", "1.00"),
        _obs("statusinvest", "1.01"),  # P/VP concorda
        _obs("fundamentus", "8.50", metric=Metric.DIVIDEND_YIELD),
        _obs("statusinvest", "9.10", metric=Metric.DIVIDEND_YIELD),  # DY diverge
        _obs("fundamentus", "12.0", metric=Metric.ROE),  # ROE só uma fonte
    ]
    results = validate_snapshot(
        ["AAAA3"],
        obs,
        methodologies=_methodologies(),
        tolerances=_tol(False),
        snapshot_collected_at=COLLECTED,
        now=NOW,
    )
    by = {r.validation.metric: r.validation for r in results}
    assert by[Metric.PRICE_TO_BOOK].status is ValidationStatus.VERIFIED
    assert by[Metric.DIVIDEND_YIELD].status is ValidationStatus.DIVERGENT
    assert by[Metric.ROE].status is ValidationStatus.SINGLE_SOURCE
    assert by[Metric.PRICE_TO_EARNINGS].status is ValidationStatus.MISSING
    assert by[Metric.QUOTE_PRICE].status is ValidationStatus.MISSING


def test_campo_nao_herda_validacao_de_outro_ativo():
    obs = [
        _obs("fundamentus", "1.00", asset="AAAA3"),
        _obs("statusinvest", "1.00", asset="AAAA3"),
        _obs("fundamentus", "1.00", asset="BBBB3"),
    ]
    results = validate_snapshot(
        ["AAAA3", "BBBB3"],
        obs,
        methodologies=_methodologies(),
        tolerances=_tol(False),
        snapshot_collected_at=COLLECTED,
        now=NOW,
    )
    by = {(r.validation.asset_id, r.validation.metric): r.validation for r in results}
    assert by[("AAAA3", Metric.PRICE_TO_BOOK)].status is ValidationStatus.VERIFIED
    assert by[("BBBB3", Metric.PRICE_TO_BOOK)].status is ValidationStatus.SINGLE_SOURCE


def test_falha_de_coleta_nao_vira_zero_nem_tabela_vazia():
    results = validate_snapshot(
        ["AAAA3"],
        [],
        methodologies=_methodologies(),
        tolerances=_tol(False),
        snapshot_collected_at=COLLECTED,
        now=NOW,
    )
    assert len(results) == len(Metric)
    assert {r.validation.status for r in results} == {ValidationStatus.MISSING}


# --- Freshness (D20) -------------------------------------------------------------------------


def test_dias_uteis_pulam_fim_de_semana():
    assert business_days_between(datetime(2026, 9, 18).date(), datetime(2026, 9, 21).date()) == 1
    assert business_days_between(datetime(2026, 9, 18).date(), datetime(2026, 9, 25).date()) == 5
    assert business_days_between(datetime(2026, 9, 19).date(), datetime(2026, 9, 20).date()) == 0


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 9, 18, 23, 0, tzinfo=UTC), Freshness.FRESH),
        (datetime(2026, 9, 21, 12, 0, tzinfo=UTC), Freshness.FRESH),  # segunda: 1 dia útil
        (datetime(2026, 9, 22, 12, 0, tzinfo=UTC), Freshness.STALE),  # terça: 2
        (datetime(2026, 9, 25, 12, 0, tzinfo=UTC), Freshness.STALE),  # sexta: 5
        (datetime(2026, 9, 28, 12, 0, tzinfo=UTC), Freshness.EXPIRED),  # segunda: 6
    ],
)
def test_freshness_por_dias_uteis(now, expected):
    assert compute_freshness(COLLECTED, now) is expected


def test_freshness_usa_dia_de_brasilia():
    # 02h UTC de sábado ainda é sexta à noite em Brasília.
    collected = datetime(2026, 9, 19, 2, 0, tzinfo=UTC)
    assert compute_freshness(collected, datetime(2026, 9, 21, 12, 0, tzinfo=UTC)) is Freshness.FRESH


def test_freshness_vai_para_a_validacao():
    res = validate_field(
        "AAAA3",
        Metric.PRICE_TO_BOOK,
        [_obs("fundamentus", "1.00")],
        methodologies=_methodologies(),
        tolerances=_tol(False),
        snapshot_collected_at=COLLECTED,
        now=datetime(2026, 9, 28, 12, 0, tzinfo=UTC),
    )
    assert res.validation.freshness is Freshness.EXPIRED
    assert res.validation.status is ValidationStatus.SINGLE_SOURCE

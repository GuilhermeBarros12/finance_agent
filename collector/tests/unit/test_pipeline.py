"""Pipeline sem banco (T15): ordem das etapas, falhas, calibragem, logs."""

import io
import json
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from collector.contracts import Metric
from collector.logs import JsonLogger
from collector.pipeline import (
    AlreadyRanToday,
    ConfigurationError,
    NothingToPublish,
    Pipeline,
    RunOptions,
)
from collector.settings import load_settings
from collector.store import PublishRejected
from collector.validation.tolerance import ValidationOptions, load_tolerances
from fakes import FakeIndicatorSource, FakeStore, comparable_methodologies

UNIVERSE = ["DEMO3", "TEST4", "DEMO5", "TEST6"]
NOW = datetime(2026, 11, 16, 15, 0, tzinfo=UTC)
SECRET_URL = "postgresql://collector_ingest:senha-secreta-123@127.0.0.1:54322/postgres"


def _settings(**env: str):
    return load_settings({"SCRAPER_CONTACT": "t@example.test", **env})


def _pipeline(sources, store, *, settings=None, tolerances=None, universe=UNIVERSE, log=None):
    settings = settings or _settings()
    return Pipeline(
        settings=settings,
        tolerances=tolerances or load_tolerances(),
        universe=universe,
        universe_version="u-1",
        build_adapters=lambda run_id: [make(run_id) for make in sources],
        store=store,
        log=log or JsonLogger(io.StringIO()),
        clock=lambda: NOW,
    )


def _src(source_id, **kw):
    return lambda run_id: FakeIndicatorSource(source_id, run_id, **kw)


def test_stage_acontece_antes_de_publish():
    store = FakeStore()
    report = _pipeline([_src("fundamentus"), _src("statusinvest")], store).run(RunOptions())
    assert store.calls == ["batch_done_on", "stage", "publish"]
    assert report.published and report.snapshot_id


def test_lote_do_dia_recusa_sem_force_e_aceita_com_force():
    store = FakeStore(batch_done=True)
    pipe = _pipeline([_src("fundamentus")], store)
    with pytest.raises(AlreadyRanToday):
        pipe.run(RunOptions())
    assert store.calls == ["batch_done_on"]  # nada foi coletado nem gravado
    store.calls.clear()
    pipe.run(RunOptions(force=True))
    assert store.calls == ["stage", "publish"]


def test_data_logica_usa_america_sao_paulo():
    # 01:00 UTC de 17/11 ainda é 16/11 em Brasília
    store = FakeStore()
    pipe = _pipeline([_src("fundamentus")], store)
    pipe._clock = lambda: datetime(2026, 11, 17, 1, 0, tzinfo=UTC)
    report = pipe.run(RunOptions())
    assert report.logical_day.isoformat() == "2026-11-16"


def test_fixtures_recusado_fora_do_ambiente_local():
    store = FakeStore()
    pipe = _pipeline([_src("fundamentus")], store, settings=_settings(APP_ENV="production"))
    with pytest.raises(ConfigurationError, match="APP_ENV=local"):
        pipe.run(RunOptions(mode="fixtures"))
    assert store.calls == []


def test_dry_run_nao_toca_no_banco():
    store = FakeStore()
    report = _pipeline([_src("fundamentus")], store).run(RunOptions(dry_run=True))
    assert store.calls == []
    assert not report.published and report.observations_collected == 16


def test_falha_de_um_ativo_vai_ao_manifesto_e_nao_vira_observacao():
    store = FakeStore()
    sources = [_src("fundamentus", fail_assets=["DEMO5"]), _src("statusinvest")]
    _pipeline(sources, store).run(RunOptions())
    assert store.manifest is not None
    assert store.manifest["failures"] == [
        {"asset_id": "DEMO5", "source_id": "fundamentus", "reason": "falha simulada"}
    ]
    assert set(store.manifest) == {
        "snapshot_id",
        "run_id",
        "collected_at",
        "universe_version",
        "assets_total",
        "assets_updated",
        "failures",
    }
    assert store.manifest["collected_at"].endswith("Z")
    staged = store.staged
    assert staged is not None
    assert not [
        o for o in staged.observations if o.asset_id == "DEMO5" and o.source_id == "fundamentus"
    ]
    by_key = {(v.asset_id, v.metric): v for v in staged.validations}
    # a fonte que sobrou vira single_source ou incomparable; nunca verified com uma só
    assert by_key[("DEMO5", Metric.ROE)].observation_ids == [
        f"{staged.run_id}:statusinvest:DEMO5:roe"
    ]
    assert by_key[("DEMO5", Metric.ROE)].status.value == "single_source"


def test_falha_total_sem_dados_vira_missing_com_motivo_e_nunca_zero():
    store = FakeStore()
    sources = [
        _src("fundamentus", fail_assets=["DEMO5"]),
        _src("statusinvest", fail_assets=["DEMO5"]),
    ]
    _pipeline(sources, store).run(RunOptions())
    staged = store.staged
    assert staged is not None
    missing = [v for v in staged.validations if v.asset_id == "DEMO5" and v.metric is Metric.ROE]
    assert missing[0].status.value == "missing"
    assert "falha de coleta" in (missing[0].reason or "")
    assert missing[0].freshness.value == "unknown_reference_date"
    assert all(o.value_decimal != Decimal(0) for o in staged.observations)


def test_calibragem_publica_as_duas_fontes_como_incomparable():
    store = FakeStore()
    settings = _settings()
    settings = settings.model_copy(
        update={"methodologies": comparable_methodologies(settings.methodologies)}
    )
    report = _pipeline([_src("fundamentus"), _src("statusinvest")], store, settings=settings).run(
        RunOptions()
    )
    staged = store.staged
    assert staged is not None
    # P-17: nada fica de fora; 4 ativos x 4 indicadores x 2 fontes chegam ao staging.
    assert report.observations_unpublished == 0
    assert {o.source_id for o in staged.observations} == {"fundamentus", "statusinvest"}
    assert len(staged.observations) == 32
    compared = [v for v in staged.validations if v.observation_ids]
    assert len(compared) == 16
    assert all(v.status.value == "incomparable" for v in compared)
    assert all(v.comparison is not None and v.selected_observation_id is None for v in compared)
    assert report.statuses.get("verified", 0) == 0 and report.statuses.get("divergent", 0) == 0
    ids = {o.observation_id for o in staged.observations}
    assert all(i in ids for v in staged.validations for i in v.observation_ids)


def test_sem_calibragem_as_duas_observacoes_sao_publicadas():
    store = FakeStore()
    settings = _settings()
    settings = settings.model_copy(
        update={"methodologies": comparable_methodologies(settings.methodologies)}
    )
    tol = load_tolerances().model_copy(
        update={"validation": ValidationOptions(calibration_mode=False)}
    )
    sources = [_src("fundamentus"), _src("statusinvest", offset=Decimal(5))]
    report = _pipeline(sources, store, settings=settings, tolerances=tol).run(RunOptions())
    assert report.observations_unpublished == 0
    assert report.statuses["divergent"] == 16 and len(store.staged.observations) == 32


def test_ativo_fora_do_universo_e_descartado_como_falha():
    store = FakeStore()
    sources = [_src("fundamentus", extra_assets=["ZZZZ9"]), _src("statusinvest")]
    _pipeline(sources, store).run(RunOptions())
    assert store.staged is not None and store.manifest is not None
    assert all(o.asset_id != "ZZZZ9" for o in store.staged.observations)
    assert {
        "asset_id": "ZZZZ9",
        "source_id": "fundamentus",
        "reason": "ativo fora do universo",
    } in (store.manifest["failures"])
    # uma única falha por par (ativo, fonte), mesmo com várias observações descartadas
    pares = [
        f
        for f in store.manifest["failures"]
        if f["asset_id"] == "ZZZZ9" and f["source_id"] == "fundamentus"
    ]
    assert len(pares) == 1


def test_sem_observacao_publicavel_nao_chama_o_banco():
    store = FakeStore()
    pipe = _pipeline([_src("fundamentus", fail_all=True)], store)
    with pytest.raises(NothingToPublish):
        pipe.run(RunOptions())
    assert "stage" not in store.calls and "publish" not in store.calls


def test_recusa_da_rpc_propaga():
    store = FakeStore(publish_error=PublishRejected("cobertura insuficiente"))
    with pytest.raises(PublishRejected):
        _pipeline([_src("fundamentus")], store).run(RunOptions())
    assert store.calls == ["batch_done_on", "stage", "publish"]


def test_excecao_do_adaptador_vira_falha_sem_vazar_a_mensagem():
    stream = io.StringIO()
    log = JsonLogger(stream, secrets=[SECRET_URL])
    boom = RuntimeError(f"erro com {SECRET_URL}")
    store = FakeStore()
    sources = [_src("fundamentus", boom=boom), _src("statusinvest")]
    _pipeline(sources, store, log=log).run(RunOptions())
    assert store.manifest is not None
    reasons = {f["reason"] for f in store.manifest["failures"] if f["source_id"] == "fundamentus"}
    assert reasons == {"coleta da fonte falhou (RuntimeError)"}
    assert "senha-secreta" not in stream.getvalue()


def test_logs_sao_json_com_run_id_etapa_fonte_e_contagens():
    stream = io.StringIO()
    store = FakeStore()
    _pipeline([_src("fundamentus")], store, log=JsonLogger(stream)).run(RunOptions())
    events = [json.loads(line) for line in stream.getvalue().splitlines()]
    assert {e["etapa"] for e in events} >= {"inicio", "coleta", "validacao", "staging", "fim"}
    assert all(e["run_id"] for e in events)
    coleta = next(e for e in events if e["etapa"] == "coleta")
    assert coleta["fonte"] == "fundamentus" and coleta["observacoes"] == 16
    assert "duracao_ms" in coleta


def test_universo_vazio_ou_repetido_e_recusado():
    store = FakeStore()
    with pytest.raises(ConfigurationError):
        _pipeline([_src("fundamentus")], store, universe=[]).run(RunOptions())
    with pytest.raises(ConfigurationError):
        _pipeline([_src("fundamentus")], store, universe=["DEMO3", "DEMO3"]).run(RunOptions())

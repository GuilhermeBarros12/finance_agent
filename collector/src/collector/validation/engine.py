"""Motor de validação por campo (README 7.3 a 7.6).

Cada par (ativo, métrica) é decidido sozinho: nada aqui olha outra métrica ou outro ativo,
então um campo nunca herda a validação de outro. Divergência nunca é resolvida por média,
por escolha de lado nem por LLM: `divergent` não seleciona observação.

Freshness: dias úteis (segunda a sexta) entre `collected_at` do snapshot e `now`, no
horário de Brasília. Mais de 1 é `stale`, mais de 5 é `expired` (ADR 0001, D20).
LIMITAÇÃO: feriados não são considerados nesta fatia; um feriado conta como dia útil e
pode marcar `stale` antes da hora.

Modo de calibragem (P-17): com `calibration_mode` ligado, a comparação é calculada, mas a
tolerância ainda não foi calibrada, então o resultado não é defensável como `verified` nem
como `divergent`. O estado gravado é `incomparable`, com as DUAS observações, sem escolher
lado, com `reason` "uncalibrated: ..." e com a comparação em `comparison` (delta_abs,
limite, atol, rtol e versão da tolerância). Assim as duas fontes chegam ao banco e a análise
da T17 lê números em colunas próprias, não texto livre.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from collector.contracts import (
    Comparison,
    FieldValidation,
    Freshness,
    Metric,
    Observation,
    ValidationStatus,
)
from collector.settings import Methodologies
from collector.validation.comparability import BRT, check_comparability
from collector.validation.tolerance import Tolerances, compute_tolerance

UNCALIBRATED = "uncalibrated"
FUTURE_COLLECTED_AT = "collected_at_in_future"
# Folga para relógios levemente desencontrados; além disso a data de coleta é suspeita.
CLOCK_SKEW = timedelta(minutes=5)
MISSING_FUNDAMENTUS = "selecao_exige_fundamentus"
STALE_AFTER_BUSINESS_DAYS = 1
EXPIRED_AFTER_BUSINESS_DAYS = 5

# Prioridade de exibição (D19): o Fundamentus vem primeiro. Convenção de interface.
DISPLAY_PRIORITY = ("fundamentus", "statusinvest", "brapi")


@dataclass(frozen=True)
class InvalidRecord:
    """Falha de contrato ou de parsing de um campo em uma fonte (vira `invalid`)."""

    asset_id: str
    metric: Metric
    source_id: str
    reason: str


@dataclass(frozen=True)
class FieldResult:
    validation: FieldValidation
    unpublished_observation_ids: tuple[str, ...] = field(default=())


def business_days_between(start: date, end: date) -> int:
    """Dias úteis (seg-sex) em (start, end]. Zero se `end <= start`. Sem feriados."""
    days = 0
    current = start
    while current < end:
        current += timedelta(days=1)
        if current.weekday() < 5:
            days += 1
    return days


def _require_aware(value: datetime, name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} deve ter fuso horário")


def compute_freshness(collected_at: datetime, now: datetime) -> Freshness:
    _require_aware(collected_at, "collected_at")
    _require_aware(now, "now")
    elapsed = business_days_between(collected_at.astimezone(BRT).date(), now.astimezone(BRT).date())
    if elapsed > EXPIRED_AFTER_BUSINESS_DAYS:
        return Freshness.EXPIRED
    if elapsed > STALE_AFTER_BUSINESS_DAYS:
        return Freshness.STALE
    return Freshness.FRESH


def _priority(obs: Observation) -> tuple[int, str]:
    try:
        return (DISPLAY_PRIORITY.index(obs.source_id), obs.source_id)
    except ValueError:
        return (len(DISPLAY_PRIORITY), obs.source_id)


def validate_field(
    asset_id: str,
    metric: Metric,
    observations: Sequence[Observation],
    *,
    methodologies: Methodologies,
    tolerances: Tolerances,
    snapshot_collected_at: datetime,
    now: datetime | None = None,
    invalid: Sequence[InvalidRecord] = (),
    not_applicable_reason: str | None = None,
    missing_reason: str | None = None,
) -> FieldResult:
    """Valida um único (ativo, métrica). `observations` são as utilizáveis.

    `observations` com outro ativo ou outra métrica são erro de quem chama (`ValueError`).
    `invalid` são as falhas de contrato do campo; `missing_reason` descreve a falha de
    coleta (nunca vira zero nem tabela vazia).
    """
    now = now or datetime.now(UTC)
    for obs in observations:
        if obs.asset_id != asset_id or obs.metric != metric:
            raise ValueError("observação de outro ativo ou métrica passada ao campo")
    invalid = [r for r in invalid if r.asset_id == asset_id and r.metric == metric]
    freshness = compute_freshness(snapshot_collected_at, now)
    future = snapshot_collected_at > now + CLOCK_SKEW
    if future:
        # Data de coleta no futuro: não inventar data nem declarar "fresh".
        freshness = Freshness.UNKNOWN_REFERENCE_DATE

    def build(
        status: ValidationStatus,
        ids: Iterable[str] = (),
        *,
        fresh: Freshness | None = None,
        selected: str | None = None,
        comparison: Comparison | None = None,
        reason: str | None = None,
        unpublished: Iterable[str] = (),
    ) -> FieldResult:
        if future and fresh is not None:
            note = f"{FUTURE_COLLECTED_AT}: collected_at do snapshot é posterior a now"
            reason = f"{reason}; {note}" if reason else note
        validation = FieldValidation(
            asset_id=asset_id,
            metric=metric,
            status=status,
            # Sem observação não há data a medir: nunca "fresh" nem a data de hoje.
            freshness=fresh or Freshness.UNKNOWN_REFERENCE_DATE,
            selected_observation_id=selected,
            observation_ids=list(ids),
            comparison=comparison,
            reason=reason,
        )
        return FieldResult(validation, tuple(unpublished))

    if not_applicable_reason is not None:
        return build(
            ValidationStatus.NOT_APPLICABLE,
            reason=not_applicable_reason,
            unpublished=[o.observation_id for o in observations],
        )

    sources = [o.source_id for o in observations]
    if len(sources) != len(set(sources)) or len(set(sources)) > 2:
        # Fora da fatia (2 fontes, 1 observação por fonte): não adivinhar qual vale.
        return build(
            ValidationStatus.INVALID,
            reason="observações repetidas por fonte ou mais de duas fontes",
            unpublished=[o.observation_id for o in observations],
        )

    if not observations:
        if invalid:
            return build(ValidationStatus.INVALID, reason="; ".join(r.reason for r in invalid))
        return build(ValidationStatus.MISSING, reason=missing_reason)

    if len(observations) == 1:
        reason = None
        if invalid:
            reason = "outra fonte inválida: " + "; ".join(r.reason for r in invalid)
        return build(
            ValidationStatus.SINGLE_SOURCE,
            [observations[0].observation_id],
            fresh=freshness,
            reason=reason,
        )

    first, second = sorted(observations, key=_priority)
    methodology = methodologies.metrics[metric.value]
    verdict = check_comparability(first, second, methodology)
    ids = [first.observation_id, second.observation_id]
    if not verdict.comparable:
        return build(ValidationStatus.INCOMPARABLE, ids, fresh=freshness, reason=verdict.reason)

    if first.source_id != "fundamentus":
        # D19: o valor exibido é o do Fundamentus; sem ele não se escolhe outra fonte.
        return build(
            ValidationStatus.INVALID,
            reason=f"{MISSING_FUNDAMENTUS}: sem observação do Fundamentus entre as duas fontes",
            unpublished=ids,
        )

    tol = tolerances.metrics[metric]
    result = compute_tolerance(
        first.value_decimal, second.value_decimal, atol=tol.atol, rtol=tol.rtol
    )

    comparison = Comparison(
        delta_abs=result.delta_abs,
        limit=result.limit,
        atol=tol.atol,
        rtol=tol.rtol,
        tolerance_version=tolerances.version,
    )
    if tolerances.validation.calibration_mode:
        # Nunca verified nem divergent antes da calibragem; nenhum lado é escolhido.
        return build(
            ValidationStatus.INCOMPARABLE,
            ids,
            fresh=freshness,
            comparison=comparison,
            reason=f"{UNCALIBRATED}: tolerância {tolerances.version} ainda não calibrada",
        )
    if result.within:
        return build(
            ValidationStatus.VERIFIED,
            ids,
            fresh=freshness,
            selected=first.observation_id,
            comparison=comparison,
        )
    return build(ValidationStatus.DIVERGENT, ids, fresh=freshness, comparison=comparison)


def validate_snapshot(
    assets: Iterable[str],
    observations: Iterable[Observation],
    *,
    methodologies: Methodologies,
    tolerances: Tolerances,
    snapshot_collected_at: datetime,
    now: datetime | None = None,
    invalid: Sequence[InvalidRecord] = (),
    not_applicable: Mapping[tuple[str, Metric], str] | None = None,
    missing_reasons: Mapping[tuple[str, Metric], str] | None = None,
) -> list[FieldResult]:
    """Uma `FieldResult` por (ativo, métrica) do universo, cada uma decidida isoladamente."""
    assets = list(assets)
    observations = list(observations)
    outside = sorted({o.asset_id for o in observations} - set(assets))
    if outside:
        # Nunca descartar observação em silêncio: quem chama decide o que fazer.
        raise ValueError(f"observações de ativos fora do universo informado: {outside}")
    grouped: dict[tuple[str, Metric], list[Observation]] = {}
    for obs in observations:
        grouped.setdefault((obs.asset_id, obs.metric), []).append(obs)
    na = not_applicable or {}
    miss = missing_reasons or {}
    results = []
    for asset_id in assets:
        for metric in Metric:
            key = (asset_id, metric)
            results.append(
                validate_field(
                    asset_id,
                    metric,
                    grouped.get(key, []),
                    methodologies=methodologies,
                    tolerances=tolerances,
                    snapshot_collected_at=snapshot_collected_at,
                    now=now,
                    invalid=invalid,
                    not_applicable_reason=na.get(key),
                    missing_reason=miss.get(key),
                )
            )
    return results

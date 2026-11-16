"""Comparabilidade antes de tolerância (README 7.3).

Duas observações só chegam à tolerância se forem do mesmo ativo e métrica, na mesma
unidade, com metodologia demonstrada como equivalente e datas compatíveis. Na dúvida o
resultado é "não comparável" com um motivo; nunca "verified porque os números parecem
próximos".
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from collector.contracts import Observation
from collector.settings import MetricMethodology, Verdict

# Motivos (texto estável, gravado em `FieldValidation.reason`).
UNKNOWN_METADATA = "unknown_metadata"
ASSET_MISMATCH = "asset_mismatch"
METRIC_MISMATCH = "metric_mismatch"
UNIT_MISMATCH = "unit_mismatch"
NOT_COMPARABLE_METRIC = "not_comparable_metric"
SINGLE_SOURCE_METRIC = "single_source_metric"
METHODOLOGY_MISMATCH = "methodology_mismatch"
PERIOD_MISMATCH = "period_mismatch"
DATE_MISMATCH = "date_mismatch"
REFERENCE_DATE_UNKNOWN = "reference_date_unknown"

# Brasil sem horário de verão desde 2019: deslocamento fixo evita depender de tzdata.
BRT = timezone(timedelta(hours=-3))


@dataclass(frozen=True)
class Comparability:
    comparable: bool
    reason: str | None = None


def _no(reason: str) -> Comparability:
    return Comparability(False, reason)


def _reference_day(obs: Observation) -> date | None:
    ref = obs.reference_at
    if ref is None:
        return None
    if isinstance(ref, datetime):
        return ref.astimezone(BRT).date()
    return ref


def check_comparability(
    a: Observation, b: Observation, methodology: MetricMethodology
) -> Comparability:
    """Decide se `a` e `b` (mesmo ativo e métrica) podem ir à tolerância."""
    if a.asset_id != b.asset_id or a.asset_class != b.asset_class:
        return _no(ASSET_MISMATCH)
    if a.metric != b.metric:
        return _no(METRIC_MISMATCH)
    if a.unit != b.unit or a.currency != b.currency:
        return _no(UNIT_MISMATCH)

    if methodology.verdict is Verdict.INSUFFICIENT_METADATA:
        return _no(UNKNOWN_METADATA)
    if methodology.verdict is Verdict.NOT_COMPARABLE:
        return _no(NOT_COMPARABLE_METRIC)
    if methodology.verdict is Verdict.SINGLE_SOURCE:
        return _no(SINGLE_SOURCE_METRIC)

    # Veredito `comparable`: a metodologia de cada fonte precisa estar declarada, ser a
    # mesma que a observação diz ter usado e coincidir em fórmula, janela e base.
    declared = []
    for obs in (a, b):
        source = methodology.sources.get(obs.source_id)
        if source is None or obs.methodology_id == "unknown":
            return _no(UNKNOWN_METADATA)
        if source.methodology_id == "unknown" or source.methodology_id != obs.methodology_id:
            return _no(UNKNOWN_METADATA)
        if source.formula is None or source.window is None or source.basis is None:
            return _no(UNKNOWN_METADATA)
        declared.append(source)
    first, second = declared
    if (first.formula, first.window, first.basis) != (second.formula, second.window, second.basis):
        return _no(METHODOLOGY_MISMATCH)

    if (a.period_start, a.period_end) != (b.period_start, b.period_end):
        return _no(PERIOD_MISMATCH)

    day_a, day_b = _reference_day(a), _reference_day(b)
    if day_a is None and day_b is None:
        # Sem data-base nas duas: vale o dia (horário de Brasília) em que foram coletadas.
        day_a = a.collected_at.astimezone(BRT).date()
        day_b = b.collected_at.astimezone(BRT).date()
    elif day_a is None or day_b is None:
        return _no(REFERENCE_DATE_UNKNOWN)
    if day_a != day_b:
        return _no(DATE_MISMATCH)
    return Comparability(True)


__all__ = ["Comparability", "check_comparability"]

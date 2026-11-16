"""Tolerância numérica (README 7.4) e carregamento de `config/tolerances.yaml`.

Tudo em `Decimal`. A função só vale para valores cuja comparabilidade já foi verificada
(ver `comparability.py`): tolerância não resolve comparabilidade.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, localcontext
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, StrictBool, ValidationError, model_validator

from collector.contracts import METRIC_UNIT, DecimalStr, Metric, Unit
from collector.settings import DEFAULT_CONFIG_DIR, SettingsError

DEFAULT_TOLERANCES_PATH = DEFAULT_CONFIG_DIR / "tolerances.yaml"


@dataclass(frozen=True)
class ToleranceResult:
    delta_abs: Decimal
    limit: Decimal
    within: bool


def _check_decimals(*values: Decimal) -> None:
    for value in values:
        if not isinstance(value, Decimal):
            raise TypeError("valores devem ser Decimal (float e int não são aceitos)")
        if not value.is_finite():
            raise ValueError("Todos os valores devem ser decimais finitos.")


def compute_tolerance(a: Decimal, b: Decimal, *, atol: Decimal, rtol: Decimal) -> ToleranceResult:
    """`delta_abs = |a-b|`; `limite = max(atol, rtol * max(|a|, |b|))`; dentro se `delta <= limite`."""
    _check_decimals(a, b, atol, rtol)
    if atol < 0 or rtol < 0:
        raise ValueError("Tolerâncias não podem ser negativas.")
    # Precisão folgada: nenhuma conta aqui é arredondada em silêncio.
    with localcontext() as ctx:
        ctx.prec = 80
        limit = max(atol, rtol * max(abs(a), abs(b)))
        delta = abs(a - b)
        return ToleranceResult(delta_abs=delta, limit=limit, within=delta <= limit)


def within_tolerance(a: Decimal, b: Decimal, *, atol: Decimal, rtol: Decimal) -> bool:
    return compute_tolerance(a, b, atol=atol, rtol=rtol).within


class MetricTolerance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit: Unit
    atol: DecimalStr
    rtol: DecimalStr

    @model_validator(mode="after")
    def _non_negative(self) -> MetricTolerance:
        if self.atol < 0 or self.rtol < 0:
            raise ValueError("atol e rtol não podem ser negativos")
        return self


class ValidationOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Começa ligado (plano T14, passo 5): nenhum selo antes de a T17 terminar.
    calibration_mode: StrictBool = True


class Tolerances(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    comparison: Literal["max_absolute_or_relative"]
    validation: ValidationOptions = ValidationOptions()
    metrics: dict[Metric, MetricTolerance]

    @model_validator(mode="after")
    def _check_metrics(self) -> Tolerances:
        if set(self.metrics) != set(Metric):
            raise ValueError(
                f"métricas inesperadas ou ausentes: faltam {sorted(set(Metric) - set(self.metrics))}"
            )
        for metric, tol in self.metrics.items():
            if tol.unit != METRIC_UNIT[metric]:
                raise ValueError(f"unidade {tol.unit.value} incompatível com {metric.value}")
        return self


def load_tolerances(path: Path | str = DEFAULT_TOLERANCES_PATH) -> Tolerances:
    path = Path(path)
    try:
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except FileNotFoundError as exc:
        raise SettingsError(f"arquivo de configuração ausente: {path}") from exc
    except yaml.YAMLError as exc:
        raise SettingsError(f"YAML inválido em {path}: {exc}") from exc
    try:
        return Tolerances.model_validate(data)
    except ValidationError as exc:
        raise SettingsError(f"configuração inválida em {path}: {exc}") from exc

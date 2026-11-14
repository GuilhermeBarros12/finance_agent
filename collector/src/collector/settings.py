"""Carregamento e validação de `config/methodologies.yaml` (T07)."""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, model_validator

DEFAULT_METHODOLOGIES_PATH = (
    Path(__file__).resolve().parents[3] / "config" / "methodologies.yaml"
)

EXPECTED_METRICS = frozenset(
    {"quote_price", "price_to_book", "price_to_earnings", "dividend_yield", "roe"}
)


class Verdict(StrEnum):
    COMPARABLE = "comparable"
    NOT_COMPARABLE = "not_comparable"
    INSUFFICIENT_METADATA = "insufficient_metadata"
    SINGLE_SOURCE = "single_source"


class SourceMethodology(BaseModel):
    model_config = ConfigDict(extra="forbid")

    methodology_id: str
    formula: str | None = None
    window: str | None = None
    basis: str | None = None
    reference_date_available: bool | None = None


class MetricMethodology(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    sources: dict[str, SourceMethodology]
    notes: str = ""


class Methodologies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    metrics: dict[str, MetricMethodology]

    @model_validator(mode="after")
    def _check_metrics(self) -> Methodologies:
        found = set(self.metrics)
        if found != EXPECTED_METRICS:
            raise ValueError(
                f"métricas inesperadas ou ausentes: faltam {sorted(EXPECTED_METRICS - found)}, "
                f"sobram {sorted(found - EXPECTED_METRICS)}"
            )
        return self


def load_methodologies(path: Path | str = DEFAULT_METHODOLOGIES_PATH) -> Methodologies:
    """Lê e valida o arquivo. Veredito desconhecido gera `ValidationError`."""
    with Path(path).open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return Methodologies.model_validate(data)

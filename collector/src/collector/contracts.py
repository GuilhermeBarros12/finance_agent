"""Contrato único de dados entre o coletor (Python) e as Edge Functions (TypeScript).

Os modelos abaixo são a fonte da verdade (ADR 0001, D8). O script
``scripts/export_schemas.py`` exporta o JSON Schema para ``schemas/`` e o TypeScript
é gerado a partir dele. Regras do README 7.1, 7.5 e 7.7:

* decimais viajam como string no JSON (``"8.50"``), nunca como número;
* percentuais ficam na escala de 0 a 100;
* números não finitos e unidades incompatíveis com a métrica são rejeitados;
* a URL de evidência não pode carregar credenciais nem parâmetros secretos.

As mesmas regras estão espelhadas em ``supabase/functions/_shared/schemas.ts`` (Zod).
Os exemplos em ``schemas/examples/`` garantem que os dois lados concordam.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import StrEnum
from typing import Annotated, Any
from urllib.parse import parse_qsl, urlsplit

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)
from pydantic_core import PydanticCustomError

# --- Padrões compartilhados com o lado TypeScript -------------------------------------

DECIMAL_PATTERN = r"^-?\d+(\.\d+)?$"
DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"
DATETIME_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"

# Nomes de parâmetro de URL que indicam credencial (README 7.1). Mesma lista no Zod.
SECRET_PARAM_PATTERN = r"token|key|secret|session|sid|auth|password|passwd|credential|signature"


class AssetClass(StrEnum):
    """Classe do ativo. Nesta fatia só existem ações (ADR 0001)."""

    STOCK = "stock"


class Metric(StrEnum):
    """Os cinco campos da fatia."""

    QUOTE_PRICE = "quote_price"
    PRICE_TO_BOOK = "price_to_book"
    PRICE_TO_EARNINGS = "price_to_earnings"
    DIVIDEND_YIELD = "dividend_yield"
    ROE = "roe"


class Unit(StrEnum):
    BRL = "BRL"
    RATIO = "ratio"
    PERCENT = "percent"


class ValidationStatus(StrEnum):
    """Estados de validação (README 7.5)."""

    VERIFIED = "verified"
    DIVERGENT = "divergent"
    SINGLE_SOURCE = "single_source"
    INCOMPARABLE = "incomparable"
    MISSING = "missing"
    NOT_APPLICABLE = "not_applicable"
    INVALID = "invalid"


class Freshness(StrEnum):
    """Estados de atualização (README 6.4)."""

    FRESH = "fresh"
    STALE = "stale"
    EXPIRED = "expired"
    UNKNOWN_REFERENCE_DATE = "unknown_reference_date"


# Unidade (e moeda) exigida por métrica. Qualquer outra combinação é rejeitada.
METRIC_UNIT: dict[Metric, Unit] = {
    Metric.QUOTE_PRICE: Unit.BRL,
    Metric.PRICE_TO_BOOK: Unit.RATIO,
    Metric.PRICE_TO_EARNINGS: Unit.RATIO,
    Metric.DIVIDEND_YIELD: Unit.PERCENT,
    Metric.ROE: Unit.PERCENT,
}


# --- Tipos primitivos -----------------------------------------------------------------


def _parse_decimal(value: Any) -> Decimal:
    """Aceita só string decimal canônica (ou Decimal já pronto); rejeita float e int."""
    if isinstance(value, Decimal):
        decimal = value
    elif isinstance(value, str):
        if not re.fullmatch(DECIMAL_PATTERN, value):
            raise ValueError("decimal deve ser string como '8.50' (sem expoente, NaN ou espaços)")
        try:
            decimal = Decimal(value)
        except InvalidOperation as exc:  # pragma: no cover - o padrão já filtra
            raise ValueError("decimal inválido") from exc
    else:
        raise PydanticCustomError("decimal_type", "decimal deve ser string, não número")
    if not decimal.is_finite():
        raise ValueError("decimal deve ser finito")
    return decimal


DecimalStr = Annotated[
    Decimal,
    BeforeValidator(_parse_decimal),
    PlainSerializer(lambda v: format(v, "f"), return_type=str, when_used="always"),
    WithJsonSchema({"type": "string", "pattern": DECIMAL_PATTERN}),
]


def _parse_date(value: Any) -> date:
    if isinstance(value, datetime):
        raise PydanticCustomError("date_type", "data deve ser AAAA-MM-DD, sem hora")
    if isinstance(value, date):
        return value
    if isinstance(value, str) and re.fullmatch(DATE_PATTERN, value):
        return date.fromisoformat(value)
    raise ValueError("data deve ser string AAAA-MM-DD")


IsoDate = Annotated[
    date,
    BeforeValidator(_parse_date),
    PlainSerializer(lambda v: v.isoformat(), return_type=str, when_used="always"),
    WithJsonSchema({"type": "string", "pattern": DATE_PATTERN}),
]


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and re.fullmatch(DATETIME_PATTERN, value):
        parsed = datetime.fromisoformat(value)
    else:
        raise ValueError("instante deve ser string ISO 8601 com fuso (ex.: 2026-09-18T21:00:00Z)")
    if parsed.tzinfo is None:
        raise ValueError("instante deve ter fuso horário")
    return parsed


def _serialize_datetime(value: datetime) -> str:
    text = value.isoformat()
    return text[:-6] + "Z" if text.endswith("+00:00") else text


IsoDateTime = Annotated[
    datetime,
    BeforeValidator(_parse_datetime),
    PlainSerializer(_serialize_datetime, return_type=str, when_used="always"),
    WithJsonSchema({"type": "string", "pattern": DATETIME_PATTERN}),
]


def _parse_reference_at(value: Any) -> date | datetime:
    """`reference_at` é uma data-base (AAAA-MM-DD) ou um instante com fuso."""
    if isinstance(value, datetime):
        return _parse_datetime(value)
    if isinstance(value, date):
        return value
    if isinstance(value, str) and re.fullmatch(DATE_PATTERN, value):
        return date.fromisoformat(value)
    return _parse_datetime(value)


def _serialize_reference_at(value: date | datetime) -> str:
    return _serialize_datetime(value) if isinstance(value, datetime) else value.isoformat()


ReferenceAt = Annotated[
    date | datetime,
    BeforeValidator(_parse_reference_at),
    PlainSerializer(_serialize_reference_at, return_type=str, when_used="always"),
    WithJsonSchema(
        {
            "type": "string",
            "pattern": f"(?:{DATE_PATTERN})|(?:{DATETIME_PATTERN})",
        }
    ),
]

NonEmptyStr = Annotated[str, StringConstraints(min_length=1)]
Sha256Hex = Annotated[str, StringConstraints(pattern=SHA256_PATTERN)]


def _check_source_url(value: Any) -> str:
    if not isinstance(value, str):
        raise PydanticCustomError("url_type", "source_url deve ser string")
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("source_url deve ser uma URL http(s) absoluta")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise ValueError("source_url não pode conter credenciais")
    if parts.fragment:
        raise ValueError("source_url não pode conter fragmento")
    for name, _ in parse_qsl(parts.query, keep_blank_values=True):
        if re.search(SECRET_PARAM_PATTERN, name, re.IGNORECASE):
            raise ValueError("source_url não pode conter parâmetro de credencial ou sessão")
    return value


SourceUrl = Annotated[
    str,
    BeforeValidator(_check_source_url),
    WithJsonSchema({"type": "string", "pattern": r"^https?://", "minLength": 1}),
]


class _Contract(BaseModel):
    """Base: campos desconhecidos são erro, para o contrato não derivar em silêncio."""

    model_config = ConfigDict(extra="forbid", use_enum_values=False)


# --- Modelos --------------------------------------------------------------------------


class Observation(_Contract):
    """Um campo de um ativo em uma fonte (README 7.1)."""

    observation_id: NonEmptyStr
    asset_id: NonEmptyStr
    asset_class: AssetClass
    metric: Metric
    raw_value: NonEmptyStr
    value_decimal: DecimalStr
    unit: Unit
    currency: Annotated[str, StringConstraints(pattern=r"^BRL$")] | None = None
    period_start: IsoDate | None = None
    period_end: IsoDate | None = None
    reference_at: ReferenceAt | None = None
    collected_at: IsoDateTime
    source_id: NonEmptyStr
    source_url: SourceUrl
    upstream_source: NonEmptyStr | None = None
    methodology_id: NonEmptyStr = "unknown"
    run_id: NonEmptyStr
    parser_version: NonEmptyStr
    raw_content_hash: Sha256Hex

    @model_validator(mode="after")
    def _check_unit_and_period(self) -> Observation:
        expected = METRIC_UNIT[self.metric]
        if self.unit != expected:
            raise ValueError(f"unidade {self.unit.value} incompatível com {self.metric.value}")
        if self.metric is Metric.QUOTE_PRICE:
            if self.currency != "BRL":
                raise ValueError("quote_price exige currency BRL")
        elif self.currency is not None:
            raise ValueError(f"{self.metric.value} não tem moeda")
        if (
            self.period_start is not None
            and self.period_end is not None
            and self.period_end < self.period_start
        ):
            raise ValueError("period_end anterior a period_start")
        return self


class Comparison(_Contract):
    """Resultado numérico da comparação (README 7.4). Todos os decimais são string."""

    delta_abs: DecimalStr
    limit: DecimalStr
    atol: DecimalStr
    rtol: DecimalStr
    tolerance_version: NonEmptyStr


class FieldValidation(_Contract):
    """Estado de validação de um campo de um ativo (README 7.5)."""

    asset_id: NonEmptyStr
    metric: Metric
    status: ValidationStatus
    freshness: Freshness
    selected_observation_id: NonEmptyStr | None = None
    observation_ids: list[NonEmptyStr]
    comparison: Comparison | None = None
    reason: str | None = None

    @model_validator(mode="after")
    def _check_selection(self) -> FieldValidation:
        if self.status is ValidationStatus.DIVERGENT and self.selected_observation_id is not None:
            raise ValueError("divergent não seleciona observação (README 7.6)")
        if (
            self.selected_observation_id is not None
            and self.selected_observation_id not in self.observation_ids
        ):
            raise ValueError("selected_observation_id deve estar em observation_ids")
        if (
            self.status in (ValidationStatus.VERIFIED, ValidationStatus.DIVERGENT)
            and self.comparison is None
        ):
            raise ValueError(f"{self.status.value} exige comparison")
        return self


class SourceFailure(_Contract):
    """Falha de coleta de um ativo em uma fonte. Nunca vira zero nem dado vazio."""

    asset_id: NonEmptyStr
    source_id: NonEmptyStr
    reason: NonEmptyStr


class SnapshotManifest(_Contract):
    """Resumo de um lote publicado."""

    snapshot_id: NonEmptyStr
    run_id: NonEmptyStr
    collected_at: IsoDateTime
    universe_version: NonEmptyStr
    assets_total: Annotated[int, Field(ge=0, strict=True)]
    assets_updated: Annotated[int, Field(ge=0, strict=True)]
    failures: list[SourceFailure]

    @model_validator(mode="after")
    def _check_counts(self) -> SnapshotManifest:
        if self.assets_updated > self.assets_total:
            raise ValueError("assets_updated maior que assets_total")
        return self

"""Adaptador da brapi para `quote_price` (T11).

Uma requisição por ativo (limite do plano gratuito). O token vai no cabeçalho
`Authorization` e nunca em URL, log, mensagem de erro ou `Observation`.

ATENÇÃO: o caminho e os nomes dos campos abaixo seguem o README 6.2 e a fixture
sintética. A documentação oficial não pôde ser baixada no ambiente de execução (T11.md).
Todos estão concentrados nas constantes deste bloco, para troca fácil.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from pydantic import SecretStr

from collector.contracts import AssetClass, Metric, Observation, SourceFailure, Unit
from collector.http import FetchError, HttpClient
from collector.settings import SourceConfig
from collector.sources.base import RawRecord, SourceAdapter, utc_now

# --- Contrato da API (confirmar com a documentação oficial) ---------------------------
QUOTE_PATH = "/api/v2/stocks/quote"
SYMBOLS_PARAM = "symbols"
RESULTS_KEY = "results"
SYMBOL_FIELD = "symbol"
PRICE_FIELD = "regularMarketPrice"
TIME_FIELD = "regularMarketTime"
CURRENCY_FIELD = "currency"
# ---------------------------------------------------------------------------------------

SOURCE_ID = "brapi"
BRAPI_METHODOLOGY_ID = "brapi_quote"
PARSER_VERSION = "brapi-quote-0.1"
_TICKER = re.compile(r"[A-Z]{4}[0-9]{1,2}")
_MAX_PRICE = Decimal(10) ** 9


class BrapiParseError(ValueError):
    """Resposta da brapi fora do formato esperado. A mensagem nunca traz token nem URL."""


@dataclass
class CollectResult:
    observations: list[Observation] = field(default_factory=list)
    failures: list[SourceFailure] = field(default_factory=list)


def _reject_constant(name: str) -> Any:
    raise BrapiParseError(f"constante JSON não permitida: {name}")


def _load_json(content: bytes) -> Any:
    """Lê o JSON sem `float`: todo número vira `Decimal` direto do texto."""
    try:
        text = content.decode("utf-8")
        return json.loads(
            text, parse_float=Decimal, parse_int=Decimal, parse_constant=_reject_constant
        )
    except BrapiParseError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise BrapiParseError("resposta não é JSON válido") from None


def _parse_price(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, Decimal):
        raise BrapiParseError(f"{PRICE_FIELD} ausente ou não numérico")
    if not value.is_finite() or value <= 0 or value >= _MAX_PRICE:
        raise BrapiParseError(f"{PRICE_FIELD} inválido (deve ser positivo e finito)")
    return value


def _parse_reference(value: Any) -> datetime:
    if not isinstance(value, str):
        raise BrapiParseError(f"{TIME_FIELD} ausente ou não é texto ISO 8601")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise BrapiParseError(f"{TIME_FIELD} inválido") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise BrapiParseError(f"{TIME_FIELD} sem fuso horário")
    return parsed.astimezone(UTC)


class BrapiAdapter(SourceAdapter):
    source_id = SOURCE_ID

    def __init__(
        self,
        http: HttpClient,
        source: SourceConfig,
        token: SecretStr,
        run_id: str,
        *,
        methodology_id: str = BRAPI_METHODOLOGY_ID,
    ) -> None:
        if source.id != SOURCE_ID:
            raise ValueError("configuração de fonte não é da brapi")
        if not token.get_secret_value():
            raise ValueError("token da brapi vazio")
        self._http = http
        self._source = source
        self._token = token  # SecretStr: fora de repr/str
        self._run_id = run_id
        self._methodology_id = methodology_id
        self.failures: list[SourceFailure] = []

    def _source_url(self, asset: str) -> str:
        return f"{self._source.base_url.rstrip('/')}{QUOTE_PATH}?{SYMBOLS_PARAM}={asset}"

    def fetch(self, assets: Sequence[str]) -> list[RawRecord]:
        """Uma requisição por ativo. Falha de um ativo vai para `self.failures`.

        Se nenhum ativo foi coletado, lança `FetchError` (nunca devolve vazio em silêncio).
        """
        self.failures = []
        records: list[RawRecord] = []
        for asset in assets:
            if not _TICKER.fullmatch(asset):
                self.failures.append(
                    SourceFailure(
                        asset_id=asset or "?", source_id=SOURCE_ID, reason="ticker inválido"
                    )
                )
                continue
            try:
                response = self._http.get(
                    SOURCE_ID,
                    f"{self._source.base_url.rstrip('/')}{QUOTE_PATH}",
                    params={SYMBOLS_PARAM: asset},
                    headers={"Authorization": f"Bearer {self._token.get_secret_value()}"},
                )
            except FetchError as exc:
                self.failures.append(
                    SourceFailure(asset_id=asset, source_id=SOURCE_ID, reason=str(exc)[:200])
                )
                continue
            records.append(
                RawRecord(
                    source_id=SOURCE_ID,
                    url=self._source_url(asset),
                    content=response.content,
                    fetched_at=utc_now(),
                    asset_id=asset,
                )
            )
        if not records:
            raise FetchError("brapi: nenhum ativo coletado")
        return records

    def parse(self, raw: RawRecord) -> list[Observation]:
        if raw.asset_id is None:
            raise BrapiParseError("RawRecord da brapi precisa de asset_id")
        data = _load_json(raw.content)
        results = data.get(RESULTS_KEY) if isinstance(data, dict) else None
        if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
            raise BrapiParseError(f"{RESULTS_KEY} deve ter exatamente um item")
        item = results[0]
        symbol = item.get(SYMBOL_FIELD)
        if not isinstance(symbol, str) or symbol.upper() != raw.asset_id.upper():
            raise BrapiParseError(f"{SYMBOL_FIELD} diferente do ativo pedido")
        currency = item.get(CURRENCY_FIELD)
        if currency is not None and currency != "BRL":
            raise BrapiParseError(f"{CURRENCY_FIELD} diferente de BRL")
        price = _parse_price(item.get(PRICE_FIELD))
        reference_at = _parse_reference(item.get(TIME_FIELD))
        return [
            Observation(
                observation_id=f"{self._run_id}:{SOURCE_ID}:{raw.asset_id}:{Metric.QUOTE_PRICE.value}",
                asset_id=raw.asset_id,
                asset_class=AssetClass.STOCK,
                metric=Metric.QUOTE_PRICE,
                raw_value=format(price, "f"),
                value_decimal=price,
                unit=Unit.BRL,
                currency="BRL",
                reference_at=reference_at,
                collected_at=raw.fetched_at,
                source_id=SOURCE_ID,
                source_url=raw.url,
                methodology_id=self._methodology_id,
                run_id=self._run_id,
                parser_version=PARSER_VERSION,
                raw_content_hash=raw.content_hash,
            )
        ]

    def collect(self, assets: Sequence[str]) -> CollectResult:
        """Busca e interpreta; falha de um ativo não derruba os demais."""
        result = CollectResult()
        try:
            records = self.fetch(assets)
        except FetchError:
            result.failures = list(self.failures)
            return result
        result.failures = list(self.failures)
        for raw in records:
            try:
                result.observations.extend(self.parse(raw))
            except (BrapiParseError, ValueError) as exc:
                result.failures.append(
                    SourceFailure(
                        asset_id=raw.asset_id or "?", source_id=SOURCE_ID, reason=str(exc)[:200]
                    )
                )
        return result

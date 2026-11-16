"""Fontes sintéticas do modo `fixtures` (T15, README 14.1).

Tudo sai de arquivos escritos à mão em `collector/tests/fixtures/pipeline/`, com tickers
inventados (DEMO3, TEST4). A brapi passa pelo adaptador real (T11) sobre um
`httpx.MockTransport`, então nenhuma rede é usada; Fundamentus e StatusInvest ainda não têm
adaptador (T12 e T13), por isso os indicadores vêm de `FixtureIndicatorAdapter`.

Este módulo não é um scraper: não escreve parser de nenhuma página.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
from pydantic import SecretStr

from collector.contracts import METRIC_UNIT, AssetClass, Metric, Observation, SourceFailure
from collector.http import HttpClient
from collector.settings import Settings, SettingsError
from collector.sources.base import CollectResult, SourceCollector
from collector.sources.brapi import BrapiAdapter

DEFAULT_FIXTURES_DIR = (
    Path(__file__).resolve().parents[3] / "collector" / "tests" / "fixtures" / "pipeline"
)
FIXTURE_PARSER_VERSION = "fixture-0.1"
INDICATOR_METRICS = (
    Metric.PRICE_TO_BOOK,
    Metric.PRICE_TO_EARNINGS,
    Metric.DIVIDEND_YIELD,
    Metric.ROE,
)


@dataclass(frozen=True)
class FixtureSet:
    universe_version: str
    assets: list[str]
    indicators: dict[str, dict[str, dict[str, dict[str, str]]]]
    brapi_dir: Path


def load_fixture_set(directory: Path | str = DEFAULT_FIXTURES_DIR) -> FixtureSet:
    directory = Path(directory)
    path = directory / "indicators.json"
    try:
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return FixtureSet(
            universe_version=str(data["universe_version"]),
            assets=[str(a) for a in data["assets"]],
            indicators=data["indicators"],
            brapi_dir=directory / "brapi",
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SettingsError(f"fixtures inválidas em {path}: {type(exc).__name__}") from None


class FixtureIndicatorAdapter:
    """Indicadores de uma fonte vindos de JSON sintético (sem rede, sem parser de página)."""

    def __init__(
        self,
        source_id: str,
        base_url: str,
        data: dict[str, dict[str, dict[str, str]]],
        run_id: str,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.source_id = source_id
        self._base_url = base_url.rstrip("/")
        self._data = data
        self._run_id = run_id
        self._clock = clock

    def collect(self, assets: Sequence[str]) -> CollectResult:
        result = CollectResult()
        for asset in assets:
            cells = self._data.get(asset)
            if cells is None:
                result.failures.append(
                    SourceFailure(
                        asset_id=asset, source_id=self.source_id, reason="sem dado na fixture"
                    )
                )
                continue
            for metric in INDICATOR_METRICS:
                cell = cells.get(metric.value)
                if cell is None:
                    continue
                result.observations.append(self._observation(asset, metric, cell))
        return result

    def _observation(self, asset: str, metric: Metric, cell: dict[str, str]) -> Observation:
        digest = hashlib.sha256(json.dumps(cell, sort_keys=True).encode()).hexdigest()
        return Observation(
            observation_id=f"{self._run_id}:{self.source_id}:{asset}:{metric.value}",
            asset_id=asset,
            asset_class=AssetClass.STOCK,
            metric=metric,
            raw_value=cell["raw"],
            value_decimal=cell["value"],
            unit=METRIC_UNIT[metric],
            reference_at=date.fromisoformat(cell["reference_date"]),
            collected_at=self._clock(),
            source_id=self.source_id,
            source_url=f"{self._base_url}/fixture/{asset}",
            methodology_id="unknown",
            run_id=self._run_id,
            parser_version=FIXTURE_PARSER_VERSION,
            raw_content_hash=digest,
        )


def _brapi_handler(directory: Path) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        symbol = request.url.params.get("symbols", "")
        path = directory / f"{symbol}.json"
        if not symbol.isalnum() or not path.is_file():
            return httpx.Response(404, json={"error": "sem fixture"})
        return httpx.Response(200, content=path.read_bytes())

    return handler


def build_fixture_adapters(
    settings: Settings, fixtures: FixtureSet, run_id: str, stack: ExitStack
) -> list[SourceCollector]:
    http = stack.enter_context(
        HttpClient(
            settings.sources,
            settings.scraper_contact,
            transport=httpx.MockTransport(_brapi_handler(fixtures.brapi_dir)),
            sleep=lambda _us: None,
        )
    )
    adapters: list[SourceCollector] = [
        BrapiAdapter(http, settings.sources.get("brapi"), SecretStr("fixture-token"), run_id)
    ]
    for source_id, data in fixtures.indicators.items():
        adapters.append(
            FixtureIndicatorAdapter(
                source_id, settings.sources.get(source_id).base_url, data, run_id
            )
        )
    return adapters

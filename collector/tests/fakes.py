"""Adaptadores e armazenamento falsos para os testes do pipeline (T15).

`FakeIndicatorSource` simula uma fonte de indicadores (como Fundamentus ou StatusInvest)
sem rede e sem parser de página. Tickers e valores são inventados.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from collector.contracts import METRIC_UNIT, AssetClass, Metric, Observation, SourceFailure
from collector.settings import Methodologies
from collector.sources.base import CollectResult
from collector.store import StagedRun

INDICATORS = (Metric.PRICE_TO_BOOK, Metric.PRICE_TO_EARNINGS, Metric.DIVIDEND_YIELD, Metric.ROE)
BASE_VALUES = {
    Metric.PRICE_TO_BOOK: Decimal("1.50"),
    Metric.PRICE_TO_EARNINGS: Decimal("12.00"),
    Metric.DIVIDEND_YIELD: Decimal("6.00"),
    Metric.ROE: Decimal("15.00"),
}
REFERENCE_DAY = date(2026, 11, 13)


class FakeIndicatorSource:
    def __init__(
        self,
        source_id: str,
        run_id: str,
        *,
        fail_assets: Sequence[str] = (),
        fail_all: bool = False,
        only_assets: Sequence[str] | None = None,
        offset: Decimal = Decimal(0),
        methodology_id: str = "fake_m",
        extra_assets: Sequence[str] = (),
        boom: Exception | None = None,
    ) -> None:
        self.source_id = source_id
        self.run_id = run_id
        self.fail_assets = set(fail_assets)
        self.fail_all = fail_all
        self.only_assets = None if only_assets is None else set(only_assets)
        self.offset = offset
        self.methodology_id = methodology_id
        self.extra_assets = list(extra_assets)
        self.boom = boom

    def collect(self, assets: Sequence[str]) -> CollectResult:
        if self.boom is not None:
            raise self.boom
        result = CollectResult()
        for asset in [*assets, *self.extra_assets]:
            if (
                self.fail_all
                or asset in self.fail_assets
                or (self.only_assets is not None and asset not in self.only_assets)
            ):
                result.failures.append(
                    SourceFailure(asset_id=asset, source_id=self.source_id, reason="falha simulada")
                )
                continue
            for metric in INDICATORS:
                result.observations.append(self._obs(asset, metric))
        return result

    def _obs(self, asset: str, metric: Metric) -> Observation:
        value = BASE_VALUES[metric] + self.offset
        raw = format(value, "f")
        return Observation(
            observation_id=f"{self.run_id}:{self.source_id}:{asset}:{metric.value}",
            asset_id=asset,
            asset_class=AssetClass.STOCK,
            metric=metric,
            raw_value=raw,
            value_decimal=value,
            unit=METRIC_UNIT[metric],
            reference_at=REFERENCE_DAY,
            collected_at=datetime.now(UTC),
            source_id=self.source_id,
            source_url=f"https://example.test/{self.source_id}/{asset}",
            methodology_id=self.methodology_id,
            run_id=self.run_id,
            parser_version="fake-0.1",
            raw_content_hash=hashlib.sha256(
                f"{self.source_id}{asset}{metric}".encode()
            ).hexdigest(),
        )


def comparable_methodologies(base: Methodologies) -> Methodologies:
    """Metodologias em que as duas fontes falsas são comparáveis (só para os testes)."""
    data = base.model_dump(mode="json")
    for name, metric in data["metrics"].items():
        if name == "quote_price":
            continue
        metric["verdict"] = "comparable"
        for source in ("fundamentus", "statusinvest"):
            metric["sources"][source] = {
                "methodology_id": "fake_m",
                "formula": "f",
                "window": "w",
                "basis": "b",
                "reference_date_available": True,
            }
    return Methodologies.model_validate(data)


class FakeStore:
    """`BatchStore` em memória: registra a ordem das chamadas."""

    def __init__(self, *, batch_done: bool = False, publish_error: Exception | None = None) -> None:
        self.batch_done = batch_done
        self.publish_error = publish_error
        self.calls: list[str] = []
        self.staged: StagedRun | None = None
        self.manifest: dict[str, Any] | None = None

    def batch_done_on(self, day: date) -> bool:
        self.calls.append("batch_done_on")
        return self.batch_done

    def stage(self, staged: StagedRun) -> None:
        self.calls.append("stage")
        self.staged = staged

    def publish(self, run_id: str, manifest: dict[str, Any]) -> str:
        self.calls.append("publish")
        self.manifest = manifest
        if self.publish_error is not None:
            raise self.publish_error
        return "00000000-0000-4000-8000-0000000000aa"

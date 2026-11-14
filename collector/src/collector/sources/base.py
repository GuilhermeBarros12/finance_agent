"""Interface comum dos adaptadores de fonte.

`fetch` busca e `parse` interpreta, separados: os testes de parser usam só `parse`
com fixtures, sem rede.
"""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from collector.contracts import Observation


@dataclass(frozen=True)
class RawRecord:
    """Resposta bruta de uma fonte, antes de qualquer interpretação.

    `asset_id` é `None` quando a resposta cobre vários ativos (ex.: tabela única).
    `fetched_at` é um instante com fuso UTC.
    """

    source_id: str
    url: str
    content: bytes
    fetched_at: datetime
    asset_id: str | None = None

    def __post_init__(self) -> None:
        if self.fetched_at.tzinfo is None or self.fetched_at.utcoffset() != UTC.utcoffset(None):
            raise ValueError("fetched_at deve ter fuso UTC")

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


class SourceAdapter(ABC):
    source_id: str

    @abstractmethod
    def fetch(self, assets: Sequence[str]) -> list[RawRecord]:
        """Busca as respostas brutas. Falha de rede lança exceção; nunca devolve vazio."""

    @abstractmethod
    def parse(self, raw: RawRecord) -> list[Observation]:
        """Interpreta uma resposta bruta. Formato inesperado lança erro de parser."""


def utc_now() -> datetime:
    return datetime.now(UTC)

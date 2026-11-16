"""Acesso ao banco pelo papel `collector_ingest` (T15, D13).

O papel só consegue: ler `assets` e `data_sources`, inserir em `collection_runs` e nas
tabelas de staging, e executar `publish_snapshot` e `collector_batch_done_on`. Nada aqui
lê dados publicados.

Ordem obrigatória do pipeline: `stage` confirma (commit) numa transação própria; só
depois `publish` chama a RPC, noutra transação. Assim a RPC enxerga o staging e uma
publicação recusada não apaga o que foi preparado (nem o snapshot ativo muda).

Deadlock (40P01) e `lock_timeout` (55P03) são transitórios: a transação foi desfeita pelo
servidor, então repetir a chamada inteira é seguro. Vale para `stage` e para `publish`,
com número máximo de tentativas e espera crescente.

Mensagens de erro nunca carregam a string de conexão: só a classe do erro, o SQLSTATE e o
texto primário do servidor (que não inclui credenciais).
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Protocol

import psycopg
from psycopg.types.json import Jsonb

from collector.contracts import FieldValidation, Observation

RETRYABLE_SQLSTATES = frozenset({"40P01", "55P03"})
MAX_ATTEMPTS = 4
BASE_DELAY_SECONDS = 2
CONNECT_TIMEOUT_SECONDS = 15


class StoreError(Exception):
    """Falha de banco sem detalhes sensíveis."""


class PublishRejected(StoreError):
    """A RPC recusou o lote (integridade, manifesto). O snapshot ativo não mudou."""


def staging_id(run_id: str, observation_id: str) -> uuid.UUID:
    """Id da observação no staging: determinístico, para as validações poderem citá-lo."""
    return uuid.uuid5(uuid.UUID(run_id), observation_id)


@dataclass
class StagedRun:
    run_id: str
    started_at: datetime
    parser_versions: dict[str, str]
    summary: dict[str, Any]
    observations: list[Observation] = field(default_factory=list)
    validations: list[FieldValidation] = field(default_factory=list)


class BatchStore(Protocol):
    def batch_done_on(self, day: date) -> bool: ...

    def stage(self, staged: StagedRun) -> None: ...

    def publish(self, run_id: str, manifest: dict[str, Any]) -> str: ...


def call_with_retry[T](
    fn: Callable[[], T],
    *,
    max_attempts: int = MAX_ATTEMPTS,
    base_delay: int = BASE_DELAY_SECONDS,
    sleep: Callable[[int], None] = time.sleep,
    on_retry: Callable[[int, str, int], None] | None = None,
) -> T:
    """Repete `fn` em 40P01 e 55P03, com espera crescente (base, 2x, 4x...)."""
    attempt = 1
    while True:
        try:
            return fn()
        except psycopg.Error as exc:
            state = exc.sqlstate
            if state not in RETRYABLE_SQLSTATES or attempt >= max_attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            if on_retry is not None:
                on_retry(attempt, str(state), delay)
            sleep(delay)
            attempt += 1


def _describe(exc: psycopg.Error) -> str:
    message = exc.diag.message_primary if exc.diag and exc.diag.message_primary else ""
    return f"{type(exc).__name__} (sqlstate {exc.sqlstate}): {message}".strip()


def _obs_row(run_id: str, obs: Observation) -> tuple[Any, ...]:
    reference = obs.reference_at
    reference_at = reference if isinstance(reference, datetime) else None
    reference_date = reference if isinstance(reference, date) and reference_at is None else None
    return (
        staging_id(run_id, obs.observation_id),
        uuid.UUID(run_id),
        obs.asset_id,
        obs.source_id,
        obs.metric.value,
        obs.raw_value,
        obs.value_decimal,
        obs.unit.value,
        obs.currency,
        obs.period_start,
        obs.period_end,
        reference_at,
        reference_date,
        obs.collected_at,
        obs.source_url,
        obs.upstream_source,
        obs.methodology_id,
        obs.parser_version,
        obs.raw_content_hash,
    )


def _validation_row(run_id: str, val: FieldValidation) -> tuple[Any, ...]:
    cmp = val.comparison
    selected = val.selected_observation_id
    return (
        uuid.UUID(run_id),
        val.asset_id,
        val.metric.value,
        val.status.value,
        val.freshness.value,
        staging_id(run_id, selected) if selected is not None else None,
        [staging_id(run_id, oid) for oid in val.observation_ids],
        cmp.delta_abs if cmp else None,
        cmp.limit if cmp else None,
        cmp.atol if cmp else None,
        cmp.rtol if cmp else None,
        cmp.tolerance_version if cmp else None,
        val.reason,
    )


_INSERT_RUN = (
    "insert into public.collection_runs (id, started_at, status, parser_versions, summary) "
    "values (%s, %s, 'running', %s, %s)"
)
_INSERT_OBS = (
    "insert into public.staging_observations (id, run_id, asset_symbol, source_code, metric, "
    "raw_value, value_decimal, unit, currency, period_start, period_end, reference_at, "
    "reference_date, collected_at, source_url, upstream_source, methodology_id, parser_version, "
    "raw_content_hash) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
    "%s, %s, %s)"
)
_INSERT_VAL = (
    "insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, "
    "selected_observation_id, observation_ids, delta_abs, limit_value, atol, rtol, "
    "tolerance_version, reason) values (%s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, %s, %s, %s)"
)


class PostgresStore:
    """`BatchStore` sobre psycopg 3. `database_url` é segredo: nunca é impresso."""

    def __init__(
        self,
        database_url: str,
        *,
        sleep: Callable[[int], None] = time.sleep,
        max_attempts: int = MAX_ATTEMPTS,
        base_delay: int = BASE_DELAY_SECONDS,
        on_retry: Callable[[int, str, int], None] | None = None,
    ) -> None:
        self._url = database_url
        self._sleep = sleep
        self._max_attempts = max_attempts
        self._base_delay = base_delay
        self._on_retry = on_retry

    def _connect(self) -> psycopg.Connection[Any]:
        try:
            return psycopg.connect(self._url, connect_timeout=CONNECT_TIMEOUT_SECONDS)
        except psycopg.Error as exc:
            raise StoreError(f"conexão com o banco falhou: {type(exc).__name__}") from None

    def _retry[T](self, fn: Callable[[], T]) -> T:
        return call_with_retry(
            fn,
            max_attempts=self._max_attempts,
            base_delay=self._base_delay,
            sleep=self._sleep,
            on_retry=self._on_retry,
        )

    def batch_done_on(self, day: date) -> bool:
        try:
            with self._connect() as conn:
                row = conn.execute("select public.collector_batch_done_on(%s)", (day,)).fetchone()
        except psycopg.Error as exc:
            raise StoreError(f"consulta do lote do dia falhou: {_describe(exc)}") from None
        return bool(row and row[0])

    def stage(self, staged: StagedRun) -> None:
        """Insere execução, observações e validações e CONFIRMA, em transação própria."""

        def attempt() -> None:
            # o `with` da conexão confirma (commit) ao sair sem erro
            with self._connect() as conn, conn.cursor() as cur:
                cur.execute(
                    _INSERT_RUN,
                    (
                        uuid.UUID(staged.run_id),
                        staged.started_at,
                        Jsonb(staged.parser_versions),
                        Jsonb(staged.summary),
                    ),
                )
                cur.executemany(
                    _INSERT_OBS, [_obs_row(staged.run_id, o) for o in staged.observations]
                )
                cur.executemany(
                    _INSERT_VAL,
                    [_validation_row(staged.run_id, v) for v in staged.validations],
                )

        try:
            self._retry(attempt)
        except psycopg.Error as exc:
            raise StoreError(f"gravação em staging falhou: {_describe(exc)}") from None

    def publish(self, run_id: str, manifest: dict[str, Any]) -> str:
        """Chama `publish_snapshot` (transação própria). Devolve o id do snapshot."""

        def attempt() -> str:
            with self._connect() as conn:
                row = conn.execute(
                    "select public.publish_snapshot(%s, %s)",
                    (uuid.UUID(run_id), Jsonb(manifest)),
                ).fetchone()
            if row is None:  # pragma: no cover - a função sempre devolve uma linha
                raise StoreError("publish_snapshot não devolveu o id do snapshot")
            return str(row[0])

        try:
            return self._retry(attempt)
        except psycopg.errors.IntegrityConstraintViolation as exc:
            raise PublishRejected(_describe(exc)) from None
        except psycopg.errors.InvalidParameterValue as exc:
            raise PublishRejected(_describe(exc)) from None
        except psycopg.Error as exc:
            raise StoreError(f"publicação falhou: {_describe(exc)}") from None


__all__ = [
    "BatchStore",
    "PostgresStore",
    "PublishRejected",
    "StagedRun",
    "StoreError",
    "call_with_retry",
    "staging_id",
]

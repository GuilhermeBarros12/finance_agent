"""Fixtures dos testes de integração (T15): Supabase local descartável.

Os testes só rodam com `COLLECTOR_TEST_DATABASE_URL` apontando para o banco LOCAL, com
um usuário administrador (no Supabase local: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
valores públicos da CLI). Sem a variável, são pulados (a CI Python não tem Supabase).

Para conectar como `collector_ingest`, a fixture define uma senha ALEATÓRIA para o papel só
durante o teste e a remove no fim (`nologin`, sem senha): nenhuma senha vai ao repositório.
Depois de cada teste o banco volta ao estado anterior (snapshots, execuções, staging, ativos
extras e o ponteiro ativo). A limpeza usa a chave de retenção da T08 (`app.retention_job`),
a mesma da `prune_snapshots`.
"""

from __future__ import annotations

import os
import secrets
from collections.abc import Iterator
from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit

import psycopg
import pytest

ADMIN_URL_ENV = "COLLECTOR_TEST_DATABASE_URL"
EXTRA_ASSETS = ("DEMO5", "TEST6")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if os.environ.get(ADMIN_URL_ENV):
        return
    skip = pytest.mark.skip(reason=f"{ADMIN_URL_ENV} ausente (sem Supabase local)")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


def _local_only(url: str) -> None:
    host = urlsplit(url).hostname or ""
    if host not in ("127.0.0.1", "localhost", "::1"):
        pytest.exit(f"{ADMIN_URL_ENV} deve apontar para o banco local, não para {host!r}", 2)


@dataclass
class Db:
    admin_url: str
    collector_url: str
    admin: psycopg.Connection
    baseline: dict = field(default_factory=dict)
    had_residual_role: bool = False

    def one(self, sql: str, *params):
        row = self.admin.execute(sql, params).fetchone()
        return row[0] if row else None

    def rows(self, sql: str, *params):
        return self.admin.execute(sql, params).fetchall()

    def active(self):
        return self.one("select snapshot_id from public.active_snapshot where universe = 'stocks'")


def _restore(db: Db) -> None:
    base = db.baseline
    with db.admin.transaction():
        cur = db.admin.cursor()
        cur.execute("select set_config('app.retention_job', 'on', true)")
        cur.execute(
            "update public.active_snapshot set snapshot_id = %s, updated_at = %s "
            "where universe = 'stocks'",
            (base["active"], base["active_updated_at"]),
        )
        cur.execute("delete from public.snapshots where id <> all(%s)", (base["snapshots"],))
        cur.execute("delete from public.staging_validations")
        cur.execute("delete from public.staging_observations")
        cur.execute("delete from public.collection_runs where id <> all(%s)", (base["runs"],))
        cur.execute("delete from public.assets where symbol = any(%s)", (list(EXTRA_ASSETS),))


def reset_collector_role(admin: psycopg.Connection) -> bool:
    """Remove login/senha residuais de uma execução morta (SIGKILL). True se havia resíduo."""
    row = admin.execute(
        "select rolcanlogin, rolpassword is not null from pg_authid where rolname = 'collector_ingest'"
    ).fetchone()
    residual = bool(row and (row[0] or row[1]))
    if residual:
        admin.execute("alter role collector_ingest nologin password null")
    return residual


@pytest.fixture
def db() -> Iterator[Db]:
    admin_url = os.environ[ADMIN_URL_ENV]
    _local_only(admin_url)
    admin = psycopg.connect(admin_url, autocommit=True)
    password = secrets.token_hex(16)
    parts = urlsplit(admin_url)
    host = f"[{parts.hostname}]" if ":" in (parts.hostname or "") else parts.hostname
    collector_url = (
        f"postgresql://collector_ingest:{quote(password)}@{host}:{parts.port or 5432}{parts.path}"
    )
    state = Db(admin_url, collector_url, admin)
    try:
        state.had_residual_role = reset_collector_role(admin)
        admin.execute(f"alter role collector_ingest login password '{password}'")
        active = admin.execute(
            "select snapshot_id, updated_at from public.active_snapshot where universe = 'stocks'"
        ).fetchone()
        assert active is not None, "o seed da T08 precisa estar aplicado (supabase db reset)"
        state.baseline = {
            "active": active[0],
            "active_updated_at": active[1],
            "snapshots": [r[0] for r in admin.execute("select id from public.snapshots")],
            "runs": [r[0] for r in admin.execute("select id from public.collection_runs")],
        }
        assert not state.one(
            "select public.collector_batch_done_on((now() at time zone 'America/Sao_Paulo')::date)"
        ), "já existe lote concluído hoje no banco local; rode `supabase db reset` e repita"
        for symbol in EXTRA_ASSETS:
            admin.execute(
                "insert into public.assets (symbol, asset_class, name) values (%s, 'stock', %s)",
                (symbol, f"{symbol} (fictícia)"),
            )
        yield state
    finally:
        try:
            if state.baseline:
                _restore(state)
        finally:
            admin.execute("alter role collector_ingest nologin password null")
            admin.close()

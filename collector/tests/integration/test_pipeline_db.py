"""Pipeline e CLI contra o Supabase local (T15). Marcados como `integration`."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from collector.logs import JsonLogger
from collector.pipeline import AlreadyRanToday, Pipeline, RunOptions
from collector.settings import load_settings
from collector.store import PostgresStore, PublishRejected
from collector.validation.tolerance import ValidationOptions, load_tolerances
from fakes import FakeIndicatorSource, comparable_methodologies

pytestmark = pytest.mark.integration

UNIVERSE = ["DEMO3", "TEST4", "DEMO5", "TEST6"]
SEED_SNAPSHOT = "d0000000-0000-4000-8000-000000000001"


def _env(db, **extra):
    env = {
        **os.environ,
        "SCRAPER_CONTACT": "t@example.test",
        "APP_ENV": "local",
        "COLLECTOR_DATABASE_URL": db.collector_url,
        **extra,
    }
    env.pop("BRAPI_TOKEN", None)
    return env


def _cli(db, *args, **extra):
    return subprocess.run(
        [sys.executable, "-m", "collector.cli", *args],
        capture_output=True,
        text=True,
        env=_env(db, **extra),
        timeout=120,
        check=False,
    )


def _pipeline(db, sources, *, settings=None, tolerances=None, store=None, log=None):
    settings = settings or load_settings({"SCRAPER_CONTACT": "t@example.test"})
    return Pipeline(
        settings=settings,
        tolerances=tolerances or load_tolerances(),
        universe=UNIVERSE,
        universe_version="teste-1",
        build_adapters=lambda run_id: [FakeIndicatorSource(s, run_id, **kw) for s, kw in sources],
        store=store or PostgresStore(db.collector_url, sleep=lambda _s: None),
        log=log or JsonLogger(io.StringIO(), secrets=[db.collector_url]),
        clock=lambda: datetime.now(UTC),
    )


def _comparable_settings():
    settings = load_settings({"SCRAPER_CONTACT": "t@example.test"})
    return settings.model_copy(
        update={"methodologies": comparable_methodologies(settings.methodologies)}
    )


# -- CLI -------------------------------------------------------------------------------


def test_cli_fixtures_publica_snapshot_e_move_o_ponteiro_ativo(db):
    assert str(db.active()) == SEED_SNAPSHOT
    proc = _cli(db, "run", "--mode", "fixtures")
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert report["published"] is True
    active = db.active()
    assert str(active) == report["snapshot_id"] != SEED_SNAPSHOT
    assert db.one("select run_id from public.snapshots where id = %s", active).hex == (
        report["run_id"].replace("-", "")
    )
    assert db.one("select count(*) from public.observations where snapshot_id = %s", active) == 18
    assert (
        db.one("select count(*) from public.field_validations where snapshot_id = %s", active) == 10
    )
    assert db.one("select status from public.collection_runs where id = %s", report["run_id"]) == (
        "succeeded"
    )
    assert db.one("select count(*) from public.staging_observations") == 0
    assert db.one("select published_at is not null from public.snapshots where id = %s", active)
    # valores financeiros seguem como numeric exato
    price = db.one(
        "select o.value_decimal from public.observations o join public.assets a on a.id = o.asset_id "
        "where o.snapshot_id = %s and a.symbol = 'DEMO3' and o.metric = 'quote_price'",
        active,
    )
    assert price == Decimal("38.50")
    # nada sensível nas saídas
    secret = db.collector_url
    password = secret.split(":")[2].split("@")[0]
    assert password not in proc.stdout + proc.stderr and secret not in proc.stdout + proc.stderr
    events = [json.loads(line) for line in proc.stderr.splitlines()]
    assert all("run_id" in e and "etapa" in e for e in events)


def test_cli_segundo_lote_no_mesmo_dia_e_recusado_e_force_publica(db):
    first = _cli(db, "run", "--mode", "fixtures")
    assert first.returncode == 0, first.stderr
    published = db.active()
    second = _cli(db, "run", "--mode", "fixtures")
    assert second.returncode == 3 and "--force" in second.stderr
    assert db.active() == published
    assert db.one("select count(*) from public.collection_runs") == 1 + len(db.baseline["runs"])
    forced = _cli(db, "run", "--mode", "fixtures", "--force")
    assert forced.returncode == 0, forced.stderr
    assert db.active() != published
    assert db.one("select count(*) from public.snapshots") == 2 + len(db.baseline["snapshots"])


def test_cli_fixtures_recusado_com_app_env_diferente_de_local(db):
    proc = _cli(db, "run", "--mode", "fixtures", APP_ENV="production")
    assert proc.returncode == 2 and "APP_ENV=local" in proc.stderr
    assert str(db.active()) == SEED_SNAPSHOT
    assert db.one("select count(*) from public.collection_runs") == len(db.baseline["runs"])


def test_cli_dry_run_nao_grava_nada(db):
    proc = _cli(db, "run", "--mode", "fixtures", "--dry-run")
    assert proc.returncode == 0, proc.stderr
    assert str(db.active()) == SEED_SNAPSHOT
    assert db.one("select count(*) from public.collection_runs") == len(db.baseline["runs"])


# -- Pipeline --------------------------------------------------------------------------


class _InspectingStore(PostgresStore):
    """Confere, de OUTRA conexão, que o staging já estava confirmado quando a RPC foi chamada."""

    def __init__(self, url, admin, **kw):
        super().__init__(url, **kw)
        self._admin = admin
        self.seen: dict[str, int] = {}

    def publish(self, run_id, manifest):
        row = self._admin.execute(
            "select (select count(*) from public.staging_observations where run_id = %s),"
            " (select count(*) from public.staging_validations where run_id = %s),"
            " (select count(*) from public.collection_runs where id = %s)",
            (run_id, run_id, run_id),
        ).fetchone()
        self.seen = {"observations": row[0], "validations": row[1], "runs": row[2]}
        return super().publish(run_id, manifest)


def test_staging_e_confirmado_antes_da_rpc(db):
    store = _InspectingStore(db.collector_url, db.admin, sleep=lambda _s: None)
    sources = [("fundamentus", {}), ("statusinvest", {})]
    _pipeline(db, sources, store=store).run(RunOptions())
    assert store.seen["runs"] == 1
    assert store.seen["observations"] == 32 and store.seen["validations"] == 20


def test_falha_de_um_ativo_aparece_no_manifesto_e_nao_e_preenchida(db):
    sources = [("fundamentus", {"fail_assets": ["DEMO5"]}), ("statusinvest", {})]
    report = _pipeline(db, sources).run(RunOptions())
    snap = db.active()
    assert str(snap) == report.snapshot_id
    failures = db.one("select failures from public.snapshots where id = %s", snap)
    assert failures == [
        {"asset_id": "DEMO5", "source_id": "fundamentus", "reason": "falha simulada"}
    ]
    assert (
        db.one(
            "select count(*) from public.observations o join public.assets a on a.id = o.asset_id "
            "join public.data_sources s on s.id = o.source_id "
            "where o.snapshot_id = %s and a.symbol = 'DEMO5' and s.code = 'fundamentus'",
            snap,
        )
        == 0
    )
    # nada vem do snapshot anterior: o seed tem DEMO3/TEST4, nunca DEMO5
    assert db.one(
        "select status from public.field_validations v join public.assets a on a.id = v.asset_id "
        "where v.snapshot_id = %s and a.symbol = 'DEMO5' and v.metric = 'roe'",
        snap,
    ) in ("single_source", "incomparable")
    assert db.one("select assets_total from public.snapshots where id = %s", snap) == 4
    assert db.one("select status from public.collection_runs where id = %s", report.run_id) == (
        "succeeded"
    )


def test_falha_total_de_uma_fonte_publica_com_a_outra_e_registra_as_falhas(db):
    sources = [("fundamentus", {}), ("statusinvest", {"fail_all": True})]
    _pipeline(db, sources).run(RunOptions())
    snap = db.active()
    failures = db.one("select failures from public.snapshots where id = %s", snap)
    assert sorted(f["asset_id"] for f in failures) == sorted(UNIVERSE)
    assert {f["source_id"] for f in failures} == {"statusinvest"}
    # sem a statusinvest cada indicador fica só com a fundamentus; cotação não tem fonte aqui
    statuses = db.rows(
        "select distinct status from public.field_validations where snapshot_id = %s order by 1",
        snap,
    )
    assert statuses == [("missing",), ("single_source",)]


def test_integridade_barra_e_o_snapshot_anterior_continua_ativo(db):
    # fundamentus cobre só 1 de 4 ativos e a statusinvest falha por inteiro
    sources = [("fundamentus", {"only_assets": ["DEMO3"]}), ("statusinvest", {"fail_all": True})]
    before_obs = db.one("select count(*) from public.observations")
    with pytest.raises(PublishRejected, match="cobertura insuficiente"):
        _pipeline(db, sources).run(RunOptions())
    assert str(db.active()) == SEED_SNAPSHOT
    assert db.one("select count(*) from public.snapshots") == len(db.baseline["snapshots"])
    assert db.one("select count(*) from public.observations") == before_obs
    # a execução fica `running` (só a RPC encerra) e não conta como lote concluído do dia
    assert db.one("select count(*) from public.collection_runs where status = 'running'") == 1
    again = _pipeline(db, [("fundamentus", {}), ("statusinvest", {})]).run(RunOptions())
    assert again.published and str(db.active()) == again.snapshot_id


def test_lote_do_dia_via_pipeline_recusa_e_force_publica(db):
    sources = [("fundamentus", {}), ("statusinvest", {})]
    _pipeline(db, sources).run(RunOptions())
    with pytest.raises(AlreadyRanToday):
        _pipeline(db, sources).run(RunOptions())
    assert _pipeline(db, sources).run(RunOptions(force=True)).published


def test_calibragem_publica_as_duas_fontes_e_a_comparacao_no_banco(db):
    sources = [("fundamentus", {}), ("statusinvest", {})]
    report = _pipeline(db, sources, settings=_comparable_settings()).run(RunOptions())
    snap = db.active()
    # P-17: as duas fontes chegam ao banco; a comparação vai em colunas próprias.
    assert report.observations_unpublished == 0
    assert (
        db.one(
            "select count(*) from public.observations o join public.data_sources s on s.id = o.source_id "
            "where o.snapshot_id = %s and s.code = 'statusinvest'",
            snap,
        )
        == 16
    )
    assert (
        db.one(
            "select count(*) from public.observations where snapshot_id = %s and source_id is not null",
            snap,
        )
        == 32
    )
    rows = db.rows(
        "select status, reason, selected_observation_id, cardinality(observation_ids), "
        "delta_abs, limit_value, atol, rtol, tolerance_version "
        "from public.field_validations where snapshot_id = %s and status <> 'missing'",
        snap,
    )
    assert len(rows) == 16
    for status, reason, selected, count, delta, limit, atol, rtol, version in rows:
        assert status == "incomparable" and reason.startswith("uncalibrated")
        assert selected is None and count == 2
        assert None not in (delta, limit, atol, rtol) and version


def test_sem_calibragem_verified_e_divergent_chegam_ao_banco(db):
    tol = load_tolerances().model_copy(
        update={"validation": ValidationOptions(calibration_mode=False)}
    )
    sources = [("fundamentus", {}), ("statusinvest", {"offset": Decimal("0.01")})]
    _pipeline(db, sources, settings=_comparable_settings(), tolerances=tol).run(RunOptions())
    snap = db.active()
    counts = dict(
        db.rows(
            "select status, count(*) from public.field_validations where snapshot_id = %s group by 1",
            snap,
        )
    )
    # pb, pl e roe ficam dentro da tolerância; o dividend_yield (atol 0,20, offset 0,01) também
    assert counts == {"verified": 16, "missing": 4}
    assert db.one("select count(*) from public.observations where snapshot_id = %s", snap) == 32
    sources = [("fundamentus", {}), ("statusinvest", {"offset": Decimal(5)})]
    _pipeline(db, sources, settings=_comparable_settings(), tolerances=tol).run(
        RunOptions(force=True)
    )
    counts = dict(
        db.rows(
            "select status, count(*) from public.field_validations where snapshot_id = %s group by 1",
            db.active(),
        )
    )
    assert counts == {"divergent": 16, "missing": 4}


def test_excecao_com_string_de_conexao_nao_vaza_nos_logs(db):
    stream = io.StringIO()
    log = JsonLogger(stream, secrets=[db.collector_url])
    boom = RuntimeError(f"falhou em {db.collector_url}")
    sources = [("fundamentus", {"boom": boom}), ("statusinvest", {})]
    _pipeline(db, sources, log=log).run(RunOptions())
    password = db.collector_url.split(":")[2].split("@")[0]
    assert password not in stream.getvalue()
    failures = db.one("select failures::text from public.snapshots where id = %s", db.active())
    assert password not in failures and "RuntimeError" in failures


def test_papel_do_coletor_nao_le_dados_publicados(db):
    import psycopg

    with (
        psycopg.connect(db.collector_url) as conn,
        pytest.raises(psycopg.errors.InsufficientPrivilege),
    ):
        conn.execute("select count(*) from public.snapshots")


@pytest.mark.integration
def test_reset_collector_role_removes_residual_login(db) -> None:
    from conftest import reset_collector_role

    # a fixture deixou o papel com login e senha (como após uma execução morta por SIGKILL)
    assert reset_collector_role(db.admin) is True
    assert reset_collector_role(db.admin) is False
    row = db.admin.execute(
        "select rolcanlogin, rolpassword is null from pg_authid where rolname = 'collector_ingest'"
    ).fetchone()
    assert row == (False, True)

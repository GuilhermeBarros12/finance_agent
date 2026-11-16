"""Linha de comando do coletor (T15; README 14.1).

    python -m collector.cli doctor --offline|--online [--env-file ARQ]
    python -m collector.cli run [--mode fixtures] [--dry-run] [--force] [--env-file ARQ]

Códigos de saída: 0 ok; 1 falha inesperada ou verificação online com problema; 2
configuração ou uso; 3 lote do dia já concluído (use --force); 4 nada publicável ou RPC de
publicação recusou o lote (o snapshot ativo não mudou); 5 erro de banco.

Logs estruturados (JSON, uma linha por evento) vão para o stderr; o resumo final vai para o
stdout. Token e string de conexão nunca aparecem em nenhum dos dois.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping, Sequence
from contextlib import ExitStack
from pathlib import Path
from typing import Any, TextIO

import httpx
from pydantic import SecretStr, ValidationError

from collector.envfile import load_env_file
from collector.fixture_sources import DEFAULT_FIXTURES_DIR, build_fixture_adapters, load_fixture_set
from collector.http import HttpClient
from collector.logs import JsonLogger
from collector.pipeline import LOCAL_ENV, Pipeline, PipelineError, RunOptions
from collector.settings import (
    DEFAULT_CONFIG_DIR,
    PermissionStatus,
    Settings,
    SettingsError,
    load_settings,
)
from collector.sources.base import SourceCollector
from collector.sources.brapi import SOURCE_ID as BRAPI_ID
from collector.sources.brapi import BrapiAdapter
from collector.store import PostgresStore, PublishRejected, StoreError
from collector.validation.tolerance import Tolerances, load_tolerances

# Adaptadores com implementação nesta fatia. Fundamentus (T12) e StatusInvest (T13) se
# registram aqui depois, sem mudar o pipeline.
REGISTERED_SOURCES = (BRAPI_ID,)

EXIT_OK = 0
EXIT_FAILURE = 1
EXIT_CONFIG = 2
EXIT_ALREADY_RAN = 3
EXIT_REFUSED = 4
EXIT_DATABASE = 5


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="collector", description="Coletor de indicadores")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument(
            "--env-file", help="arquivo .env de desenvolvimento (não sobrescreve o ambiente)"
        )
        p.add_argument("--config-dir", default=str(DEFAULT_CONFIG_DIR), help=argparse.SUPPRESS)

    doctor = sub.add_parser("doctor", help="verifica a configuração")
    common(doctor)
    mode = doctor.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--offline", action="store_true", help="só configuração, sem consultar fontes"
    )
    mode.add_argument(
        "--online", action="store_true", help="acesso mínimo às fontes (pode gastar cota)"
    )

    run = sub.add_parser("run", help="executa o lote")
    common(run)
    run.add_argument("--mode", choices=("real", "fixtures"), default="real")
    run.add_argument("--dry-run", action="store_true", help="coleta e valida, sem publicar")
    run.add_argument("--force", action="store_true", help="reprocessa o dia (novo snapshot)")
    run.add_argument("--fixtures-dir", default=str(DEFAULT_FIXTURES_DIR), help=argparse.SUPPRESS)
    return parser


def _secrets(settings: Settings) -> list[str]:
    values = []
    if settings.brapi_token is not None:
        values.append(settings.brapi_token.get_secret_value())
    if settings.database_url is not None:
        values.append(settings.database_url.get_secret_value())
    return values


def _doctor_offline(settings: Settings, tolerances: Tolerances) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    enabled = [s for s in settings.sources.sources if s.enabled]
    if not settings.universe.stocks:
        errors.append("universo vazio")
    if len(set(settings.universe.stocks)) != len(settings.universe.stocks):
        errors.append("universo com ativo repetido")
    if not enabled:
        errors.append("nenhuma fonte habilitada")
    for source in enabled:
        if source.permission_status is PermissionStatus.PROIBIDA:
            errors.append(f"fonte habilitada com permissão proibida: {source.id}")
        if source.id not in REGISTERED_SOURCES:
            warnings.append(f"fonte habilitada sem adaptador registrado: {source.id}")
    if settings.brapi_token is None:
        warnings.append("BRAPI_TOKEN ausente (necessário para run real e doctor --online)")
    if settings.database_url is None:
        warnings.append("COLLECTOR_DATABASE_URL ausente (necessária para publicar)")
    if tolerances.validation.calibration_mode:
        warnings.append("calibration_mode ligado: nenhum campo recebe verified ou divergent")
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "app_env": settings.app_env,
        "universe_version": settings.universe.version,
        "universe_size": len(settings.universe.stocks),
        "methodologies_version": settings.methodologies.version,
        "tolerances_version": tolerances.version,
        "sources_enabled": [s.id for s in enabled],
        "adapters_registered": list(REGISTERED_SOURCES),
        "brapi_token_set": settings.brapi_token is not None,
        "database_url_set": settings.database_url is not None,
    }


def _doctor_online(
    settings: Settings, transport: httpx.BaseTransport | None, log: JsonLogger
) -> dict[str, Any]:
    """Uma requisição mínima por fonte com adaptador. Pode gastar cota da brapi."""
    checks: dict[str, str] = {}
    ok = True
    token = settings.require_brapi_token()
    with HttpClient(settings.sources, settings.scraper_contact, transport=transport) as http:
        adapter = BrapiAdapter(
            http, settings.sources.get(BRAPI_ID), SecretStr(token), "doctor-online"
        )
        result = adapter.collect(settings.universe.stocks[:1])
        if result.observations:
            checks[BRAPI_ID] = "ok"
        else:
            ok = False
            reason = result.failures[0].reason if result.failures else "sem resposta"
            checks[BRAPI_ID] = f"falhou: {reason}"
    for source in settings.sources.sources:
        if source.enabled and source.id not in REGISTERED_SOURCES:
            checks[source.id] = "sem adaptador registrado (T12/T13)"
    log.event("doctor_online", **{f"fonte_{k}": v for k, v in checks.items()})
    return {"ok": ok, "checks": checks}


def main(
    argv: Sequence[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
    transport: httpx.BaseTransport | None = None,
) -> int:
    out = stdout if stdout is not None else sys.stdout
    log = JsonLogger(stderr if stderr is not None else sys.stderr)
    args = build_parser().parse_args(argv)
    env = dict(os.environ if environ is None else environ)
    try:
        return _dispatch(args, env, out, log, transport)
    except SettingsError as exc:
        log.event("erro", motivo=str(exc))
        return EXIT_CONFIG
    except ValidationError as exc:
        log.event("erro", motivo=f"configuração inválida ({exc.error_count()} erro(s))")
        return EXIT_CONFIG


def _dispatch(
    args: argparse.Namespace,
    env: dict[str, str],
    out: TextIO,
    log: JsonLogger,
    transport: httpx.BaseTransport | None,
) -> int:
    if args.env_file:
        load_env_file(args.env_file, env)
    settings = load_settings(env, config_dir=args.config_dir)
    for secret in _secrets(settings):
        log.add_secret(secret)
    tolerances = load_tolerances(Path(args.config_dir) / "tolerances.yaml")

    if args.command == "doctor":
        if args.offline:
            report = _doctor_offline(settings, tolerances)
        else:
            report = _doctor_online(settings, transport, log)
        out.write(json.dumps(report, ensure_ascii=False) + "\n")
        return EXIT_OK if report["ok"] else EXIT_FAILURE
    return _run(args, settings, tolerances, out, log, transport)


def _run(
    args: argparse.Namespace,
    settings: Settings,
    tolerances: Tolerances,
    out: TextIO,
    log: JsonLogger,
    transport: httpx.BaseTransport | None,
) -> int:
    options = RunOptions(mode=args.mode, dry_run=args.dry_run, force=args.force)
    if options.mode == "fixtures" and settings.app_env != LOCAL_ENV:
        log.event("erro", motivo="o modo fixtures só roda com APP_ENV=local")
        return EXIT_CONFIG
    with ExitStack() as stack:
        if options.mode == "fixtures":
            fixtures = load_fixture_set(args.fixtures_dir)
            universe, version = fixtures.assets, fixtures.universe_version

            def build(run_id: str) -> Sequence[SourceCollector]:
                return build_fixture_adapters(settings, fixtures, run_id, stack)
        else:
            universe, version = settings.universe.stocks, settings.universe.version
            token = settings.require_brapi_token()
            http = stack.enter_context(
                HttpClient(settings.sources, settings.scraper_contact, transport=transport)
            )

            def build(run_id: str) -> Sequence[SourceCollector]:
                adapters: list[SourceCollector] = []
                for source in settings.sources.sources:
                    if not source.enabled:
                        continue
                    if source.id == BRAPI_ID:
                        adapters.append(BrapiAdapter(http, source, SecretStr(token), run_id))
                    else:
                        log.event("fonte_sem_adaptador", fonte=source.id)
                return adapters

        store = None
        if not options.dry_run:
            store = PostgresStore(
                settings.require_database_url(),
                on_retry=lambda attempt, state, delay: log.event(
                    "retry_banco", tentativa=attempt, sqlstate=state, espera_s=delay
                ),
            )
        pipeline = Pipeline(
            settings=settings,
            tolerances=tolerances,
            universe=universe,
            universe_version=version,
            build_adapters=build,
            store=store,
            log=log,
        )
        try:
            report = pipeline.run(options)
        except PublishRejected as exc:
            log.event("erro", motivo=f"publicação recusada: {exc}")
            return EXIT_REFUSED
        except StoreError as exc:
            log.event("erro", motivo=str(exc))
            return EXIT_DATABASE
        except PipelineError as exc:
            log.event("erro", motivo=str(exc))
            return exc.exit_code
    out.write(json.dumps(report.as_dict(), ensure_ascii=False) + "\n")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())

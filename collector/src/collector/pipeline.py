"""Pipeline do lote: coletar, validar, gravar em staging e publicar (T15; README 14.4).

Ordem: validar configuração; criar `run_id` e a data lógica (America/Sao_Paulo); recusar
se já houver lote concluído no dia (salvo `force`); coletar cada fonte; validar por campo
(T14); gravar em staging e CONFIRMAR; só então chamar `publish_snapshot`.

Regras que este módulo guarda:

* D12: se uma fonte falha para um ativo, os campos dela ficam sem observação e o motor
  produz `missing` ou `single_source`. Nada é copiado de snapshot anterior; falha nunca
  vira zero, tabela vazia nem a data de hoje.
* Observação listada em `unpublished_observation_ids` (calibragem, comparação inválida) NÃO
  vai ao staging: a RPC recusaria observação sem validação do seu campo.
* Observação de ativo fora do universo é descartada e registrada como falha: o motor
  lança `ValueError` para ela.
* Se a RPC recusar (ex.: menos da metade do universo com observação), nada muda no
  snapshot ativo.
* O modo `fixtures` só publica com `APP_ENV=local`.
"""

from __future__ import annotations

import time
import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from collector.contracts import (
    FieldValidation,
    Metric,
    Observation,
    SnapshotManifest,
    SourceFailure,
)
from collector.logs import JsonLogger
from collector.settings import Settings
from collector.sources.base import CollectResult, SourceCollector
from collector.store import BatchStore, StagedRun
from collector.validation.comparability import BRT
from collector.validation.engine import FieldResult, validate_snapshot
from collector.validation.tolerance import Tolerances

LOCAL_ENV = "local"
_MAX_REASON = 200


class PipelineError(Exception):
    exit_code = 1


class ConfigurationError(PipelineError):
    exit_code = 2


class AlreadyRanToday(PipelineError):
    exit_code = 3


class NothingToPublish(PipelineError):
    exit_code = 4


@dataclass(frozen=True)
class RunOptions:
    mode: str = "real"  # "real" | "fixtures"
    dry_run: bool = False
    force: bool = False


@dataclass
class RunReport:
    run_id: str
    logical_day: date
    dry_run: bool
    published: bool
    snapshot_id: str | None
    assets_total: int
    assets_updated: int
    observations_collected: int
    observations_published: int
    observations_unpublished: int
    statuses: dict[str, int]
    failures: list[SourceFailure] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "logical_day": self.logical_day.isoformat(),
            "dry_run": self.dry_run,
            "published": self.published,
            "snapshot_id": self.snapshot_id,
            "assets_total": self.assets_total,
            "assets_updated": self.assets_updated,
            "observations_collected": self.observations_collected,
            "observations_published": self.observations_published,
            "observations_unpublished": self.observations_unpublished,
            "statuses": self.statuses,
            "failures": len(self.failures),
        }


AdapterBuilder = Callable[[str], Sequence[SourceCollector]]


def _clean_reason(text: str) -> str:
    clean = "".join(c if c.isprintable() else " " for c in text).strip()
    return clean[:_MAX_REASON] or "falha"


def _source_failure(asset_id: str, source_id: str, reason: str) -> SourceFailure:
    return SourceFailure(
        asset_id=asset_id or "?", source_id=source_id, reason=_clean_reason(reason)
    )


class Pipeline:
    def __init__(
        self,
        *,
        settings: Settings,
        tolerances: Tolerances,
        universe: Sequence[str],
        universe_version: str,
        build_adapters: AdapterBuilder,
        store: BatchStore | None,
        log: JsonLogger,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._settings = settings
        self._tolerances = tolerances
        self._universe = list(universe)
        self._universe_version = universe_version
        self._build_adapters = build_adapters
        self._store = store
        self._log = log
        self._clock = clock

    # -- etapa 1 ------------------------------------------------------------------------
    def _check_config(self, options: RunOptions) -> None:
        if options.mode not in ("real", "fixtures"):
            raise ConfigurationError(f"modo desconhecido: {options.mode}")
        if options.mode == "fixtures" and self._settings.app_env != LOCAL_ENV:
            raise ConfigurationError(
                "o modo fixtures só publica com APP_ENV=local "
                f"(APP_ENV atual: {self._settings.app_env!r})"
            )
        if not self._universe or len(set(self._universe)) != len(self._universe):
            raise ConfigurationError("universo vazio ou com ativo repetido")
        if not self._universe_version:
            raise ConfigurationError("versão do universo vazia")
        if not options.dry_run and self._store is None:
            raise ConfigurationError("publicar exige conexão com o banco")

    # -- etapa 4 ------------------------------------------------------------------------
    def _collect_source(self, adapter: SourceCollector) -> CollectResult:
        started = time.monotonic()
        try:
            result = adapter.collect(self._universe)
        except Exception as exc:  # noqa: BLE001 - uma fonte nunca derruba as outras
            # Só a classe do erro: a mensagem de um adaptador desconhecido pode ter URL.
            reason = f"coleta da fonte falhou ({type(exc).__name__})"
            result = CollectResult(
                failures=[_source_failure(a, adapter.source_id, reason) for a in self._universe]
            )
        self._log.event(
            "coleta",
            fonte=adapter.source_id,
            observacoes=len(result.observations),
            falhas=len(result.failures),
            duracao_ms=round((time.monotonic() - started) * 1000),
        )
        return result

    def _gather(
        self, adapters: Sequence[SourceCollector]
    ) -> tuple[list[Observation], list[SourceFailure]]:
        observations: list[Observation] = []
        failures: list[SourceFailure] = []
        universe = set(self._universe)
        seen_outside: set[tuple[str, str]] = set()  # (asset_id, source_id): uma falha por par
        for adapter in adapters:
            result = self._collect_source(adapter)
            failures.extend(result.failures)
            for obs in result.observations:
                if obs.asset_id not in universe:
                    # o motor lança ValueError para ativo fora do universo: descartar aqui
                    key = (obs.asset_id, adapter.source_id)
                    if key not in seen_outside:
                        seen_outside.add(key)
                        failures.append(
                            _source_failure(
                                obs.asset_id, adapter.source_id, "ativo fora do universo"
                            )
                        )
                    continue
                observations.append(obs)
        return observations, failures

    # -- execução -----------------------------------------------------------------------
    def run(self, options: RunOptions) -> RunReport:
        self._check_config(options)
        run_id = str(uuid.uuid4())
        self._log.run_id = run_id
        started_at = self._clock()
        logical_day = started_at.astimezone(BRT).date()
        self._log.event(
            "inicio",
            modo=options.mode,
            dry_run=options.dry_run,
            force=options.force,
            data_logica=logical_day.isoformat(),
            universo=len(self._universe),
        )

        if not options.dry_run and not options.force:
            assert self._store is not None
            if self._store.batch_done_on(logical_day):
                raise AlreadyRanToday(
                    f"já existe lote concluído em {logical_day.isoformat()} "
                    "(America/Sao_Paulo); use --force para reprocessar o dia"
                )

        adapters = self._build_adapters(run_id)
        if not adapters:
            raise ConfigurationError("nenhum adaptador de fonte registrado")
        observations, failures = self._gather(adapters)
        collected_at = self._clock()

        failed_assets: dict[str, set[str]] = {}
        for failure in failures:
            failed_assets.setdefault(failure.asset_id, set()).add(failure.source_id)
        missing_reasons = {
            (asset, metric): "falha de coleta em: " + ", ".join(sorted(sources))
            for asset, sources in failed_assets.items()
            for metric in Metric
        }

        started = time.monotonic()
        results: list[FieldResult] = validate_snapshot(
            self._universe,
            observations,
            methodologies=self._settings.methodologies,
            tolerances=self._tolerances,
            snapshot_collected_at=collected_at,
            now=self._clock(),
            missing_reasons=missing_reasons,
        )
        statuses = Counter(r.validation.status.value for r in results)
        self._log.event(
            "validacao",
            campos=len(results),
            estados=dict(statuses),
            duracao_ms=round((time.monotonic() - started) * 1000),
        )

        unpublished = {oid for r in results for oid in r.unpublished_observation_ids}
        publishable = [o for o in observations if o.observation_id not in unpublished]
        validations: list[FieldValidation] = [r.validation for r in results]
        updated = len({o.asset_id for o in publishable})
        manifest = SnapshotManifest(
            snapshot_id=str(uuid.uuid4()),
            run_id=run_id,
            collected_at=collected_at,
            universe_version=self._universe_version,
            assets_total=len(self._universe),
            assets_updated=updated,
            failures=failures,
        )
        report = RunReport(
            run_id=run_id,
            logical_day=logical_day,
            dry_run=options.dry_run,
            published=False,
            snapshot_id=None,
            assets_total=len(self._universe),
            assets_updated=updated,
            observations_collected=len(observations),
            observations_published=len(publishable),
            observations_unpublished=len(unpublished),
            statuses=dict(statuses),
            failures=failures,
        )
        if options.dry_run:
            self._log.event("fim", publicado=False, motivo="dry-run", **_counts(report))
            return report
        if not publishable:
            raise NothingToPublish("nenhuma observação publicável: o snapshot ativo não muda")

        assert self._store is not None
        staged = StagedRun(
            run_id=run_id,
            started_at=started_at,
            parser_versions=_parser_versions(publishable),
            summary={"modo": options.mode, "force": options.force, **_counts(report)},
            observations=publishable,
            validations=validations,
        )
        started = time.monotonic()
        self._store.stage(staged)  # confirmado (commit) antes da RPC
        self._log.event(
            "staging",
            observacoes=len(publishable),
            validacoes=len(validations),
            duracao_ms=round((time.monotonic() - started) * 1000),
        )
        started = time.monotonic()
        snapshot_id = self._store.publish(run_id, manifest.model_dump(mode="json"))
        report.published = True
        report.snapshot_id = snapshot_id
        self._log.event(
            "publicacao",
            snapshot_id=snapshot_id,
            duracao_ms=round((time.monotonic() - started) * 1000),
        )
        self._log.event("fim", publicado=True, **_counts(report))
        return report


def _counts(report: RunReport) -> dict[str, Any]:
    return {
        "ativos_total": report.assets_total,
        "ativos_atualizados": report.assets_updated,
        "observacoes_coletadas": report.observations_collected,
        "observacoes_publicadas": report.observations_published,
        "observacoes_fora_do_lote": report.observations_unpublished,
        "falhas": len(report.failures),
    }


def _parser_versions(observations: Sequence[Observation]) -> dict[str, str]:
    versions: dict[str, set[str]] = {}
    for obs in observations:
        versions.setdefault(obs.source_id, set()).add(obs.parser_version)
    return {source: ",".join(sorted(v)) for source, v in sorted(versions.items())}

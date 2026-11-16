"""Carregamento e validação de `config/methodologies.yaml` (T07)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from enum import StrEnum
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, SecretStr, ValidationError, model_validator

DEFAULT_METHODOLOGIES_PATH = Path(__file__).resolve().parents[3] / "config" / "methodologies.yaml"

EXPECTED_METRICS = frozenset(
    {"quote_price", "price_to_book", "price_to_earnings", "dividend_yield", "roe"}
)


class Verdict(StrEnum):
    COMPARABLE = "comparable"
    NOT_COMPARABLE = "not_comparable"
    INSUFFICIENT_METADATA = "insufficient_metadata"
    SINGLE_SOURCE = "single_source"


class SourceMethodology(BaseModel):
    model_config = ConfigDict(extra="forbid")

    methodology_id: str
    formula: str | None = None
    window: str | None = None
    basis: str | None = None
    reference_date_available: bool | None = None


class MetricMethodology(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    sources: dict[str, SourceMethodology]
    notes: str = ""


class Methodologies(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    metrics: dict[str, MetricMethodology]

    @model_validator(mode="after")
    def _check_metrics(self) -> Methodologies:
        found = set(self.metrics)
        if found != EXPECTED_METRICS:
            raise ValueError(
                f"métricas inesperadas ou ausentes: faltam {sorted(EXPECTED_METRICS - found)}, "
                f"sobram {sorted(found - EXPECTED_METRICS)}"
            )
        return self


def load_methodologies(path: Path | str = DEFAULT_METHODOLOGIES_PATH) -> Methodologies:
    """Lê e valida o arquivo. Veredito desconhecido gera `ValidationError`."""
    with Path(path).open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    return Methodologies.model_validate(data)


# --- Fontes, universo e variáveis de ambiente (T10) -----------------------------------

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parents[3] / "config"


class SettingsError(Exception):
    """Configuração ausente ou inválida. A mensagem diz o que falta."""


class PermissionStatus(StrEnum):
    PERMITIDA = "permitida"
    PROIBIDA = "proibida"
    INDEFINIDA = "indefinida"


class SourceConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    base_url: str
    permission_status: PermissionStatus
    reviewed_at: str
    max_requests_per_minute: int
    enabled: bool

    @model_validator(mode="after")
    def _check(self) -> SourceConfig:
        if self.max_requests_per_minute <= 0:
            raise ValueError("max_requests_per_minute deve ser positivo")
        if not urlsplit(self.base_url).hostname:
            raise ValueError(f"base_url sem domínio: {self.base_url!r}")
        return self

    @property
    def host(self) -> str:
        return (urlsplit(self.base_url).hostname or "").lower()


class SourcesConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: list[SourceConfig]

    @model_validator(mode="after")
    def _unique(self) -> SourcesConfig:
        ids = [s.id for s in self.sources]
        if len(ids) != len(set(ids)):
            raise ValueError("ids de fonte duplicados")
        return self

    def get(self, source_id: str) -> SourceConfig:
        for source in self.sources:
            if source.id == source_id:
                return source
        raise KeyError(source_id)


class Universe(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str
    stocks: list[str]


def _load_yaml(path: Path) -> object:
    try:
        with path.open(encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except FileNotFoundError as exc:
        raise SettingsError(f"arquivo de configuração ausente: {path}") from exc
    except yaml.YAMLError as exc:
        raise SettingsError(f"YAML inválido em {path}: {exc}") from exc


def _validate[M: BaseModel](model: type[M], data: object, path: Path) -> M:
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise SettingsError(f"configuração inválida em {path}: {exc}") from exc


def load_sources(path: Path | str = DEFAULT_CONFIG_DIR / "sources.yaml") -> SourcesConfig:
    path = Path(path)
    return _validate(SourcesConfig, _load_yaml(path), path)


def load_universe(path: Path | str = DEFAULT_CONFIG_DIR / "universe.yaml") -> Universe:
    path = Path(path)
    return _validate(Universe, _load_yaml(path), path)


class Settings(BaseModel):
    """Configuração completa do coletor: arquivos `config/*.yaml` e variáveis de ambiente."""

    model_config = ConfigDict(extra="forbid")

    app_env: str = "local"
    scraper_contact: str
    brapi_token: SecretStr | None = None
    database_url: SecretStr | None = None
    sources: SourcesConfig
    universe: Universe
    methodologies: Methodologies

    def require_brapi_token(self) -> str:
        if self.brapi_token is None:
            raise SettingsError("variável de ambiente ausente: BRAPI_TOKEN")
        return self.brapi_token.get_secret_value()

    def require_database_url(self) -> str:
        if self.database_url is None:
            raise SettingsError("variável de ambiente ausente: COLLECTOR_DATABASE_URL")
        return self.database_url.get_secret_value()


def load_settings(
    environ: Mapping[str, str] | None = None,
    config_dir: Path | str = DEFAULT_CONFIG_DIR,
) -> Settings:
    """Carrega tudo ou falha com `SettingsError` e mensagem clara.

    `SCRAPER_CONTACT` é obrigatória (vai no User-Agent). `BRAPI_TOKEN` e
    `COLLECTOR_DATABASE_URL` são opcionais aqui e exigidas por quem as usa.
    Variável vazia vale como ausente.
    """
    env = os.environ if environ is None else environ
    config_dir = Path(config_dir)

    def get(name: str) -> str | None:
        value = env.get(name, "").strip()
        return value or None

    contact = get("SCRAPER_CONTACT")
    if contact is None:
        raise SettingsError("variável de ambiente ausente: SCRAPER_CONTACT")
    token = get("BRAPI_TOKEN")
    db_url = get("COLLECTOR_DATABASE_URL")
    try:
        methodologies = load_methodologies(config_dir / "methodologies.yaml")
    except FileNotFoundError as exc:
        raise SettingsError(f"arquivo de configuração ausente: {exc.filename}") from exc
    except (ValidationError, yaml.YAMLError) as exc:
        raise SettingsError(f"configuração inválida em methodologies.yaml: {exc}") from exc
    return Settings(
        app_env=get("APP_ENV") or "local",
        scraper_contact=contact,
        brapi_token=SecretStr(token) if token else None,
        database_url=SecretStr(db_url) if db_url else None,
        sources=load_sources(config_dir / "sources.yaml"),
        universe=load_universe(config_dir / "universe.yaml"),
        methodologies=methodologies,
    )

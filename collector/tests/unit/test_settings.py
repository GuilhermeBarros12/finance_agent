from pathlib import Path

import pytest
from collector.settings import (
    DEFAULT_CONFIG_DIR,
    SettingsError,
    load_settings,
    load_sources,
    load_universe,
)

ENV = {"SCRAPER_CONTACT": "contato@example.test"}


def test_loads_real_config() -> None:
    settings = load_settings(ENV)
    assert settings.scraper_contact == "contato@example.test"
    assert {s.id for s in settings.sources.sources} == {"fundamentus", "statusinvest", "brapi"}
    assert "PETR4" in settings.universe.stocks
    assert settings.app_env == "local"
    assert settings.brapi_token is None


def test_missing_contact_fails_clearly() -> None:
    with pytest.raises(SettingsError, match="SCRAPER_CONTACT"):
        load_settings({})
    with pytest.raises(SettingsError, match="SCRAPER_CONTACT"):
        load_settings({"SCRAPER_CONTACT": "  "})


def test_missing_token_fails_when_required() -> None:
    settings = load_settings(ENV)
    with pytest.raises(SettingsError, match="BRAPI_TOKEN"):
        settings.require_brapi_token()
    with pytest.raises(SettingsError, match="COLLECTOR_DATABASE_URL"):
        settings.require_database_url()


def test_secrets_not_in_repr() -> None:
    settings = load_settings({**ENV, "BRAPI_TOKEN": "SEGREDO123"})
    assert settings.require_brapi_token() == "SEGREDO123"
    assert "SEGREDO123" not in repr(settings)


def test_missing_config_file_fails_clearly(tmp_path: Path) -> None:
    with pytest.raises(SettingsError, match="ausente"):
        load_settings(ENV, config_dir=tmp_path)


def test_invalid_sources_fail_clearly(tmp_path: Path) -> None:
    bad = tmp_path / "sources.yaml"
    bad.write_text("sources:\n  - id: x\n", encoding="utf-8")
    with pytest.raises(SettingsError, match="inválida"):
        load_sources(bad)


def test_unknown_permission_status_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "sources.yaml"
    bad.write_text(
        "sources:\n  - id: x\n    base_url: https://x.example.test\n"
        "    permission_status: talvez\n    reviewed_at: '2026-01-01'\n"
        "    max_requests_per_minute: 1\n    enabled: true\n",
        encoding="utf-8",
    )
    with pytest.raises(SettingsError):
        load_sources(bad)


def test_universe_loads() -> None:
    assert load_universe(DEFAULT_CONFIG_DIR / "universe.yaml").version

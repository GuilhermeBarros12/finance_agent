import httpx
import pytest
from collector.http import FetchError, HttpClient, SourceNotAllowedError, build_user_agent
from collector.settings import SourceConfig, SourcesConfig


def _sources(brapi_enabled: bool = True) -> SourcesConfig:
    def src(id_: str, host: str, rpm: int, enabled: bool) -> SourceConfig:
        return SourceConfig(
            id=id_,
            base_url=f"https://{host}",
            permission_status="permitida",
            reviewed_at="2026-01-01",
            max_requests_per_minute=rpm,
            enabled=enabled,
        )

    return SourcesConfig(
        sources=[
            src("fonte_a", "a.example.test", 60, True),
            src("fonte_b", "b.example.test", 60, brapi_enabled),
        ]
    )


class Env:
    def __init__(self, handler, sources=None) -> None:
        self.sleeps: list[float] = []
        self.now = 0.0
        self.requests: list[httpx.Request] = []

        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return handler(request)

        self.client = HttpClient(
            sources or _sources(),
            "contato@example.test",
            transport=httpx.MockTransport(wrapped),
            sleep=self._sleep,
            clock=lambda: self.now,
        )

    def _sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def ok(_: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text="ok")


def test_success_sends_user_agent_with_contact() -> None:
    env = Env(ok)
    response = env.client.get("fonte_a", "https://a.example.test/x")
    assert response.text == "ok"
    assert "contato@example.test" in env.requests[0].headers["user-agent"]


def test_empty_contact_rejected() -> None:
    with pytest.raises(ValueError):
        build_user_agent("  ")


def test_refuses_domain_outside_config() -> None:
    env = Env(ok)
    with pytest.raises(SourceNotAllowedError):
        env.client.get("fonte_a", "https://outro.example.test/x")
    assert env.requests == []


def test_refuses_other_sources_domain_and_unknown_source() -> None:
    env = Env(ok)
    with pytest.raises(SourceNotAllowedError):
        env.client.get("fonte_a", "https://b.example.test/x")
    with pytest.raises(SourceNotAllowedError):
        env.client.get("desconhecida", "https://a.example.test/x")


def test_refuses_disabled_source() -> None:
    env = Env(ok, _sources(brapi_enabled=False))
    with pytest.raises(SourceNotAllowedError, match="desabilitada"):
        env.client.get("fonte_b", "https://b.example.test/x")
    assert env.requests == []


def test_refuses_http_scheme_and_lookalike_host() -> None:
    env = Env(ok)
    for url in (
        "http://a.example.test/x",
        "https://a.example.test.evil.test/x",
        "https://u:p@a.example.test/x",
    ):
        with pytest.raises(SourceNotAllowedError):
            env.client.get("fonte_a", url)


def test_retries_with_growing_wait_then_succeeds() -> None:
    codes = iter([503, 500, 200])
    env = Env(lambda _: httpx.Response(next(codes), text="x"))
    assert env.client.get("fonte_a", "https://a.example.test/x").status_code == 200
    assert len(env.requests) == 3
    # esperas de recuo (1s, 2s); o intervalo por domínio (1s) já está coberto por elas
    assert 1.0 in env.sleeps and 2.0 in env.sleeps


def test_gives_up_after_three_attempts() -> None:
    env = Env(lambda _: httpx.Response(503))
    with pytest.raises(FetchError, match="3 tentativas"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 3


def test_transport_error_retried_then_fails() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("falha", request=request)

    env = Env(boom)
    with pytest.raises(FetchError, match="transporte"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 3


def test_client_error_not_retried() -> None:
    env = Env(lambda _: httpx.Response(404))
    with pytest.raises(FetchError, match="404"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_honors_retry_after() -> None:
    responses = iter([httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(200)])
    env = Env(lambda _: next(responses))
    env.client.get("fonte_a", "https://a.example.test/x")
    assert 7.0 in env.sleeps


def test_retry_after_too_long_aborts() -> None:
    env = Env(lambda _: httpx.Response(429, headers={"Retry-After": "99999"}))
    with pytest.raises(FetchError, match="Retry-After"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_min_interval_per_domain() -> None:
    env = Env(ok)  # 60 req/min => 1s entre requisições
    env.client.get("fonte_a", "https://a.example.test/1")
    env.client.get("fonte_a", "https://a.example.test/2")
    assert env.sleeps == [1.0]
    env.client.get("fonte_b", "https://b.example.test/1")  # outro domínio: sem espera
    assert env.sleeps == [1.0]


def test_redirect_not_followed() -> None:
    env = Env(lambda _: httpx.Response(302, headers={"Location": "https://evil.test/"}))
    with pytest.raises(FetchError, match="302"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_error_message_does_not_leak_query_secret() -> None:
    env = Env(lambda _: httpx.Response(404))
    with pytest.raises(FetchError) as info:
        env.client.get("fonte_a", "https://a.example.test/x", params={"token": "SEGREDO"})
    assert "SEGREDO" not in str(info.value)

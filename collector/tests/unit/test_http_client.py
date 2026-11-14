import threading
import time
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.utils import format_datetime

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


WALL_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
S = 1_000_000


class Env:
    def __init__(self, handler, sources=None) -> None:
        self.sleeps: list[int] = []  # microssegundos
        self.now = 0  # microssegundos
        self.requests: list[httpx.Request] = []

        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return handler(request)

        self.client = HttpClient(
            sources or _sources(),
            "contato@example.test",
            transport=httpx.MockTransport(wrapped),
            sleep=self._sleep,
            clock=lambda: self.now * 1000,  # ns
            wall_clock=lambda: WALL_NOW,
        )

    def _sleep(self, microseconds: int) -> None:
        assert isinstance(microseconds, int)
        self.sleeps.append(microseconds)
        self.now += microseconds


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
    assert S in env.sleeps and 2 * S in env.sleeps


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
    assert 7 * S in env.sleeps


def test_retry_after_too_long_aborts() -> None:
    env = Env(lambda _: httpx.Response(429, headers={"Retry-After": "99999"}))
    with pytest.raises(FetchError, match="Retry-After"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_min_interval_per_domain() -> None:
    env = Env(ok)  # 60 req/min => 1s entre requisições
    env.client.get("fonte_a", "https://a.example.test/1")
    env.client.get("fonte_a", "https://a.example.test/2")
    assert env.sleeps == [S]
    env.client.get("fonte_b", "https://b.example.test/1")  # outro domínio: sem espera
    assert env.sleeps == [S]


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


# --- revisão da T10 ---


@pytest.mark.parametrize(
    "url",
    [
        "https://a.example.test:8443/x",
        "https://a.example.test:abc/x",
        "https://[a.example.test/x",
        "https://a.example.test／x",
        " https://a.example.test/x",
        "https://a.example.test/x y",
        "https://a.example.test./x",
        "https://a.example.test@evil.test/x",
        "https://evil.test@a.example.test/x",
        "https://u:p@a.example.test/x",
        "ftp://a.example.test/x",
    ],
)
def test_refuses_malformed_or_unsafe_urls_without_leaking(url: str) -> None:
    env = Env(ok)
    with pytest.raises(SourceNotAllowedError) as info:
        env.client.get("fonte_a", url)
    message = str(info.value)
    assert "evil.test@" not in message and "u:p" not in message and "@" not in message
    assert env.requests == []


def test_credentials_with_other_host_not_in_message() -> None:
    env = Env(ok)
    with pytest.raises(SourceNotAllowedError) as info:
        env.client.get("fonte_a", "https://usuario:senha123@outro.example.test/x")
    assert "senha123" not in str(info.value) and "usuario" not in str(info.value)


def test_accepts_uppercase_host_and_explicit_443() -> None:
    env = Env(ok)
    env.client.get("fonte_a", "https://A.Example.TEST/x")
    env.client.get("fonte_a", "https://a.example.test:443/x")
    assert len(env.requests) == 2


def test_refuses_prohibited_source_even_if_enabled() -> None:
    sources = SourcesConfig(
        sources=[
            SourceConfig(
                id="fonte_p",
                base_url="https://p.example.test",
                permission_status="proibida",
                reviewed_at="2026-01-01",
                max_requests_per_minute=60,
                enabled=True,
            )
        ]
    )
    env = Env(ok, sources)
    with pytest.raises(SourceNotAllowedError, match="proibida"):
        env.client.get("fonte_p", "https://p.example.test/x")
    assert env.requests == []


def test_retry_after_http_date_too_far_aborts() -> None:
    when = format_datetime(WALL_NOW + timedelta(hours=2), usegmt=True)
    env = Env(lambda _: httpx.Response(429, headers={"Retry-After": when}))
    with pytest.raises(FetchError, match="Retry-After"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_retry_after_http_date_within_limit_is_honored() -> None:
    when = format_datetime(WALL_NOW + timedelta(seconds=60), usegmt=True)
    responses = iter([httpx.Response(429, headers={"Retry-After": when}), httpx.Response(200)])
    env = Env(lambda _: next(responses))
    env.client.get("fonte_a", "https://a.example.test/x")
    assert max(env.sleeps) == 60 * S


@pytest.mark.parametrize("value", ["amanha", "-5", "1.5", "", "Mon, 99 Foo 2026 25:61:61 GMT"])
def test_retry_after_unreadable_abandons(value: str) -> None:
    env = Env(lambda _: httpx.Response(503, headers={"Retry-After": value}))
    with pytest.raises(FetchError, match="Retry-After"):
        env.client.get("fonte_a", "https://a.example.test/x")
    assert len(env.requests) == 1


def test_small_retry_after_does_not_shorten_backoff() -> None:
    codes = iter([503, 503, 200])
    env = Env(lambda _: httpx.Response(next(codes), headers={"Retry-After": "0"}))
    env.client.get("fonte_a", "https://a.example.test/x")
    assert S in env.sleeps and 2 * S in env.sleeps


@pytest.mark.parametrize(
    "exc",
    [
        httpx.DecodingError("x"),
        httpx.TooManyRedirects("x"),
        httpx.InvalidURL("x"),
        ValueError("x"),
    ],
)
def test_other_exceptions_become_fetch_error(exc: Exception) -> None:
    def boom(_: httpx.Request) -> httpx.Response:
        raise exc

    env = Env(boom)
    with pytest.raises(FetchError) as info:
        env.client.get("fonte_a", "https://a.example.test/x")
    assert "a.example.test" not in str(info.value)


def test_adapter_cannot_override_user_agent() -> None:
    env = Env(ok)
    env.client.get(
        "fonte_a", "https://a.example.test/x", headers={"user-agent": "outro", "X-A": "1"}
    )
    sent = env.requests[0].headers
    assert "contato@example.test" in sent["user-agent"] and sent["x-a"] == "1"
    assert "outro" not in sent["user-agent"]


def test_timeout_is_not_float() -> None:
    env = Env(ok)
    assert env.client._client.timeout.read == 20


def test_min_interval_holds_under_threads() -> None:
    starts: list = []
    lock = threading.Lock()
    env = Env(ok)
    # relógio fixo em 0: sem lock, todas as threads leriam o mesmo "último" e não esperariam
    env.client._clock = lambda: 0
    env.client._sleep = lambda s: (lock.acquire(), starts.append(s), lock.release())

    def work() -> None:
        env.client._wait_interval("a.example.test", 60)

    threads = [threading.Thread(target=work) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    # cada thread recebe um horário distinto: esperas 0 (sem sleep), 1, 2, 3, 4
    assert sorted(starts) == [S, 2 * S, 3 * S, 4 * S]


# --- sleep padrão (2ª revisão) ---


def _default_sleep_client(responses, rpm: int = 600) -> tuple[HttpClient, list]:
    sources = SourcesConfig(
        sources=[
            SourceConfig(
                id="fonte_a",
                base_url="https://a.example.test",
                permission_status="permitida",
                reviewed_at="2026-01-01",
                max_requests_per_minute=rpm,
                enabled=True,
            )
        ]
    )
    it = iter(responses)
    client = HttpClient(
        sources,
        "contato@example.test",
        transport=httpx.MockTransport(lambda _: next(it)),
    )
    return client, []


def test_default_sleep_receives_number_not_decimal_for_interval(monkeypatch) -> None:
    received: list = []
    monkeypatch.setattr(time, "sleep", received.append)
    client, _ = _default_sleep_client([httpx.Response(200), httpx.Response(200)])
    client.get("fonte_a", "https://a.example.test/1")
    client.get("fonte_a", "https://a.example.test/2")
    assert len(received) == 1
    assert type(received[0]) in (int, float) and not isinstance(received[0], Decimal)
    assert 0 < received[0] <= 0.1  # 600/min => intervalo de 0,1 s


def test_default_sleep_receives_number_for_429_backoff(monkeypatch) -> None:
    received: list = []
    monkeypatch.setattr(time, "sleep", received.append)
    client, _ = _default_sleep_client(
        [httpx.Response(429, headers={"Retry-After": "3"}), httpx.Response(200)]
    )
    client.get("fonte_a", "https://a.example.test/1")
    assert all(type(v) in (int, float) for v in received)
    assert 3 in received  # Retry-After de 3 s vence o recuo de 1 s


def test_default_sleep_real_does_not_raise() -> None:
    client, _ = _default_sleep_client([httpx.Response(200), httpx.Response(200)], rpm=6000)
    started = time.monotonic_ns()
    client.get("fonte_a", "https://a.example.test/1")
    client.get("fonte_a", "https://a.example.test/2")  # dorme ~10 ms de verdade
    assert time.monotonic_ns() - started >= 5_000_000


def test_contact_with_line_break_rejected() -> None:
    with pytest.raises(ValueError):
        build_user_agent("a@example.test\r\nX-Evil: 1")


def test_os_and_runtime_errors_become_fetch_error_without_url() -> None:
    for exc in (OSError("/segredo/a.example.test"), RuntimeError("a.example.test")):

        def boom(_: httpx.Request, exc: Exception = exc) -> httpx.Response:
            raise exc

        env = Env(boom)
        with pytest.raises(FetchError) as info:
            env.client.get("fonte_a", "https://a.example.test/x")
        assert "a.example.test" not in str(info.value)

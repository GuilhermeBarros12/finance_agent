import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from collector.http import FetchError, HttpClient
from collector.settings import load_settings
from collector.sources.base import RawRecord
from collector.sources.brapi import BRAPI_METHODOLOGY_ID, BrapiAdapter, BrapiParseError
from pydantic import SecretStr

FIX = Path(__file__).resolve().parents[1] / "fixtures" / "brapi"
TOKEN = "tok-SECRETO-9f3a"
ENV = {"SCRAPER_CONTACT": "teste@example.test", "BRAPI_TOKEN": TOKEN}


def _body(symbol: str = "DEMO3", **over: object) -> bytes:
    item: dict[str, object] = {
        "symbol": symbol,
        "currency": "BRL",
        "regularMarketPrice": 10.5,
        "regularMarketTime": "2026-11-13T20:07:00.000Z",
    }
    item.update(over)
    item = {k: v for k, v in item.items() if v is not ...}
    return json.dumps({"results": [item]}).encode()


def _adapter(handler, token: str = TOKEN):  # type: ignore[no-untyped-def]
    settings = load_settings(ENV)
    http = HttpClient(
        settings.sources,
        settings.scraper_contact,
        transport=httpx.MockTransport(handler),
        sleep=lambda _us: None,
    )
    return BrapiAdapter(http, settings.sources.get("brapi"), SecretStr(token), "run-1")


def _raw(content: bytes, asset: str = "DEMO3") -> RawRecord:
    return RawRecord(
        "brapi",
        f"https://brapi.dev/api/v2/stocks/quote?symbols={asset}",
        content,
        datetime(2026, 11, 16, 12, 0, tzinfo=UTC),
        asset,
    )


def _parse(content: bytes, asset: str = "DEMO3"):  # type: ignore[no-untyped-def]
    return _adapter(lambda r: httpx.Response(200)).parse(_raw(content, asset))


def test_fixture_parses_to_exact_decimal() -> None:
    obs = _parse((FIX / "DEMO3.json").read_bytes())[0]
    assert obs.value_decimal == Decimal("38.50")
    assert obs.raw_value == "38.50"
    assert obs.model_dump(mode="json")["value_decimal"] == "38.50"
    assert obs.reference_at == datetime(2026, 11, 13, 20, 7, tzinfo=UTC)
    assert obs.methodology_id == "brapi_quote"
    assert obs.unit.value == "BRL" and obs.currency == "BRL"
    assert obs.source_url == "https://brapi.dev/api/v2/stocks/quote?symbols=DEMO3"


def test_offset_converted_to_utc() -> None:
    obs = _parse((FIX / "TEST4_offset.json").read_bytes(), "TEST4")[0]
    assert obs.reference_at == datetime(2026, 11, 13, 20, 7, tzinfo=UTC)
    assert obs.reference_at.utcoffset().total_seconds() == 0  # type: ignore[union-attr]
    assert obs.value_decimal == Decimal("1234.5")


def test_no_binary_float_error() -> None:
    assert _parse(_body(regularMarketPrice=0.1))[0].value_decimal == Decimal("0.1")
    assert (
        _parse(
            b'{"results":[{"symbol":"DEMO3","regularMarketPrice":38,'
            b'"regularMarketTime":"2026-11-13T20:07:00Z"}]}'
        )[0].value_decimal
        == 38
    )


def test_methodology_matches_config() -> None:
    cfg = load_settings(ENV).methodologies.metrics["quote_price"].sources["brapi"]
    assert cfg.methodology_id == BRAPI_METHODOLOGY_ID


@pytest.mark.parametrize("price", [None, "38,50", "abc", 0, -1, -0.5, True, [], ...])
def test_invalid_price_never_zero(price: object) -> None:
    with pytest.raises(BrapiParseError):
        _parse(_body(regularMarketPrice=price))


@pytest.mark.parametrize("when", [None, "ontem", "2026-11-13T20:07:00", 1763064420, ...])
def test_invalid_reference_is_failure_not_today(when: object) -> None:
    with pytest.raises(BrapiParseError):
        _parse(_body(regularMarketTime=when))


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"nao json",
        b'{"results":[]}',
        b"[]",
        b'{"error":true}',
        b'{"results":[{"symbol":"DEMO3","regularMarketPrice":NaN}]}',
        b'{"results":[1]}',
    ],
)
def test_bad_shapes(content: bytes) -> None:
    with pytest.raises(BrapiParseError):
        _parse(content)


def test_symbol_and_currency_mismatch() -> None:
    with pytest.raises(BrapiParseError):
        _parse(_body("TEST4"))
    with pytest.raises(BrapiParseError):
        _parse(_body(currency="USD"))


def test_collect_isolates_failures_and_token_not_leaked() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        sym = req.url.params["symbols"]
        if sym == "TEST4":
            return httpx.Response(401, text=f"unauthorized {TOKEN}")
        if sym == "FAKE3":
            return httpx.Response(200, content=_body("FAKE3", regularMarketPrice=None))
        return httpx.Response(200, content=_body(sym))

    adapter = _adapter(handler)
    result = adapter.collect(["DEMO3", "TEST4", "FAKE3", "bad"])
    assert [o.asset_id for o in result.observations] == ["DEMO3"]
    assert {f.asset_id for f in result.failures} == {"TEST4", "FAKE3", "bad"}
    assert len(seen) == 3  # uma requisição por ativo válido
    assert all(r.url.params["symbols"] in {"DEMO3", "TEST4", "FAKE3"} for r in seen)
    assert all(TOKEN not in str(r.url) for r in seen)
    assert seen[0].headers["Authorization"] == f"Bearer {TOKEN}"
    dumped = json.dumps(
        [o.model_dump(mode="json") for o in result.observations]
        + [f.model_dump(mode="json") for f in result.failures]
    )
    assert TOKEN not in dumped
    assert TOKEN not in repr(adapter) and TOKEN not in str(adapter.__dict__)


def test_all_fail_raises_without_token() -> None:
    adapter = _adapter(lambda r: httpx.Response(500, text=TOKEN))
    with pytest.raises(FetchError) as info:
        adapter.fetch(["DEMO3"])
    assert TOKEN not in str(info.value) and TOKEN not in repr(info.value)
    assert adapter.failures[0].asset_id == "DEMO3"
    assert TOKEN not in adapter.failures[0].reason


def test_rate_limit_is_failure() -> None:
    adapter = _adapter(lambda r: httpx.Response(429, headers={"Retry-After": "999"}))
    result = adapter.collect(["DEMO3"])
    assert result.observations == [] and len(result.failures) == 1


def test_parse_error_messages_without_token() -> None:
    with pytest.raises(BrapiParseError) as info:
        _parse(_body(regularMarketPrice=TOKEN))
    assert TOKEN not in str(info.value) and TOKEN not in repr(info.value)


def test_empty_token_rejected() -> None:
    with pytest.raises(ValueError):
        _adapter(lambda r: httpx.Response(200), token="")


# --- T11 (correções da revisão) ---------------------------------------------------------


def _raw_body(price: str, time: str = '"2026-11-13T20:07:00Z"') -> bytes:
    return (
        '{"results":[{"symbol":"DEMO3","currency":"BRL",'
        f'"regularMarketPrice":{price},"regularMarketTime":{time}}}]}}'
    ).encode()


@pytest.mark.parametrize("stamp", ['"0001-01-01T00:00:00+14:00"', '"9999-12-31T23:59:59-14:00"'])
def test_instant_overflow_is_parse_error(stamp: str) -> None:
    with pytest.raises(BrapiParseError):
        _parse(_raw_body("10.5", stamp))


def test_instant_overflow_fails_only_that_asset() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        sym = request.url.params["symbols"]
        stamp = '"0001-01-01T00:00:00+14:00"' if sym == "DEMO3" else '"2026-11-13T20:07:00Z"'
        body = _raw_body("10.5", stamp).replace(b"DEMO3", sym.encode())
        return httpx.Response(200, content=body)

    result = _adapter(handler).collect(["DEMO3", "TEST4"])
    assert [o.asset_id for o in result.observations] == ["TEST4"]
    assert [f.asset_id for f in result.failures] == ["DEMO3"]


@pytest.mark.parametrize("price", ["1e-30", "1e-99999999", "0.000000001", "1e999999999", "1e9"])
def test_price_scale_and_range_refused(price: str) -> None:
    with pytest.raises(BrapiParseError):
        _parse(_raw_body(price))


def test_price_at_scale_limit_accepted() -> None:
    obs = _parse(_raw_body("0.00000001"))[0]
    assert obs.value_decimal == Decimal("0.00000001")
    assert obs.raw_value == "0.00000001"


def test_raw_value_keeps_received_literal() -> None:
    obs = _parse(_raw_body("38.50"))[0]
    assert obs.raw_value == "38.50"
    obs = _parse(_raw_body("1.5e1"))[0]
    assert obs.raw_value == "1.5e1"
    assert obs.value_decimal == Decimal(15)


def test_future_reference_vs_fetched_at() -> None:
    # fetched_at = 2026-11-16T12:00Z
    with pytest.raises(BrapiParseError):
        _parse(_raw_body("10", '"2027-01-01T00:00:00Z"'))
    assert _parse(_raw_body("10", '"2026-11-16T12:04:00Z"'))
    with pytest.raises(BrapiParseError):
        _parse(_raw_body("10", '"2026-11-16T12:06:00Z"'))


def test_surrogate_ticker_does_not_break_batch() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_raw_body("10.5"))

    result = _adapter(handler).collect(["\ud800", "DEMO3"])
    assert [o.asset_id for o in result.observations] == ["DEMO3"]
    assert [f.asset_id for f in result.failures] == ["?"]


def test_duplicate_json_keys_refused() -> None:
    body = b'{"results":[{"symbol":"DEMO3","regularMarketPrice":1,"regularMarketPrice":2,' + (
        b'"regularMarketTime":"2026-11-13T20:07:00Z"}]}'
    )
    with pytest.raises(BrapiParseError):
        _parse(body)


def test_duplicate_asset_collected_once() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.params["symbols"])
        return httpx.Response(200, content=_raw_body("10.5"))

    result = _adapter(handler).collect(["DEMO3", "DEMO3"])
    assert calls == ["DEMO3"]
    assert len(result.observations) == 1


@pytest.mark.parametrize("token", ["a\r\nb", "tókén", "a b", "a\n"])
def test_bad_token_rejected(token: str) -> None:
    with pytest.raises(ValueError):
        _adapter(lambda r: httpx.Response(200), token)


def test_oversized_body_fails_asset() -> None:
    big = b" " * (1024 * 1024 + 1)
    result_adapter = _adapter(lambda r: httpx.Response(200, content=big))
    with pytest.raises(FetchError):
        result_adapter.fetch(["DEMO3"])
    assert [f.asset_id for f in result_adapter.failures] == ["DEMO3"]


_HUGE_EXPONENTS = ["1e99999999999999999999", "-1e99999999999999999999", "1e-99999999999999999999"]


def _item(symbol: str, price: str, extra: str = "") -> bytes:
    return (
        f'{{"results":[{{"symbol":"{symbol}","regularMarketPrice":{price},'
        f'"regularMarketTime":"2026-11-13T20:07:00Z"{extra}}}]}}'
    ).encode()


@pytest.mark.parametrize("huge", _HUGE_EXPONENTS)
@pytest.mark.parametrize("where", ["price", "other_field", "root"])
def test_huge_exponent_fails_only_that_asset(huge: str, where: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        symbol = request.url.params["symbols"]
        if symbol != "HUGE3":
            return httpx.Response(200, content=_item(symbol, "10.5"))
        if where == "price":
            return httpx.Response(200, content=_item(symbol, huge))
        if where == "other_field":
            return httpx.Response(200, content=_item(symbol, "10.5", f',"volume":{huge}'))
        return httpx.Response(200, content=b'{"x":' + huge.encode() + b',"results":[]}')

    result = _adapter(handler).collect(["DEMO3", "HUGE3", "TEST4"])
    assert [o.asset_id for o in result.observations] == ["DEMO3", "TEST4"]
    assert [f.asset_id for f in result.failures] == ["HUGE3"]


@pytest.mark.parametrize("huge", _HUGE_EXPONENTS)
def test_huge_exponent_is_parse_error(huge: str) -> None:
    with pytest.raises(BrapiParseError):
        _parse(_item("DEMO3", huge))
    with pytest.raises(BrapiParseError):
        _parse(_item("DEMO3", "10.5", f',"volume":{huge}'))


def test_failure_reason_with_lone_surrogate_does_not_raise() -> None:
    failure = BrapiAdapter._failure("DEMO3", "\ud800 bad\x00\n")
    assert failure.asset_id == "DEMO3"
    assert "bad" in failure.reason
    failure.model_dump_json()  # serializável em UTF-8

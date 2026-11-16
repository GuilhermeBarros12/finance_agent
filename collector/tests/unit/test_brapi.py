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

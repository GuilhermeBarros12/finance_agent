from decimal import Decimal

import pytest
from collector.normalization import (
    MissingKind,
    NormalizationError,
    parse_br_decimal,
    parse_missing,
    parse_percent,
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1.234,56", Decimal("1234.56")),
        ("12,34", Decimal("12.34")),
        ("1.234.567,8", Decimal("1234567.8")),
        ("1.234", Decimal(1234)),
        ("42", Decimal(42)),
        ("-1.234,56", Decimal("-1234.56")),
        ("-0,5", Decimal("-0.5")),
        ("0", Decimal(0)),
        ("0,00", Decimal("0.00")),
        ("  7,10 ", Decimal("7.10")),
    ],
)
def test_parse_br_decimal_valid(text: str, expected: Decimal) -> None:
    result = parse_br_decimal(text)
    assert isinstance(result, Decimal)
    assert result == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "abc",
        "12,3x",
        "1,234.56",
        "1.23",
        "12.34.5",
        "1,2,3",
        "--1",
        "NaN",
        "Infinity",
        "1e5",
        "-",
        "N/A",
        "R$ 1,00",
        "8,5%",
        "١٢٣",
        ",5",
        "5,",
        "0.123",
        "0.850",
        "00012",
        "007",
        "01,5",
        "1234.567",
    ],
)
def test_parse_br_decimal_invalid_raises(text: str) -> None:
    with pytest.raises(NormalizationError):
        parse_br_decimal(text)


def test_zero_legitimate_is_not_missing() -> None:
    assert parse_missing("0,00") is None
    assert parse_br_decimal("0,00") == 0


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("8,5%", Decimal("8.50")),
        ("0,00%", Decimal(0)),
        ("-3,25%", Decimal("-3.25")),
        ("1.234,5%", Decimal("1234.5")),
        (" 12% ", Decimal(12)),
    ],
)
def test_parse_percent_scale_0_to_100(text: str, expected: Decimal) -> None:
    assert parse_percent(text) == expected


@pytest.mark.parametrize("text", ["8,5", "%", "abc%", "", "8,5 %%"])
def test_parse_percent_invalid_raises(text: str) -> None:
    with pytest.raises(NormalizationError):
        parse_percent(text)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (None, MissingKind.EMPTY),
        ("", MissingKind.EMPTY),
        ("   ", MissingKind.EMPTY),
        ("-", MissingKind.DASH),
        (" - ", MissingKind.DASH),
        ("N/A", MissingKind.NOT_AVAILABLE),
        ("n/a", MissingKind.NOT_AVAILABLE),
        ("1,5", None),
        ("0", None),
        ("lixo", None),  # não é ausência; o conversor numérico é quem lança erro
        ("-1", None),
    ],
)
def test_parse_missing(text: str | None, expected: MissingKind | None) -> None:
    assert parse_missing(text) is expected


def test_garbage_after_parse_missing_still_errors() -> None:
    assert parse_missing("lixo") is None
    with pytest.raises(NormalizationError):
        parse_br_decimal("lixo")


def test_parse_percent_str_has_two_places() -> None:
    assert str(parse_percent("8,5%")) == "8.50"
    assert str(parse_percent("12%")) == "12.00"
    assert str(parse_percent("-3,255%")) == "-3.26"


@pytest.mark.parametrize("value", [0, 1.5, b"-", ["-"]])
def test_parse_missing_non_text_raises(value: object) -> None:
    with pytest.raises(NormalizationError):
        parse_missing(value)  # type: ignore[arg-type]

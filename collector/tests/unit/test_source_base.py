from datetime import UTC, datetime, timedelta, timezone

import pytest
from collector.sources.base import RawRecord, SourceAdapter


def test_raw_record_hash_and_utc() -> None:
    rec = RawRecord("fonte_a", "https://a.example.test/x", b"abc", datetime(2026, 1, 1, tzinfo=UTC))
    assert len(rec.content_hash) == 64


def test_raw_record_rejects_naive_and_non_utc() -> None:
    with pytest.raises(ValueError):
        RawRecord(
            "f", "https://a.example.test/x", b"", datetime.fromisoformat("2026-01-01T00:00:00")
        )
    with pytest.raises(ValueError):
        RawRecord(
            "f",
            "https://a.example.test/x",
            b"",
            datetime(2026, 1, 1, tzinfo=timezone(timedelta(hours=-3))),
        )


def test_adapter_is_abstract() -> None:
    with pytest.raises(TypeError):
        SourceAdapter()  # type: ignore[abstract]

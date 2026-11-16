"""Logs estruturados (uma linha JSON por evento) do coletor (T15).

Cada evento leva `run_id`, `etapa` e, quando faz sentido, `fonte`, contagens e `duracao_ms`.
Segredos registrados (token da brapi, string de conexão e a senha dela) são trocados por
`***` no texto final, mesmo que apareçam por engano em algum campo. Nunca se registra HTML
integral nem a resposta bruta de uma fonte.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, TextIO
from urllib.parse import unquote, urlsplit

REDACTED = "***"
_MIN_SECRET_LEN = 4
_MAX_FIELD_CHARS = 500


def secret_variants(secret: str) -> list[str]:
    """O próprio segredo e, se for URL de conexão, a senha (crua e decodificada)."""
    variants = [secret]
    try:
        password = urlsplit(secret).password
    except ValueError:
        password = None
    if password:
        variants.extend([password, unquote(password)])
    return variants


class JsonLogger:
    def __init__(
        self,
        stream: TextIO | None = None,
        *,
        run_id: str | None = None,
        secrets: Iterable[str] = (),
    ) -> None:
        self._stream = stream if stream is not None else sys.stderr
        self.run_id = run_id
        self._secrets: list[str] = []
        for secret in secrets:
            self.add_secret(secret)

    def add_secret(self, secret: str | None) -> None:
        for variant in secret_variants(secret or ""):
            if len(variant) >= _MIN_SECRET_LEN and variant not in self._secrets:
                self._secrets.append(variant)
        # os mais longos primeiro: a string de conexão antes da senha que ela contém
        self._secrets.sort(key=len, reverse=True)

    def redact(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret, REDACTED)
        return text

    def _clip(self, value: Any) -> Any:
        if isinstance(value, str) and len(value) > _MAX_FIELD_CHARS:
            return value[:_MAX_FIELD_CHARS] + "…"
        return value

    def event(self, etapa: str, **fields: Any) -> None:
        record: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "run_id": self.run_id,
            "etapa": etapa,
        }
        record.update({k: self._clip(v) for k, v in fields.items() if v is not None})
        line = json.dumps(record, ensure_ascii=False, default=str)
        self._stream.write(self.redact(line) + "\n")
        self._stream.flush()

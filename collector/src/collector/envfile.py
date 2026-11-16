"""Leitura de arquivos `.env` para desenvolvimento (README 14.1, `--env-file`).

Formato aceito: `NOME=valor`, uma por linha; linhas vazias e comentários (`#`) são
ignorados; aspas simples ou duplas em volta do valor são removidas. Variável já definida
(e não vazia) no ambiente de execução nunca é sobrescrita. Os valores nunca são impressos
nem aparecem em mensagens de erro (só o número da linha).
"""

from __future__ import annotations

import re
from collections.abc import MutableMapping
from pathlib import Path

from collector.settings import SettingsError

_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def parse_env_file(path: Path | str) -> dict[str, str]:
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SettingsError(f"arquivo --env-file ilegível: {path} ({type(exc).__name__})") from None
    values: dict[str, str] = {}
    for number, line in enumerate(text.splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].lstrip()
        name, sep, value = line.partition("=")
        name = name.strip()
        if not sep or not _NAME.fullmatch(name):
            raise SettingsError(f"--env-file: linha {number} inválida (esperado NOME=valor)")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[name] = value
    return values


def load_env_file(path: Path | str, environ: MutableMapping[str, str]) -> list[str]:
    """Carrega o arquivo em `environ` sem sobrescrever o que já está definido (não vazio).

    Devolve só os nomes carregados.
    """
    loaded = []
    for name, value in parse_env_file(path).items():
        if environ.get(name, "").strip():
            continue
        environ[name] = value
        loaded.append(name)
    return loaded

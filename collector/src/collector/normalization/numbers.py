"""Conversão de números no formato brasileiro.

Não existe conversão genérica: cada adaptador chama a função que corresponde ao formato
declarado pela sua fonte. Texto que não casa com o formato gera `NormalizationError`;
nunca vira zero. Ausência de dado (vazio, ``-``, ``N/A``) é tratada por `parse_missing`,
separada do erro.
"""

from __future__ import annotations

import re
from decimal import Decimal
from enum import StrEnum

# Dígitos ASCII apenas. Milhar com ponto em grupos de três; decimal com vírgula.
# Sem zero à esquerda: "0" ou "0,x" só como zero; "0.123" e "00012" são erro.
_BR_DECIMAL = re.compile(r"-?(?:0|[1-9][0-9]{0,2}(?:\.[0-9]{3})+|[1-9][0-9]*)(?:,[0-9]+)?")


class NormalizationError(ValueError):
    """Texto que não é um número no formato esperado."""


class MissingKind(StrEnum):
    """Tipos de ausência declarada pela fonte. Nunca equivalem a zero."""

    EMPTY = "empty"
    DASH = "dash"
    NOT_AVAILABLE = "not_available"


_MISSING_TOKENS = {"-": MissingKind.DASH, "n/a": MissingKind.NOT_AVAILABLE}


def parse_br_decimal(text: str) -> Decimal:
    """``"1.234,56"`` vira ``Decimal("1234.56")``. Aceita sinal ``-`` e zero legítimo."""
    if not isinstance(text, str):
        raise NormalizationError(f"esperado texto, recebido {type(text).__name__}")
    cleaned = text.strip()
    if not _BR_DECIMAL.fullmatch(cleaned):
        raise NormalizationError(f"número brasileiro inválido: {text!r}")
    return Decimal(cleaned.replace(".", "").replace(",", "."))


def parse_percent(text: str) -> Decimal:
    """``"8,5%"`` vira ``Decimal("8.50")``: escala 0 a 100, quantizado a 2 casas.

    O quantize usa o arredondamento padrão do contexto (meio-par), só para casas além da 2ª.
    """
    if not isinstance(text, str):
        raise NormalizationError(f"esperado texto, recebido {type(text).__name__}")
    cleaned = text.strip()
    if not cleaned.endswith("%"):
        raise NormalizationError(f"percentual sem '%': {text!r}")
    return parse_br_decimal(cleaned[:-1]).quantize(Decimal("0.01"))


def parse_missing(text: str | None) -> MissingKind | None:
    """Devolve o tipo de ausência, ou `None` se o texto não declara ausência.

    `None` não significa que o texto seja um número válido: quem recebe `None` deve
    seguir para `parse_br_decimal`/`parse_percent`, que lançam erro se for inválido.
    """
    if text is None:
        return MissingKind.EMPTY
    if not isinstance(text, str):
        raise NormalizationError(f"esperado texto, recebido {type(text).__name__}")
    cleaned = text.strip()
    if not cleaned:
        return MissingKind.EMPTY
    return _MISSING_TOKENS.get(cleaned.lower())

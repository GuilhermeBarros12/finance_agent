"""Teste de contrato (T06): os exemplos de `schemas/examples/` valem para Python e Zod.

O teste Deno (`supabase/functions/_shared/schemas_test.ts`) lê os mesmos arquivos.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest
from collector.contracts import FieldValidation, Observation, SnapshotManifest
from pydantic import BaseModel, ValidationError

EXAMPLES = Path(__file__).resolve().parents[3] / "schemas" / "examples"
MODELS: dict[str, type[BaseModel]] = {
    "observation": Observation,
    "validation": FieldValidation,
    "manifest": SnapshotManifest,
}


def _cases() -> list[tuple[str, Path]]:
    found = [(kind, path) for kind in MODELS for path in sorted((EXAMPLES / kind).glob("*.json"))]
    assert found, "nenhum exemplo encontrado em schemas/examples"
    return found


CASES = _cases()


@pytest.mark.parametrize(("kind", "path"), CASES, ids=[f"{k}/{p.stem}" for k, p in CASES])
def test_exemplo_aceito_ou_rejeitado(kind: str, path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    model = MODELS[kind]
    if path.name.startswith("valid-"):
        model.model_validate(data)
    else:
        assert path.name.startswith("invalid-"), f"nome fora do padrão: {path.name}"
        with pytest.raises(ValidationError):
            model.model_validate(data)


def test_cada_tipo_tem_exemplos_validos_e_invalidos() -> None:
    for kind in MODELS:
        names = [p.name for p in (EXAMPLES / kind).glob("*.json")]
        assert any(n.startswith("valid-") for n in names), kind
        assert any(n.startswith("invalid-") for n in names), kind


def test_decimal_vai_como_string_no_json() -> None:
    path = EXAMPLES / "observation" / "valid-dividend-yield.json"
    obs = Observation.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert obs.value_decimal == Decimal("8.50")
    dumped = obs.model_dump(mode="json")
    assert dumped["value_decimal"] == "8.50"
    assert Observation.model_validate(dumped) == obs
    assert json.loads(obs.model_dump_json())["value_decimal"] == "8.50"


def test_ida_e_volta_preserva_data_e_instante() -> None:
    path = EXAMPLES / "observation" / "valid-quote-price.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    dumped = Observation.model_validate(raw).model_dump(mode="json")
    assert dumped["reference_at"] == raw["reference_at"]
    assert dumped["collected_at"] == raw["collected_at"]

"""Exporta o JSON Schema dos contratos Pydantic para `schemas/` (T06).

Uso: python scripts/export_schemas.py
A CI roda este script e falha se `git diff schemas/` mostrar diferença.
"""

from __future__ import annotations

import json
from pathlib import Path

from collector.contracts import FieldValidation, Observation, SnapshotManifest
from pydantic import BaseModel

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas"

TARGETS: dict[str, type[BaseModel]] = {
    "observation.schema.json": Observation,
    "validation.schema.json": FieldValidation,
    "manifest.schema.json": SnapshotManifest,
}


def main() -> None:
    SCHEMAS_DIR.mkdir(exist_ok=True)
    for filename, model in TARGETS.items():
        schema = model.model_json_schema(mode="validation")
        text = json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
        (SCHEMAS_DIR / filename).write_text(text, encoding="utf-8")
        print(f"gravado schemas/{filename}")


if __name__ == "__main__":
    main()

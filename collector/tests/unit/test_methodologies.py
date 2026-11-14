import copy

import pytest
import yaml
from collector.settings import DEFAULT_METHODOLOGIES_PATH, Verdict, load_methodologies
from pydantic import ValidationError


def _raw() -> dict:
    return yaml.safe_load(DEFAULT_METHODOLOGIES_PATH.read_text(encoding="utf-8"))


def _write(tmp_path, data) -> object:
    p = tmp_path / "m.yaml"
    p.write_text(yaml.safe_dump(data), encoding="utf-8")
    return p


def test_arquivo_real_carrega():
    m = load_methodologies()
    assert m.version == "provisoria-1"
    assert m.metrics["quote_price"].verdict is Verdict.SINGLE_SOURCE


def test_nenhum_campo_comparable_na_versao_provisoria():
    m = load_methodologies()
    assert all(x.verdict is not Verdict.COMPARABLE for x in m.metrics.values())
    for name in ("price_to_book", "price_to_earnings", "dividend_yield", "roe"):
        assert m.metrics[name].verdict is Verdict.INSUFFICIENT_METADATA


def test_veredito_invalido_e_rejeitado(tmp_path):
    data = copy.deepcopy(_raw())
    data["metrics"]["roe"]["verdict"] = "quase_comparavel"
    with pytest.raises(ValidationError):
        load_methodologies(_write(tmp_path, data))


def test_metrica_ausente_e_rejeitada(tmp_path):
    data = copy.deepcopy(_raw())
    del data["metrics"]["roe"]
    with pytest.raises(ValidationError):
        load_methodologies(_write(tmp_path, data))


def test_campo_extra_e_rejeitado(tmp_path):
    data = copy.deepcopy(_raw())
    data["metrics"]["roe"]["sources"]["fundamentus"]["inventado"] = 1
    with pytest.raises(ValidationError):
        load_methodologies(_write(tmp_path, data))

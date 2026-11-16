"""CLI, --env-file e logs (T15), sem banco."""

import io
import json

import httpx
import pytest
from collector.cli import main
from collector.envfile import load_env_file, parse_env_file
from collector.logs import JsonLogger
from collector.settings import SettingsError

BASE = {"SCRAPER_CONTACT": "t@example.test"}
SECRET = "postgresql://collector_ingest:senha-secreta-123@127.0.0.1:54322/postgres"
TOKEN = "tok-SECRETO-9f3a"


def _run(argv, env, transport=None):
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, environ=env, stdout=out, stderr=err, transport=transport)
    return code, out.getvalue(), err.getvalue()


def test_doctor_offline_ok_sem_consultar_fontes():
    code, out, _ = _run(["doctor", "--offline"], BASE)
    report = json.loads(out)
    assert code == 0 and report["ok"]
    assert report["universe_size"] == 12
    assert report["brapi_token_set"] is False
    assert any("calibration_mode" in w for w in report["warnings"])


def test_doctor_offline_sem_contato_falha_com_mensagem_clara():
    code, _, err = _run(["doctor", "--offline"], {})
    assert code == 2 and "SCRAPER_CONTACT" in err


def test_doctor_online_usa_transporte_falso_e_nao_vaza_token():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        body = {
            "results": [
                {
                    "symbol": request.url.params["symbols"],
                    "currency": "BRL",
                    "regularMarketPrice": 10.5,
                    "regularMarketTime": "2026-11-13T20:07:00.000Z",
                }
            ]
        }
        return httpx.Response(200, json=body)

    env = {**BASE, "BRAPI_TOKEN": TOKEN}
    code, out, err = _run(["doctor", "--online"], env, httpx.MockTransport(handler))
    assert code == 0 and json.loads(out)["checks"]["brapi"] == "ok"
    assert seen == ["brapi.dev"]
    assert TOKEN not in out + err


def test_doctor_online_falha_da_fonte_da_saida_1():
    transport = httpx.MockTransport(lambda r: httpx.Response(404))
    code, out, _ = _run(["doctor", "--online"], {**BASE, "BRAPI_TOKEN": TOKEN}, transport)
    assert code == 1 and json.loads(out)["ok"] is False


def test_doctor_online_exige_token():
    code, _, err = _run(["doctor", "--online"], BASE)
    assert code == 2 and "BRAPI_TOKEN" in err


def test_run_fixtures_recusado_fora_de_local():
    code, _, err = _run(["run", "--mode", "fixtures"], {**BASE, "APP_ENV": "production"})
    assert code == 2 and "APP_ENV=local" in err


def test_run_dry_run_fixtures_nao_precisa_de_banco():
    code, out, err = _run(["run", "--mode", "fixtures", "--dry-run"], {**BASE, "APP_ENV": "local"})
    report = json.loads(out)
    assert code == 0, err
    assert report["published"] is False and report["observations_collected"] == 18


def test_run_publicar_sem_url_do_banco_falha_com_mensagem_clara():
    code, _, err = _run(["run", "--mode", "fixtures"], {**BASE, "APP_ENV": "local"})
    assert code == 2 and "COLLECTOR_DATABASE_URL" in err


def test_run_real_sem_token_falha_antes_de_coletar():
    code, _, err = _run(["run", "--dry-run"], BASE)
    assert code == 2 and "BRAPI_TOKEN" in err


def test_env_file_nao_sobrescreve_o_ambiente(tmp_path):
    path = tmp_path / ".env.teste"
    path.write_text(
        "# comentário\nSCRAPER_CONTACT=do-arquivo@example.test\n"
        f'BRAPI_TOKEN="{TOKEN}"\nCOLLECTOR_DATABASE_URL=\nexport APP_ENV=local\n'
    )
    env = {"SCRAPER_CONTACT": "do-ambiente@example.test"}
    loaded = load_env_file(path, env)
    assert env["SCRAPER_CONTACT"] == "do-ambiente@example.test"
    assert env["BRAPI_TOKEN"] == TOKEN and env["APP_ENV"] == "local"
    assert "SCRAPER_CONTACT" not in loaded


def test_env_file_invalido_nao_mostra_o_valor(tmp_path):
    path = tmp_path / ".env.ruim"
    path.write_text(f"{TOKEN}\n")
    with pytest.raises(SettingsError) as info:
        parse_env_file(path)
    assert TOKEN not in str(info.value) and "linha 1" in str(info.value)


def test_cli_aceita_env_file_em_todos_os_comandos(tmp_path):
    path = tmp_path / ".env.teste"
    path.write_text("SCRAPER_CONTACT=t@example.test\nAPP_ENV=local\n")
    code, out, _ = _run(["doctor", "--offline", "--env-file", str(path)], {})
    assert code == 0 and json.loads(out)["app_env"] == "local"
    code, _, _ = _run(["run", "--mode", "fixtures", "--dry-run", "--env-file", str(path)], {})
    assert code == 0


def test_logger_troca_segredos_inclusive_a_senha_da_url():
    stream = io.StringIO()
    log = JsonLogger(stream, run_id="r", secrets=[SECRET, TOKEN])
    log.event("teste", msg=f"url {SECRET} e token {TOKEN} e senha senha-secreta-123")
    text = stream.getvalue()
    assert "senha-secreta" not in text and TOKEN not in text and "***" in text
    assert json.loads(text)["run_id"] == "r"

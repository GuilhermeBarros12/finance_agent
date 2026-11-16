"""Retry em 40P01 e 55P03 (T15), sem banco: os erros são simulados."""

import psycopg
import pytest
from collector.store import (
    PostgresStore,
    PublishRejected,
    StoreError,
    call_with_retry,
    staging_id,
)

RUN = "6f1c1d0e-0000-4000-8000-000000000001"
SECRET_URL = "postgresql://collector_ingest:senha-secreta-123@127.0.0.1:54322/postgres"


class _Result:
    def fetchone(self):
        return ("11111111-1111-4111-8111-111111111111",)


class _Conn:
    def __init__(self, errors):
        self.errors = errors

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *_args, **_kw):
        if self.errors:
            raise self.errors.pop(0)
        return _Result()


def _store(errors, sleeps, retries=None):
    store = PostgresStore(
        SECRET_URL,
        sleep=sleeps.append,
        on_retry=(lambda *a: retries.append(a)) if retries is not None else None,
    )
    store._connect = lambda: _Conn(errors)  # type: ignore[method-assign]
    return store


@pytest.mark.parametrize(
    "error", [psycopg.errors.DeadlockDetected, psycopg.errors.LockNotAvailable]
)
def test_repete_em_deadlock_e_lock_timeout_com_espera_crescente(error):
    sleeps: list[int] = []
    retries: list[tuple] = []
    store = _store([error(), error()], sleeps, retries)
    assert store.publish(RUN, {}) == "11111111-1111-4111-8111-111111111111"
    assert sleeps == [2, 4]
    assert [r[1] for r in retries] == [error.sqlstate] * 2


def test_desiste_depois_do_limite_de_tentativas():
    sleeps: list[int] = []
    store = _store([psycopg.errors.DeadlockDetected() for _ in range(10)], sleeps)
    with pytest.raises(StoreError, match="40P01"):
        store.publish(RUN, {})
    assert sleeps == [2, 4, 8]  # 4 tentativas no total


def test_erro_nao_transitorio_nao_e_repetido():
    sleeps: list[int] = []
    store = _store([psycopg.errors.IntegrityConstraintViolation("cobertura insuficiente")], sleeps)
    with pytest.raises(PublishRejected):
        store.publish(RUN, {})
    assert sleeps == []


def test_call_with_retry_deixa_passar_o_que_nao_e_do_banco():
    with pytest.raises(ValueError):
        call_with_retry(lambda: (_ for _ in ()).throw(ValueError("x")), sleep=lambda _s: None)


def test_conexao_que_falha_nao_mostra_a_string_de_conexao():
    store = PostgresStore("postgresql://collector_ingest:senha-secreta-123@127.0.0.1:1/x")
    with pytest.raises(StoreError) as info:
        store.batch_done_on(__import__("datetime").date(2026, 11, 16))
    assert "senha-secreta" not in str(info.value) and "127.0.0.1" not in str(info.value)


def test_staging_id_e_deterministico_por_run():
    assert staging_id(RUN, "a") == staging_id(RUN, "a")
    assert staging_id(RUN, "a") != staging_id(RUN, "b")

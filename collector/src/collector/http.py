"""Cliente HTTP compartilhado pelos adaptadores (T10).

Recusa domínios fora de `config/sources.yaml`, fontes `enabled: false` e fontes
`permission_status: proibida`, limita as
tentativas, respeita `Retry-After` e o intervalo mínimo por domínio. Falha final
lança `FetchError`; nunca devolve corpo vazio no lugar de erro.
"""

from __future__ import annotations

import re
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Self
from urllib.parse import urlsplit

import httpx

from collector.settings import PermissionStatus, SourceConfig, SourcesConfig

MAX_ATTEMPTS = 3
# Todas as esperas são inteiros em microssegundos; o relógio é em nanossegundos.
US_PER_SECOND = 1_000_000
BACKOFF_BASE_US = 1 * US_PER_SECOND
MAX_RETRY_AFTER_US = 120 * US_PER_SECOND
DEFAULT_TIMEOUT_SECONDS = 20
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
_DIGITS = re.compile(r"[0-9]{1,12}")
_ALLOWED_PORTS = frozenset({None, 443})


class FetchError(Exception):
    """Falha de coleta HTTP. As mensagens nunca contêm a URL, só o id da fonte."""


class SourceNotAllowedError(FetchError):
    """Fonte desconhecida, desabilitada, proibida ou URL fora do domínio da fonte."""


def build_user_agent(contact: str) -> str:
    contact = contact.strip()
    if not contact:
        raise ValueError("SCRAPER_CONTACT vazio")
    if any(ord(c) < 32 or ord(c) == 127 for c in contact):
        raise ValueError("SCRAPER_CONTACT com caractere de controle")
    return f"agente-investimentos-coletor/0.1 (contato: {contact})"


def _sleep_us(microseconds: int) -> None:
    """Dorme `microseconds` (int). A divisão int/int é a única conversão para o `time.sleep`."""
    time.sleep(microseconds / US_PER_SECOND)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class HttpClient:
    """Cliente síncrono. O intervalo mínimo por domínio é protegido por lock (uso por threads)."""

    def __init__(
        self,
        sources: SourcesConfig,
        contact: str,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[int], None] = _sleep_us,
        clock: Callable[[], int] = time.monotonic_ns,
        wall_clock: Callable[[], datetime] = _utc_now,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._sources = sources
        self._sleep = sleep
        self._clock = clock
        self._wall_clock = wall_clock
        self._lock = threading.Lock()
        self._next_slot: dict[str, int] = {}
        self._user_agent = build_user_agent(contact)
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout,
            follow_redirects=False,  # um redirecionamento poderia sair do domínio permitido
            headers={"User-Agent": self._user_agent},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _check_allowed(self, source_id: str, url: str) -> SourceConfig:
        try:
            source = self._sources.get(source_id)
        except KeyError:
            raise SourceNotAllowedError(f"fonte desconhecida: {source_id}") from None
        if not source.enabled:
            raise SourceNotAllowedError(f"fonte desabilitada: {source_id}")
        if source.permission_status == PermissionStatus.PROIBIDA:
            raise SourceNotAllowedError(f"fonte com permissão proibida: {source_id}")
        if (
            not isinstance(url, str)
            or not url.isascii()
            or any(c.isspace() or ord(c) < 32 for c in url)
        ):
            raise SourceNotAllowedError(f"URL malformada para {source_id}")
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            raise SourceNotAllowedError(f"URL malformada para {source_id}") from None
        # credenciais primeiro: assim nenhuma mensagem precisa citar netloc/userinfo
        if "@" in parts.netloc:
            raise SourceNotAllowedError(f"URL com credenciais é recusada para {source_id}")
        if parts.scheme != "https":
            raise SourceNotAllowedError(f"esquema diferente de https recusado para {source_id}")
        hostname = (parts.hostname or "").lower()
        if hostname != source.host:
            raise SourceNotAllowedError(
                f"domínio fora do permitido para {source_id} (esperado {source.host}, "
                f"recebido {hostname})"
            )
        if port not in _ALLOWED_PORTS:
            raise SourceNotAllowedError(f"porta diferente da padrão recusada para {source_id}")
        return source

    def _wait_interval(self, host: str, max_per_minute: int) -> None:
        """Reserva o próximo horário livre do domínio sob lock e dorme fora dele."""
        min_interval = (60 * US_PER_SECOND) // max_per_minute
        with self._lock:
            now = self._clock() // 1000  # ns -> us
            slot = now
            last = self._next_slot.get(host)
            if last is not None:
                slot = max(now, last + min_interval)
            self._next_slot[host] = slot
        remaining = slot - now
        if remaining > 0:
            self._sleep(remaining)

    def _retry_after(self, response: httpx.Response) -> int | None:
        """Microssegundos pedidos pelo servidor. `None` se o cabeçalho não existe.

        Lança `ValueError` se existe e não é interpretável (inteiro ou data HTTP).
        """
        value = response.headers.get("Retry-After")
        if value is None:
            return None
        value = value.strip()
        if _DIGITS.fullmatch(value):
            return int(value) * US_PER_SECOND
        try:
            when = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError):
            raise ValueError("Retry-After ilegível") from None
        if when.tzinfo is None:
            raise ValueError("Retry-After ilegível")
        return max(0, (when - self._wall_clock()) // timedelta(microseconds=1))

    def get(
        self,
        source_id: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        source = self._check_allowed(source_id, url)
        # o User-Agent com o contato é do cliente; o adaptador não o troca
        send_headers = {k: v for k, v in (headers or {}).items() if k.lower() != "user-agent"}
        send_headers["User-Agent"] = self._user_agent
        last_reason = "sem tentativa"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._wait_interval(source.host, source.max_requests_per_minute)
            delay = BACKOFF_BASE_US * (2 ** (attempt - 1))
            try:
                response = self._client.get(url, params=params, headers=send_headers)
            except httpx.TransportError as exc:
                last_reason = f"erro de transporte: {type(exc).__name__}"
            except (httpx.HTTPError, httpx.InvalidURL, ValueError, OSError, RuntimeError) as exc:
                raise FetchError(
                    f"{source_id}: requisição inválida ({type(exc).__name__})"
                ) from None
            else:
                if 200 <= response.status_code < 300:
                    return response
                if response.status_code not in _RETRY_STATUS:
                    raise FetchError(f"HTTP {response.status_code} de {source_id}")
                last_reason = f"HTTP {response.status_code}"
                try:
                    retry_after = self._retry_after(response)
                except ValueError:
                    raise FetchError(
                        f"{source_id} enviou Retry-After ilegível; tentativa abandonada"
                    ) from None
                if retry_after is not None:
                    if retry_after > MAX_RETRY_AFTER_US:
                        raise FetchError(
                            f"{source_id} pediu espera de {retry_after // US_PER_SECOND}s (Retry-After); "
                            "tentativa abandonada"
                        )
                    delay = max(delay, retry_after)
            if attempt < MAX_ATTEMPTS:
                self._sleep(delay)
        raise FetchError(f"{source_id} falhou após {MAX_ATTEMPTS} tentativas ({last_reason})")

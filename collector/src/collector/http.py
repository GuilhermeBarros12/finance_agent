"""Cliente HTTP compartilhado pelos adaptadores (T10).

Recusa domínios fora de `config/sources.yaml` e fontes `enabled: false`, limita as
tentativas, respeita `Retry-After` e o intervalo mínimo por domínio. Falha final
lança `FetchError`; nunca devolve corpo vazio no lugar de erro.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Self
from urllib.parse import urlsplit

import httpx

from collector.settings import SourceConfig, SourcesConfig

MAX_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 1.0
MAX_RETRY_AFTER_SECONDS = 120.0
DEFAULT_TIMEOUT_SECONDS = 20.0
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


class FetchError(Exception):
    """Falha de coleta HTTP."""


class SourceNotAllowedError(FetchError):
    """Fonte desconhecida, desabilitada ou URL fora do domínio da fonte."""


def build_user_agent(contact: str) -> str:
    contact = contact.strip()
    if not contact:
        raise ValueError("SCRAPER_CONTACT vazio")
    return f"agente-investimentos-coletor/0.1 (contato: {contact})"


class HttpClient:
    def __init__(
        self,
        sources: SourcesConfig,
        contact: str,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._sources = sources
        self._sleep = sleep
        self._clock = clock
        self._last_request: dict[str, float] = {}
        self._client = httpx.Client(
            transport=transport,
            timeout=timeout,
            follow_redirects=False,  # um redirecionamento poderia sair do domínio permitido
            headers={"User-Agent": build_user_agent(contact)},
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
        parts = urlsplit(url)
        if parts.scheme != "https" or (parts.hostname or "").lower() != source.host:
            raise SourceNotAllowedError(
                f"URL fora do domínio permitido para {source_id} ({source.host}): {parts.netloc!r}"
            )
        if parts.username or parts.password:
            raise SourceNotAllowedError("URL com credenciais é recusada")
        return source

    def _wait_interval(self, host: str, max_per_minute: int) -> None:
        min_interval = 60.0 / max_per_minute
        last = self._last_request.get(host)
        if last is not None:
            remaining = min_interval - (self._clock() - last)
            if remaining > 0:
                self._sleep(remaining)
        self._last_request[host] = self._clock()

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if value is None:
            return None
        try:
            seconds = float(value.strip())
        except ValueError:
            return None  # formato data HTTP não é usado; cai no recuo crescente
        return seconds if seconds >= 0 else None

    def get(
        self,
        source_id: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        source = self._check_allowed(source_id, url)
        last_reason = "sem tentativa"
        for attempt in range(1, MAX_ATTEMPTS + 1):
            self._wait_interval(source.host, source.max_requests_per_minute)
            delay = BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
            try:
                response = self._client.get(url, params=params, headers=headers)
            except httpx.TransportError as exc:
                last_reason = f"erro de transporte: {type(exc).__name__}"
            else:
                if 200 <= response.status_code < 300:
                    return response
                if response.status_code not in _RETRY_STATUS:
                    raise FetchError(f"HTTP {response.status_code} de {source_id}")
                last_reason = f"HTTP {response.status_code}"
                retry_after = self._retry_after(response)
                if retry_after is not None:
                    if retry_after > MAX_RETRY_AFTER_SECONDS:
                        raise FetchError(
                            f"{source_id} pediu espera de {retry_after:.0f}s (Retry-After); "
                            "tentativa abandonada"
                        )
                    delay = retry_after
            if attempt < MAX_ATTEMPTS:
                self._sleep(delay)
        raise FetchError(f"{source_id} falhou após {MAX_ATTEMPTS} tentativas ({last_reason})")

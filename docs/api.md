# API

Endpoints das Edge Functions do Supabase (Deno). Base: `https://<PROJECT_REF>.supabase.co/functions/v1` (em ambiente local, `http://127.0.0.1:54321/functions/v1`). Decimais trafegam como **string** (`"8.50"`); percentuais na escala de 0 a 100.

Formato de erro, em todo endpoint:

```json
{ "error": { "code": "UNSUPPORTED_ASSET", "message": "texto em português", "details": { } } }
```

`details` é opcional. Nunca contém o corpo recebido, token nem texto interno de falha.

## POST /agent (T18, modo determinístico)

Responde a partir do snapshot ativo, **sem LLM**. O corpo já traz os ativos e os indicadores escolhidos (seletor manual). A T19 passa a aceitar só `message`.

### Autenticação e autorização

- `Authorization: Bearer <access_token do usuário>`. O JWT é verificado no código (`auth.getUser`); `verify_jwt = false` em `supabase/config.toml`, para o `401` sair no formato estruturado. O cabeçalho `apikey` é exigido só pelo gateway do Supabase.
- A conta precisa estar em `allowed_users` com `enabled = true`. O `user_id` vem **sempre do JWT**; uma chave `user_id` no corpo é recusada (`400`).

### Entrada

```json
{
  "request_id": "6e51ed30-9fd4-48fd-9a19-060f8197cda1",
  "conversation_id": "c1000000-0000-4000-8000-000000000001",
  "message": "texto digitado, opcional",
  "selection": { "asset_ids": ["PETR4", "VALE3"], "metrics": ["price_to_book"] }
}
```

| Campo | Regra |
| --- | --- |
| `request_id` | uuid gerado pelo navegador; repetir o mesmo valor é seguro (idempotência). |
| `conversation_id` | uuid de uma conversa do próprio usuário. |
| `message` | opcional; até 8.000 caracteres (pontos de código); nulo ou em branco equivale a ausente. |
| `selection.asset_ids` | obrigatório; 1 a 20 tickers, `[A-Z0-9]{1,12}`, sem repetição. |
| `selection.metrics` | obrigatório; 1 a 5 entre `quote_price`, `price_to_book`, `price_to_earnings`, `dividend_yield`, `roe`, sem repetição. |

Chaves extras são recusadas em qualquer nível. Corpo acima de 64 KB: `413`.

### Saída `200`

```json
{
  "request_id": "6e51ed30-9fd4-48fd-9a19-060f8197cda1",
  "conversation_id": "c1000000-0000-4000-8000-000000000001",
  "user_message_id": "uuid",
  "message_id": "uuid da mensagem do assistente",
  "status": "completed",
  "mode": "deterministic",
  "snapshot_id": "uuid",
  "content": "Resposta montada sem IA a partir do lote coletado em ...",
  "citations": [
    { "observation_id": "uuid", "asset_id": "DEMO3", "metric": "dividend_yield", "source_id": "fundamentus",
      "source_url": "https://...", "collected_at": "2026-09-18T20:01:00+00:00", "reference_at": "2026-09-18" }
  ],
  "warnings": [],
  "coverage": { "status": "partial", "missing_fields": [ { "asset_id": "TEST4", "metric": "roe", "reason": "missing" } ] },
  "payload": { "content_version": 1, "mode": "deterministic", "...": "ver docs/data-dictionary.md (messages.payload)" }
}
```

- `payload` é exatamente o que fica em `messages.payload` do assistente. Cada número tem fonte, data e estado de validação na evidência.
- `coverage.reason` é o estado da validação (`missing`, `incomparable`, ...) ou `not_in_snapshot`.
- Uma divergência (`divergent`) nunca é resolvida: `selected_observation_id` é nulo e as duas observações vão na evidência. Cada campo usa só a própria validação.
- Falha de coleta nunca vira zero: campo sem validação no lote gera o aviso `FIELD_NOT_IN_SNAPSHOT`.
- Repetição de um pedido já concluído devolve **o mesmo corpo** com o cabeçalho `Idempotent-Replay: true`, sem reler o mercado e sem duplicar mensagens.

### Idempotência (D16)

`request_runs` tem uma linha por `(user_id, request_id)` com o SHA-256 do corpo canônico (chaves em ordem fixa, `message` ausente = nulo).

| Situação | Resposta |
| --- | --- |
| Primeiro pedido | processa e grava |
| Mesmo `request_id`, mesmo corpo, concluído | `200` com a resposta gravada |
| Mesmo `request_id`, corpo diferente | `409 REQUEST_CONFLICT` |
| Mesmo corpo, ainda em andamento | `202 { "status": "processing" }` com `Retry-After: 3` |
| Reserva em andamento há mais de 3 minutos | tratada como expirada e retomada |
| Execução anterior terminou em falha | o mesmo pedido pode ser repetido de imediato |

As mensagens têm ids derivados de `(user_id, request_id)` e são gravadas num único `INSERT`: retomar uma reserva cujo turno já foi gravado não duplica nada.

### Erros

| HTTP / código | Quando |
| --- | --- |
| `400 INVALID_REQUEST` | JSON inválido ou corpo fora do schema (`details` lista `path` e `message`). |
| `401 UNAUTHENTICATED` | Sem `Authorization: Bearer`, token inválido ou expirado. |
| `403 ACCESS_DENIED` | Conta fora de `allowed_users` ou desabilitada. |
| `404 NOT_FOUND` | Conversa inexistente ou de outro dono (não distingue os casos). |
| `405 METHOD_NOT_ALLOWED` | Método diferente de `POST` e `OPTIONS`. |
| `409 REQUEST_CONFLICT` | `request_id` já usado com outro conteúdo. |
| `413 PAYLOAD_TOO_LARGE` | Corpo acima de 64 KB. |
| `422 UNSUPPORTED_ASSET` | Ticker fora de `assets` (`details.asset_ids` lista os recusados). |
| `500 INTERNAL_ERROR` | Falha inesperada ou dado publicado fora do contrato da T06. Nada é gravado e o pedido pode ser repetido. |
| `503 DATA_UNAVAILABLE` | Sem snapshot ativo e publicado. |
| `503 SERVICE_UNAVAILABLE` | O serviço de autenticação não respondeu. |
| `202` (sem erro) | Pedido igual ainda em andamento. |

Ordem das checagens: método, JWT (401), `allowed_users` (403), corpo (400/413), idempotência (409/202/200), conversa (404), ativos (422), snapshot (503).

### CORS

`APP_ORIGINS` (lista separada por vírgula, correspondência exata, em `supabase/.env.functions`). A origem só é devolvida em `Access-Control-Allow-Origin` quando consta na lista; `*` é ignorado e não há `Allow-Credentials`. Sem `APP_ORIGINS`, nenhum navegador é liberado (curl e testes continuam funcionando). Para o front local: `APP_ORIGINS=http://localhost:5173`.

### Exemplo

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "request_id": "6e51ed30-9fd4-48fd-9a19-060f8197cda1",
    "conversation_id": "c1000000-0000-4000-8000-000000000001",
    "selection": { "asset_ids": ["DEMO3"], "metrics": ["dividend_yield"] }
  }'
```

Com o seed local, o resultado traz `dividend_yield` de `DEMO3` como `divergent`, com os valores `"8.50"` (fundamentus) e `"9.10"` (statusinvest) e `selected_observation_id: null`.

## GET /catalog (T18b)

Dá ao front o que ele precisa para o seletor, a carteira e o painel de estado dos dados. Só leitura; sem LLM e sem carteira.

### Autenticação e autorização

Igual ao `POST /agent`: `Authorization: Bearer <access_token do usuário>`, verificado no código (`auth.getUser`), e conta em `allowed_users` com `enabled = true`. Chave de serviço, `anon` ou `publishable` como bearer **não** autenticam (`401`). Só `GET` (e `OPTIONS` para CORS, `204`); outros métodos: `405` com `Allow: GET, OPTIONS`. Sem corpo nem parâmetros: nada vindo do navegador entra na resposta. CORS por `APP_ORIGINS` (`*` descartado, sem `Allow-Credentials`). Resposta com `Cache-Control: no-store`.

### Saída `200`

```json
{
  "universe_version": "seed-1",
  "assets": [
    { "asset_id": "DEMO3", "name": "Demo S.A. (fictícia)", "reference_url": "https://statusinvest.com.br/acoes/demo3" }
  ],
  "metrics": [
    { "metric": "quote_price", "label": "Cotação", "unit": "BRL" },
    { "metric": "price_to_book", "label": "P/VP", "unit": "ratio" },
    { "metric": "price_to_earnings", "label": "P/L", "unit": "ratio" },
    { "metric": "dividend_yield", "label": "Dividend yield", "unit": "percent" },
    { "metric": "roe", "label": "ROE", "unit": "percent" }
  ],
  "snapshot": {
    "snapshot_id": "d0000000-0000-4000-8000-000000000001",
    "collected_at": "2026-09-18T20:05:00+00:00",
    "freshness": "fresh",
    "assets_total": 2,
    "assets_updated": 2,
    "failures": [],
    "status_counts": { "verified": 1, "divergent": 1, "single_source": 0, "incomparable": 1, "missing": 1, "not_applicable": 0, "invalid": 0 }
  }
}
```

- `universe_version`: o do snapshot ativo (`snapshots.universe_version`). **Sem snapshot (ou sem versão gravada) é `null`**: a função não lê `config/universe.yaml` (fora do pacote da função) e não inventa valor. O front deve tolerar `null`.
- `assets`: ações (`asset_class = stock`) de `assets`, ordenadas por `asset_id` (símbolo). Não há coluna de "ativo/inativo" nesta fatia. `reference_url` é montada **no servidor** (README 7.8) com classe + símbolo do cadastro e o `base_url` da fonte `statusinvest` em `data_sources` (habilitada). Só `https`, sem credenciais, porta, parâmetros ou fragmento; sem fonte válida cadastrada, `null`. É link de consulta manual, não evidência de observação.
- `metrics`: as cinco métricas do contrato, com rótulo em português e unidade de `METRIC_UNIT` (a mesma de `contracts.py`).
- `snapshot`: `null` (com `200`) quando não há snapshot ativo publicado. `collected_at`, `assets_total` e `assets_updated` vêm do manifesto, nunca do relógio.
- `freshness`: calculado no servidor contra o relógio atual, pela regra da T14/D20 reproduzida em TypeScript (`catalog/freshness.ts`): dias úteis seg-sex em `(dia de collected_at, dia de agora]` no fuso de Brasília (UTC-3 fixo, sem feriados); mais de 1 é `stale`, mais de 5 é `expired`; coleta mais de 5 minutos no futuro é `unknown_reference_date`.
- `status_counts`: contagem das validações do snapshot ativo por estado. Traz os 7 estados do contrato da T06 (inclui `not_applicable`, além dos seis do exemplo do plano); estado sem validação vale `0`.
- `failures`: resumo do manifesto, `{asset_id, source_id, reason}`. `reason` sai sem tags HTML, sem URL ou string de conexão, sem JWT/token/chave, em linha única e com no máximo 200 caracteres. Manifesto malformado vira `500`, nunca lista vazia.

### Erros

`401 UNAUTHENTICATED`, `403 ACCESS_DENIED`, `405 METHOD_NOT_ALLOWED`, `503 SERVICE_UNAVAILABLE` (Auth fora do ar), `500 INTERNAL_ERROR` (falha de leitura ou dado inconsistente; sem stack nem SQL). Mesmo formato do restante deste documento. Os logs não trazem JWT.

# API

Endpoints das Edge Functions do Supabase (Deno). Base: `https://<PROJECT_REF>.supabase.co/functions/v1` (em ambiente local, `http://127.0.0.1:54321/functions/v1`). Decimais trafegam como **string** (`"8.50"`); percentuais na escala de 0 a 100.

Formato de erro, em todo endpoint:

```json
{ "error": { "code": "UNSUPPORTED_ASSET", "message": "texto em português", "details": { } } }
```

`details` é opcional. Nunca contém o corpo recebido, token nem texto interno de falha.

## POST /agent (T18 e T19)

Responde a partir do snapshot ativo. Os números e as validações vêm sempre do banco, de forma determinística. Com `selection` (seletor manual) não há LLM. Sem `selection` (T19), um classificador de LLM só escolhe tickers e indicadores a partir de `message`; o texto do LLM nunca chega ao usuário. Falha do LLM não é erro: vira `needs_selection` (ver abaixo).

### Autenticação e autorização

- `Authorization: Bearer <access_token do usuário>`. O JWT é verificado no código (`auth.getUser`); `verify_jwt = false` em `supabase/config.toml`, para o `401` sair no formato estruturado. O cabeçalho `apikey` é exigido só pelo gateway do Supabase.
- A conta precisa estar em `allowed_users` com `enabled = true`. O `user_id` vem **sempre do JWT**; uma chave `user_id` no corpo é recusada (`400`).

### Entrada

```json
{
  "request_id": "6e51ed30-9fd4-48fd-9a19-060f8197cda1",
  "conversation_id": "c1000000-0000-4000-8000-000000000001",
  "message": "texto digitado; obrigatório se não houver selection",
  "selection": { "asset_ids": ["PETR4", "VALE3"], "metrics": ["price_to_book"] }
}
```

| Campo | Regra |
| --- | --- |
| `request_id` | uuid gerado pelo navegador; repetir o mesmo valor é seguro (idempotência). |
| `conversation_id` | uuid de uma conversa do próprio usuário. |
| `message` | até 8.000 caracteres (pontos de código); nulo ou em branco equivale a ausente. **Obrigatório quando não há `selection`.** Para o classificador, até 2.000 caracteres (acima disso: `needs_selection` `LLM_INPUT_TOO_LONG`). |
| `selection` | **opcional desde a T19.** Presente: modo manual, o LLM não é chamado, mesmo com `message`. Ausente: o classificador escolhe. Sem `selection` e sem `message` (ou só espaços): `400`. `null` é recusado. |
| `selection.asset_ids` | se `selection` existir, obrigatório; 1 a 20 tickers, `[A-Z0-9]{1,12}`, sem repetição. |
| `selection.metrics` | se `selection` existir, obrigatório; 1 a 5 entre `quote_price`, `price_to_book`, `price_to_earnings`, `dividend_yield`, `roe`, sem repetição. |

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
  "intent_source": "manual",
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

- `intent_source` (T19): `manual` (veio `selection`), `llm` (o classificador escolheu) ou `mock` (`MOCK_LLM=true`, só local). Não altera o `payload`.
- `payload` é exatamente o que fica em `messages.payload` do assistente. Cada número tem fonte, data e estado de validação na evidência.
- `coverage.reason` é o estado da validação (`missing`, `incomparable`, ...) ou `not_in_snapshot`.
- Uma divergência (`divergent`) nunca é resolvida: `selected_observation_id` é nulo e as duas observações vão na evidência. Cada campo usa só a própria validação.
- Falha de coleta nunca vira zero: campo sem validação no lote gera o aviso `FIELD_NOT_IN_SNAPSHOT`.
- Repetição de um pedido já concluído devolve **o mesmo corpo** com o cabeçalho `Idempotent-Replay: true`, sem reler o mercado e sem duplicar mensagens.

### Sem `selection`: classificador e `needs_selection` (T19, D4, D5)

Ordem: o fluxo é o da T18 até a conversa do dono (autenticação, `allowed_users`, corpo, reserva, dono da conversa); só então o classificador roda. Quem não é dono da conversa, não está autenticado ou não é autorizado **não gasta cota**.

O prompt enviado ao provedor tem só: a instrução, a lista de tickers do universo (`assets`), a lista de métricas e a mensagem do usuário, dentro de `<mensagem_do_usuario>...</mensagem_do_usuario>` (os sinais `<` e `>` da mensagem são trocados para ela não fechar o delimitador). Nada de e-mail, nome, UUID, `user_id`, `conversation_id`, histórico, carteira, snapshot ou valores. A saída é validada por Zod estrito: `intent` em `compare|lookup|unsupported`; `asset_ids` só do universo; `metrics` só das cinco métricas; chaves extras, repetições, mais de 20 ativos ou 5 métricas e `compare`/`lookup` sem ativo ou sem métrica invalidam a resposta **inteira** (nada é corrigido ou filtrado). O texto precisa ser exatamente um objeto JSON: cerca de markdown ou texto antes ou depois também é inválido. A seleção aprovada ainda passa pela resolução contra `assets` (422 como antes).

Falhas do LLM respondem **`200`** com:

```json
{
  "request_id": "uuid",
  "conversation_id": "uuid",
  "status": "needs_selection",
  "mode": "deterministic",
  "content": "Não foi possível interpretar a pergunta automaticamente. Escolha os ativos e os indicadores no seletor manual.",
  "reason": { "code": "LLM_QUOTA_EXHAUSTED" },
  "warnings": [ { "code": "LLM_QUOTA_EXHAUSTED", "message": "O limite diário do modo por IA foi atingido. O modo por IA não foi usado." } ]
}
```

A interface abre o seletor manual (D5) e reenvia com **novo `request_id`** e `selection`. Esta resposta não tem `payload`, `citations`, `message_id`, `user_message_id`, `coverage` nem `snapshot_id`: não há dado a apresentar, e **nada é gravado em `messages`** (a mensagem digitada fica com a interface, que a reenvia junto da seleção manual). A execução em `request_runs` termina `succeeded` com esta resposta; repetir o mesmo `request_id` e corpo devolve o mesmo resultado (`Idempotent-Replay: true`) sem nova chamada ao LLM e sem nova cota.

| `reason.code` | Quando |
| --- | --- |
| `LLM_INVALID_OUTPUT` | JSON inválido, markdown ou texto extra, chave extra, ticker fora do universo, métrica fora do enum, resposta do provedor acima de 32 KB ou fora do formato. |
| `LLM_UNSUPPORTED` | O modelo classificou `intent: "unsupported"`. |
| `LLM_QUOTA_EXHAUSTED` | O limite diário (`LLM_DAILY_LIMIT`) foi atingido; o provedor não é chamado. |
| `LLM_QUOTA_UNAVAILABLE` | Não foi possível consultar o contador; falha fechada, o provedor não é chamado. |
| `LLM_PROVIDER_ERROR` | `4xx` do provedor (chave inválida, modelo removido), `429` ou `5xx` persistentes, erro de rede, `Retry-After` acima do teto. |
| `LLM_TIMEOUT` | O provedor não respondeu em 8 s (AbortController). Não há nova tentativa. |
| `LLM_DISABLED` | Sem `GROQ_API_KEY` e sem `MOCK_LLM`; nada é chamado. |
| `LLM_INPUT_TOO_LONG` | `message` com mais de 2.000 caracteres; nada é chamado. |
| `LLM_NO_UNIVERSE` | Não há ações em `assets`; nada é chamado. |

Chamadas e cota:
- No máximo **2 chamadas** ao provedor por requisição. A segunda só em `429`, `5xx`, `408` ou erro de rede, esperando `Retry-After` (segundos inteiros, teto de 5 s; acima do teto não espera nem repete; ausente ou inválido: 500 ms). Timeout não é repetido.
- Antes de **cada** chamada, a RPC `consume_llm_quota('groq', LLM_DAILY_LIMIT)` incrementa `llm_usage` de forma atômica (dia em `America/Sao_Paulo`). Limite atingido: o provedor não é chamado. A unidade consumida **não é devolvida** se a chamada falhar. Um pedido com retry consome 2.
- Configuração (`supabase/.env.functions`): `GROQ_API_KEY` (segredo), `GROQ_MODEL` (padrão `openai/gpt-oss-120b`), `LLM_DAILY_LIMIT` (inteiro, padrão 200; `0` desliga), `MOCK_LLM`, `APP_ENV`. `MOCK_LLM=true` devolve sempre `compare` de `DEMO3`/`dividend_yield` (validado contra o universo, sem rede e sem cota) e **só vale com `APP_ENV=local` ou `test`**; com outro valor ou sem `APP_ENV` a função **não inicia** (erro de configuração claro), nunca cai em modo simulado fora do local. Valor inválido de `MOCK_LLM`, `GROQ_MODEL` ou `LLM_DAILY_LIMIT` também impede a partida.
- Os logs registram `code`, `request_id`, `user_id`, `duration_ms` e `llm_calls` (inteiro). Nunca a mensagem do usuário, a chave, a URL do provedor ou o corpo da resposta dele.

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
| `400 INVALID_REQUEST` | JSON inválido, corpo fora do schema ou sem `selection` e sem `message` (`details` lista `path` e `message`). |
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
| `200 needs_selection` (sem erro) | Falha do LLM (tabela acima): abra o seletor manual. |

Ordem das checagens: método, JWT (401), `allowed_users` (403), corpo (400/413), idempotência (409/202/200), conversa (404), classificador (só sem `selection`; falha vira `200 needs_selection`), ativos (422), snapshot (503).

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

Só com `message` (T19; com `MOCK_LLM=true` e `APP_ENV=local` o resultado é o do exemplo seguinte):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/agent" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  --data '{ "request_id": "7f51ed30-9fd4-48fd-9a19-060f8197cda2", "conversation_id": "c1000000-0000-4000-8000-000000000001", "message": "dividend yield de DEMO3" }'
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
    { "id": "a0000000-0000-4000-8000-000000000001", "asset_id": "DEMO3", "name": "Demo S.A. (fictícia)", "reference_url": "https://statusinvest.com.br/acoes/demo3" }
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
- `assets`: ações (`asset_class = stock`) de `assets`, ordenadas por `asset_id` (símbolo). `id` (T21d, P-21) é o uuid de `assets.id`, em minúsculas: é o valor que o navegador grava em `portfolio_items.asset_id` e usa para cruzar a carteira com o catálogo; `asset_id` continua sendo o símbolo (é o que o `POST /agent` aceita em `selection.asset_ids`). O handler confere o formato uuid: id ausente ou malformado vira `500 INTERNAL_ERROR`, nunca valor inventado. Campo aditivo: clientes antigos o ignoram. Não há coluna de "ativo/inativo" nesta fatia. `reference_url` é montada **no servidor** (README 7.8) com classe + símbolo do cadastro e o `base_url` da fonte `statusinvest` em `data_sources` (habilitada). Só `https`, sem credenciais, porta, parâmetros ou fragmento; sem fonte válida cadastrada, `null`. É link de consulta manual, não evidência de observação.
- `metrics`: as cinco métricas do contrato, com rótulo em português e unidade de `METRIC_UNIT` (a mesma de `contracts.py`).
- `snapshot`: `null` (com `200`) quando não há snapshot ativo publicado. `collected_at`, `assets_total` e `assets_updated` vêm do manifesto, nunca do relógio.
- `freshness`: calculado no servidor contra o relógio atual, pela regra da T14/D20 reproduzida em TypeScript (`catalog/freshness.ts`): dias úteis seg-sex em `(dia de collected_at, dia de agora]` no fuso de Brasília (UTC-3 fixo, sem feriados); mais de 1 é `stale`, mais de 5 é `expired`; coleta mais de 5 minutos no futuro é `unknown_reference_date`.
- `status_counts`: contagem das validações do snapshot ativo por estado. Traz os 7 estados do contrato da T06 (inclui `not_applicable`, além dos seis do exemplo do plano); estado sem validação vale `0`.
- `failures`: resumo do manifesto, `{asset_id, source_id, reason}`. `reason` sai sem tags HTML, sem URL ou string de conexão, sem JWT/token/chave, em linha única e com no máximo 200 caracteres. Manifesto malformado vira `500`, nunca lista vazia.

### Erros

`401 UNAUTHENTICATED`, `403 ACCESS_DENIED`, `405 METHOD_NOT_ALLOWED`, `503 SERVICE_UNAVAILABLE` (Auth fora do ar), `500 INTERNAL_ERROR` (falha de leitura ou dado inconsistente; sem stack nem SQL). Mesmo formato do restante deste documento. Os logs não trazem JWT.

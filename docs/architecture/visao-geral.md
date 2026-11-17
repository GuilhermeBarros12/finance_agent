# Visão geral da arquitetura

Estado após a T19 (banco, publicação, função do agente e classificador de intenção). As demais partes entram nas tarefas seguintes.

```text
Coletor (Python)  --publica-->  Postgres (Supabase)  <--lê--  Edge Function  <--JWT--  Frontend (React)
                                   |                            ^
                                   |-- dados de mercado         |-- user_id vem do JWT
                                   |   (sem acesso do navegador)
                                   `-- dados privados (RLS de dono autorizado)
```

- **Dados de mercado** (`assets`, `data_sources`, `collection_runs`, `snapshots`, `observations`, `field_validations`, `active_snapshot`): escritos só pelo coletor, imutáveis depois de publicados, lidos só pela Edge Function. O navegador não tem grant nem política nessas tabelas.
- **Dados privados** (`allowed_users`, `conversations`, `messages`, `request_runs`, `llm_usage`, `portfolio_items`): o navegador lê o que é seu e gerencia conversas e carteira; mensagens, execuções e contador de LLM são escritos só pelo backend.
- Detalhes de tabelas e políticas em `docs/data-dictionary.md`.

## Publicação (T09)

```text
Coletor --(papel collector_ingest)--> staging_* --publish_snapshot--> snapshots + observations + field_validations
                                                       |                 `-> active_snapshot (só snapshot publicado)
                                                       `-- tudo ou nada, numa transação
```

- O coletor conecta com o papel `collector_ingest` (não com `service_role`, D13). Ele insere em `collection_runs` e nas tabelas de staging, lê `assets` e `data_sources` e executa `publish_snapshot`. Não lê nada privado nem de snapshots.
- `publish_snapshot` trava o staging (o `INSERT` do coletor espera), valida o manifesto no formato da T06 (`failures` obrigatório, instante com fuso, valores finitos, sem datas infinitas nem no futuro além de 5 minutos) e o lote inteiro antes de copiar. O coletor deve confirmar (commit) o staging antes de chamar a RPC e repetir em `40P01` (deadlock entre sessões com insert pendente) ou `55P03` (espera de lock acima de 30 s); ver `docs/tarefas/T09.md`. Se algo falha, o último snapshot publicado continua ativo (README 6.4). Lote com ao menos metade do universo e menos que o total fica `partial`, com o manifesto de cobertura no snapshot.
- `prune_snapshots` (retenção de 30 dias, D11) roda como administrador, não apaga o snapshot ativo e é a única a ligar `app.retention_job`.
- O coletor (T15) é o módulo `collector.pipeline`, chamado por `python -m collector.cli`. Ordem: valida a configuração, cria `run_id` e a data lógica em `America/Sao_Paulo`, recusa se `collector_batch_done_on(dia)` for verdadeiro (salvo `--force`), coleta cada fonte registrada, valida por campo (T14), grava `collection_runs` e `staging_*` e CONFIRMA, e só então chama `publish_snapshot` em outra transação (repetida em `40P01`/`55P03`). Observação que o motor lista em `unpublished_observation_ids` nunca vai ao staging. Se a RPC recusar, o snapshot ativo não muda e a execução fica `running`. O modo `fixtures` usa dados sintéticos de `collector/tests/fixtures/pipeline/` e só publica com `APP_ENV=local`.
- A RPC não é exposta por HTTP: `anon`, `authenticated` e `service_role` não têm `execute`, então não há entrada em `docs/api.md`. A chamada é direta no Postgres, pelo coletor.

## Função do agente (T18)

```text
Navegador --JWT--> agent (Edge Function, Deno)
                    |-- auth.getUser(JWT)                        -> user_id (só daqui)
                    |-- cliente com JWT do usuário (RLS)         -> allowed_users, conversations
                    `-- cliente service_role (depois do acima)   -> request_runs, messages (escrita)
                                                                    assets, snapshots, field_validations, observations (leitura)
```

- Código em `supabase/functions/agent/`: `handler.ts` (fluxo do README 9.1), `request.ts` (Zod estrito e hash do corpo), `idempotency.ts` (reserva em `request_runs`), `evidence.ts` (payload versão 1 e pacote de evidências), `store.ts` (único módulo que fala com o Supabase), `index.ts` (liga o ambiente). O handler recebe tudo por injeção (`AgentDeps`: clientes, relógio, hash), por isso os testes rodam em memória na CI.
- Na T18 não havia LLM. A carteira (`portfolio_items`) não é lida nem enviada a ninguém. O classificador da T19 está na seção seguinte.
- Ordem: método, JWT (401), `allowed_users` (403), corpo (400), idempotência (409/202/200), conversa (404), ativos (422), snapshot (503), evidências, gravação das duas mensagens num único `INSERT` e conclusão da reserva com a resposta. Nada fica numa transação aberta entre passos.
- `verify_jwt = false` em `supabase/config.toml` (`[functions.agent]`): o JWT é conferido no código, e o 401 sai no formato de erro do projeto. A autorização não depende disso: sem passar por `auth.getUser` e por `allowed_users`, o cliente administrativo nunca é usado.
- Contrato HTTP em `docs/api.md`.
- **`_shared/` (T18b).** A autenticação (`auth.ts`: `bearer`, `authenticateWith`, `isAllowedUserWith`), os erros (`errors.ts`), o CORS (`cors.ts`) e a leitura do ambiente (`env.ts`) saíram de `agent/` para `supabase/functions/_shared/`. `agent/errors.ts` e `agent/cors.ts` só reexportam; o comportamento do `agent` não mudou.
- **`GET /functions/v1/catalog` (T18b).** `supabase/functions/catalog/`: mesma ordem de segurança do agente (método, JWT 401, `allowed_users` 403) e só então o cliente `service_role` lê `assets`, `data_sources`, `active_snapshot`, `snapshots` e a contagem de `field_validations`. Só leitura, sem LLM, sem carteira. O frescor é calculado no servidor (`freshness.ts`, mesma regra de dias úteis do motor da T14) contra o relógio injetado; `failures` passa por `sanitize.ts`; o link de referência é montado em `reference.ts`.

## Classificador de intenção (T19)

```text
POST /agent sem selection
  -> (auth, allowed_users, corpo, reserva, conversa do dono)     [como na T18]
  -> listStockSymbols()                  universo = ações de `assets`
  -> llm.classify(message, universe)
       mock?      -> classificação fixa (MOCK_LLM=true só com APP_ENV=local|test)
       sem chave? -> LLM_DISABLED
       groq:  consume_llm_quota(RPC, atômica)  --nega--> LLM_QUOTA_EXHAUSTED (sem chamar)
              fetch injetável + AbortController + tamanho máximo, até 2 chamadas
              Zod estrito (intent, asset_ids do universo, metrics do enum)
  -> ok:    segue o fluxo determinístico da T18 com a seleção validada
  -> falha: 200 needs_selection + aviso com código; nada em `messages`; run `succeeded`
```

- Código em `supabase/functions/_shared/llm/`: `config.ts` (ambiente e recusa de mock hospedado), `schema.ts` (Zod e prompt), `groq.ts` (`classifyIntent`, retry, timeout), `service.ts` (liga tudo, entrega `LlmService` ao handler), `fakes.ts` (dublês de teste). `agent/store.ts` ganhou `SupabaseQuotaStore` (RPC) e `listStockSymbols`.
- O LLM só devolve intenção, tickers do universo e métricas do enum. Não escreve texto para o usuário, não vê valores, snapshot, carteira, conversa nem identificadores do usuário, e nunca escolhe lado em divergência. Os números vêm do banco, como na T18.
- O contador global fica em `llm_usage`, incrementado por `public.consume_llm_quota` (`security definer`, só `service_role`). A cota é consumida antes da chamada e não é devolvida em falha.
- Sem fallback de LLM nem Gemini (D6).

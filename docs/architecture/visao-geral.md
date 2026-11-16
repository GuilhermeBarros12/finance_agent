# Visão geral da arquitetura

Estado após a T18 (banco, publicação e função do agente). As demais partes entram nas tarefas seguintes.

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
- Sem LLM nesta tarefa: o modo é `deterministic`, não há chamada de rede além do banco, e `MOCK_LLM` nem é lido. A carteira (`portfolio_items`) não é lida nem enviada a ninguém. A T19 acrescenta o classificador de intenção antes da resolução de ativos.
- Ordem: método, JWT (401), `allowed_users` (403), corpo (400), idempotência (409/202/200), conversa (404), ativos (422), snapshot (503), evidências, gravação das duas mensagens num único `INSERT` e conclusão da reserva com a resposta. Nada fica numa transação aberta entre passos.
- `verify_jwt = false` em `supabase/config.toml` (`[functions.agent]`): o JWT é conferido no código, e o 401 sai no formato de erro do projeto. A autorização não depende disso: sem passar por `auth.getUser` e por `allowed_users`, o cliente administrativo nunca é usado.
- Contrato HTTP em `docs/api.md`.

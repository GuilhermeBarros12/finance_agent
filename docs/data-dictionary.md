# Dicionário de dados

Descreve as tabelas do schema `public`, criadas por `supabase/migrations/` (T08). Valores financeiros são `numeric`, chaves são `uuid`, eventos são `timestamptz`. Percentuais ficam na escala de 0 a 100. Todas as tabelas têm RLS habilitado.

Papéis: `anon` e `authenticated` são os papéis do navegador; "backend" é o papel confiável usado pela Edge Function e pelo coletor (a RPC de publicação e o papel dedicado chegam na T09).

## Dados de mercado (compartilhados)

Sem acesso para `anon` e `authenticated`: sem grant e sem política. A leitura passa pela Edge Function.

### `assets`
| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid, pk | |
| `symbol` | text, único | Maiúsculas e dígitos, até 12 caracteres (`DEMO3`). |
| `asset_class` | text | Só `stock` nesta fatia. |
| `name` | text, nulo | |
| `reference_links` | jsonb | Links de referência. |
| `created_at` | timestamptz | |

### `data_sources`
`id` uuid pk; `code` text único (`fundamentus`, `statusinvest`, `brapi`); `display_name`; `base_url` (http/https, sem credenciais); `enabled`; `created_at`.

### `collection_runs`
`id` uuid pk; `started_at`; `finished_at` (nulo, não anterior a `started_at`); `status` (`running`, `succeeded`, `partial`, `failed`); `parser_versions` jsonb; `summary` jsonb (resumo sem segredos); `created_at`.

### `snapshots`
| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid, pk | |
| `run_id` | uuid, fk `collection_runs` | |
| `universe` | text | Padrão `stocks`. |
| `collected_at` | timestamptz | Momento da coleta; não substitui a data-base do dado. |
| `universe_version` | text, nulo | |
| `assets_total`, `assets_updated` | integer | `assets_updated <= assets_total`. |
| `failures` | jsonb | Lista de falhas por ativo e fonte (manifesto de cobertura). |
| `published_at` | timestamptz, nulo | Preenchido = publicado e imutável. |
| `created_at` | timestamptz | |

Trigger `snapshots_immutable`: rejeita `update` e `delete` de linha com `published_at` preenchido (erro `23000`). Os triggers `observations_immutable` e `field_validations_immutable` rejeitam insert, update e delete de linhas cujo snapshot já foi publicado. Exceção única: a rotina de retenção liga `set_config('app.retention_job', 'on', true)` na própria transação, e isso libera SÓ o `delete` do snapshot inteiro (as observações e validações dele somem junto, pela cascata); o delete direto de observação ou validação de snapshot publicado segue rejeitado (`23000`) mesmo com a variável ligada; update e insert seguem rejeitados com a variável ligada, mesmo para `service_role`. O FK `field_validations.selected_observation_id` não tem `on delete set null` (geraria update em linha publicada). Triggers `*_no_truncate` (`reject_truncate()`) proíbem `truncate` nas três tabelas. `selected_observation_id` e `observation_ids` não garantem mesmo snapshot/métrica: a RPC de publicação (T09) deve validar. Fluxo de publicação: inserir observações e validações com `published_at` nulo, depois preencher `published_at`.

### `observations`
Um campo de um ativo em uma fonte (README 7.1).
| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid, pk | `observation_id` do contrato. |
| `snapshot_id` | uuid, fk `snapshots` (cascade) | |
| `asset_id` | uuid, fk `assets` | |
| `source_id` | uuid, fk `data_sources` | |
| `metric` | text | `quote_price`, `price_to_book`, `price_to_earnings`, `dividend_yield`, `roe`. |
| `raw_value` | text | Texto recebido, antes da normalização. |
| `value_decimal` | numeric | Valor normalizado. |
| `unit`, `currency` | text | `quote_price`: `BRL`/`BRL`; razões: `ratio`/nulo; percentuais: `percent`/nulo (check). |
| `period_start`, `period_end` | date, nulos | `period_end >= period_start`. |
| `reference_at` | timestamptz, nulo | Instante-base informado pela fonte. |
| `reference_date` | date, nulo | Data-base quando a fonte informa só o dia. |
| `collected_at` | timestamptz | |
| `source_url` | text | http(s) sem credenciais embutidas. |
| `upstream_source` | text, nulo | |
| `methodology_id` | text | `unknown` por padrão. |
| `run_id` | uuid, fk `collection_runs` | |
| `parser_version` | text | |
| `raw_content_hash` | text | SHA-256 hex em minúsculas (64 caracteres). |
| `created_at` | timestamptz | |

Restrição `unique (snapshot_id, asset_id, metric, source_id)`. Índice em `(snapshot_id, asset_id, metric, source_id)`.

### `field_validations`
Estado de validação de um campo de um ativo num snapshot (README 7.5). `unique (snapshot_id, asset_id, metric)`.
| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid, pk | |
| `snapshot_id` | uuid, fk (cascade) | |
| `asset_id` | uuid, fk `assets` | |
| `metric` | text | Mesmos cinco valores. |
| `status` | text | `verified`, `divergent`, `single_source`, `incomparable`, `missing`, `not_applicable`, `invalid`. |
| `freshness` | text | `fresh`, `stale`, `expired`, `unknown_reference_date`. |
| `selected_observation_id` | uuid, nulo, fk `observations` | Nulo em `divergent`, `missing`, `invalid` e `not_applicable` (check). |
| `observation_ids` | uuid[] | Observações usadas na comparação. |
| `delta_abs`, `limit_value`, `atol`, `rtol` | numeric, nulos | Obrigatórios (e não negativos) em `verified` e `divergent`; nulos nos demais estados. |
| `tolerance_version` | text, nulo | Obrigatório com os campos acima. |
| `reason` | text, nulo | |
| `created_at` | timestamptz | |

### `active_snapshot`
`universe` text pk; `snapshot_id` uuid fk `snapshots`; `updated_at`. Ponteiro para a publicação ativa. Trigger `active_snapshot_published_only` (T09): só aceita snapshot com `published_at` preenchido e do mesmo `universe`.

### `snapshots` (acréscimo da T09)
`unique (run_id)`: uma publicação por execução do coletor.

### `staging_observations` (T09)
Área de preparo do lote. Mesmas colunas de `observations`, exceto `snapshot_id`, `asset_id`, `source_id`: usa `asset_symbol` e `source_code` (ids legíveis do contrato Python) e `run_id` sem FK. `id` é escolhido pelo coletor e preservado em `observations`. Sem `unique` de negócio de propósito: `publish_snapshot` detecta duplicata e recusa o lote. Mesmos checks de unidade, URL e hash de `observations`. `numeric` para `value_decimal`. RLS ligado; só `collector_ingest` insere (política `with check (true)`); ninguém lê (a função `security definer` lê). Staging de lote publicado é apagado pela RPC; o abandonado expira em `prune_snapshots`.

### `staging_validations` (T09)
Espelha `field_validations` com `asset_symbol` e `run_id` (sem FK); `selected_observation_id` e `observation_ids` referem-se a `staging_observations.id`. Mesmos checks de estado, comparação e `divergent` sem seleção. Mesmo regime de acesso de `staging_observations`.

## Dados privados

### `allowed_users`
`user_id` uuid pk, fk `auth.users` (cascade); `enabled` boolean (padrão true); `created_at`. O usuário lê só a própria linha; só a administração escreve.

### `conversations`
`id` uuid pk; `user_id` fk `auth.users` (cascade); `title` (1 a 200 caracteres); `created_at`; `updated_at` (trigger `touch_updated_at`). `unique (id, user_id)`. Índice `(user_id, updated_at, id)`. Dono autorizado: select, delete, insert de `(user_id, title)`, update de `title`.

### `messages`
`id` uuid pk; `conversation_id` e `user_id` (fk composta para `conversations (id, user_id)`, cascade); `role` (`user` ou `assistant`); `sequence_no` (>= 1); `content` (até 20000 caracteres); `content_version` integer (padrão 1); `payload` jsonb (resposta estruturada, D21); `created_at`. `unique (conversation_id, sequence_no)`. Índice `(conversation_id, sequence_no)`. Dono autorizado só lê; o cliente não escreve.

### `request_runs`
`id` uuid pk; `user_id` fk; `request_id` uuid; `conversation_id` (fk composta com `user_id`, nulo); `status` (`processing`, `succeeded`, `failed`); `error`; `created_at`; `updated_at`. `unique (user_id, request_id)` garante idempotência. Dono autorizado só lê.

### `llm_usage`
Contador global (não por usuário). pk `(usage_date, provider)`; `request_count` (>= 0); `updated_at`. Sem acesso do cliente.

### `portfolio_items`
`id` uuid pk; `user_id` fk `auth.users` (cascade); `asset_id` fk `assets`; `created_at`. `unique (user_id, asset_id)`. Só o símbolo da ação, sem quantidade, preço ou valor (E14 a E16). Nunca vai ao LLM. Dono autorizado: select, delete e insert de `(user_id, asset_id)`; sem update.

## Funções

| Função | Papel |
| --- | --- |
| `public.is_allowed_user()` | `security invoker`, `stable`. Verdadeiro se `auth.uid()` está em `allowed_users` com `enabled`. `execute` revogado de `public` e `anon`; mantido para `authenticated` (as políticas a usam) e `service_role`. |
| `public.reject_published_snapshot_change()`, `public.reject_truncate()`, `public.touch_updated_at()` | Funções de trigger. `execute` revogado de `public`, `anon` e `authenticated` (`revoke ... from public` não basta: o Supabase concede execute a anon/authenticated por default ACL). Testado com `has_function_privilege`. Padrão para funções `security definer` da T09. |
| `public.publish_snapshot(p_run_id uuid, p_manifest jsonb) returns uuid` | T09. `security definer`, `search_path = ''`, nomes qualificados. `execute` revogado de `public`, `anon`, `authenticated` e `service_role`; concedido só a `collector_ingest`. Numa transação: trava a execução (`for update`) e serializa por universo (advisory lock); valida e só então copia staging para `snapshots`/`observations`/`field_validations`, trava o snapshot, publica (`published_at`), aponta `active_snapshot`, marca a execução (`succeeded`, ou `partial` se `assets_updated < assets_total`) e limpa o staging do `run_id`. Qualquer erro desfaz tudo e o ponteiro não muda. Recusa: manifesto inválido; execução inexistente, encerrada ou já publicada; zero observações; ativo ou fonte inexistente (símbolo/código não resolvido para uuid); chave `(ativo, métrica, fonte)` duplicada; validação duplicada; menos da metade do `assets_total` com observação; validação cujo `observation_ids` inclua observação de outro run, ativo ou métrica (ou repetida); selecionada fora de `observation_ids`; estado incoerente (`missing`/`invalid`/`not_applicable` com observações; `single_source` sem exatamente 1; `verified`/`divergent` sem 2+ observações de 2+ fontes; `verified` com delta > limite; `divergent` com delta <= limite); observação sem validação do seu campo. Manifesto: `collected_at`, `universe_version`, `assets_total` obrigatórios; `universe` (só `stocks`), `failures`, `assets_updated`, `run_id` opcionais. |
| `public.prune_snapshots(p_keep_days integer) returns integer` | T09, D11. `security definer`, `search_path = ''`. Apaga snapshots publicados há mais de N dias (N >= 1), nunca o ativo; liga `app.retention_job` só na própria transação e o desliga ao fim; apaga staging abandonado com mais de N dias. `execute` só do dono (administrador do banco); nem `collector_ingest` executa. Retorna quantos snapshots apagou. |
| `public.reject_unpublished_active_snapshot()` | Função de trigger de `active_snapshot`. `execute` revogado de `public`, `anon` e `authenticated`. |
| `public.touch_updated_at()` | Atualiza `updated_at` em `conversations`, `request_runs` e `llm_usage`. |

## Papel `collector_ingest` (T09, D13)

Criado `nologin`, sem senha e sem herança: nenhuma senha no repositório. Para o coletor se conectar, o autor define a senha fora do código, uma vez por ambiente: `alter role collector_ingest login password '<senha forte>';` (como administrador do banco) e guarda a URL de conexão em `COLLECTOR_DATABASE_URL` (segredo). Privilégios: `select` em `assets` e `data_sources`; `insert` em `collection_runs` (política: só `status = 'running'` e `finished_at` nulo), `staging_observations` e `staging_validations`; `execute` em `publish_snapshot`; `statement_timeout` de 120 s. Nada em `snapshots`, `observations`, `field_validations`, `active_snapshot` nem em tabelas privadas (`messages`, `conversations`, `portfolio_items`, `allowed_users`, `llm_usage`, `request_runs`). Sem `delete`/`update` em snapshot, ligar `app.retention_job` não lhe dá efeito algum.

## Políticas (resumo)

Toda política de tabela privada exige `user_id = auth.uid()` e `is_allowed_user()`; `allowed_users_read_self` exige só `user_id = auth.uid()`.

| Tabela | Operações permitidas ao `authenticated` |
| --- | --- |
| `allowed_users` | select (própria linha) |
| `conversations` | select, insert, update (`title`), delete, do dono |
| `messages` | select, do dono |
| `request_runs` | select, do dono |
| `portfolio_items` | select, insert, delete, do dono |
| `llm_usage`, tabelas de mercado e staging | nenhuma |

`anon` não tem nenhum privilégio em nenhuma tabela.

## Dados de exemplo

`supabase/seed.sql`: ativos `DEMO3` e `TEST4`, três fontes, um snapshot publicado com `price_to_book` de DEMO3 `verified`, `dividend_yield` de DEMO3 `divergent`, `price_to_earnings` de TEST4 `incomparable` e `roe` de TEST4 `missing`.

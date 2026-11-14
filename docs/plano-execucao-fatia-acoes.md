# Plano de execução — primeira fatia (ações)

Este documento é o roteiro para construir a primeira fatia do Agente de Investimentos. Ele foi escrito para ser executado por agentes de código, uma tarefa por vez, sem depender de nenhuma conversa anterior.

## 1. Como usar este plano

1. Leia a seção 2 (contexto) e a seção 3 (regras) inteiras antes de qualquer tarefa.
2. Execute **uma tarefa por sessão**. Cada tarefa tem um identificador (`T01`, `T02`, ...).
3. Só comece uma tarefa quando todas as tarefas do campo **Depende de** estiverem concluídas.
4. Uma tarefa só está concluída quando todos os itens de **Pronto quando** forem verdadeiros. Rode os comandos indicados e mostre a saída.
5. Tarefas marcadas **HUMANO** exigem uma ação do autor do projeto (painel de um serviço, escolha pessoal, segredo). O agente prepara o que puder e para.
6. Se algo no plano contradisser o que você encontrar no repositório ou numa fonte externa, **pare e relate**. Não improvise uma decisão de arquitetura.

## 2. Contexto do projeto

O Agente de Investimentos é uma aplicação web pessoal. Ela coleta indicadores de ações em duas fontes, compara campo a campo e mostra o resultado num chat, sempre com a fonte e a data de cada número.

Documentos de referência, em ordem de autoridade:

1. `docs/adr/0001-primeira-fatia-acoes.md` — decisões aceitas (D1 a D21). **Prevalece sobre o README.**
2. `README.md` — especificação completa. Use as seções citadas em cada tarefa.

Resumo da fatia:

| Item | Escolha |
| --- | --- |
| Ativos | Só ações, de 10 a 20 tickers |
| Campos | `quote_price`, `price_to_book`, `price_to_earnings`, `dividend_yield`, `roe` |
| Fontes | brapi (cotação), Fundamentus e StatusInvest (indicadores) |
| Coleta | Python, uma vez por dia útil, via GitHub Actions |
| Banco | Postgres no Supabase |
| Backend | Supabase Edge Functions (Deno, TypeScript) |
| Frontend | React, TypeScript e Vite |
| LLM | Groq, só para classificar a intenção da pergunta |
| Usuários | Um (o autor), com login Google |

Fora da fatia: FIIs, ETFs, Tesouro, PDF, Realtime, fallback de LLM, multiusuário, histórico de indicadores, RIs.

### Vocabulário

| Termo | Significado |
| --- | --- |
| Observação | Um campo de um ativo em uma fonte (README 7.1) |
| Snapshot | Conjunto publicado das observações de um lote diário |
| Lote | Uma execução completa do coletor |
| Fixture | Arquivo de exemplo usado nos testes, no lugar da fonte real |
| Idempotência | Repetir a mesma requisição não cria efeito duplicado |
| Estados de validação | `verified`, `divergent`, `single_source`, `incomparable`, `missing`, `not_applicable`, `invalid` (README 7.5) |
| Estados de atualização | `fresh`, `stale`, `expired`, `unknown_reference_date` (README 6.4) |

## 3. Regras para todos os agentes

Regras de dados:

- Nenhum número de mercado aparece sem fonte, data-base e estado de validação.
- Nunca use `float` para valor financeiro. Em Python use `decimal.Decimal`. No JSON, decimais são **strings**. No banco, `numeric`. O navegador não faz cálculo com valores de mercado.
- Percentuais são guardados na escala de 0 a 100 (`"8.50"` significa 8,50%).
- Falha de coleta nunca vira zero, tabela vazia ou data de hoje.
- Um campo não herda a validação de outro campo.
- Em divergência, não calcule média, não escolha um lado e não peça ao LLM para decidir.

Regras de segurança:

- Nenhum segredo no repositório. Arquivos `.env*` reais são ignorados pelo git; só os `.example` são versionados, com valores vazios.
- Nada com prefixo `VITE_` pode ser segredo.
- A chave `service_role` do Supabase não entra em secrets do GitHub nem no frontend.
- O `user_id` vem sempre do JWT, nunca do corpo da requisição.
- Fixtures são **sintéticas**: HTML e JSON escritos à mão, com tickers inventados (`DEMO3`, `TEST4`) e valores inventados. Não commite cópia de página real de terceiros.
- A CI não faz scraping nem chama LLM real. Testes contra fontes reais são separados e opt-in.
- Não contorne `403`, CAPTCHA, login ou bloqueio de fonte.
- Não habilite cobrança em nenhum serviço.

Regras de processo:

- Não escreva parser de Fundamentus ou StatusInvest antes de a T01 estar concluída e a fonte estar marcada como permitida.
- Não crie commits vazios para manter o cron ativo (README 14.5).
- Não inclua nesta fatia nada da lista "fora da fatia".
- Não marque como feito o que não foi executado. Se um teste falhar, relate a falha com a saída.
- Trabalhe num branch próprio por tarefa (`tarefa/T10`) e entregue por pull request para `main`. Não faça merge: o autor aprova.
- Registre o andamento em `docs/status-tarefas.md`.
- Antes de cada commit, rode `bash scripts/ci/check_guardrails.sh`. A CI (`.github/workflows/ci.yml`) roda a mesma verificação e os testes em todo pull request.

## 4. Visão geral das tarefas

| ID | Tarefa | Quem | Depende de |
| --- | --- | --- | --- |
| T01 | Revisar termos e `robots.txt` das fontes | Agente + HUMANO | — |
| T02 | Licença MIT e proteção de segredos | Agente + HUMANO | — |
| T03 | Atualizar o README com as decisões | Agente | — |
| T04 | Escolher o universo de tickers | HUMANO | — |
| T05 | Inicializar a estrutura do repositório | Agente | T02 |
| T06 | Schema único de observação e validação | Agente | T05 |
| T07 | Homologar a metodologia dos campos | Agente + HUMANO | T01 |
| T08 | Migrations do banco | Agente | T05, T06 |
| T09 | RPC de publicação e papel dedicado | Agente | T08 |
| T10 | Base do coletor e normalização | Agente | T06 |
| T11 | Adaptador brapi | Agente | T10 |
| T12 | Adaptador Fundamentus | Agente | T01, T07, T10 |
| T13 | Adaptador StatusInvest | Agente | T01, T07, T10 |
| T14 | Validação por campo | Agente | T07, T10 |
| T15 | Pipeline, CLI e publicação | Agente | T09, T11, T12, T13, T14 |
| T16 | Workflow diário e alerta de idade | Agente + HUMANO | T15, T22a |
| T17 | Experimento de calibragem das tolerâncias | Agente + HUMANO | T16 |
| T18 | Edge Function do agente (modo determinístico) | Agente | T08, T06 |
| T19 | Classificador de intenção com LLM | Agente | T18 |
| T20 | Avaliação dos modelos | Agente + HUMANO | T19 |
| T21 | Frontend mínimo | Agente | T18 |
| T22a | Criar o projeto Supabase hospedado | HUMANO | T08, T09 |
| T22b | Publicar funções e frontend | Agente + HUMANO | T19, T21, T22a |
| T23 | Exportação periódica das conversas | Agente | T22a |
| T24 | Conferência manual de aceite | HUMANO | T17, T22b |

Ordem sugerida: T01 a T04 podem andar em paralelo. T01 é a tarefa que mais bloqueia, então comece por ela.

---

## 5. Fase 0 — Preparação

### T01 — Revisar termos e `robots.txt` das fontes

- **Quem:** agente pesquisa e redige; HUMANO decide.
- **Objetivo:** saber se a coleta automatizada de Fundamentus, StatusInvest e brapi é permitida, antes de escrever qualquer parser (decisão D3).
- **Referências:** README 18.3 e os links da seção 25 (`statusinvest-terms`, `fundamentus-stocks`, `brapi-pricing`).
- **Passos:**
  1. Para cada fonte, leia o `robots.txt` do domínio e a página de termos ou condições de uso.
  2. Registre, por fonte: URL consultada, data da consulta, trechos relevantes citados literalmente, o que é permitido, o que é proibido e o que é omisso.
  3. Verifique se a página que seria coletada exige login, tem CAPTCHA ou bloqueia robôs.
  4. Escreva `docs/source-methodologies/permissoes.md` com uma seção por fonte e uma conclusão por fonte: `permitida`, `proibida` ou `indefinida`.
  5. Crie `config/sources.yaml` com uma entrada por fonte: `id`, `base_url`, `permission_status`, `reviewed_at`, `max_requests_per_minute`, `enabled`. Deixe `enabled: false` em todas até a decisão do autor.
- **HUMANO:** ler o documento e decidir, fonte a fonte, se habilita. Para fonte `indefinida`, a decisão e o risco são do autor.
- **Pronto quando:** o documento existe com as três fontes; `config/sources.yaml` existe; o autor registrou a decisão no próprio documento.
- **Não fazer:** não escreva código de coleta. Não conclua "permitida" por ausência de proibição; nesse caso marque `indefinida`.
- **Se uma fonte for vetada:** pare e avise. A validação cruzada perde a segunda fonte e as decisões D2 e T17 precisam ser revistas com o autor.

### T02 — Licença MIT e proteção de segredos

- **Quem:** agente + HUMANO.
- **Objetivo:** cumprir as condições para o repositório ser público (D14, D18).
- **Referências:** README 12.7 e 24.
- **Passos:**
  1. Crie `LICENSE` com o texto oficial da licença MIT, ano 2026 e titular "Guilherme". Confirme o nome do titular com o autor.
  2. Crie `.gitignore` com o conteúdo da seção 12.7 do README.
  3. No `README.md`, troque o badge "MIT (proposta)" por "MIT" e ajuste a seção 24 para dizer que a licença foi confirmada.
  4. Crie `SECURITY.md` com um canal de contato privado. Peça o canal ao autor; não invente um e-mail.
- **HUMANO:** nas configurações do repositório no GitHub, ativar *Secret scanning* e *Push protection*.
- **Pronto quando:** `LICENSE` e `.gitignore` existem; badge atualizado; o autor confirma que o secret scanning está ativo.

### T03 — Atualizar o README com as decisões

- **Quem:** agente.
- **Objetivo:** o README deixar de contradizer o ADR 0001.
- **Passos:** edite somente os pontos abaixo, mantendo o estilo do documento.
  1. Seção 2: adicione uma linha à tabela 2.2 apontando para `docs/adr/0001-primeira-fatia-acoes.md` e dizendo que a entrega começa por uma fatia de ações.
  2. Seções 4.1, 5, 9.2, 9.3 e 12.3: o Gemini deixa de ser o fallback definido. Escreva que o segundo provedor será escolhido por teste e que a primeira fatia não tem fallback de LLM (D6).
  3. Seção 9.1: o LLM classifica a intenção; não redige explicações na primeira fatia (D4). Cite o seletor manual (D5).
  4. Seção 12.6: substitua "36 horas" e "7 dias" por "1 dia útil" e "5 dias úteis" (D20).
  5. Seção 12.2 e 14.2: a credencial do coletor é um papel de banco dedicado, não `SUPABASE_SECRET_KEY` (D13).
  6. Seção 21: acrescente a fatia de ações como primeira entrega do curto prazo e a ordem das fatias seguintes.
  7. Seção 3: marque login multiusuário como "usuário único na primeira fatia" (D7).
- **Pronto quando:** uma busca por "Gemini" no README não encontra nenhuma frase que o trate como fallback decidido; os sete pontos estão alterados.
- **Não fazer:** não reescreva seções que não estão na lista. Não marque nenhum checkbox da seção 19.3.

### T04 — Escolher o universo de tickers

- **Quem:** HUMANO.
- **Objetivo:** definir de 10 a 20 ações para a fatia (D9).
- **Passos:** o autor lista os tickers. O agente grava `config/universe.yaml`:

  ```yaml
  version: "fatia-acoes-1"
  stocks:
    - PETR4
    - VALE3
    # ... demais tickers escolhidos pelo autor
  ```

- **Sugestão para o autor:** inclua empresas de setores diferentes e pelo menos um banco. Bancos costumam ter indicadores calculados de forma diferente entre fontes, o que ajuda a exercitar a detecção de divergência (premissa em aberto do ADR).
- **Pronto quando:** o arquivo existe com 10 a 20 tickers.

---

## 6. Fase 1 — Fundação

### T05 — Inicializar a estrutura do repositório

- **Quem:** agente. **Depende de:** T02.
- **Objetivo:** criar o esqueleto, com ferramentas de teste funcionando, sem lógica de negócio.
- **Referências:** README 11 (árvore de arquivos) e 13.
- **Passos:**
  1. Crie só as pastas desta fatia: `config/`, `collector/src/collector/`, `collector/tests/{fixtures,unit,integration}/`, `schemas/`, `supabase/{migrations,functions,tests/database}/`, `frontend/`, `docs/`, `.github/workflows/`.
  2. Python 3.12: `pyproject.toml` com o pacote em `collector/src`, dependências `httpx`, `beautifulsoup4`, `pydantic`, `pyyaml`, e de desenvolvimento `pytest`, `ruff`. Gere `requirements.lock` e `requirements-dev.lock` com hashes (por exemplo com `pip-compile --generate-hashes`). Crie `.python-version`.
  3. Node: `package.json` na raiz com o Supabase CLI como dependência de desenvolvimento; `.nvmrc`.
  4. Frontend: projeto Vite com React e TypeScript em `frontend/`, com Vitest configurado e `frontend/.env.example` (README 12.4).
  5. Supabase: rode `supabase init` e versione `supabase/config.toml`.
  6. Crie `.env.collector.example` e `supabase/.env.functions.example` com as variáveis vazias (README 12.2 e 12.3, sem as variáveis do Gemini).
  7. A CI já existe em `.github/workflows/ci.yml` e ativa cada job quando a parte correspondente aparece (`pyproject.toml`, `frontend/package.json`, `supabase/functions/deno.json`, `supabase/migrations/*.sql`). Não a recrie. Garanta que o projeto atende ao que ela roda: `ruff check .` e `pytest` na raiz; em `frontend/`, os scripts `lint`, `typecheck`, `test` e `build` no `package.json`. A CI usa só fixtures.
- **Pronto quando:** `pytest` roda e passa (pode ter um teste de fumaça); `npm test` no frontend passa; a CI fica verde.
- **Não fazer:** não crie as pastas de `reports`, `pdf`, `gemini.ts` nem `treasury_official.py`.

### T06 — Schema único de observação e validação

- **Quem:** agente. **Depende de:** T05.
- **Objetivo:** um contrato único entre Python e TypeScript (D8).
- **Referências:** README 7.1, 7.5 e 7.7.
- **Desenho:** os modelos Pydantic são a fonte da verdade. Um script exporta JSON Schema para `schemas/`. O TypeScript é gerado a partir do JSON Schema.
- **Passos:**
  1. Em `collector/src/collector/contracts.py`, defina os modelos:
     - `Observation`, com todos os campos da tabela 7.1 do README. `value_decimal` é `Decimal`, serializado como string. `metric` é um enum com os cinco campos da fatia. `asset_class` é um enum que nesta fatia só tem `stock`.
     - `FieldValidation`: `asset_id`, `metric`, `status` (enum dos sete estados), `freshness` (enum dos quatro estados), `selected_observation_id` (nulo quando `divergent`), `observation_ids`, `comparison` (`delta_abs`, `limit`, `atol`, `rtol`, `tolerance_version`), `reason`.
     - `SnapshotManifest`: `snapshot_id`, `run_id`, `collected_at`, `universe_version`, `assets_total`, `assets_updated`, lista de falhas por ativo e fonte.
  2. Rejeite números não finitos e unidades incompatíveis com a métrica.
  3. Crie `scripts/export_schemas.py`, que grava `schemas/observation.schema.json`, `schemas/validation.schema.json` e `schemas/manifest.schema.json`.
  4. No lado TypeScript, gere os tipos a partir desses arquivos (por exemplo com `json-schema-to-typescript`) em `supabase/functions/_shared/contracts.gen.ts`, e exponha validadores Zod em `supabase/functions/_shared/schemas.ts`.
  5. Teste de contrato: um conjunto de exemplos JSON em `schemas/examples/` (válidos e inválidos). O pytest valida todos com Pydantic; o teste Deno valida os mesmos arquivos com Zod. Os dois lados devem aceitar e rejeitar os mesmos exemplos.
  6. Na CI, um passo roda o export e falha se `git diff` mostrar diferença em `schemas/` (schema desatualizado).
- **Pronto quando:** os dois conjuntos de testes passam sobre os mesmos exemplos; a CI detecta schema desatualizado.

### T07 — Homologar a metodologia dos campos

- **Quem:** agente pesquisa; HUMANO aprova. **Depende de:** T01.
- **Objetivo:** documentar, campo a campo, se Fundamentus e StatusInvest medem a mesma coisa (D2).
- **Referências:** README 7.3 e 6.1.
- **Passos:** para cada um dos quatro indicadores (`price_to_book`, `price_to_earnings`, `dividend_yield`, `roe`) e para a cotação, registre em `docs/source-methodologies/acoes.md`:
  1. Como cada fonte define o campo: fórmula, janela (por exemplo últimos doze meses), base contábil (patrimônio final ou médio), unidade.
  2. De onde cada fonte tira o dado (origem primária, por exemplo demonstrações enviadas à CVM), quando a fonte informar.
  3. Se a fonte informa a data-base do indicador.
  4. Um veredito por campo: `comparável`, `não comparável` ou `metadados insuficientes`.
  5. Um identificador de metodologia por fonte e campo (por exemplo `dy_ttm_fundamentus`), para preencher `methodology_id`.
- **Consequência por veredito:** `comparável` permite `verified` e `divergent`. `não comparável` produz `incomparable`. `metadados insuficientes` também produz `incomparable`, com motivo `unknown_metadata`.
- **HUMANO:** aprovar o documento.
- **Pronto quando:** os cinco campos têm veredito e o autor aprovou.
- **Não fazer:** não declare `comparável` porque os números de um dia pareceram próximos.

---

## 7. Fase 2 — Banco de dados

### T08 — Migrations do banco

- **Quem:** agente. **Depende de:** T05, T06.
- **Referências:** README 8.1, 8.2, 8.3.
- **Passos:** crie migrations em `supabase/migrations/`, em três arquivos.
  1. **Dados de mercado** (compartilhados): `assets`, `data_sources`, `collection_runs`, `snapshots`, `observations`, `field_validations`, `active_snapshot`. Use `uuid` para chaves, `timestamptz` para eventos e `numeric` para valores. Aplique a restrição `unique (snapshot_id, asset_id, metric, source_id)` em `observations`. `snapshots` é imutável depois de publicado: crie um trigger que rejeita `update` e `delete` em linhas publicadas, exceto pela rotina de retenção.
  2. **Dados privados:** `allowed_users` (uma linha por usuário autorizado), `conversations`, `messages`, `request_runs`, `llm_usage` (contador global por dia e provedor). Aplique as restrições do README 8.2: `unique (id, user_id)` em `conversations`, FK composta `(conversation_id, user_id)` em `messages`, `unique (conversation_id, sequence_no)`, `unique (user_id, request_id)`. `messages` tem `content_version` (inteiro) e `payload` (`jsonb`) para a resposta estruturada (D21).
  3. **RLS e grants:** habilite RLS em todas as tabelas. Tabelas de mercado: sem acesso para `anon` e `authenticated`; a leitura passa pela Edge Function. Tabelas privadas: o dono autorizado lê as suas linhas; `conversations` aceita insert, update de título e delete do dono; `messages`, `request_runs` e `llm_usage` não aceitam escrita do cliente. Use o padrão do exemplo do README 8.3, trocando `beta_users` por `allowed_users`.
  4. `supabase/seed.sql` com dados sintéticos: dois ativos fictícios, um snapshot com um campo `verified`, um `divergent`, um `missing` e um `incomparable`.
- **Pronto quando:** `supabase db reset` aplica tudo sem erro; os testes pgTAP em `supabase/tests/database/` passam e cobrem: um usuário não autorizado não lê nada; o cliente não consegue inserir mensagem com `role = 'assistant'`; `anon` não lê nenhuma tabela.
- **Não fazer:** não crie `relatorios_pdf`, bucket de Storage nem `usage_counters` por usuário.

### T09 — RPC de publicação e papel dedicado

- **Quem:** agente. **Depende de:** T08.
- **Objetivo:** o coletor publica um snapshot de forma atômica, com a menor permissão possível (D13, README 6.4).
- **Passos:**
  1. Crie tabelas de staging (`staging_observations`, `staging_validations`) com uma coluna `run_id`.
  2. Crie a função `public.publish_snapshot(p_run_id uuid, p_manifest jsonb)`, que numa única transação: valida a integridade do staging; copia para `observations` e `field_validations`; cria a linha em `snapshots`; aponta `active_snapshot` para ela; limpa o staging daquele `run_id`.
  3. Regras de integridade que **impedem** a publicação: zero observações; menos da metade do universo com alguma observação utilizável; chave duplicada; observação que aponta para ativo ou fonte inexistente. Nesses casos a função lança erro e `active_snapshot` não muda.
  4. Crie o papel `collector_ingest`, com: `insert` nas tabelas de staging e em `collection_runs`; `execute` em `publish_snapshot`; `select` em `assets` e `data_sources`. Nada em tabelas privadas.
  5. A função é `security definer`, com `search_path` fixo e `execute` revogado de `public`, `anon` e `authenticated`.
  6. Crie a função de retenção `public.prune_snapshots(p_keep_days int)`, que apaga snapshots com mais de N dias, nunca o ativo (D11).
- **Pronto quando:** os testes pgTAP provam: publicação válida troca o ponteiro; staging vazio não troca; `collector_ingest` não lê `messages` nem `conversations`; `authenticated` não executa `publish_snapshot`.

---

## 8. Fase 3 — Coletor

### T10 — Base do coletor e normalização

- **Quem:** agente. **Depende de:** T06.
- **Referências:** README 7.2 e 14.4.
- **Passos:**
  1. `collector/src/collector/sources/base.py`: uma interface `SourceAdapter` com `source_id`, `fetch(assets) -> list[RawRecord]` e `parse(raw) -> list[Observation]`. Buscar e interpretar ficam separados para os testes usarem só o `parse`.
  2. Um cliente HTTP compartilhado com `httpx`: timeout, no máximo 3 tentativas com espera crescente, respeito a `Retry-After`, intervalo mínimo entre requisições por domínio, e `User-Agent` com o contato de `SCRAPER_CONTACT`. O cliente recusa domínios fora de `config/sources.yaml` e fontes com `enabled: false`.
  3. `collector/src/collector/normalization/`: funções `parse_br_decimal` (por exemplo `"1.234,56"` vira `Decimal("1234.56")`), `parse_percent` (por exemplo `"8,5%"` vira `Decimal("8.50")` na escala de 0 a 100) e `parse_missing`, que distingue vazio, `"-"`, `"N/A"` e erro. Cada adaptador declara o formato da sua fonte; não existe conversão genérica aplicada a qualquer texto.
  4. `collector/src/collector/settings.py`: carrega `config/*.yaml` e as variáveis de ambiente com Pydantic, e falha com mensagem clara se faltar algo.
- **Pronto quando:** testes unitários cobrem: número brasileiro com e sem milhar, negativo, percentual, zero legítimo, traço, texto inválido (deve gerar erro, não zero).

### T11 — Adaptador brapi

- **Quem:** agente. **Depende de:** T10.
- **Referências:** README 6.2; documentação oficial da brapi em `brapi-quote` (seção 25).
- **Passos:**
  1. Leia a documentação atual do endpoint de cotação antes de codificar. O README cita `GET https://brapi.dev/api/v2/stocks/quote?symbols=PETR4`; confirme o caminho e os nomes dos campos na documentação.
  2. Uma requisição por ativo (limite do plano gratuito). O token vem de `BRAPI_TOKEN` e nunca aparece em `source_url` nem em log.
  3. Gere uma `Observation` de `quote_price` por ativo, com `reference_at` igual ao instante informado pela fonte.
  4. Fixture sintética em `collector/tests/fixtures/brapi/`, escrita à mão no formato documentado.
- **Pronto quando:** testes com a fixture passam; um teste confirma que o token não aparece em nenhuma `Observation` serializada.

### T12 — Adaptador Fundamentus

- **Quem:** agente. **Depende de:** T01 (fonte permitida), T07, T10.
- **Referências:** README 6.1; `fundamentus-stocks` (seção 25).
- **Passos:**
  1. Confira em `config/sources.yaml` que a fonte está `enabled: true`. Se não estiver, pare.
  2. A tabela de resultados traz todas as ações numa página. Baixe **uma vez por lote** e filtre os tickers do universo (README 14.4, item 5).
  3. Localize as colunas pelo **texto do cabeçalho**, não pela posição. Se um cabeçalho esperado não existir, lance um erro de parser; não devolva lista vazia.
  4. Extraia P/VP, P/L, DY e ROE. Preencha `methodology_id` com os identificadores da T07 e `raw_value` com o texto original.
  5. Se a fonte não informar data-base do indicador, `reference_at` fica nulo. Não use a data da coleta no lugar.
  6. Fixture sintética: um HTML escrito à mão com a mesma estrutura de tabela e tickers inventados.
- **Pronto quando:** testes cobrem: extração correta; cabeçalho ausente gera erro; ticker do universo ausente na tabela gera falha registrada para aquele ativo, sem derrubar os outros; página de erro com HTTP 200 é detectada.

### T13 — Adaptador StatusInvest

- **Quem:** agente. **Depende de:** T01 (fonte permitida), T07, T10.
- **Passos:** os mesmos princípios da T12, com estas diferenças:
  1. A fonte tende a exigir uma página por ativo. Use o intervalo entre requisições definido em `config/sources.yaml`.
  2. Registre em `source_url` a página do ativo (por exemplo `https://statusinvest.com.br/acoes/petr4`).
  3. Se a página responder `403` ou CAPTCHA, registre a falha e **suspenda a fonte no lote**. Não tente de novo com outro cabeçalho.
- **Pronto quando:** testes equivalentes aos da T12 passam, mais um teste em que `403` marca a fonte como suspensa.

### T14 — Validação por campo

- **Quem:** agente. **Depende de:** T07, T10.
- **Referências:** README 7.3 a 7.6.
- **Passos:**
  1. `collector/src/collector/validation/comparability.py`: recebe duas observações do mesmo ativo e métrica e decide se são comparáveis, com base na tabela da T07, na unidade e nas datas. Devolve um motivo quando não são.
  2. `collector/src/collector/validation/tolerance.py`: a função `within_tolerance` do README 7.4, com `limite = max(atol, rtol * max(|a|, |b|))`.
  3. `collector/src/collector/validation/engine.py`: para cada par (ativo, métrica), produz uma `FieldValidation`:
     - nenhuma observação utilizável: `missing`;
     - observação com falha de contrato: `invalid`;
     - uma observação utilizável: `single_source`;
     - duas, não comparáveis: `incomparable`;
     - duas, comparáveis, dentro do limite: `verified`, com `selected_observation_id` igual à do Fundamentus (D19);
     - duas, comparáveis, fora do limite: `divergent`, com `selected_observation_id` nulo.
  4. `config/tolerances.yaml` com os valores do README 7.4 para os cinco campos e `version: "draft-1"`.
  5. **Modo de calibragem:** uma opção `validation.calibration_mode` em configuração. Quando ligada, o motor calcula e grava `delta_abs` e o limite, mas grava o estado `single_source` no lugar de `verified` e `divergent`, com `reason: "uncalibrated"`. Assim nenhum selo aparece antes de a T17 terminar. Comece com a opção **ligada**.
  6. `freshness`: calcule a partir de `collected_at` do snapshot e de dias úteis (segunda a sexta). Mais de 1 dia útil é `stale`; mais de 5 é `expired` (D20). Feriados não são considerados nesta fatia; registre essa limitação no código e no README.
- **Pronto quando:** há um teste para cada um dos sete estados; os dois exemplos numéricos do README 7.4 passam; um teste confirma que, com o modo de calibragem ligado, nenhum resultado sai `verified` ou `divergent`.

### T15 — Pipeline, CLI e publicação

- **Quem:** agente. **Depende de:** T09, T11, T12, T13, T14.
- **Referências:** README 14.1 e 14.4.
- **Passos:**
  1. `collector/src/collector/pipeline.py`, na ordem: validar configuração; criar `run_id` e a data lógica em `America/Sao_Paulo`; recusar se já houver lote concluído no dia (salvo `--force`); coletar cada fonte; normalizar; validar; gravar em staging; chamar `publish_snapshot`.
  2. **Regra do ticker que falha (D12):** se uma fonte falhar para um ativo, os campos daquela fonte ficam sem observação. O motor então produz `missing` ou `single_source`, conforme o que sobrar. Nunca copie observação de um snapshot anterior.
  3. Monte o `SnapshotManifest` com totais e a lista de falhas.
  4. `collector/src/collector/cli.py` com os comandos do README 14.1: `doctor --offline`, `doctor --online`, `run --mode fixtures`, `run --dry-run`, `run`, `run --force`. Todos aceitam `--env-file`.
  5. A conexão com o banco usa o papel `collector_ingest`, com a string de conexão em `COLLECTOR_DATABASE_URL`.
  6. Logs estruturados com `run_id`, etapa, fonte, contagens e duração. Sem token, sem HTML integral.
  7. O modo `fixtures` só publica se `APP_ENV` for o ambiente local.
- **Pronto quando:** com o Supabase local no ar, `python -m collector.cli run --mode fixtures` publica um snapshot e o teste de integração confere o ponteiro ativo; um teste simula a falha total de uma fonte e confirma que o snapshot anterior continua ativo se a regra de integridade barrar; um teste simula a falha de um ativo e confere o manifesto.

### T16 — Workflow diário e alerta de idade

- **Quem:** agente + HUMANO. **Depende de:** T15, T22a.
- **Referências:** README 14.2 e 14.5.
- **Passos:**
  1. `.github/workflows/collect-daily.yml`, baseado no exemplo do README 14.2, com estas mudanças: cron `"17 1 * * 2-6"` (01:17 UTC de terça a sábado, que são 22:17 de segunda a sexta em Brasília); o secret `COLLECTOR_DATABASE_URL` no lugar de `SUPABASE_URL` e `SUPABASE_SECRET_KEY`; Actions fixadas em SHA completo.
  2. Mantenha `workflow_dispatch` com a opção `force`.
  3. **Alerta de idade (D14):** um segundo workflow, `check-freshness.yml`, com cron diário, que consulta a idade do snapshot ativo e **falha** se passar de 3 dias úteis. A falha de um workflow agendado gera e-mail do GitHub para o dono do repositório. O workflow não faz commit.
- **HUMANO:** cadastrar os secrets `COLLECTOR_DATABASE_URL` e `BRAPI_TOKEN` e a variável `SCRAPER_CONTACT` no repositório.
- **Pronto quando:** um disparo manual conclui e publica um snapshot no projeto hospedado; o workflow de verificação passa com snapshot recente.
- **Não fazer:** não crie commit automático para manter o cron ativo.

### T17 — Experimento de calibragem das tolerâncias

- **Quem:** agente analisa; HUMANO decide. **Depende de:** T16.
- **Objetivo:** fixar `atol` e `rtol` com base em dados reais.
- **Passos:**
  1. Deixe o lote rodar por pelo menos 10 dias úteis com `calibration_mode` ligado.
  2. Escreva `scripts/analyze_deltas.py`, que lê as comparações gravadas e gera, por métrica: quantidade de pares, mediana, percentis 90 e 99 de `delta_abs`, e os casos acima do limite `draft-1`.
  3. Grave o resultado em `docs/source-methodologies/calibragem-tolerancias.md`, com uma proposta de valores e a justificativa.
- **HUMANO:** aprovar os valores. O agente então atualiza `config/tolerances.yaml` para `version: "1"` e desliga `calibration_mode`.
- **Pronto quando:** o relatório existe, o autor aprovou e o lote seguinte produz estados `verified` e `divergent`.
- **Não fazer:** não escolha a tolerância para zerar os alertas. Divergência real é o resultado esperado do sistema.

---

## 9. Fase 4 — Backend e chat

### T18 — Edge Function do agente (modo determinístico)

- **Quem:** agente. **Depende de:** T06, T08.
- **Referências:** README 9.1, 15.2, 15.4, 15.6.
- **Objetivo:** responder perguntas a partir do snapshot, **sem LLM**. O corpo da requisição já traz os ativos e os indicadores escolhidos.
- **Contrato de entrada de `POST /agent`:**

  ```json
  {
    "request_id": "uuid gerado pelo navegador",
    "conversation_id": "uuid",
    "message": "texto digitado, opcional",
    "selection": { "asset_ids": ["PETR4", "VALE3"], "metrics": ["price_to_book"] }
  }
  ```

  Nesta tarefa `selection` é obrigatório. A T19 torna possível enviar só `message`.
- **Passos, na ordem do README 9.1:**
  1. Autenticar pelo JWT. Conferir `allowed_users`. Sem autorização, `403`.
  2. Validar o corpo com Zod. Limite de 8.000 caracteres para `message`.
  3. Idempotência (D16): inserir em `request_runs` com `(user_id, request_id)` e um hash do corpo. Se já existir com o mesmo hash, devolver a resposta gravada. Com hash diferente, `409`. Se estiver em andamento, `202`. Reserva com mais de 3 minutos é tratada como expirada.
  4. Conferir que a conversa pertence ao usuário.
  5. Resolver ativos contra `assets`. Ativo fora do universo gera `422 UNSUPPORTED_ASSET`.
  6. Ler o snapshot ativo. Sem snapshot, `503 DATA_UNAVAILABLE`.
  7. Montar o pacote de evidências: as validações e as observações dos pares pedidos.
  8. Montar a resposta estruturada (D21) e gravar a mensagem do usuário e a do assistente. Sem transação aberta durante chamadas externas.
- **Formato de `messages.payload`, versão 1:**

  ```json
  {
    "content_version": 1,
    "mode": "deterministic",
    "snapshot_id": "...",
    "snapshot_collected_at": "...",
    "manifest": { "assets_total": 20, "assets_updated": 19 },
    "sections": [
      { "kind": "metric_table", "metric": "price_to_book", "validation_ids": ["..."] },
      { "kind": "limitation", "validation_ids": ["..."] }
    ],
    "evidence": { "validations": [], "observations": [] },
    "warnings": []
  }
  ```

  `evidence` é a cópia que permite apagar snapshots antigos sem quebrar a mensagem (D11, D21).
- **Leitura do banco:** use o cliente com o JWT do usuário para dados privados. Para tabelas de mercado e escritas de sistema, use o cliente administrativo, sempre depois da autenticação e da checagem de dono (README 8.4).
- **Pronto quando:** testes Deno cobrem: sem JWT (`401`); usuário não autorizado (`403`); conversa de outro dono (`404`); repetição do mesmo `request_id` não duplica mensagens; mesmo `request_id` com corpo diferente (`409`); ativo fora do universo (`422`); resposta com campo `divergent` tem `selected_observation_id` nulo e as duas observações na evidência.

### T19 — Classificador de intenção com LLM

- **Quem:** agente. **Depende de:** T18.
- **Referências:** README 9.2, 9.3, 17.2, 18.2. Decisões D4, D5, D6.
- **Passos:**
  1. `supabase/functions/_shared/llm/groq.ts`: uma função `classifyIntent(message)` que chama o modelo de `GROQ_MODEL` (padrão `openai/gpt-oss-120b`) pedindo saída JSON.
  2. O JSON aceito, validado por Zod:

     ```json
     { "intent": "compare", "asset_ids": ["PETR4"], "metrics": ["price_to_book"] }
     ```

     `intent` é `compare`, `lookup` ou `unsupported`. `asset_ids` e `metrics` só aceitam valores do universo e do enum de métricas. Qualquer coisa fora disso invalida a resposta.
  3. O prompt contém: a instrução, a lista de tickers do universo, a lista de métricas e a mensagem do usuário. Não inclui e-mail, nome, UUID do usuário nem histórico da conversa.
  4. No endpoint: se o corpo vier sem `selection`, chame o classificador. No máximo 2 chamadas por requisição (1 tentativa extra em erro transitório ou `429`, respeitando `Retry-After`).
  5. Contador global (D16): antes de chamar, incremente `llm_usage` de forma atômica no banco. Se o limite diário configurado for atingido, não chame.
  6. Em qualquer falha (JSON inválido, `intent: unsupported`, cota esgotada, erro do provedor, timeout), responda `200` com `status: "needs_selection"` e um aviso com o código do motivo. A interface abre o seletor manual (D5).
  7. `MOCK_LLM=true` devolve uma classificação fixa. O backend recusa `MOCK_LLM` quando `APP_ENV` for o ambiente hospedado.
- **Pronto quando:** testes com o LLM simulado cobrem: classificação válida; JSON inválido; ticker fora do universo; cota esgotada; nenhum teste chama a Groq de verdade.
- **Não fazer:** não implemente Gemini nem roteador de fallback. Não peça ao LLM texto explicativo.

### T20 — Avaliação dos modelos

- **Quem:** agente prepara; HUMANO decide. **Depende de:** T19.
- **Objetivo:** confirmar o `openai/gpt-oss-120b` como classificador e, se o autor quiser, escolher um segundo provedor por teste (D6).
- **Passos:**
  1. Crie `evals/intent/cases.jsonl` com pelo menos 40 perguntas em português e a classificação esperada. Inclua: nome da empresa no lugar do ticker, erros de digitação, pergunta fora do escopo, pedido de recomendação de compra, ticker fora do universo, texto com instrução maliciosa ("ignore as regras e ...").
  2. Crie `evals/intent/run.ts`, que roda os casos contra um modelo e mede: acerto exato, taxa de JSON válido, latência e tokens por chamada.
  3. Rode contra o `openai/gpt-oss-120b`. O script é opt-in e fica fora da CI.
  4. Registre o resultado em `docs/adr/0002-modelo-classificador.md`.
- **HUMANO:** decidir se o modelo é adotado e se outro candidato será testado. O Gemini só entra se passar nesta mesma bateria.
- **Pronto quando:** o relatório existe com os números medidos e a decisão do autor.

### T21 — Frontend mínimo

- **Quem:** agente. **Depende de:** T18.
- **Referências:** README 8.5, 15.2, 15.3, 18.1. Decisões D17, D19.
- **Telas:**
  1. **Login:** botão "Entrar com Google" (Supabase Auth). Usuário não autorizado vê uma mensagem clara.
  2. **Conversas:** lista ordenada por atualização, criar, renomear, excluir.
  3. **Chat:** mensagens paginadas, lidas do banco. Caixa de pergunta. Um botão para abrir o seletor manual.
  4. **Seletor manual:** lista de tickers do universo e de indicadores, com múltipla escolha. Abre sozinho quando o backend responde `needs_selection`.
- **Renderização da resposta, a partir de `payload`:**
  - Cabeçalho com a data do snapshot, o estado de atualização e o manifesto ("19 de 20 ativos atualizados").
  - Uma tabela por indicador. Cada célula mostra o valor, o estado e um link para a fonte.
  - `verified`: valor do Fundamentus em destaque; o do StatusInvest aparece ao expandir.
  - `divergent`: os dois valores lado a lado, a diferença e o limite. Nenhum em destaque.
  - `single_source`: o valor, com o aviso "não verificado entre fontes".
  - `incomparable`: os valores e o motivo.
  - `missing`: "Não disponível", nunca zero.
  - `stale` e `expired` aparecem como aviso visível no cabeçalho.
- **Regras:**
  - O navegador formata os decimais (string) para exibição, mas não calcula.
  - O `request_id` é gerado com `crypto.randomUUID()` e **reutilizado** quando a mesma pergunta for reenviada.
  - Sem Realtime e sem atualização otimista: depois da resposta, a interface relê as mensagens do banco.
  - Não renderize HTML vindo do backend. Crie `frontend/public/_headers` com uma política de segurança de conteúdo.
- **Pronto quando:** testes Vitest cobrem a renderização dos sete estados; um teste Playwright, com o Supabase local e o seed, faz login com usuário de teste, envia uma seleção, recarrega a página e encontra a conversa.

### T22a — Criar o projeto Supabase hospedado

- **Quem:** HUMANO, com roteiro do agente. **Depende de:** T08, T09.
- **Passos para o autor:**
  1. Criar o projeto no Supabase (plano gratuito).
  2. Aplicar as migrations com `supabase db push`, depois de revisá-las.
  3. Criar a senha do papel `collector_ingest` e montar a `COLLECTOR_DATABASE_URL`.
  4. Configurar o Google OAuth no painel de Auth (README 16.2).
  5. Entrar uma vez na aplicação, inserir o próprio `user_id` em `allowed_users` e **desativar novos cadastros** no painel de Auth.
- **O agente** escreve o roteiro em `docs/runbooks/primeiro-deploy.md`, com os comandos exatos.
- **Pronto quando:** o autor confirma que o projeto existe, que as migrations foram aplicadas e que só o seu usuário está autorizado.

### T22b — Publicar funções e frontend

- **Quem:** agente + HUMANO. **Depende de:** T19, T21, T22a.
- **Referências:** README 16.3 e 16.4.
- **Passos:**
  1. HUMANO: definir os secrets das funções (`GROQ_API_KEY`, `GROQ_MODEL`, `APP_ORIGINS`, `APP_ENV`) com `supabase secrets set`.
  2. Publicar a função `agent` com `supabase functions deploy`.
  3. HUMANO: criar o projeto no Cloudflare Pages apontando para `frontend/`, com as variáveis `VITE_*`.
  4. Conferir que o bundle publicado não contém nenhuma chave privada (busque por `gsk_` e por `service_role` nos arquivos de `frontend/dist`).
- **Pronto quando:** o autor entra na aplicação publicada, faz uma pergunta e recebe uma resposta com dados do snapshot real.

### T23 — Exportação periódica das conversas

- **Quem:** agente. **Depende de:** T22a.
- **Objetivo:** as conversas são o único dado que não pode ser recoletado (D10).
- **Passos:**
  1. Adicione à interface um botão "Exportar minhas conversas", que baixa um JSON com as conversas e mensagens do usuário, lidas com o JWT dele.
  2. Documente em `docs/runbooks/backup.md` a rotina: exportar uma vez por semana e guardar fora do repositório.
- **Pronto quando:** o arquivo baixado contém todas as conversas do usuário de teste; o runbook existe.
- **Não fazer:** não envie conversas como artefato do GitHub Actions nem para o repositório.

---

## 10. Fase 5 — Aceite

### T24 — Conferência manual de aceite

- **Quem:** HUMANO. **Depende de:** T17, T22b.
- **Objetivo:** o teste de aceitação da fatia (D15).
- **Roteiro, que o agente grava em `docs/runbooks/conferencia-manual.md` como planilha a preencher:**
  1. Escolher pelo menos 5 tickers do universo.
  2. Para cada ticker e cada um dos 4 indicadores, abrir as duas fontes no mesmo dia do snapshot e anotar os valores.
  3. Anotar o que o sistema mostrou: valores, estado e fontes.
  4. Marcar cada linha como "confere" ou "não confere".
- **A fatia é aceita quando:**
  - todos os valores mostrados batem com a fonte indicada;
  - todos os estados batem com a conferência manual;
  - pelo menos um caso de `divergent` real foi observado e mostrado corretamente. Se nenhum aparecer nos 5 tickers, amplie a amostra antes de aceitar;
  - recarregar a página e entrar de novo preserva o histórico;
  - reenviar a mesma pergunta não duplica mensagens.

---

## 11. Depois da fatia

Em ordem sugerida. Cada item precisa de um plano próprio.

1. **Benchmark do `pdf-lib`** em Edge Function hospedada (experimento pendente do ADR). Define os limites do relatório.
2. **Relatório em PDF** das ações, reaproveitando `payload`.
3. **FIIs**, com FFO yield, cap rate e vacância em `single_source`.
4. **ETFs** (cotação).
5. **Tesouro**, com o adaptador do CSV oficial.
6. **Multiusuário:** convites, limites por usuário e testes de isolamento com duas contas.

## 12. Pendências que dependem do autor

| Pendência | Tarefa | Bloqueia |
| --- | --- | --- |
| Decidir se cada fonte é habilitada | T01 | T12, T13 |
| Confirmar o titular da licença e o canal de segurança | T02 | T05 |
| Ativar secret scanning | T02 | Código no repositório público |
| Escolher os tickers | T04 | T15 em ambiente real |
| Aprovar a metodologia dos campos | T07 | T12, T13, T14 |
| Criar o projeto Supabase e os secrets | T22a, T16 | Coleta real |
| Aprovar as tolerâncias | T17 | Estados `verified` e `divergent` |
| Decidir o modelo | T20 | — |
| Fazer a conferência manual | T24 | Aceite |

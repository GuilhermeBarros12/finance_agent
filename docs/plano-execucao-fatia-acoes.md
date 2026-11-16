# Plano de execução — primeira fatia (ações)

Este documento é o roteiro para construir a primeira fatia do Agente de Investimentos. Ele foi escrito para ser executado por agentes de código, uma tarefa por vez, sem depender de nenhuma conversa anterior.

## 1. Como usar este plano

Este plano é executado em sequência por um orquestrador, que delega cada tarefa a sub-agents (ADR 0002). O comando `/executar-plano` percorre todas as tarefas liberadas. O comando `/tarefa T10` executa uma só.

1. Leia a seção 2 (contexto) e a seção 3 (regras) inteiras antes de qualquer tarefa.
2. O estado de cada tarefa está em `docs/status-tarefas.md`, **no branch `fatia-acoes`**. Esse arquivo é a fonte da verdade.
3. Só comece uma tarefa quando todas as tarefas do campo **Depende de** estiverem `concluída`.
4. Uma tarefa só está concluída quando todos os itens de **Pronto quando** forem verdadeiros, o revisor aprovar e a CI passar.
5. Tarefas marcadas **HUMANO** ficam fora da execução autônoma. Elas estão em `docs/pendencias.md`.
6. Se uma tarefa travar, registre em `docs/bloqueios.md`, marque como `bloqueada` e passe para a próxima tarefa liberada. Não pare a execução inteira e não improvise uma decisão de arquitetura.

### Fluxo de branches

```text
main            protegida; só o autor faz merge
  `-- fatia-acoes        branch de integração da leva
        |-- tarefa/T05   um branch por tarefa, criado a partir de fatia-acoes
        |-- tarefa/T06
        `-- ...
```

Cada tarefa vira um pull request de `tarefa/Txx` para `fatia-acoes`. O orquestrador faz o merge quando a CI (`CI ok`) e o revisor aprovam. No final, a tarefa T25 abre um único pull request de `fatia-acoes` para `main`, que o autor revisa.

## 2. Contexto do projeto

O Agente de Investimentos é uma aplicação web pessoal. Ela coleta indicadores de ações em duas fontes, compara campo a campo e mostra o resultado num chat, sempre com a fonte e a data de cada número.

Documentos de referência, em ordem de autoridade:

1. `docs/adr/0002-execucao-autonoma.md` — decisões E1 a E20, sobre a execução autônoma e o front completo. **Prevalece sobre o ADR 0001.**
2. `docs/adr/0001-primeira-fatia-acoes.md` — decisões D1 a D21. **Prevalece sobre o README.**
3. `README.md` — especificação completa. Use as seções citadas em cada tarefa.

Resumo da fatia:

| Item | Escolha |
| --- | --- |
| Ativos | Só ações, de 10 a 20 tickers |
| Campos | `quote_price`, `price_to_book`, `price_to_earnings`, `dividend_yield`, `roe` |
| Fontes | brapi (cotação), Fundamentus e StatusInvest (indicadores) |
| Coleta | Python, uma vez por dia útil, via GitHub Actions |
| Banco | Postgres no Supabase |
| Backend | Supabase Edge Functions (Deno, TypeScript) |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router e TanStack Query |
| LLM | Groq, só para classificar a intenção da pergunta |
| Usuários | Um (o autor), com login Google |

Fora da fatia: FIIs, ETFs, Tesouro, PDF, Realtime, fallback de LLM, multiusuário, histórico de indicadores, RIs.

Fora da execução autônoma (ficam com o autor, ver `docs/pendencias.md`): projeto Supabase hospedado, segredos, deploy, coleta real, calibragem das tolerâncias, avaliação de modelos e conferência manual. O alvo da leva é o sistema inteiro funcionando em ambiente local, com Supabase local, dados sintéticos e `MOCK_LLM=true` (ADR 0002, E2).

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

- Não escreva parser de Fundamentus ou StatusInvest antes de a fonte estar com `enabled: true` em `config/sources.yaml` **e** de existir `docs/source-methodologies/estrutura-paginas.md`. Sem esse documento a estrutura da página seria inventada.
- Não crie commits vazios para manter o cron ativo (README 14.5).
- Não inclua nesta fatia nada da lista "fora da fatia".
- Não marque como feito o que não foi executado. Se um teste falhar, relate a falha com a saída.
- Um branch por tarefa (`tarefa/T10`), criado a partir de `fatia-acoes`, entregue por pull request para `fatia-acoes`. Ninguém faz merge em `main` além do autor.
- Mensagens de commit começam pelo ID da tarefa: `T10: ...`.
- Antes de cada commit, rode `bash scripts/ci/check_guardrails.sh`. A CI (`.github/workflows/ci.yml`) roda a mesma verificação e os testes em todo pull request.
- Não desative teste, não pule teste e não silencie lint para a CI passar.

Regras de documentação (ADR 0002, E19). Fazem parte do **Pronto quando** de toda tarefa de código:

- Crie `docs/tarefas/Txx.md` seguindo o modelo de `docs/tarefas/README.md`: o que foi feito, por que foi feito assim, o que foi descartado, arquivos principais, como conferir e limitações.
- Se a tarefa criar ou alterar tabela, coluna, função SQL ou política, atualize `docs/data-dictionary.md`.
- Se a tarefa criar ou alterar endpoint, atualize `docs/api.md` com entrada, saída, erros e um exemplo.
- Se a tarefa mudar como as partes se encaixam, atualize `docs/architecture/visao-geral.md`.
- Crie esses arquivos na primeira tarefa que precisar deles.

Regras de interface (ADR 0002, E8 a E10, E18). Valem para as tarefas T21a a T21f:

- Antes de escrever qualquer tela, leia `.claude/skills/frontend-design/SKILL.md` e `docs/design.md`.
- Tailwind CSS e componentes shadcn/ui. Os tokens de cor, tipografia e espaçamento vêm de `docs/design.md`; não invente valores por tela.
- Estrutura por funcionalidade em `frontend/src/features/<nome>/`, cada uma com `components/`, `hooks/` e `api.ts`. Componentes reutilizáveis em `frontend/src/components/`.
- React Router para rotas. TanStack Query para leitura e escrita de dados. Sem biblioteca de estado global.
- Todo texto visível em português do Brasil. Layout utilizável a partir de 360 px de largura. Tema claro e escuro seguindo o sistema.
- Toda tela trata os estados de carregamento, vazio e erro.

## 4. Visão geral das tarefas

"Autônoma" indica se a tarefa entra na execução sem supervisão.

| ID | Tarefa | Autônoma | Depende de |
| --- | --- | --- | --- |
| T01 | Revisar termos e `robots.txt` das fontes | concluída | — |
| T02 | Licença MIT e proteção de segredos | sim | — |
| T03 | Atualizar o README com as decisões | sim | — |
| T04 | Escolher o universo de tickers | concluída | — |
| T05 | Inicializar a estrutura do repositório | sim | T02 |
| T06 | Schema único de observação e validação | sim | T05 |
| T07 | Metodologia provisória dos campos | sim | T05 |
| T08 | Migrations do banco | sim | T05, T06 |
| T09 | RPC de publicação e papel dedicado | sim | T08 |
| T10 | Base do coletor e normalização | sim | T06 |
| T11 | Adaptador brapi | sim | T10 |
| T12 | Adaptador Fundamentus | bloqueada (P-01) | T07, T10 |
| T13 | Adaptador StatusInvest | bloqueada (P-01) | T07, T10 |
| T14 | Validação por campo | sim | T07, T10 |
| T15 | Pipeline, CLI e publicação | sim | T09, T11, T14 |
| T16 | Workflow diário e alerta de idade | não (HUMANO) | T15, T22a |
| T17 | Experimento de calibragem das tolerâncias | não (HUMANO) | T16 |
| T18 | Edge Function do agente (modo determinístico) | sim | T06, T08 |
| T18b | Edge Function de catálogo e estado dos dados | sim | T18 |
| T19 | Classificador de intenção com LLM | sim | T18 |
| T20 | Avaliação dos modelos | não (HUMANO) | T19 |
| T21a | Fundação do front e guia de design | sim | T05 |
| T21b | Login e conversas | sim | T21a, T08 |
| T21c | Chat, tabela de indicadores e seletor manual | sim | T21b, T18, T18b |
| T21d | Carteira | sim | T21c |
| T21e | Estado dos dados, exportação e aviso legal | sim | T21c |
| T21f | Testes ponta a ponta e capturas de tela | sim | T19, T21d, T21e |
| T22a | Criar o projeto Supabase hospedado | não (HUMANO) | T08, T09 |
| T22b | Publicar funções e frontend | não (HUMANO) | T19, T21f, T22a |
| T23 | Exportação das conversas | absorvida pela T21e | — |
| T24 | Conferência manual de aceite | não (HUMANO) | T17, T22b |
| T25 | Relatório final e pull request para `main` | sim | todas as autônomas |

Ordem sugerida para a execução autônoma: T02, T03, T05, T06, T07, T08, T10, T09, T11, T14, T15, T18, T18b, T19, T21a, T21b, T21c, T21d, T21e, T21f, T25. Quando uma tarefa estiver bloqueada, siga para a próxima da lista cujas dependências estejam concluídas.

## 5. Fase 0 — Preparação

### T01 — Revisar termos e `robots.txt` das fontes

> **Concluída.** Relatório em `docs/source-methodologies/permissoes.md`. O autor habilitou as três fontes em 2026-11-14. Fundamentus e StatusInvest continuam com permissão `indefinida`, por conta e risco do autor.

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

- **Quem:** agente.
- **Objetivo:** cumprir as condições para o repositório ser público (D14, D18).
- **Referências:** README 12.7 e 24.
- **Passos:**
  1. Crie `LICENSE` com o texto oficial da licença MIT, ano 2026 e titular "Guilherme" (autor informado na seção 24 do README).
  2. Crie `.gitignore` com o conteúdo da seção 12.7 do README. Acrescente `test-results/` e `playwright-report/`.
  3. No `README.md`, troque o badge "MIT (proposta)" por "MIT" e ajuste a seção 24 para dizer que a licença foi confirmada.
  4. Crie `SECURITY.md`. O canal de contato é o recurso "Report a vulnerability" da aba Security do repositório no GitHub. Não invente um e-mail.
- **Já feito pelo autor:** Secret Protection e Push Protection estão ativos no repositório.
- **Pronto quando:** `LICENSE`, `.gitignore` e `SECURITY.md` existem; o badge está atualizado; `bash scripts/ci/check_guardrails.sh` passa.
- **Pendência do autor (não bloqueia):** P-09 em `docs/pendencias.md`.

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
  8. Seção 2: acrescente também uma linha apontando para `docs/adr/0002-execucao-autonoma.md`.
  9. Seção 1 ("O que o agente não é"): registre que a aplicação tem uma carteira que guarda só os símbolos das ações, sem quantidade nem valor, e que isso não a torna um gestor de carteira (ADR 0002, E14 a E16).
  10. Seção 5: acrescente Tailwind CSS, shadcn/ui, React Router e TanStack Query à tabela da stack (ADR 0002, E8 e E18).
- **Pronto quando:** uma busca por "Gemini" no README não encontra nenhuma frase que o trate como fallback decidido; os dez pontos estão alterados.
- **Não fazer:** não reescreva seções que não estão na lista. Não marque nenhum checkbox da seção 19.3.

### T04 — Escolher o universo de tickers

> **Concluída.** O autor aprovou 12 ações (ADR 0002, E6). O arquivo `config/universe.yaml` já existe. Não o altere.

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

### T07 — Metodologia provisória dos campos

- **Quem:** agente. **Depende de:** T05.
- **Objetivo:** criar o arquivo que diz ao motor de validação se um campo é comparável entre as duas fontes (D2; ADR 0002, E7).
- **Contexto:** os sites das fontes respondem `403` ao agente, então a metodologia real ainda não foi lida. O arquivo nasce com o veredito mais conservador, e o autor o preenche depois (P-04).
- **Referências:** README 7.3 e 6.1.
- **Passos:**
  1. Crie `config/methodologies.yaml`:

     ```yaml
     version: "provisoria-1"
     # verdict: comparable | not_comparable | insufficient_metadata
     metrics:
       price_to_book:
         verdict: insufficient_metadata
         sources:
           fundamentus: { methodology_id: unknown, formula: null, window: null, basis: null, reference_date_available: null }
           statusinvest: { methodology_id: unknown, formula: null, window: null, basis: null, reference_date_available: null }
         notes: "Metodologia não lida. Preencher conforme docs/pendencias.md, P-04."
       # repetir para price_to_earnings, dividend_yield e roe
       quote_price:
         verdict: single_source
         sources:
           brapi: { methodology_id: brapi_quote, formula: null, window: null, basis: null, reference_date_available: true }
         notes: "Só a brapi fornece cotação nesta fatia."
     ```

  2. Crie o modelo Pydantic que carrega e valida esse arquivo em `collector/src/collector/settings.py` (ou num módulo vizinho). Um veredito desconhecido deve gerar erro.
  3. Crie `docs/source-methodologies/acoes.md` explicando: o que cada veredito significa, a consequência de cada um (`comparable` permite `verified` e `divergent`; os outros dois produzem `incomparable`), e o roteiro para o autor preencher (que páginas abrir e o que anotar por campo: fórmula, janela, base contábil, data-base).
- **Pronto quando:** o arquivo carrega sem erro; um teste confirma que um veredito inválido é rejeitado; o documento existe.
- **Não fazer:** não marque nenhum campo como `comparable`. Só o autor faz isso.

---

## 7. Fase 2 — Banco de dados

### T08 — Migrations do banco

- **Quem:** agente. **Depende de:** T05, T06.
- **Referências:** README 8.1, 8.2, 8.3.
- **Passos:** crie migrations em `supabase/migrations/`, em três arquivos.
  1. **Dados de mercado** (compartilhados): `assets`, `data_sources`, `collection_runs`, `snapshots`, `observations`, `field_validations`, `active_snapshot`. Use `uuid` para chaves, `timestamptz` para eventos e `numeric` para valores. Aplique a restrição `unique (snapshot_id, asset_id, metric, source_id)` em `observations`. `snapshots` é imutável depois de publicado: crie um trigger que rejeita `update` e `delete` em linhas publicadas, exceto pela rotina de retenção.
  2. **Dados privados:** `allowed_users` (uma linha por usuário autorizado), `conversations`, `messages`, `request_runs`, `llm_usage` (contador global por dia e provedor) e `portfolio_items` (a carteira: `user_id`, `asset_id`, `created_at`, com `unique (user_id, asset_id)` e FK para `assets`; sem quantidade, preço ou valor — ADR 0002, E14 a E16). Aplique as restrições do README 8.2: `unique (id, user_id)` em `conversations`, FK composta `(conversation_id, user_id)` em `messages`, `unique (conversation_id, sequence_no)`, `unique (user_id, request_id)`. `messages` tem `content_version` (inteiro) e `payload` (`jsonb`) para a resposta estruturada (D21).
  3. **RLS e grants:** habilite RLS em todas as tabelas. Tabelas de mercado: sem acesso para `anon` e `authenticated`; a leitura passa pela Edge Function. Tabelas privadas: o dono autorizado lê as suas linhas; `conversations` aceita insert, update de título e delete do dono; `portfolio_items` aceita select, insert e delete do dono; `messages`, `request_runs` e `llm_usage` não aceitam escrita do cliente. Use o padrão do exemplo do README 8.3, trocando `beta_users` por `allowed_users`.
  4. `supabase/seed.sql` com dados sintéticos: dois ativos fictícios, um snapshot com um campo `verified`, um `divergent`, um `missing` e um `incomparable`.
- **Pronto quando:** `supabase db reset` aplica tudo sem erro; os testes pgTAP em `supabase/tests/database/` passam e cobrem: um usuário não autorizado não lê nada; o cliente não consegue inserir mensagem com `role = 'assistant'`; `anon` não lê nenhuma tabela; um usuário não lê nem apaga itens da carteira de outro; a carteira recusa um ativo que não existe em `assets`. `docs/data-dictionary.md` descreve todas as tabelas e colunas criadas.
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

- **Quem:** agente. **Depende de:** T07, T10.
- **Bloqueada** até existir `docs/source-methodologies/estrutura-paginas.md` (pendência P-01). Sem esse documento, não comece: a estrutura da tabela seria inventada.
- **Referências:** README 6.1; `fundamentus-stocks` (seção 25); `docs/source-methodologies/estrutura-paginas.md`.
- **Passos:**
  1. Confira em `config/sources.yaml` que a fonte está `enabled: true`. Se não estiver, pare.
  2. A tabela de resultados traz todas as ações numa página. Baixe **uma vez por lote** e filtre os tickers do universo (README 14.4, item 5).
  3. Localize as colunas pelo **texto do cabeçalho**, não pela posição. Se um cabeçalho esperado não existir, lance um erro de parser; não devolva lista vazia.
  4. Extraia P/VP, P/L, DY e ROE. Preencha `methodology_id` com o valor de `config/methodologies.yaml` e `raw_value` com o texto original.
  4b. Registre o adaptador na lista de fontes do pipeline (T15).
  5. Se a fonte não informar data-base do indicador, `reference_at` fica nulo. Não use a data da coleta no lugar.
  6. Fixture sintética: um HTML escrito à mão com a mesma estrutura de tabela e tickers inventados.
- **Pronto quando:** testes cobrem: extração correta; cabeçalho ausente gera erro; ticker do universo ausente na tabela gera falha registrada para aquele ativo, sem derrubar os outros; página de erro com HTTP 200 é detectada.

### T13 — Adaptador StatusInvest

- **Quem:** agente. **Depende de:** T07, T10.
- **Bloqueada** até existir `docs/source-methodologies/estrutura-paginas.md` (pendência P-01).
- **Passos:** os mesmos princípios da T12, com estas diferenças:
  1. A fonte tende a exigir uma página por ativo. Use o intervalo entre requisições definido em `config/sources.yaml`.
  2. Registre em `source_url` a página do ativo (por exemplo `https://statusinvest.com.br/acoes/petr4`).
  3. Se a página responder `403` ou CAPTCHA, registre a falha e **suspenda a fonte no lote**. Não tente de novo com outro cabeçalho.
- **Pronto quando:** testes equivalentes aos da T12 passam, mais um teste em que `403` marca a fonte como suspensa.

### T14 — Validação por campo

- **Quem:** agente. **Depende de:** T07, T10.
- **Referências:** README 7.3 a 7.6.
- **Passos:**
  1. `collector/src/collector/validation/comparability.py`: recebe duas observações do mesmo ativo e métrica e decide se são comparáveis, com base no veredito de `config/methodologies.yaml` (T07), na unidade e nas datas. Devolve um motivo quando não são. Com veredito `insufficient_metadata`, o motivo é `unknown_metadata`. Os testes usam um arquivo de metodologia de teste com veredito `comparable`, para exercitar `verified` e `divergent`.
  2. `collector/src/collector/validation/tolerance.py`: a função `within_tolerance` do README 7.4, com `limite = max(atol, rtol * max(|a|, |b|))`.
  3. `collector/src/collector/validation/engine.py`: para cada par (ativo, métrica), produz uma `FieldValidation`:
     - nenhuma observação utilizável: `missing`;
     - observação com falha de contrato: `invalid`;
     - uma observação utilizável: `single_source`;
     - duas, não comparáveis: `incomparable`;
     - duas, comparáveis, dentro do limite: `verified`, com `selected_observation_id` igual à do Fundamentus (D19);
     - duas, comparáveis, fora do limite: `divergent`, com `selected_observation_id` nulo.
  4. `config/tolerances.yaml` com os valores do README 7.4 para os cinco campos e `version: "draft-1"`.
  5. **Modo de calibragem:** uma opção `validation.calibration_mode` em configuração. Quando ligada, o motor calcula a comparação, mas grava o estado `incomparable` no lugar de `verified` e `divergent`, com as duas observações, sem escolher lado, com `reason` começando por `uncalibrated:` e com a comparação em `comparison` (`delta_abs`, `limit`, `atol`, `rtol`, `tolerance_version`). Assim nenhum selo aparece antes de a T17 terminar, as duas fontes continuam visíveis e os números ficam em campos próprios (decisão da pendência P-17, que substituiu o `single_source` do texto original). Comece com a opção **ligada**.
  6. `freshness`: calcule a partir de `collected_at` do snapshot e de dias úteis (segunda a sexta). Mais de 1 dia útil é `stale`; mais de 5 é `expired` (D20). Feriados não são considerados nesta fatia; registre essa limitação no código e no README.
- **Pronto quando:** há um teste para cada um dos sete estados; os dois exemplos numéricos do README 7.4 passam; um teste confirma que, com o modo de calibragem ligado, nenhum resultado sai `verified` ou `divergent`.

### T15 — Pipeline, CLI e publicação

- **Quem:** agente. **Depende de:** T09, T11, T14.
- **Referências:** README 14.1 e 14.4.
- **Sobre as fontes:** o pipeline recebe uma lista de adaptadores registrados. Nesta tarefa só a brapi existe de verdade. T12 e T13 se registram depois, sem mudar o pipeline. Os testes de integração usam dois adaptadores falsos, definidos dentro de `collector/tests/`, para simular duas fontes de indicadores.
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
  2. Escreva `scripts/analyze_deltas.py`, que lê as comparações gravadas em `field_validations` (linhas `incomparable` com `reason` começando por `uncalibrated:`; colunas `delta_abs`, `limit_value`, `atol`, `rtol` e `tolerance_version`) e gera, por métrica: quantidade de pares, mediana, percentis 90 e 99 de `delta_abs`, e os casos acima do limite `draft-1`.
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

### T18b — Edge Function de catálogo e estado dos dados

- **Quem:** agente. **Depende de:** T18.
- **Objetivo:** dar ao front o que ele precisa para montar o seletor, a carteira e o painel de estado dos dados. As tabelas de mercado não são legíveis pelo cliente, então a leitura passa por esta função.
- **Contrato de `GET /catalog`** (exige usuário autorizado):

  ```json
  {
    "universe_version": "fatia-acoes-1",
    "assets": [{ "asset_id": "PETR4", "name": "...", "reference_url": "https://statusinvest.com.br/acoes/petr4" }],
    "metrics": [{ "metric": "price_to_book", "label": "P/VP", "unit": "ratio" }],
    "snapshot": {
      "snapshot_id": "...",
      "collected_at": "...",
      "freshness": "fresh",
      "assets_total": 12,
      "assets_updated": 11,
      "failures": [{ "asset_id": "VALE3", "source_id": "statusinvest", "reason": "..." }],
      "status_counts": { "verified": 0, "divergent": 0, "single_source": 12, "incomparable": 36, "missing": 4, "invalid": 0 }
    }
  }
  ```

  Sem snapshot publicado, `snapshot` é `null` e a resposta continua `200`.
- **Passos:**
  1. Crie `supabase/functions/catalog/index.ts`, reaproveitando a autenticação e a autorização de `_shared/`.
  2. O link de referência é montado no servidor a partir do cadastro do ativo (README 7.8).
  3. `failures` é um resumo sem dados sensíveis: sem URL com token, sem HTML.
  4. Documente o endpoint em `docs/api.md`.
- **Pronto quando:** testes Deno cobrem: sem JWT (`401`); usuário não autorizado (`403`); resposta com snapshot; resposta sem snapshot; `status_counts` bate com o seed.

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

### T21a — Fundação do front e guia de design

- **Quem:** agente. **Depende de:** T05.
- **Referências:** `.claude/skills/frontend-design/SKILL.md`; regras de interface da seção 3; ADR 0002, E8, E10 e E18.
- **Passos:**
  1. Leia a skill `frontend-design` inteira e siga o processo dela em duas passadas (plano, depois construção).
  2. Escreva `docs/design.md`: o assunto e o público (uma pessoa conferindo indicadores de ações com atenção à origem do dado); paleta com 4 a 6 cores nomeadas em hexadecimal, para tema claro e escuro; tipografia e escala; espaçamento; e a **representação visual de cada estado** de validação (`verified`, `divergent`, `single_source`, `incomparable`, `missing`, `invalid`) e de atualização (`fresh`, `stale`, `expired`). Cada estado precisa ser distinguível sem depender só de cor (ícone ou texto junto).
  3. Configure Tailwind CSS com os tokens de `docs/design.md` e instale o shadcn/ui. Adicione só os componentes que as telas usam.
  4. Configure React Router com as rotas: `/entrar`, `/` (conversas), `/conversas/:id`, `/carteira`, `/dados`, `/aviso-legal`. Rotas privadas redirecionam para `/entrar`.
  5. Configure TanStack Query e o cliente Supabase em `frontend/src/lib/supabase.ts`.
  6. Crie o layout base: navegação entre Conversas, Carteira e Dados, que funcione em 360 px de largura, e o alternador de tema seguindo o sistema.
  7. Crie os componentes compartilhados de estado: carregando, vazio e erro.
  8. Crie `frontend/public/_headers` com uma política de segurança de conteúdo e `frontend/public/_redirects` para as rotas.
- **Pronto quando:** `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` passam em `frontend/`; `docs/design.md` existe e cobre todos os estados; há um teste de que rota privada sem sessão redireciona para `/entrar`.
- **Não fazer:** não crie telas de funcionalidade aqui. Não use cor como único sinal de um estado.

### T21b — Login e conversas

- **Quem:** agente. **Depende de:** T21a, T08.
- **Referências:** README 8.5, 15.2, 15.3.
- **Pastas:** `frontend/src/features/auth/` e `frontend/src/features/conversations/`.
- **Passos:**
  1. Tela `/entrar`: botão "Entrar com Google" (Supabase Auth). Usuário que não está em `allowed_users` vê uma mensagem clara de acesso não autorizado e um botão para sair.
  2. Tela `/`: lista de conversas ordenada por atualização, com criar, renomear e excluir. Excluir pede confirmação.
  3. As operações usam supabase-js com o JWT do usuário e TanStack Query. Depois de cada escrita, a lista é relida do banco (sem atualização otimista, D17).
  4. Estados de carregamento, lista vazia e erro.
- **Pronto quando:** testes Vitest cobrem: lista vazia, lista com itens, erro de carregamento, criar, renomear, excluir com confirmação, e a mensagem de não autorizado.

### T21c — Chat, tabela de indicadores e seletor manual

- **Quem:** agente. **Depende de:** T21b, T18, T18b.
- **Referências:** README 7.5, 7.6, 15.4; D5, D17, D19, D21.
- **Pasta:** `frontend/src/features/chat/`.
- **Passos:**
  1. Tela `/conversas/:id`: mensagens paginadas lidas do banco, caixa de pergunta e botão para abrir o seletor manual.
  2. Envio para `POST /agent`. O `request_id` vem de `crypto.randomUUID()` e é **reutilizado** quando a mesma pergunta é reenviada. Depois da resposta, a tela relê as mensagens do banco.
  3. Seletor manual: lista de ações e de indicadores vinda de `GET /catalog`, com múltipla escolha. Abre sozinho quando o backend responde `needs_selection`, mostrando o motivo.
  4. Renderização da resposta a partir de `payload` (D21), num componente `MetricTable`:
     - cabeçalho com a data do snapshot, o estado de atualização e o manifesto ("11 de 12 ativos atualizados");
     - uma tabela por indicador; cada célula mostra o valor, o estado e um link para a fonte;
     - `verified`: valor do Fundamentus em destaque; o do StatusInvest aparece ao expandir;
     - `divergent`: os dois valores lado a lado, a diferença e o limite; nenhum em destaque;
     - `single_source`: o valor, com o aviso "não verificado entre fontes";
     - `incomparable`: os valores e o motivo;
     - `missing`: "Não disponível", nunca zero;
     - `stale` e `expired`: aviso visível no cabeçalho.
  5. O navegador formata os decimais (strings) para exibição em pt-BR, mas não calcula. A formatação fica numa função única, testada.
  6. Não renderize HTML vindo do backend.
  7. Em telas estreitas, a tabela continua legível (por exemplo, virando cartões por ativo).
- **Pronto quando:** testes Vitest cobrem a renderização dos sete estados de validação e dos estados de atualização, a formatação de decimais e percentuais, a reutilização do `request_id` no reenvio e a abertura do seletor em `needs_selection`.

### T21d — Carteira

- **Quem:** agente. **Depende de:** T21c.
- **Referências:** ADR 0002, E14 a E16.
- **Pasta:** `frontend/src/features/portfolio/`.
- **Passos:**
  1. Tela `/carteira`: lista das ações da carteira do usuário, lida de `portfolio_items` com o JWT dele.
  2. Adicionar: um seletor com as ações do universo (`GET /catalog`) que ainda não estão na carteira. Não há campo de texto livre, quantidade, preço nem valor.
  3. Remover uma ação, com confirmação.
  4. Um texto curto explica que só as ações acompanhadas pelo sistema podem ser adicionadas.
  5. Botão "Atualizar carteira": cria uma conversa nova (ou usa a aberta) e envia a `POST /agent` uma `selection` com todas as ações da carteira e os cinco indicadores. É o caminho determinístico: sem `message`, sem LLM. Em seguida navega para a conversa.
  6. Com a carteira vazia, o botão fica desabilitado e a tela convida a adicionar a primeira ação.
- **Pronto quando:** testes Vitest cobrem: carteira vazia; adicionar; remover; ação já presente não aparece no seletor; o botão envia `selection` com todas as ações e nenhum `message`. Um teste confirma que o módulo da carteira não é importado pelo código do classificador nem aparece em nenhum corpo enviado com `message`.
- **Não fazer:** não envie a carteira ao LLM. Não guarde nada além do símbolo.

### T21e — Estado dos dados, exportação e aviso legal

- **Quem:** agente. **Depende de:** T21c.
- **Referências:** README 6.4, 18.1, 20.1, 23; D10; ADR 0002, E9.
- **Pastas:** `frontend/src/features/data-status/` e `frontend/src/features/legal/`.
- **Passos:**
  1. Tela `/dados`, a partir de `GET /catalog`: data e idade do snapshot, estado de atualização, "X de Y ativos atualizados", contagem de campos por estado e a lista de falhas por ativo e fonte. Sem snapshot, a tela diz que ainda não há dados coletados.
  2. Na mesma tela, a lista das fontes com o estado de permissão registrado (texto fixo vindo de configuração do front, coerente com `config/sources.yaml`).
  3. Exportação: botão "Exportar meus dados", que baixa um JSON com as conversas, as mensagens e a carteira do usuário, lidos com o JWT dele. O arquivo traz a data da exportação e a versão do formato.
  4. Tela `/aviso-legal`: o conteúdo da seção 23 do README, a lista de fontes com link, e o aviso de que as respostas não são recomendação de investimento. Um link para ela aparece no rodapé de todas as telas.
- **Pronto quando:** testes Vitest cobrem: painel com snapshot, sem snapshot e com falhas; a exportação gera um JSON com conversas, mensagens e carteira; a tela de aviso legal é alcançável pelo rodapé.
- **Não fazer:** não envie a exportação a nenhum servidor. Ela é montada e baixada no navegador.

### T21f — Testes ponta a ponta e capturas de tela

- **Quem:** agente. **Depende de:** T19, T21d, T21e.
- **Objetivo:** provar o fluxo inteiro em ambiente local e produzir as imagens que o autor usa para validar o visual (ADR 0002, E20).
- **Passos:**
  1. Configure o Playwright (`playwright.config.ts` na raiz, testes em `tests/e2e/`). O ambiente é o Supabase local com o `seed.sql`, as funções servidas localmente com `MOCK_LLM=true` e o front em modo de desenvolvimento.
  2. Login nos testes: crie o usuário de teste com e-mail e senha **somente no Supabase local**, via seed ou API administrativa local, e inicie a sessão pelo cliente. Não habilite e-mail e senha em nenhum ambiente hospedado, e não acrescente esse método à tela de login.
  3. Roteiros: (a) entrar, criar conversa, enviar uma seleção, ver a tabela, recarregar a página e encontrar a conversa; (b) enviar uma pergunta em texto e ver a resposta do classificador simulado; (c) forçar `needs_selection` e usar o seletor; (d) adicionar duas ações à carteira e usar "Atualizar carteira"; (e) abrir o painel de dados; (f) exportar os dados.
  4. Capture cada tela em tema claro e escuro, em 1280 px e em 390 px de largura, e grave em `docs/capturas/`. Inclua uma captura da tabela com um campo `verified`, um `divergent`, um `incomparable` e um `missing`.
  5. Acrescente à CI um job `e2e` que só roda quando `playwright.config.ts` existe. Use o Chromium já disponível no runner ou instale-o no job. O job entra na lista `needs` de `ci-ok`.
- **Pronto quando:** os seis roteiros passam localmente; as capturas existem em `docs/capturas/`; o job `e2e` passa no pull request.
- **Se o ambiente não permitir subir o Supabase local:** registre em `docs/bloqueios.md`, entregue os roteiros escritos e as capturas que forem possíveis com o backend simulado, e diga com clareza o que não foi executado.

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

- **Quem:** agente + HUMANO. **Depende de:** T19, T21f, T22a.
- **Referências:** README 16.3 e 16.4.
- **Passos:**
  1. HUMANO: definir os secrets das funções (`GROQ_API_KEY`, `GROQ_MODEL`, `APP_ORIGINS`, `APP_ENV`) com `supabase secrets set`.
  2. Publicar a função `agent` com `supabase functions deploy`.
  3. HUMANO: criar o projeto no Cloudflare Pages apontando para `frontend/`, com as variáveis `VITE_*`.
  4. Conferir que o bundle publicado não contém nenhuma chave privada (busque por `gsk_` e por `service_role` nos arquivos de `frontend/dist`).
- **Pronto quando:** o autor entra na aplicação publicada, faz uma pergunta e recebe uma resposta com dados do snapshot real.

### T23 — Exportação das conversas

> **Absorvida pela T21e.** O botão "Exportar meus dados" cobre conversas, mensagens e carteira. A rotina de backup (exportar uma vez por semana e guardar fora do repositório) deve ser descrita em `docs/tarefas/T21e.md`.

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

### T25 — Relatório final e pull request para `main`

- **Quem:** agente (orquestrador). **Depende de:** todas as tarefas autônomas estarem `concluída` ou `bloqueada`.
- **Passos:**
  1. Escreva `docs/relatorio-execucao.md` com:
     - um resumo de uma página: o que funciona, o que não funciona e o que falta para o uso real;
     - uma tabela por tarefa: estado, pull request, evidência dos testes e link para `docs/tarefas/Txx.md`;
     - a lista de bloqueios, copiada de `docs/bloqueios.md`;
     - as capturas de tela de `docs/capturas/`, organizadas por tela;
     - os comandos que o autor pode rodar para conferir (`pytest`, `npm test`, `deno test`, `supabase test db`, testes ponta a ponta), com o resultado obtido na última execução.
  2. Confira que `docs/data-dictionary.md`, `docs/api.md` e `docs/architecture/visao-geral.md` refletem o código final.
  3. Atualize `docs/pendencias.md`: marque o que foi resolvido e acrescente o que surgiu.
  4. Abra um pull request de `fatia-acoes` para `main`, com o resumo do relatório no corpo. **Não faça o merge.**
- **Pronto quando:** o relatório existe; a CI passa no pull request para `main`; o autor foi avisado.

## 11. Depois da fatia

Em ordem sugerida. Cada item precisa de um plano próprio.

1. **Benchmark do `pdf-lib`** em Edge Function hospedada (experimento pendente do ADR). Define os limites do relatório.
2. **Relatório em PDF** das ações, reaproveitando `payload`.
3. **FIIs**, com FFO yield, cap rate e vacância em `single_source`.
4. **ETFs** (cotação).
5. **Tesouro**, com o adaptador do CSV oficial.
6. **Multiusuário:** convites, limites por usuário e testes de isolamento com duas contas.

## 12. Pendências que dependem do autor

A lista completa e atualizada está em [`docs/pendencias.md`](pendencias.md). As que seguram tarefas da execução autônoma são:

| Pendência | Bloqueia |
| --- | --- |
| P-01 — Estrutura das páginas do Fundamentus e do StatusInvest | T12, T13 |
| P-02 e P-03 — Teste de bloqueio e decisão sobre o resultado | Coleta real |
| P-04 — Metodologia dos indicadores | Estados `verified` e `divergent` com dados reais |
| P-05 — Parte hospedada | T16, T17, T20, T22a, T22b, T24 |

# Relatório da execução autônoma (atualizado em 2026-11-17)

## Resumo

**O que funciona (mesclado em `fatia-acoes`, cada tarefa com revisão aprovada e `CI ok`):**
- **Base do repositório:** licença MIT, `.gitignore`, `SECURITY.md`, README alinhado aos ADRs.
- **Contratos:** schema único de observação e validação (Pydantic, JSON Schema, Zod) com 93 exemplos validados pelos dois lados.
- **Banco:** 15 tabelas com RLS, snapshots publicados imutáveis, RPC `publish_snapshot` com papel dedicado `collector_ingest`, cota global do LLM e gatilho de `updated_at` (271 testes pgTAP).
- **Coletor:** cliente HTTP com lista de domínios, normalização, adaptador da brapi, motor de validação por campo (modo de calibragem ligado), pipeline, CLI e publicação. Só a brapi tem adaptador.
- **Backend:** `POST /agent` determinístico, classificador de intenção com LLM (cota atômica, saída validada, sem dados pessoais no prompt) e `GET /catalog`.
- **Frontend:** fundação e guia de design, login com Google e lista de conversas, **chat com a tabela de indicadores e o seletor manual (T21c)**, **painel de estado dos dados, exportação e aviso legal (T21e)**. A autorização vem do banco e é relida a cada navegação.

**O que ainda não funciona:**
- **Carteira (T21d): bloqueada.** O plano contradiz o backend: `portfolio_items.asset_id` é `uuid`, o `GET /catalog` devolve só o símbolo e o navegador não lê `assets`. Decisão do autor na **P-21** (a opção recomendada é o catálogo devolver também o `uuid`).
- **Testes ponta a ponta e capturas (T21f):** dependem da T21d.
- **Fundamentus e StatusInvest (T12, T13):** bloqueados pela P-01. Sem a segunda fonte, nenhum campo real sai `verified` ou `divergent`.
- **Nenhum dado real foi coletado e nenhum LLM real foi chamado.** Nada foi testado contra brapi, Groq, Google OAuth ou Supabase hospedado; `/agent` e `/catalog` foram simulados nos testes do front.

**O que falta para o uso real:** resolver a P-21 (carteira) e executar a T21f; a P-01 (estrutura das páginas das fontes) e a P-04 (metodologia dos indicadores); confirmar o contrato da brapi (P-16); e a parte hospedada (T22a, T22b, T16, T17, T20, T24).

**Mudança de processo nesta rodada:** o revisor `revisor-tarefa` estava fixado no modelo `fable`, que ficou sem créditos de uso. O autor não repôs os créditos e autorizou o **Opus 5.5** como revisor (`.claude/agents/revisor-tarefa.md`, `model: opus`). As revisões da T21c e da T21e foram feitas com ele.

Capturas de tela: `docs/capturas/` (T21b, T21c e T21e). As da carteira e dos testes ponta a ponta dependem da T21d e da T21f.

## Tarefas

| ID | Estado | Pull request |
| --- | --- | --- |
| T01 | concluída (antes da leva) | #2, #4 |
| T02 | concluída | #6 |
| T03 | concluída | #7 |
| T04 | concluída (antes da leva) | — |
| T05 | concluída | #8 |
| T06 | concluída | #11 |
| T07 | concluída | #9 |
| T08 | concluída | #13 |
| T09 | concluída | #15 |
| T10 | concluída | #14 |
| T11 | concluída | #16 |
| T12, T13 | bloqueadas (P-01) | — |
| T14 | concluída | #17 |
| T15 | concluída | #18 |
| T16, T17, T20, T22a, T22b, T24 | fora da leva (dependem do autor) | — |
| T18 | concluída | #19 |
| T18b | concluída | #20 |
| T19 | concluída | #22 |
| T21a | concluída | #12 |
| T21b | concluída | #23 |
| T21c | concluída | #25 |
| **T21d** | **bloqueada (P-21)** | — |
| T21e | concluída | #26 |
| T21f | pendente (depende da T21d) | — |
| T23 | absorvida pela T21e (rotina de backup em `docs/tarefas/T21e.md`) | — |

Explicação de cada tarefa concluída: `docs/tarefas/Txx.md`.

## Bloqueios

Os detalhes estão em `docs/bloqueios.md`.
- **T21d:** o plano contradiz o backend (uuid do ativo); aguarda a decisão do autor (P-21). Nada foi implementado.
- **T12 e T13:** P-01.
- **T06, T21a e T21c:** bloqueadas durante a leva e resolvidas; concluídas.

## Como conferir

Estes comandos valem para o estado de `fatia-acoes`.

| Comando | O que cobre |
| --- | --- |
| `bash scripts/ci/check_guardrails.sh` | regras da CI (segredos, `float`, fixtures, workflows) |
| `ruff check . && pytest` (Python 3.12, locks com hash) | coletor (389 testes sem banco) |
| `cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build` | front (224 testes) |
| `cd supabase/functions && deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost` | funções (247 testes) |
| `npx supabase db reset && npx supabase test db` | banco (271 testes) |
| `python -m collector.cli run --mode fixtures` (com o Supabase local e `APP_ENV=local`) | publicação de um snapshot sintético |

## Pendências para o autor

Lista completa em `docs/pendencias.md`. As principais: **P-21** (decidir como o front acessa o uuid dos ativos para a carteira), P-01 (estrutura das páginas das fontes), P-04 (metodologia), P-16 (contrato da brapi), P-18 (feriados no README), P-19 (`LLM_DAILY_LIMIT` no README e retry em timeout), P-20 (acompanhamento da T21c) e rodar `supabase functions serve` uma vez com rede aberta. Sugestão: renomear o ambiente `finance_agent (revisão de fontes)` (os parênteses impedem a migração da sessão para ele) para o agente poder ler a documentação da brapi.

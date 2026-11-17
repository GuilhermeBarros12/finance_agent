# Relatório da execução autônoma (atualizado em 2026-11-17)

## Resumo

**O que funciona (mesclado em `fatia-acoes`, com revisão aprovada e `CI ok`):**
- **Base do repositório:** licença MIT, `.gitignore`, `SECURITY.md`, README alinhado aos ADRs.
- **Contratos:** schema único de observação e validação (Pydantic, JSON Schema, Zod) com 93 exemplos validados pelos dois lados.
- **Banco:** 15 tabelas com RLS, imutabilidade dos snapshots publicados, RPC `publish_snapshot` com papel dedicado `collector_ingest` e cota global do LLM (271 testes pgTAP).
- **Coletor:** cliente HTTP com lista de domínios, normalização, adaptador da brapi, motor de validação por campo (modo de calibragem ligado), pipeline, CLI e publicação. Só a brapi tem adaptador.
- **Backend:** `POST /agent` determinístico, classificador de intenção com LLM (cota atômica, saída validada, sem dados pessoais no prompt), `GET /catalog`.
- **Frontend:** fundação e guia de design, login com Google, lista de conversas (criar, renomear, excluir) com autorização relida do banco.

**O que ainda não funciona:**
- **Chat e tabela de indicadores (T21c):** implementados e enviados em `tarefa/T21c`, mas **sem revisão e sem CI**. O revisor não rodou por falta de créditos de uso do modelo em que ele está fixado (ver bloqueios).
- **Telas T21d (carteira), T21e (estado dos dados, exportação, aviso legal) e T21f (testes ponta a ponta):** não feitas; dependem da T21c.
- **Fundamentus e StatusInvest (T12, T13):** bloqueados pela P-01. Sem a segunda fonte, nenhum campo real sai `verified` ou `divergent`.
- **Nenhum dado real foi coletado e nenhum LLM real foi chamado.** Nada foi testado contra brapi, Groq, Google OAuth ou Supabase hospedado.

**O que falta para o uso real:** destravar a T21c (créditos do revisor), executar T21d a T21f, resolver a P-01 (estrutura das páginas) e a P-04 (metodologia dos indicadores), confirmar o contrato da brapi (P-16) e a parte hospedada (T22a, T22b, T16, T17, T20, T24).

Capturas de tela: `docs/capturas/` (T21b e T21c). As de T21d a T21f dependem das tarefas.

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
| **T21c** | **em revisão (branch `tarefa/T21c`, commit fbb9415; aguardando o revisor)** | — |
| T21d, T21e, T21f | pendentes (dependem da T21c) | — |
| T23 | absorvida pela T21e | — |

Explicação de cada tarefa concluída: `docs/tarefas/Txx.md`.

## Bloqueios

Os detalhes estão em `docs/bloqueios.md`.
- **T21c:** sem revisão (créditos do modelo do revisor). O código passa nos comandos locais, mas nada foi revisado e a CI não rodou.
- **T12 e T13:** P-01.
- **T06 e T21a:** bloqueadas no início e resolvidas pelo autor; concluídas.

## Como conferir

Estes comandos valem para o estado de `fatia-acoes`.

| Comando | O que cobre |
| --- | --- |
| `bash scripts/ci/check_guardrails.sh` | regras da CI (segredos, `float`, fixtures, workflows) |
| `ruff check . && pytest` (Python 3.12, locks com hash) | coletor |
| `cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build` | front (T21a e T21b) |
| `cd supabase/functions && deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost` | funções |
| `npx supabase db reset && npx supabase test db` | banco (271 testes) |
| `python -m collector.cli run --mode fixtures` (com o Supabase local e `APP_ENV=local`) | publicação de um snapshot sintético |

## Pendências para o autor

Lista completa em `docs/pendencias.md`. As principais: P-01 (estrutura das páginas das fontes), P-04 (metodologia), P-16 (contrato da brapi), P-18 (feriados no README), P-19 (`LLM_DAILY_LIMIT` no README e retry em timeout), repor créditos do revisor (T21c) e rodar `supabase functions serve` uma vez com rede aberta.

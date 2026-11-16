# Relatório da execução autônoma (2026-11-14)

## Resumo

**O que funciona (mesclado em `fatia-acoes`):** a base do repositório (licença MIT, `.gitignore`, `SECURITY.md`), o README alinhado aos ADRs 0001 e 0002, o esqueleto Python (coletor, locks com hash, pytest, ruff), o esqueleto do frontend (Vite, React, TypeScript, Vitest), a pasta do Supabase (`supabase init`) e a metodologia provisória dos campos, com carregador e testes. A CI passa nos PRs mesclados.

**O que não funciona ou não existe:** não há banco, coletor, adaptadores, validação por campo, Edge Functions nem telas. A cadeia crítica parou na T06 e na T21a (ver bloqueios). Nenhum dado foi coletado e nenhum LLM foi chamado.

**O que falta para o uso real:** destravar a T06 (três correções pequenas) e a T21a (decisão sobre o guarda do bundle); depois a execução retoma por T08, T10, T09, T11, T14, T15, T18, T18b, T19, T21b a T21f. Dependem do autor: P-01 (T12 e T13), P-03 a P-05 (coleta real e parte hospedada).

Capturas de tela: não existem (`docs/capturas/` não foi criada), porque as telas de T21b a T21f não foram feitas.

## Tarefas

| ID | Estado | Pull request | Evidência | Explicação |
| --- | --- | --- | --- | --- |
| T01 | concluída (antes da leva) | [#2](https://github.com/GuilhermeBarros12/finance_agent/pull/2), [#4](https://github.com/GuilhermeBarros12/finance_agent/pull/4) | — | `docs/source-methodologies/permissoes.md` |
| T02 | concluída | [#6](https://github.com/GuilhermeBarros12/finance_agent/pull/6) | guardrails ok; `CI ok` | `docs/tarefas/T02.md` |
| T03 | concluída | [#7](https://github.com/GuilhermeBarros12/finance_agent/pull/7) | guardrails ok; `CI ok` | `docs/tarefas/T03.md` |
| T04 | concluída (antes da leva) | — | — | — |
| T05 | concluída | [#8](https://github.com/GuilhermeBarros12/finance_agent/pull/8) | pytest 1, vitest 1, lint, typecheck, build; `CI ok` | `docs/tarefas/T05.md` |
| T06 | **bloqueada** | sem PR; branch `tarefa/T06` | pytest 90 e deno 89 passam; revisor reprovou 3 vezes | — |
| T07 | concluída | [#9](https://github.com/GuilhermeBarros12/finance_agent/pull/9) | pytest 6; `CI ok` | `docs/tarefas/T07.md` |
| T08 | pendente (depende da T06) | — | — | — |
| T09 | pendente (depende da T08) | — | — | — |
| T10 | pendente (depende da T06) | — | — | — |
| T11 | pendente (depende da T10) | — | — | — |
| T12, T13 | bloqueadas (P-01) | — | — | — |
| T14 | pendente (depende da T10) | — | — | — |
| T15 | pendente (depende de T09, T11, T14) | — | — | — |
| T16, T17, T20, T22a, T22b, T24 | fora da leva | — | — | — |
| T18, T18b, T19 | pendentes (dependem de T06 e T08) | — | — | — |
| T21a | **bloqueada** | sem PR; branch `tarefa/T21a` | lint, typecheck, 6 testes, build passam; `check_bundle.sh` falha | — |
| T21b a T21f | pendentes (dependem de T08, T21a e das tarefas acima) | — | — | — |
| T23 | absorvida pela T21e | — | — | — |

## Bloqueios

### T06 — Schema único de observação e validação

Três reprovações do revisor por divergências de aceitar/rejeitar entre Pydantic e Zod. Restam: (1) offset de fuso com minutos de 60 a 99 (`+02:60`), aceito e reescrito pelo Pydantic e rejeitado pelo Zod; (2) substituto UTF-16 isolado em campos `NonEmptyStr`, rejeitado pelo Pydantic e aceito pelo Zod; (3) contagens desatualizadas em `docs/tarefas/T06.md`. Código completo no branch `tarefa/T06` (commit 865e2e8). Destrava: uma nova sessão corrige os três pontos e pede revisão. Bloqueia T08, T10 e toda a cadeia seguinte.

### T21a — Fundação do front e guia de design

Trabalho completo no branch `tarefa/T21a` (commit 48f7406). `scripts/ci/check_bundle.sh` falha: o regex `sb_secret_` casa com um texto literal dentro de `@supabase/supabase-js`. Não há chave no bundle. O executor tentou afrouxar o guarda e o classificador de permissões negou, então o script ficou intacto. Destrava: o autor decide se troca o regex por `sb_secret_[A-Za-z0-9_-]{20,}` (o padrão do `check_guardrails.sh`). Depois, abrir o PR, revisar e mesclar.

Os detalhes completos estão em `docs/bloqueios.md`.

## Como conferir

Estes comandos valem para o estado de `fatia-acoes`. Rodei a CI dos PRs mesclados; o resultado local abaixo vem dos relatos dos revisores nos PRs.

| Comando | Resultado na última execução |
| --- | --- |
| `bash scripts/ci/check_guardrails.sh` | "Guardrails: tudo certo." |
| `ruff check .` e `pytest` (Python 3.12, locks com hash) | passam (6 testes) |
| `cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build` | passam |
| `deno test` | não se aplica em `fatia-acoes` (o job só ativa com o código da T06) |
| `supabase test db` | não se aplica (sem migrations) |
| testes ponta a ponta | não existem (T21f) |

## Documentação obrigatória

`docs/data-dictionary.md`, `docs/api.md` e `docs/architecture/visao-geral.md` não existem: nenhuma tarefa concluída mexeu em banco, endpoint ou arquitetura. Passam a ser criados com a T08 e a T18.

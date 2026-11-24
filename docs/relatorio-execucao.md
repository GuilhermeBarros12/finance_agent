# Relatório da execução autônoma (atualizado em 2026-11-24)

## Resumo

**A fatia de ações funciona de ponta a ponta em ambiente local, com dados sintéticos e LLM simulado.** Todas as tarefas autônomas estão concluídas, cada uma com revisão aprovada e o check `CI ok` verde antes do merge em `fatia-acoes`. Ficam de fora só T12 e T13 (adaptadores do Fundamentus e do StatusInvest), que dependem do autor (P-01), e as tarefas que exigem o ambiente hospedado.

**O que funciona (provado por testes e pelos 14 roteiros ponta a ponta, que rodam também na CI):**
- **Base do repositório:** licença MIT, `.gitignore`, `SECURITY.md`, README alinhado aos ADRs.
- **Contratos:** schema único de observação e validação (Pydantic, JSON Schema, Zod), com 93 exemplos validados pelos dois lados.
- **Banco:** 15 tabelas com RLS, snapshots publicados imutáveis, RPC `publish_snapshot` com papel dedicado `collector_ingest`, cota global do LLM e gatilho de `updated_at` (271 testes pgTAP).
- **Coletor:** cliente HTTP com lista de domínios, normalização, adaptador da brapi, motor de validação por campo (modo de calibragem ligado), pipeline, CLI e publicação. Só a brapi tem adaptador.
- **Backend:** `POST /agent` determinístico e com classificador de intenção (LLM simulado nos testes; cota atômica; saída validada; sem dados pessoais nem carteira no prompt), e `GET /catalog` (agora também com o `uuid` de cada ativo).
- **Frontend:** login com Google, conversas, chat com a tabela de indicadores e seletor manual, carteira (só o símbolo; nunca vai ao LLM), painel de estado dos dados com a idade do lote, exportação dos dados no navegador, aviso legal no rodapé de todas as telas e a rotina de backup. O navegador só formata os decimais, nunca calcula; `divergent` mostra os dois valores sem destacar nenhum.
- **Ponta a ponta (T21f):** 10 roteiros e 4 de captura com Playwright, contra o Supabase local e os handlers reais, e 44 capturas de tela em `docs/capturas/`. O job `e2e` da CI passou no pull request.

**O que não funciona ou não foi provado:**
- **Nenhum dado real foi coletado e nenhum LLM real foi chamado.** Nada foi testado contra brapi, Groq, Google OAuth ou Supabase hospedado. O formato das requisições à brapi e à Groq é uma hipótese: a documentação da brapi não pôde ser lida (P-16).
- **Sem a segunda fonte (T12, T13), nenhum campo real sai `verified` ou `divergent`.** Mesmo com ela, a metodologia dos indicadores (P-04) segue vazia, e a calibragem está ligada.
- **Leitor de tela real, Firefox e Safari:** não testados.

**O que falta para o uso real:** a P-01 (estrutura das páginas das fontes) e a P-04 (metodologia); confirmar o contrato da brapi (P-16); e a parte hospedada (T22a, T22b, T16, T17, T20, T24).

**Mudanças de processo nesta leva:**
- O revisor `revisor-tarefa` estava fixado no modelo `fable`, que ficou sem créditos de uso. O autor autorizou o **Opus 5.5** (`.claude/agents/revisor-tarefa.md`, `model: opus`). As revisões da T21c a T21f usaram esse modelo.
- A P-17 (calibragem da T14) e a P-21 (uuid dos ativos para a carteira) foram decididas pelo autor durante a execução.

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
| T21d | concluída | #27 |
| T21e | concluída | #26 |
| T21f | concluída | #28 |
| T23 | absorvida pela T21e (rotina de backup em `docs/tarefas/T21e.md`) | — |

Explicação de cada tarefa concluída: `docs/tarefas/Txx.md`.

## Bloqueios

Os detalhes estão em `docs/bloqueios.md`.
- **T12 e T13:** P-01, que depende do autor.
- **T06, T21a, T21c e T21d:** bloqueadas durante a leva e resolvidas; concluídas.

## Como conferir

Estes comandos valem para o estado de `fatia-acoes`.

| Comando | O que cobre |
| --- | --- |
| `bash scripts/ci/check_guardrails.sh` | regras da CI (segredos, `float`, fixtures, workflows) |
| `ruff check . && pytest` (Python 3.12, locks com hash) | coletor |
| `cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build` | front (257 testes) |
| `cd supabase/functions && deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost` | funções (250 testes) |
| `npx supabase db reset && npx supabase test db` | banco (271 testes) |
| `npm ci && npm run e2e` (Supabase local no ar; Chromium do Playwright) | 14 testes ponta a ponta |
| `python -m collector.cli run --mode fixtures` (Supabase local e `APP_ENV=local`) | publicação de um snapshot sintético |

## Pendências para o autor

Lista completa em `docs/pendencias.md`. As principais:
- **P-01 e P-04:** estrutura das páginas das fontes e metodologia dos indicadores, que liberam T12 e T13 e os selos reais.
- **P-16:** confirmar o contrato da brapi. Sugestão: renomear o ambiente `finance_agent (revisão de fontes)` (os parênteses impedem a migração da sessão) para o agente poder ler a documentação.
- **P-18, P-19 e P-20:** o frescor sem feriados e `LLM_DAILY_LIMIT` no README, o retry em timeout, e o acompanhamento de acessibilidade da T21c.
- **Parte hospedada:** a senha do papel `collector_ingest`, `supabase functions serve` com rede aberta, Google OAuth, T22a e T22b.
- Aviso das capturas `t21f-aviso-legal-*`: aparecem rolladas até o fim porque o app não volta a rolagem ao topo quando a rota muda (T21b e T21e); vale corrigir.

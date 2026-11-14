# Bloqueios encontrados na execução

Registro do que travou uma tarefa durante a execução autônoma (ADR 0002, E11). O orquestrador acrescenta uma entrada, marca a tarefa como `bloqueada` em `docs/status-tarefas.md` e passa para a próxima tarefa liberada.

Bloqueios que dependem só do autor e já eram conhecidos antes da execução estão em `docs/pendencias.md`, não aqui.

## Quando registrar

- O revisor reprovou a tarefa depois das rodadas de correção permitidas: duas, ou três quando restam no máximo 3 problemas com a correção já descrita e nenhum viola regra de dados ou de segurança.
- A CI falhou duas vezes seguidas no pull request da tarefa.
- O plano contradiz o repositório ou uma documentação externa.
- A tarefa exige segredo, painel de serviço ou acesso que o agente não tem.

## Formato de cada entrada

```markdown
### Txx — <nome da tarefa> (AAAA-MM-DD)

- **Motivo:** uma frase.
- **O que foi tentado:** lista curta.
- **Evidência:** comando e trecho da saída, ou link do pull request.
- **Estado do código:** branch e o que ficou feito.
- **O que destrava:** a ação ou decisão necessária, e de quem.
```

## Entradas

### T06 — Schema único de observação e validação (2026-11-14)

- **Motivo:** o revisor reprovou três vezes seguidas por divergências de aceitar/rejeitar entre os validadores Pydantic e Zod (objetivo D8), esgotando as duas rodadas de correção.
- **O que foi tentado:**
  - Rodada 1: dígitos Unicode, inteiros do manifesto, datas com ano menor que 100, regras entre campos de `FieldValidation`, URLs e default de `methodology_id`.
  - Rodada 2: o Zod lançava `SyntaxError` (BigInt) com decimal malformado dentro de `comparison`, e o host de URL divergia.
  - Terceira revisão: sem exceções do Zod e com hosts e decimais alinhados, mas sobram duas divergências.
- **Evidência:** revisão da rodada 3, sondas de paridade (73.000 e 12.742 casos). pytest 90 e deno test 89 passam, e `export_schemas` não gera diferença. Divergências restantes:
  1. Offset de fuso com minutos de 60 a 99 (`+02:60`): o Pydantic aceita e reescreve o instante, o Zod rejeita. Correção sugerida: em `_parse_datetime` (`collector/src/collector/contracts.py`), rejeitar hora de offset acima de 23 e minuto acima de 59 antes de `fromisoformat`, com exemplos `invalid-*` para `collected_at`, `reference_at` e o manifesto.
  2. Substituto UTF-16 isolado em campos `NonEmptyStr`: o Pydantic rejeita, o Zod aceita. Correção sugerida: `z.string().min(1).refine((s) => s.isWellFormed())`.
  3. `docs/tarefas/T06.md` com contagens desatualizadas (86 exemplos e 90 testes) e paridade afirmada sem citar as duas divergências acima.
- **Estado do código:** branch `tarefa/T06` no remoto (commit 865e2e8), sem pull request e sem merge. Implementação completa; faltam só as três correções acima.
- **Liberada em 2026-11-14:** o autor aprovou a terceira rodada de correção. A tarefa voltou a `em andamento` e deve ser retomada no branch `tarefa/T06`, corrigindo só os três pontos acima.
- **O que destrava:** uma nova sessão corrige os três pontos em `tarefa/T06`, roda de novo a sonda de paridade e pede revisão. Não depende de segredo nem de decisão de produto. Bloqueia T08 e T10 e, por consequência, T09, T11, T14, T15, T18, T18b, T19 e a cadeia do front que depende delas.

### T21a — Fundação do front e guia de design (2026-11-14)

- **Motivo:** o check do bundle (`scripts/ci/check_bundle.sh`) falha por falso positivo, e corrigir exige alterar um guarda de segredos da CI, o que o agente não pode decidir.
- **O que foi tentado:**
  - O executor concluiu a tarefa: `npm run lint`, `typecheck`, `test` (6 testes) e `build` passam, e os guardrails também.
  - O regex `sb_secret_` do script casa com o `@supabase/supabase-js` dentro do bundle, que traz esse texto literal numa checagem `startsWith('sb_secret_')`.
  - O executor tentou afrouxar o regex e o classificador de permissões negou. O orquestrador não contornou a negativa.
- **Evidência:** `npm run build` em `frontend/` seguido de `bash scripts/ci/check_bundle.sh frontend/dist` imprime `frontend/dist/assets/index-<hash>.js` e `::error::O bundle do frontend contém texto de chave privada`, com saída 1. A CI do front falharia nesse passo.
- **Estado do código:** branch `tarefa/T21a` no remoto (commit 48f7406), sem pull request e sem merge. Trabalho completo e sem revisão: o revisor não foi acionado, porque o merge é impossível com a CI falhando.
- **Liberada em 2026-11-14:** o autor aprovou a troca do regex e ela foi feita em `fatia-acoes`. A tarefa voltou a `em andamento`. Retome no branch `tarefa/T21a`: traga `fatia-acoes` para dentro dele, confira o check do bundle, peça a revisão e abra o pull request.
- **O que destrava:** decisão do autor sobre o guarda. A proposta é trocar `sb_secret_` por `sb_secret_[A-Za-z0-9_-]{20,}` em `scripts/ci/check_bundle.sh`, o mesmo padrão do `check_guardrails.sh`. Depois disso, abrir o PR de `tarefa/T21a`, rodar a revisão e a CI, e mesclar. Bloqueia T21b em diante (que já dependem da T08).

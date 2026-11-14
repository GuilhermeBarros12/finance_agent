# Bloqueios encontrados na execução

Registro do que travou uma tarefa durante a execução autônoma (ADR 0002, E11). O orquestrador acrescenta uma entrada, marca a tarefa como `bloqueada` em `docs/status-tarefas.md` e passa para a próxima tarefa liberada.

Bloqueios que dependem só do autor e já eram conhecidos antes da execução estão em `docs/pendencias.md`, não aqui.

## Quando registrar

- O revisor reprovou a tarefa duas vezes.
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
- **O que destrava:** uma nova sessão corrige os três pontos em `tarefa/T06`, roda de novo a sonda de paridade e pede revisão. Não depende de segredo nem de decisão de produto. Bloqueia T08 e T10 e, por consequência, T09, T11, T14, T15, T18, T18b, T19 e a cadeia do front que depende delas.

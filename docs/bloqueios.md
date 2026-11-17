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

### T21c — Chat, tabela de indicadores e seletor manual (2026-11-17)

- **Motivo:** o revisor não pôde rodar. O sub-agent `revisor-tarefa` está fixado no modelo mais forte (`model: fable`, E11) e a API respondeu duas vezes `Fable 5.2 requires usage credits` (HTTP 429, tipo `rate_limit`). Não é falha da tarefa.
- **O que foi tentado:** a revisão foi iniciada e retomada uma vez; as duas terminaram com o mesmo erro. O orquestrador não trocou o modelo do revisor: a escolha é do autor e rebaixaria a revisão da tela que mostra os números ao usuário.
- **Evidência:** erro de API `Fable 5.2 requires usage credits`, `request id req_011Ch8WLYmhjvfDLrxV5Z6pg`.
- **Estado do código:** branch `tarefa/T21c` no remoto (commit fbb9415), sem pull request. A implementação está completa e o executor relata `npm run lint`, `typecheck`, `test` (147 testes, 12 arquivos), `build`, `check_bundle.sh` e `check_guardrails.sh` com exit 0; o orquestrador reconferiu o `check_guardrails.sh` (exit 0) e que o código de produção não usa `Number(`, `parseFloat`, `toFixed`, `NumberFormat` nem `innerHTML`. **Nada foi revisado, e a CI ainda não rodou** (não há PR).
- **Resolvido em 2026-11-17:** o autor não repôs créditos e autorizou o Opus 5.5 como revisor. `.claude/agents/revisor-tarefa.md` passou de `model: fable` para `model: opus`, e a revisão da T21c foi retomada com esse modelo.
- **O que destravava:** o autor repõe créditos para o modelo do revisor (ou autoriza explicitamente outro modelo em `.claude/agents/revisor-tarefa.md`). Depois, `/executar-plano`: a T21c está `em revisão` e é retomada no branch `tarefa/T21c` direto no passo da revisão (passo 5 de `.claude/commands/tarefa.md`). Bloqueia T21d, T21e e T21f.
- **Pontos para o revisor** (levantados pelo orquestrador): `divergent` sem lado em destaque; nenhuma aritmética nem `float` em valor; HTML do backend sempre como texto; reutilização do `request_id`; as capturas de `docs/capturas/` cresceram para 3,6 MB (algumas com 420 KB e 5.380 px de altura, o pedido era "pequenas"); `limit` (e não `limit_value`) é a chave no payload.

### T21d — Carteira (2026-11-17)

- **Motivo:** o plano contradiz o backend. O front não consegue ler, mostrar nem montar a carteira com os contratos que existem. O `CLAUDE.md` manda parar e registrar nesse caso.
- **O que foi encontrado (o executor reportou e o orquestrador conferiu no código):**
  - `portfolio_items.asset_id` é `uuid`, com FK para `assets.id` (`supabase/migrations/20261114000002_private_data.sql`, linha 77). O grant de insert é só `(user_id, asset_id)`.
  - `GET /catalog` devolve `assets[].asset_id` como o **símbolo** (`DEMO3`), sem o uuid (`supabase/functions/catalog/types.ts`, `docs/api.md`).
  - O navegador não lê `assets`: a migration `20261114000003_rls_grants.sql` revoga tudo em `assets` de `anon` e `authenticated`, sem política.
  - Consequências: o seletor de "Adicionar" só conhece símbolos, e o insert exige o uuid (símbolo em coluna `uuid` dá erro `22P02`); a leitura de `portfolio_items` devolve uuids que o front não sabe traduzir em símbolo; não dá para saber quais ações já estão na carteira (passo 2) nem montar `selection.asset_ids` com símbolos, que é o que `/agent` exige (`^[A-Z0-9]{1,12}$`) no passo 5.
- **O que foi tentado:** o executor parou antes de implementar e não alterou nenhum arquivo. Inventar um contrato no front esconderia o problema.
- **Estado do código:** nada foi implementado. O branch `tarefa/T21d` no remoto só tem o commit "marca em andamento".
- **O que destrava (decisão do autor; a P-21 em `docs/pendencias.md` tem o resumo):**
  - **Opção A (a menor, recomendada pelo executor):** `GET /catalog` passa a devolver também `assets[].id` (o uuid de `assets.id`). Muda só a função `catalog` e `docs/api.md`. O front usa o uuid no insert e na leitura de `portfolio_items` e cruza com o catálogo para mostrar símbolo e nome; os `asset_ids` enviados a `/agent` continuam sendo símbolos. Não abre nenhuma tabela nova ao navegador. O uuid é um identificador, não um segredo.
  - **Opção B:** dar ao `authenticated` leitura de `assets (id, symbol)` por view ou política. Abre uma tabela de mercado ao navegador e muda a regra de acesso (D13/README 8.x). Não recomendada.
  - **Opção C:** função SQL `security invoker` ou RPC que devolva `portfolio_items` com o símbolo, mais o catálogo com uuid. Mais trabalho que a A.
- **Decisões de desenho já tomadas, para quando destravar:** o backend limita a `selection` a 20 ativos (`MAX_ASSETS = 20` em `supabase/functions/agent/request.ts`), então impedir adicionar além de 20, com aviso visível; reaproveitar `postAgent` e `errorView` da T21c e o `ConfirmDialog` da T21b; `createConversation` passa a devolver o id da conversa; se o envio falhar depois de criar a conversa, a conversa fica e o usuário reenvia de dentro dela.
- **Bloqueia:** a T21f (depende da T21d). A T21e não depende dela e segue.


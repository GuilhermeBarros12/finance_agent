---
description: Executa em sequência todas as tarefas liberadas do plano, sem supervisão, até não sobrar nenhuma
---

Você é o orquestrador da execução autônoma da fatia de ações (ADR 0002). Execute as tarefas do plano em sequência, uma atrás da outra, até não haver mais tarefa liberada. Ninguém está acompanhando: não faça perguntas ao autor e não espere resposta.

## Laço

Repita até a condição de parada:

1. `git fetch origin` e entre em `fatia-acoes` atualizado.
2. Leia `docs/status-tarefas.md` e a tabela da seção 4 de `docs/plano-execucao-fatia-acoes.md`.
3. Escolha a **próxima tarefa liberada**. Primeiro, qualquer tarefa `em andamento` ou `em revisão`: ela foi iniciada antes e deve ser retomada no branch `tarefa/Txx` existente. Senão, a primeira, na ordem sugerida da seção 4, que esteja `pendente` e cujas dependências estejam todas `concluída`. Pule as tarefas `bloqueada`, `fora da leva`, `absorvida` e as que dependem de uma tarefa bloqueada.
4. Execute-a seguindo exatamente os passos de `.claude/commands/tarefa.md`, com o ID no lugar de `$ARGUMENTS`.
5. Ao terminar (concluída ou bloqueada), volte ao passo 1. Não pare para relatar entre uma tarefa e outra.

## Condição de parada

Pare quando não existir nenhuma tarefa `pendente` com as dependências concluídas. Então:

- Execute a T25 (relatório final e pull request de `fatia-acoes` para `main`, sem merge). Se já existe um relatório de uma execução anterior, atualize-o em vez de criar outro. Se o pull request anterior de `fatia-acoes` para `main` ainda está aberto, ele se atualiza sozinho; se já foi mesclado ou fechado, abra um novo.
- Entregue um resumo final: tarefas concluídas, tarefas bloqueadas com o motivo, link do pull request para `main` e o que o autor precisa fazer (`docs/pendencias.md`).

## Regras

- Uma tarefa por vez. Não execute tarefas em paralelo: elas mexem nos mesmos arquivos de estado.
- Um bloqueio numa tarefa não para a execução. Registre em `docs/bloqueios.md` e siga.
- Pare a execução inteira só em três casos: o branch `fatia-acoes` não existe; a CI está quebrada no próprio `fatia-acoes` por um motivo que não é da tarefa atual e você não consegue corrigir em duas tentativas; ou três tarefas seguidas foram bloqueadas pelo mesmo motivo de ambiente (por exemplo, não há como instalar dependências). Nesses casos, registre o motivo em `docs/bloqueios.md` e encerre com o resumo.
- Nunca faça merge em `main`, nunca use segredos, nunca faça scraping real e nunca chame LLM real.
- Se esta sessão for reiniciada, recomece pelo passo 1: o estado está em `docs/status-tarefas.md`. Uma tarefa que ficou `em andamento` ou `em revisão` de uma sessão anterior deve ser retomada no branch `tarefa/Txx` existente, e não refeita do zero.

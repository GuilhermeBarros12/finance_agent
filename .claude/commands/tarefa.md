---
description: Executa uma tarefa do plano com sub-agents (executor ou pesquisador, depois revisor)
argument-hint: <ID da tarefa, por exemplo T05>
---

Execute a tarefa **$ARGUMENTS** de `docs/plano-execucao-fatia-acoes.md`. Você é o orquestrador: delega o trabalho e confere o resultado. Não implemente a tarefa você mesmo.

1. **Checar se pode começar.** Leia a seção da tarefa no plano e `docs/status-tarefas.md`. Se alguma tarefa de **Depende de** não estiver `concluída`, pare e diga qual falta. Se a tarefa for só **HUMANO**, mostre ao autor o que ele precisa fazer e pare.

2. **Preparar o branch.** Crie o branch `tarefa/$ARGUMENTS` a partir de `main` atualizada. Marque a tarefa como `em andamento` em `docs/status-tarefas.md`.

3. **Delegar a execução.**
   - `T01` e `T07`: use o sub-agent `pesquisador-fontes`.
   - As demais: use o sub-agent `executor-tarefa`.

   Passe o ID da tarefa e o nome do branch. Espere o relato.

4. **Delegar a revisão.** Para tarefas de código, use o sub-agent `revisor-tarefa`, passando o ID e o relato do executor.
   - Se o veredito for `reprovado`, devolva a lista de problemas ao `executor-tarefa` e peça nova revisão. Faça no máximo 2 rodadas de correção. Se ainda reprovar, pare e relate ao autor.

5. **Conferir você mesmo.** Rode `bash scripts/ci/check_guardrails.sh` e veja `git status`. Não repasse ao autor um resultado que você não conferiu.

6. **Entregar.** Envie o branch e abra um pull request para `main` com o título `$ARGUMENTS: <resumo>`, usando o modelo de `.github/pull_request_template.md`. A CI roda no pull request. Não faça merge: quem aprova é o autor.

7. **Relatar ao autor:** o que foi feito, o veredito do revisor, o link do pull request e as pendências que dependem dele.

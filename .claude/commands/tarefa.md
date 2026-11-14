---
description: Executa uma tarefa do plano com sub-agents (executor, depois revisor) e a entrega no branch fatia-acoes
argument-hint: <ID da tarefa, por exemplo T05>
---

Execute a tarefa **$ARGUMENTS** de `docs/plano-execucao-fatia-acoes.md`. Você é o orquestrador: delega o trabalho e confere o resultado. Não implemente a tarefa você mesmo.

Regras do fluxo: ADR 0002 (`docs/adr/0002-execucao-autonoma.md`), decisões E3 e E11.

1. **Atualizar.** `git fetch origin` e entre no branch `fatia-acoes` atualizado. Se ele não existir no remoto, pare e avise.

2. **Checar se pode começar.** Leia a seção da tarefa no plano e `docs/status-tarefas.md`.
   - Estado `concluída`, `fora da leva` ou `absorvida`: não há o que fazer. Diga isso e pare.
   - Estado `bloqueada`: confira em `docs/pendencias.md` e `docs/bloqueios.md` se o que destrava já foi resolvido. Se não foi, pare e diga o que falta.
   - Estado `em andamento` ou `em revisão`: a tarefa foi iniciada antes. Retome-a no branch existente, sem refazer do zero.
   - Alguma tarefa de **Depende de** não está `concluída`: pare e diga qual falta.

3. **Preparar o branch.** Se `tarefa/$ARGUMENTS` já existe no remoto, entre nele e faça o merge de `fatia-acoes` para dentro dele, para trazer correções feitas depois. Senão, crie-o a partir de `fatia-acoes`. Marque a tarefa como `em andamento` em `docs/status-tarefas.md` e faça commit. Numa retomada, leia a entrada da tarefa em `docs/bloqueios.md` e passe ao executor a lista do que falta.

4. **Delegar a execução** ao sub-agent `executor-tarefa`, passando o ID e o nome do branch. Espere o relato.

5. **Delegar a revisão** ao sub-agent `revisor-tarefa`, passando o ID, o branch e o relato do executor.
   - Se o veredito for `reprovado`, devolva a lista de problemas ao `executor-tarefa` e peça nova revisão.
   - No máximo 2 rodadas de correção.
   - **Terceira rodada, só em um caso:** se a revisão depois da segunda correção ainda reprovar, mas restarem no máximo 3 problemas, todos com a correção descrita pelo revisor e nenhum deles uma violação das regras de dados ou de segurança da seção 3 do plano, faça mais uma rodada.
   - Se ainda reprovar depois disso, ou se o caso acima não se aplicar, vá para o passo 9 (bloqueio).

6. **Conferir você mesmo.** Rode `bash scripts/ci/check_guardrails.sh` e veja `git status` e `git log fatia-acoes..HEAD --oneline`. Não repasse um resultado que você não conferiu.

7. **Abrir o pull request.** Envie o branch e abra um pull request de `tarefa/$ARGUMENTS` para **`fatia-acoes`** (nunca para `main`), com o título `$ARGUMENTS: <resumo>` e o corpo no modelo de `.github/pull_request_template.md`, incluindo o veredito do revisor.

8. **Esperar a CI e mesclar.** Consulte os checks do pull request até o check `CI ok` terminar.
   - `CI ok` com sucesso e revisor `aprovado`: faça o merge do pull request em `fatia-acoes`. Depois, em `fatia-acoes`, marque a tarefa como `concluída` com o link do pull request em `docs/status-tarefas.md`, faça commit e envie.
   - CI com falha: devolva o log da falha ao `executor-tarefa`, peça a correção e uma nova revisão. No máximo 2 tentativas. Se continuar falhando, vá para o passo 9.
   - Nunca faça merge com a CI em andamento, com falha, ou com o revisor reprovando.

9. **Bloqueio.** Se a tarefa travar (revisor reprovou as rodadas de correção permitidas, CI falhou duas vezes, o plano contradiz o repositório, ou a tarefa exige segredo, painel ou acesso que você não tem): acrescente uma entrada em `docs/bloqueios.md` no formato descrito lá, marque a tarefa como `bloqueada` em `docs/status-tarefas.md`, faça commit e envie para `fatia-acoes`. Deixe o branch `tarefa/$ARGUMENTS` no remoto, sem mesclar.

10. **Relatar:** o que foi feito, o veredito do revisor, o link do pull request, o estado final da tarefa e as pendências que dependem do autor.

Nunca faça merge em `main`. Nunca desative teste nem regra da CI para conseguir o merge.

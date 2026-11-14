# Estado das tarefas

Fonte única do andamento do plano em `docs/plano-execucao-fatia-acoes.md`. A versão que vale durante a execução autônoma é a do branch **`fatia-acoes`**.

Estados possíveis:

| Estado | Significado |
| --- | --- |
| `pendente` | Ainda não começou |
| `em andamento` | O executor está trabalhando |
| `em revisão` | Aguardando o revisor e a CI |
| `concluída` | Revisor aprovou, CI passou e o pull request foi mesclado em `fatia-acoes` |
| `bloqueada` | Travou. O motivo está em `docs/bloqueios.md` ou em `docs/pendencias.md` |
| `fora da leva` | Depende do autor e de serviços hospedados. Não entra na execução autônoma |

Quem muda o estado: o orquestrador marca `em andamento`, `concluída` e `bloqueada`; o executor marca `em revisão`.

| ID | Tarefa | Depende de | Estado | Pull request |
| --- | --- | --- | --- | --- |
| T01 | Revisar termos e `robots.txt` das fontes | — | concluída | [#2](https://github.com/GuilhermeBarros12/finance_agent/pull/2), [#4](https://github.com/GuilhermeBarros12/finance_agent/pull/4) |
| T02 | Licença MIT e proteção de segredos | — | concluída | [#6](https://github.com/GuilhermeBarros12/finance_agent/pull/6) |
| T03 | Atualizar o README com as decisões | — | concluída | [#7](https://github.com/GuilhermeBarros12/finance_agent/pull/7) |
| T04 | Escolher o universo de tickers | — | concluída | |
| T05 | Inicializar a estrutura do repositório | T02 | concluída | [#8](https://github.com/GuilhermeBarros12/finance_agent/pull/8) |
| T06 | Schema único de observação e validação | T05 | concluída | [#11](https://github.com/GuilhermeBarros12/finance_agent/pull/11) |
| T07 | Metodologia provisória dos campos | T05 | concluída | [#9](https://github.com/GuilhermeBarros12/finance_agent/pull/9) |
| T08 | Migrations do banco | T05, T06 | concluída | [#13](https://github.com/GuilhermeBarros12/finance_agent/pull/13) |
| T09 | RPC de publicação e papel dedicado | T08 | em andamento | |
| T10 | Base do coletor e normalização | T06 | concluída | [#14](https://github.com/GuilhermeBarros12/finance_agent/pull/14) |
| T11 | Adaptador brapi | T10 | pendente | |
| T12 | Adaptador Fundamentus | T07, T10 | bloqueada (P-01) | |
| T13 | Adaptador StatusInvest | T07, T10 | bloqueada (P-01) | |
| T14 | Validação por campo | T07, T10 | pendente | |
| T15 | Pipeline, CLI e publicação | T09, T11, T14 | pendente | |
| T16 | Workflow diário e alerta de idade | T15, T22a | fora da leva | |
| T17 | Experimento de calibragem das tolerâncias | T16 | fora da leva | |
| T18 | Edge Function do agente (modo determinístico) | T06, T08 | pendente | |
| T18b | Edge Function de catálogo e estado dos dados | T18 | pendente | |
| T19 | Classificador de intenção com LLM | T18 | pendente | |
| T20 | Avaliação dos modelos | T19 | fora da leva | |
| T21a | Fundação do front e guia de design | T05 | concluída | [#12](https://github.com/GuilhermeBarros12/finance_agent/pull/12) |
| T21b | Login e conversas | T21a, T08 | pendente | |
| T21c | Chat, tabela de indicadores e seletor manual | T21b, T18, T18b | pendente | |
| T21d | Carteira | T21c | pendente | |
| T21e | Estado dos dados, exportação e aviso legal | T21c | pendente | |
| T21f | Testes ponta a ponta e capturas de tela | T19, T21d, T21e | pendente | |
| T22a | Criar o projeto Supabase hospedado | T08, T09 | fora da leva | |
| T22b | Publicar funções e frontend | T19, T21f, T22a | fora da leva | |
| T23 | Exportação das conversas | — | absorvida pela T21e | |
| T24 | Conferência manual de aceite | T17, T22b | fora da leva | |
| T25 | Relatório final e pull request para `main` | todas as autônomas | pendente | |

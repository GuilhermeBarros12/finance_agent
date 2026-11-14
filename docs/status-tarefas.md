# Estado das tarefas

Fonte única do andamento do plano em `docs/plano-execucao-fatia-acoes.md`.

Estados possíveis: `pendente`, `em andamento`, `em revisão`, `aguardando autor`, `concluída`.

Quem muda o estado: o orquestrador marca `em andamento`; o executor marca `em revisão`; o pesquisador marca `aguardando autor`; o revisor ou o autor marca `concluída`.

| ID | Tarefa | Depende de | Estado | Pull request |
| --- | --- | --- | --- | --- |
| T01 | Revisar termos e `robots.txt` das fontes | — | aguardando autor | [#2](https://github.com/GuilhermeBarros12/finance_agent/pull/2) |
| T02 | Licença MIT e proteção de segredos | — | pendente | |
| T03 | Atualizar o README com as decisões | — | pendente | |
| T04 | Escolher o universo de tickers | — | pendente | |
| T05 | Inicializar a estrutura do repositório | T02 | pendente | |
| T06 | Schema único de observação e validação | T05 | pendente | |
| T07 | Homologar a metodologia dos campos | T01 | pendente | |
| T08 | Migrations do banco | T05, T06 | pendente | |
| T09 | RPC de publicação e papel dedicado | T08 | pendente | |
| T10 | Base do coletor e normalização | T06 | pendente | |
| T11 | Adaptador brapi | T10 | pendente | |
| T12 | Adaptador Fundamentus | T01, T07, T10 | pendente | |
| T13 | Adaptador StatusInvest | T01, T07, T10 | pendente | |
| T14 | Validação por campo | T07, T10 | pendente | |
| T15 | Pipeline, CLI e publicação | T09, T11, T12, T13, T14 | pendente | |
| T16 | Workflow diário e alerta de idade | T15, T22a | pendente | |
| T17 | Experimento de calibragem das tolerâncias | T16 | pendente | |
| T18 | Edge Function do agente (modo determinístico) | T06, T08 | pendente | |
| T19 | Classificador de intenção com LLM | T18 | pendente | |
| T20 | Avaliação dos modelos | T19 | pendente | |
| T21 | Frontend mínimo | T18 | pendente | |
| T22a | Criar o projeto Supabase hospedado | T08, T09 | pendente | |
| T22b | Publicar funções e frontend | T19, T21, T22a | pendente | |
| T23 | Exportação periódica das conversas | T22a | pendente | |
| T24 | Conferência manual de aceite | T17, T22b | pendente | |

# ADR 0002 — Execução autônoma da fatia de ações

- **Data:** 2026-11-14
- **Estado:** aceito pelo autor do projeto
- **Origem:** segunda sessão de sabatina, sobre deixar um modelo executando o plano sem supervisão
- **Complementa:** [`0001-primeira-fatia-acoes.md`](0001-primeira-fatia-acoes.md). Onde os dois divergem, vale este.
- **Plano de execução:** [`docs/plano-execucao-fatia-acoes.md`](../plano-execucao-fatia-acoes.md)
- **Pendências do autor:** [`docs/pendencias.md`](../pendencias.md)

## Contexto

O ADR 0001 definiu a primeira fatia. O plano resultante parava em cada tarefa à espera do merge do autor, e algumas tarefas dependiam de coisas que um agente em nuvem não alcança: os sites das fontes respondem `403`, e a parte hospedada exige painel e segredos.

O autor quer deixar um modelo executando o plano em sequência, com o back e o front da fatia completos ao final. Este ADR registra as decisões que tornam isso possível e as que ampliam o escopo do front.

## Decisões

| # | Decisão | Escolha | Motivo | Consequência |
| --- | --- | --- | --- | --- |
| E1 | Escopo da leva autônoma | A fatia de ações inteira, back e front | Validar a base antes de replicar (D1) | FIIs, ETFs, Tesouro e PDF ficam para depois |
| E2 | Limite da autonomia | Tudo funcionando em ambiente local, com Supabase local, dados sintéticos e LLM simulado | É o que roda sem segredo nem painel | A parte hospedada (projeto Supabase, segredos, deploy, coleta real, calibragem, avaliação de modelos, conferência manual) continua com o autor |
| E3 | Merge | Branch de integração `fatia-acoes`. Cada tarefa vira um pull request para esse branch, e o orquestrador faz o merge quando a CI e o revisor aprovam | Manter a `main` protegida sem parar a cada tarefa | O autor revisa um único pull request de `fatia-acoes` para `main` no final |
| E4 | Bloqueio dos sites | Um teste mínimo no GitHub Actions, disparado à mão, antes de investir nos parsers | Só o resultado responde | Experimento pendente |
| E5 | Estrutura das páginas | O autor fornece o cabeçalho e uma linha de exemplo das páginas do Fundamentus e do StatusInvest | O agente em nuvem recebe `403` | T12 e T13 ficam bloqueadas até lá |
| E6 | Universo | PETR4, VALE3, ITUB4, BBDC4, BBAS3, ABEV3, WEGE3, RENT3, SUZB3, EQTL3, RADL3, B3SA3 | Setores variados; três bancos para exercitar divergência | T04 concluída. Os símbolos são configuração, não recomendação |
| E7 | Metodologia provisória | `config/methodologies.yaml` com os quatro indicadores em "metadados insuficientes" até o autor ler os sites e preencher | D2: sem homologação não há `verified` | Com dados reais, os campos aparecem como `incomparable` até lá |
| E8 | Biblioteca de interface | Tailwind CSS e componentes shadcn/ui | Telas consistentes sem supervisão | Mais dependências |
| E9 | Telas | Login, conversas, chat, seletor manual, carteira, estado dos dados, exportação e aviso legal. Layout para celular e tema claro e escuro | Pedido do autor | Substitui a "interface mínima" da D17. Continuam fora: Realtime, atualização otimista e PDF |
| E10 | Visual | Sem maquete prévia. O executor segue a skill `frontend-design`, instalada em `.claude/skills/`, e o autor valida depois por capturas de tela | Preferência do autor | Risco de retrabalho visual |
| E11 | Regras de parada | Tarefa que trava é anotada em `docs/bloqueios.md` e o orquestrador passa para a próxima tarefa liberada | Não perder a execução por um detalhe | Bloqueios podem se acumular |
| E12 | Modelos | Sonnet executa e orquestra. Fable 5.2 revisa. Os modelos ficam fixados nos arquivos dos sub-agents | Custo no volume, rigor na barreira | O autor não troca modelo à mão |
| E13 | Se o teste de bloqueio der `403` | Decidir depois do resultado | Sem escolha claramente melhor | Pendente |
| E14 | Carteira e universo | A carteira só aceita ações do universo coletado, por enquanto | A interface não dispara coleta (README 6.3) | Ação nova exige editar `config/universe.yaml` |
| E15 | Atualizar carteira | Um botão gera, numa conversa, a tabela dos cinco campos de todas as ações da carteira, sem LLM | Mesmo caminho do seletor manual (D5) | A resposta é só a tabela |
| E16 | Privacidade da carteira | Tabela privada com RLS de dono. Nunca é enviada ao LLM. Entra na exportação e é apagada com a conta | README 18.2 | "Compare as minhas ações" não funciona por texto |
| E17 | Ritmo | Execução em sequência, uma tarefa atrás da outra, numa sessão contínua | Preferência do autor | Substitui a ideia de disparo de hora em hora. Se a sessão cair, basta reiniciar: o estado fica em `docs/status-tarefas.md` |
| E18 | Arquitetura do front | Pastas por funcionalidade, React Router, TanStack Query, sem biblioteca de estado global | Segue o README 11 | Duas dependências a mais |
| E19 | Documentação | `docs/data-dictionary.md`, `docs/api.md`, `docs/architecture/visao-geral.md` e uma explicação por tarefa em `docs/tarefas/Txx.md` | Entender depois o que foi feito e por quê | Não há guia de instalação local |
| E20 | Entrega | Um pull request de `fatia-acoes` para `main`, com `docs/relatorio-execucao.md` e capturas de tela de cada tela | Tornar a E3 revisável | — |

## Nota sobre a carteira (E14 a E16)

O README diz, na seção 1, que o projeto "não é um gestor de carteira" e que a v1 não guarda posição de custódia. A carteira desta fatia é só uma lista de símbolos, sem quantidade, preço ou valor. Ela não calcula patrimônio nem rentabilidade. Qualquer passo além disso exige nova decisão.

## Nota sobre as fontes

Em 2026-11-14 o autor habilitou as três fontes (`docs/source-methodologies/permissoes.md`, seção 5). Fundamentus e StatusInvest continuam com permissão `indefinida` e foram habilitadas por conta e risco do autor. As regras de coleta não mudam: diante de `403` ou CAPTCHA, a fonte é suspensa no lote, sem tentativa de contorno.

## O que a leva autônoma não faz

- Não cria projeto hospedado, não cadastra segredo e não faz deploy.
- Não faz scraping real nem chama LLM real.
- Não faz merge em `main`.
- Não decide a E13 nem preenche a metodologia (E7) no lugar do autor.

# ADR 0001 — Primeira fatia vertical: ações

- **Data:** 2026-11-14
- **Estado:** aceito pelo autor do projeto
- **Origem:** sessão de sabatina sobre as decisões de arquitetura do `README.md`
- **Plano de execução:** [`docs/plano-execucao-fatia-acoes.md`](../plano-execucao-fatia-acoes.md)

## Contexto

O `README.md` é uma especificação. Na data deste registro o repositório não tem código. A v1 descrita lá cobre quatro classes de ativos, três fontes, login multiusuário, RLS, conversas, relatório em PDF e LLM com fallback, com 21 critérios de aceite e nenhuma medição.

Este ADR registra as decisões que reduzem esse escopo a uma primeira fatia que pode ser construída e testada. **Onde este ADR e o `README.md` divergem, vale este ADR**, até o README ser atualizado (tarefa T03 do plano).

## Decisões

| # | Decisão | Escolha | Motivo | Consequência |
| --- | --- | --- | --- | --- |
| D1 | Ordem de construção | Fatia vertical só de **ações**, de ponta a ponta: coleta, validação, snapshot, backend e chat | Validar o contrato de observação e a publicação antes de replicar para outras classes | FIIs, ETFs, Tesouro e PDF são fatias seguintes |
| D2 | Quando vale `verified` | Só quando a origem primária (`upstream_source`) e a metodologia do campo estiverem homologadas nas duas fontes | Dois scrapers concordando não provam correção | Menos campos `verified` no início |
| D3 | Termos de uso das fontes | Ler termos e `robots.txt` de Fundamentus e StatusInvest **antes** de escrever qualquer parser | Evita descartar parser, fixtures e testes | Bloqueia as tarefas de adaptador até a revisão terminar |
| D4 | Papel do LLM | Só classifica a intenção da pergunta e devolve um JSON fechado, validado por schema. Não redige texto, não fornece números nem URLs | Reduz consumo de cota e risco de número inventado | Respostas são tabelas e textos determinísticos |
| D5 | Falha do LLM | Se o JSON for inválido, a cota acabar ou o provedor falhar, a interface oferece um **seletor manual** de tickers e indicadores | A consulta nunca fica bloqueada por cota | Na falha, o usuário clica em vez de escrever |
| D6 | Segundo modelo | Não há fallback de LLM na primeira fatia. **O Gemini não é o fallback presumido.** O segundo provedor será escolhido por teste | O Gemini falhou em outro projeto do autor | O README precisa ser corrigido nas seções 4, 5, 9 e 12.3 |
| D7 | Usuários | Usuário único (o autor) agora; expansão para mais pessoas depois | Projeto pessoal | `user_id` e FKs de dono existem desde o início. Ver a nota de segurança abaixo |
| D8 | Contrato entre Python e TypeScript | Um schema único como fonte da verdade, com testes de contrato nos dois lados | Evita divergência silenciosa entre coletor e aplicação | Uma etapa de geração no build |
| D9 | Escopo de dados | Cotação, P/VP, P/L, DY e ROE; universo de 10 a 20 tickers escolhidos pelo autor | Cabe com folga na cota gratuita da brapi | Pouca variedade de ativos |
| D10 | Backup | Banco tratado como reconstruível. Só as conversas têm exportação periódica | Dado de mercado pode ser recoletado | Histórico de snapshots se perde numa falha do banco |
| D11 | Retenção | Snapshots por 30 dias. Sem série histórica de indicadores | Já previsto como backlog no README | Não há consulta "como estava há 2 semanas" |
| D12 | Ticker que falha no lote | Entra no snapshot como `missing`, com o motivo. **Não** carrega o valor do dia anterior | Não misturar datas-base num snapshot que se apresenta como consistente | Lacuna visível; a interface mostra o manifesto, por exemplo "19 de 20" |
| D13 | Credencial do coletor | Papel de banco dedicado, que só pode executar a RPC de publicação. A chave `service_role` não vai para os secrets do GitHub | `service_role` ignora RLS e daria acesso às conversas | Mais configuração de grants; a RPC precisa de teste pgTAP |
| D14 | Visibilidade do repositório | Público desde o início | Preferência do autor; runners gratuitos | Fixtures sintéticas, secret scanning ativo, alerta de idade do último lote |
| D15 | Teste de aceitação | O sistema traz os dados e compara as duas fontes; o autor confere uma bateria de casos à mão | Critério do autor | Só prova a detecção de divergência se algum caso divergir de verdade |
| D16 | Idempotência | Tabela `request_runs` mantida. Contador de uso do LLM é global, não por usuário | Evita mensagem duplicada; a cota da Groq é compartilhada | Contador por usuário entra junto com o multiusuário |
| D17 | Interface | Mínima: login, lista de conversas, caixa de pergunta, tabela com fontes e alertas. Sem Realtime, sem atualização otimista, sem PDF | Menos código antes de validar a ideia central | Experiência mais seca |
| D18 | Licença | MIT | Já proposta no README | Reuso livre, inclusive comercial |
| D19 | Exibição dos estados | `divergent`: os dois valores lado a lado, com diferença e limite, sem valor em destaque. `verified`: valor do Fundamentus em destaque, StatusInvest acessível no detalhe | Segue as seções 7.6 e 6.1 do README | A prioridade é convenção de interface, não certificação da fonte |
| D20 | Horário do lote e validade | Lote em dias úteis, à noite, depois do fechamento. `stale` com mais de 1 dia útil; `expired` com mais de 5 dias úteis | Evita misturar preço intradiário com fechamento | Valores configuráveis. Substituem as 36 horas e os 7 dias da seção 12.6 do README |
| D21 | Formato da resposta gravada | Cada resposta é gravada como dados estruturados (seções que apontam para IDs de evidência), com uma cópia das evidências na própria mensagem | Sobrevive à limpeza de snapshots; o PDF futuro reaproveita a estrutura | O formato precisa de número de versão |

## Nota de segurança sobre a D7

A aplicação fica hospedada na internet. "Usuário único" não dispensa controle de acesso: sem ele, qualquer pessoa com conta Google poderia entrar e consumir a cota do LLM. Por isso a primeira fatia mantém o mínimo:

- Google OAuth como login (decisão já registrada no README).
- Uma lista de permissão com uma única linha (o autor).
- Políticas RLS simples de "dono lê e escreve o que é seu" nas tabelas privadas.

O que fica adiado para o multiusuário é a gestão de convites, os limites por usuário e a bateria de testes de isolamento com duas contas.

## Decisões do README que continuam valendo, mas fora desta fatia

Tesouro via CSV oficial, `pdf-lib` em Deno, `single_source` para FFO yield, cap rate e vacância, e ETFs na v1. Nenhuma foi reaberta.

## Premissas em aberto

- A conferência manual (D15) só prova a detecção de divergência se houver pelo menos um caso em que as fontes discordem.
- Os limites de 1 e 5 dias úteis (D20) são um ponto de partida sem medição.
- Se a revisão de termos (D3) vetar uma fonte, D2 e a calibragem das tolerâncias precisam ser revistas.

## Experimentos pendentes

1. Benchmark de CPU do `pdf-lib` em Edge Function hospedada. Os limites de 10 ativos e 15 páginas ficam indefinidos até lá.
2. Duas semanas de coleta em modo só observação, para calibrar `atol` e `rtol`.
3. Avaliação do `openai/gpt-oss-120b` e do candidato a segundo provedor.

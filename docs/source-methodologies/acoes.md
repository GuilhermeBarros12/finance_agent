# Metodologia dos campos de ações (T07)

Data da pesquisa: 2026-11-14. Pesquisador: agente de código. Aprovação final: HUMANO (seção 6).

Objetivo (plano T07, decisão D2): documentar, campo a campo, se Fundamentus e StatusInvest medem a mesma coisa. Cotação (`quote_price`) vem da brapi.

## 1. Resultado da pesquisa e limitação

**Nenhuma página oficial das fontes pôde ser lida nesta sessão.** Todas as tentativas de abrir as páginas de metodologia falharam na resolução de DNS, antes de qualquer resposta HTTP. Isso é uma limitação do ambiente de execução, não uma resposta das fontes.

| URL tentada | Data | Resultado |
| --- | --- | --- |
| `https://www.fundamentus.com.br/resultado.php` | 2026-11-14 | `getaddrinfo ENOTFOUND www.fundamentus.com.br` (host fora da lista de domínios permitidos da sessão) |
| `https://statusinvest.com.br/termos/r/roe` | 2026-11-14 | `getaddrinfo ENOTFOUND statusinvest.com.br` |
| `https://statusinvest.com.br/termos/p/p-l` | 2026-11-14 | idem |
| `https://statusinvest.com.br/termos/?p=354` | 2026-11-14 | idem |
| `https://brapi.dev/docs/acoes` | 2026-11-14 | `getaddrinfo ENOTFOUND brapi.dev` |

Nenhum bloqueio foi contornado. Não houve scraping.

Duas buscas na web (2026-11-14) não localizaram nenhuma página de metodologia do Fundamentus. Para o StatusInvest apareceram apenas glossários genéricos (`statusinvest.com.br/termos/...`) e artigos de terceiros. O resumo devolvido pela busca não é transcrição literal das páginas e **não é evidência de metodologia**: por isso não há aspas de fonte neste documento. Artigos de terceiros (brapi blog, Suno, B3 etc.) descrevem as fórmulas escolares (por exemplo P/L = preço / lucro por ação), que não dizem qual janela, base contábil ou origem as fontes usam de fato.

Conclusão minha: sem texto lido das duas fontes, nenhum item exigido pelos passos 1 a 3 do plano está comprovado. Pelo critério do plano e do README 7.3 ("Se a fonte não informar elementos suficientes para demonstrar comparabilidade, registrar `incomparable` ou `unknown_metadata`"), o veredito de todos os campos é `metadados insuficientes`.

## 2. Veredito por campo

| Campo | Fundamentus: definição, janela, base, unidade | StatusInvest: definição, janela, base, unidade | Origem primária | Data-base informada? | Veredito | `methodology_id` Fundamentus | `methodology_id` StatusInvest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `price_to_book` | não encontrado | não encontrado | não encontrado | não encontrado | `metadados insuficientes` | `unknown` | `unknown` |
| `price_to_earnings` | não encontrado | não encontrado | não encontrado | não encontrado | `metadados insuficientes` | `unknown` | `unknown` |
| `dividend_yield` | não encontrado | não encontrado | não encontrado | não encontrado | `metadados insuficientes` | `unknown` | `unknown` |
| `roe` | não encontrado | não encontrado | não encontrado | não encontrado | `metadados insuficientes` | `unknown` | `unknown` |
| `quote_price` | n/a (fonte de cotação é a brapi) | n/a | não encontrado | não encontrado | `metadados insuficientes` | n/a | n/a (brapi: `unknown`) |

Nota sobre `methodology_id`: o README 7.1 prevê `unknown` quando a metodologia é ausente. Quando o autor ou um agente ler as páginas, os identificadores propostos seguem o padrão do plano, por exemplo `pvp_fundamentus`, `pvp_statusinvest`, `pl_fundamentus`, `pl_statusinvest`, `dy_ttm_fundamentus` (só se a janela for confirmada), `dy_ttm_statusinvest`, `roe_fundamentus`, `roe_statusinvest`. Não os use antes da confirmação.

## 3. Consequência para o sistema (conclusão minha, derivada do plano)

Conforme o plano (T07, "Consequência por veredito") e D2, `metadados insuficientes` produz `incomparable` com motivo `unknown_metadata`. Enquanto o veredito ficar assim:

- Nenhum dos quatro indicadores pode chegar a `verified` ou `divergent`.
- Com as duas fontes presentes, o estado do campo será `incomparable`, com os dois valores visíveis e o motivo.
- A T17 (calibragem) não teria o que calibrar. Isso muda o objetivo da fatia (D15 exige ao menos um `divergent` real) e precisa de decisão do autor.
- A T14 pode ser construída com a tabela de vereditos como configuração, para o estado mudar quando um campo for homologado.

## 4. Pontos de atenção para a leitura das páginas (perguntas, não afirmações)

Estes pontos vêm do README 7.3 e são o que a leitura deve responder, por campo e por fonte:

1. `dividend_yield`: a janela é doze meses, último dividendo anualizado ou outro? O numerador inclui JCP bruto ou líquido? O preço é o do dia?
2. `roe`: patrimônio final ou médio? Lucro dos últimos doze meses ou do último exercício? A fonte trata bancos de forma diferente?
3. `price_to_earnings`: lucro dos últimos doze meses ou último exercício? Como trata prejuízo (valor negativo, vazio ou `-`)?
4. `price_to_book`: usa patrimônio líquido do último balanço trimestral? Qual a data do balanço?
5. Em todos: a página mostra a data-base do indicador ou só a data de atualização do preço? O dado vem das demonstrações enviadas à CVM ou de terceiro?
6. `quote_price`: a brapi informa o instante da cotação e a moeda; confirmar também o atraso (o `/pricing` registrado em `permissoes.md` cita atualização a cada 30 minutos no plano gratuito, ver T01) e comparar com o fechamento, dado que o lote roda à noite (D20).

## 5. Pendências para fechar a tarefa

- Liberar os domínios `www.fundamentus.com.br`, `statusinvest.com.br` e `brapi.dev` nas configurações de rede da sessão do agente, para ele repetir a leitura das páginas de metodologia; ou
- o autor ler as páginas num navegador e transcrever aqui, por campo e fonte, a fórmula, a janela, a base contábil, a origem e a data-base, com URL e data.

## 6. Aprovação do autor

Preencher. Enquanto estiver em branco, a T07 permanece `aguardando autor` e as T12, T13 e T14 não devem assumir nenhum campo como `comparável`.

- [ ] `price_to_book`: aprovo o veredito `metadados insuficientes` ( ) sim ( ) não, veredito do autor: ______
- [ ] `price_to_earnings`: idem
- [ ] `dividend_yield`: idem
- [ ] `roe`: idem
- [ ] `quote_price`: idem

Data da aprovação: ______

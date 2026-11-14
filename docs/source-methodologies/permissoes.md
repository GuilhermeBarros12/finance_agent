# Permissões de coleta por fonte (T01)

Data da revisão: 2026-11-14. Revisor: agente de código, a partir de consultas HTTP a partir do ambiente de execução. Decisão final: HUMANO (seção 5).

Critério (plano, T01 e D3): `permitida` só quando há texto explícito que autoriza a coleta automatizada ou o uso pretendido. Ausência de proibição **não** conta. `proibida` quando há vedação explícita, por termos ou por `robots.txt`. `indefinida` em todos os outros casos, inclusive quando a fonte não pôde ser consultada.

Regras do próprio projeto que se aplicam aqui (README 18.3): um `403` ou um desafio de bot não é convite para proxy, troca de cabeçalho ou outro mecanismo de evasão. Esta revisão não contornou nenhum bloqueio.

## Resumo

| Fonte | `base_url` | Conclusão | Motivo principal |
| --- | --- | --- | --- |
| Fundamentus (indicadores de ações) | `https://www.fundamentus.com.br` | `indefinida` | `robots.txt` e página inicial respondem `403` ao agente. Termos não lidos. |
| StatusInvest (indicadores de ações) | `https://statusinvest.com.br` | `indefinida` | `robots.txt` e página de termos retornam desafio Cloudflare (`Attention Required!`, HTTP 403). Termos não lidos. |
| brapi (cotações) | `https://brapi.dev` | `indefinida` | Termos permitem uso da API com token dentro do plano, mas `robots.txt` bloqueia `/api/` para todos os user agents. Conflito a ser decidido pelo autor. |

Nenhuma fonte foi concluída como `permitida` nesta revisão. Consequência para o plano: T12 (Fundamentus) e T13 (StatusInvest) continuam bloqueadas, e T07 e T14 dependem de duas fontes permitidas para `verified` e `divergent`.

## 1. Fundamentus

- **URLs consultadas:**
  - `https://www.fundamentus.com.br/robots.txt`: HTTP 403 (servidor LiteSpeed/CyberPanel, página de erro própria do servidor).
  - `https://www.fundamentus.com.br/`: não consultada com sucesso. Na tentativa anterior, o domínio não resolvia no ambiente; após a liberação do host, o `robots.txt` respondeu 403.
  - `https://www.fundamentus.com.br/resultado.php` (tabela de ações, ponto de entrada do README 6.1): não consultada.
- **Data da consulta:** 2026-11-14.
- **Trechos citados:** nenhum. Não foi possível ler `robots.txt` nem termos.
- **Permitido / proibido / omisso:** não determinado. Não há como afirmar.
- **Login, CAPTCHA ou bloqueio:** o `robots.txt` retorna 403 para o agente. Esta revisão não sabe se o bloqueio é para todos os clientes ou específico deste ambiente, e não tentou contorná-lo.
- **Conclusão:** `indefinida`.
- **Pendência:** o autor pode consultar `robots.txt` e os termos a partir de um navegador comum, registrar aqui o resultado e então decidir.

## 2. StatusInvest

- **URLs consultadas:**
  - `https://statusinvest.com.br/robots.txt`: HTTP 403, servido pela Cloudflare com a página `Attention Required! | Cloudflare`.
  - `https://statusinvest.com.br/condicoes-de-uso` (página de termos citada no README 18.3 e na seção 25): HTTP 403, mesmo desafio Cloudflare.
- **Data da consulta:** 2026-11-14.
- **Trechos citados:** nenhum. Os termos não foram lidos.
- **Permitido / proibido / omisso:** não determinado.
- **Login, CAPTCHA ou bloqueio:** desafio de bot da Cloudflare em todas as páginas consultadas. Pelas regras do projeto, a coleta não pode prosseguir enquanto houver esse bloqueio. T13 prevê suspensão da fonte no lote diante de `403` ou CAPTCHA.
- **Conclusão:** `indefinida`.
- **Pendência:** ler `https://statusinvest.com.br/condicoes-de-uso` num navegador comum e transcrever os trechos sobre automação, robôs, extração, reprodução e redistribuição. Esse texto é o que o README 18.3 pede para analisar, e aplica-se também ao Fundamentus e à brapi.

## 3. brapi

- **URLs consultadas:**
  - `https://brapi.dev/robots.txt`: HTTP 200.
  - `https://brapi.dev/pricing`: HTTP 200.
  - `https://brapi.dev/terms-of-use` (Termos de uso): HTTP 200.
- **Data da consulta:** 2026-11-14.
- **Trechos citados literalmente (Termos de uso, seção 2, "Uso da API e Licença"):**
  - "A brapi.dev concede a você uma licença limitada, não exclusiva, intransferível e revogável para acessar e usar nossa API e os Dados, estritamente de acordo com estes Termos e com os limites do seu plano de assinatura (Gratuito, Startup ou Pro)."
  - "Sob esta licença, você **não pode**: 1. Revender, redistribuir ou sublicenciar os Dados ou o acesso à API para terceiros. ... Exceder os limites de requisições, profundidade de dados ou outras restrições estabelecidas pelo seu plano de assinatura."
  - Seção 3: para acessar a maioria dos serviços é preciso "obter uma chave de API (token)".
  - Seção 4: os dados são fornecidos "como estão" e "NÃO CONSTITUEM ACONSELHAMENTO FINANCEIRO, DE INVESTIMENTO, JURÍDICO OU DE QUALQUER OUTRA NATUREZA".
- **Trechos citados literalmente (página de planos, `/pricing`):**
  - "Posso usar a BRAPI em um produto comercial? Sim. Os planos pagos são desenhados para apps, fintechs, portais, análises e automações em produção. Consulte os termos de uso e fale com o suporte se o seu caso exigir condições específicas."
  - "Existe limite de requisições por segundo ou por minuto? Os planos Gratuito, Startup e Pro não têm limite por segundo ou por minuto ... O que a API aplica é a cota mensal do plano e o limite de requisições simultâneas: 1 no Gratuito, 4 no Startup e 16 no Pro."
  - Cotas mensais: Gratuito 15.000 requisições; Startup 150.000; Pro 500.000. Cotações atualizadas a cada 30 min (Gratuito), 15 min (Startup) e 5 min (Pro).
- **Robots.txt:** para `User-agent: *`, há `Allow: /`, mas também `Disallow: /api/`, `Disallow: /dashboard`, `Disallow: /login` e `Disallow: /oauth/`. Para `Googlebot` há `Crawl-delay: 2`. Não há bloco específico para agentes de coleta.
- **Permitido:** uso da API com token, dentro da cota do plano, sem revenda, redistribuição ou sublicença dos dados.
- **Proibido:** revenda, redistribuição e sublicença; exceder o plano.
- **Omisso ou em conflito:**
  - O `robots.txt` proíbe `/api/` a todos os bots. A API de cotações é justamente esse caminho. Os termos licenciam o uso da API; o `robots.txt` diz o oposto para rastreadores. A relação entre os dois não está esclarecida.
  - Os termos não tratam de atribuição (o `robots.txt` e o HTML marcam "model-attribution-required" e "data-sources: CVM,BCB", mas esses metadados não são cláusula contratual).
  - A cláusula de termos de uso ("Consulte os termos ... se o seu caso exigir condições específicas") deixa margem para a finalidade comercial de uma aplicação pessoal, que é o caso do projeto.
- **Conclusão:** `indefinida`. A licença de API é explícita, por isso não é caso de ausência de proibição. Mas o `robots.txt` veda `/api/` a todos os user agents, e a finalidade (coleta periódica para cruzamento) não foi confirmada pela brapi. A decisão cabe ao autor, que pode pedir confirmação por escrito à brapi.
- **Observação técnica:** o README e a T11 usam `GET https://brapi.dev/api/v2/stocks/quote`. Esse caminho cai na regra `Disallow: /api/`. Em si, isso não é uma proibição de uso da API com token, mas precisa estar na decisão do autor.

## 4. Análise aplicável às três fontes (README 18.3)

- **Limites propostos para `config/sources.yaml`:** valores iniciais conservadores, para revisão do autor. Não são permissão.
  - Fundamentus: 2 requisições por minuto (uma página por lote, conforme T12).
  - StatusInvest: 2 requisições por minuto (uma página por ativo, conforme T13).
  - brapi: 10 requisições por minuto, dentro da cota mensal do plano e do limite de simultâneas.
- **Identificação:** o `User-Agent` com contato vem de `SCRAPER_CONTACT` (T10). Não há contato definido nesta revisão.
- **Campos e frequência:** a definir após T07 (homologação da metodologia).

## 5. Decisão do autor

Preencher por fonte. Enquanto esta seção estiver em branco, `enabled` continua `false` para todas.

- [ ] Fundamentus: habilitar? ( ) sim ( ) não. Resultado da leitura de `robots.txt` e termos: ________
- [ ] StatusInvest: habilitar? ( ) sim ( ) não. Resultado da leitura de `condicoes-de-uso`: ________
- [ ] brapi: habilitar? ( ) sim ( ) não. Confirmação do conflito com `Disallow: /api/`: ________

Data da decisão: ________

Se alguma fonte for vetada, a validação cruzada perde a segunda fonte. Nesse caso, D2 e a calibragem da T17 devem ser revistas com o autor (plano, T01).

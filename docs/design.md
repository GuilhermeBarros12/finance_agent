# Guia de design

Escrito na T21a, seguindo a skill `frontend-design` em duas passadas (plano, revisão do plano, construção). As telas das tarefas T21b a T21f usam estes tokens e não inventam valores novos.

## Assunto e público

Uma pessoa conferindo indicadores de ações (preço/lucro, dividend yield, valor de mercado e similares) com atenção à origem do dado. O trabalho principal da tela é responder: "este número veio de onde, de quando, e as duas fontes concordam?". O visual vem do vocabulário da conferência contábil: caderno de lançamentos, carimbo de conferido, margem com anotações. Não é um painel de corretora (sem verde/vermelho de alta/baixa, sem gráficos chamativos).

## Plano (primeira passada) e revisão

Plano inicial: fundo creme, serifada de alto contraste, acento terracota. Revisão: isso é exatamente o padrão genérico apontado pela skill (creme + serifa + terracota). Mudanças:

- Fundo passou de creme para um cinza-esverdeado frio de papel de relatório ("Papel"), e o acento deixou de ser terracota: o único acento de marca é o azul-tinta, a cor da caneta de quem confere.
- A serifa ficou só nos títulos e nos valores de destaque; o texto corrido usa sans neutra. Números sempre em algarismos tabulares, para alinhar colunas de indicadores.
- A coisa memorável é o **selo de estado**: cada estado de validação é uma etiqueta com ícone e texto próprios e uma borda que reforça, como um carimbo de conferência. O resto da interface fica calmo.
- Sem cartões idênticos em grade: a lista de indicadores é uma tabela de lançamentos, com divisórias finas que separam um campo do outro (a estrutura mostra que cada campo é validado sozinho).

## Paleta

Seis cores nomeadas, com valor para cada tema. Os tokens estão em `frontend/src/index.css` como variáveis CSS e expostos ao Tailwind (`bg-papel`, `text-tinta`, etc.).

| Nome | Papel no layout | Claro | Escuro |
| --- | --- | --- | --- |
| Papel | fundo da página | `#F2F4F1` | `#12171C` |
| Tinta | texto principal e bordas fortes | `#18212B` | `#E4E8E3` |
| Azul-caneta | ação principal, links, foco | `#24557F` | `#8DB7E0` |
| Verde-conferido | `verified`, `fresh` | `#1D6446` | `#7FCBA4` |
| Âmbar-alerta | `divergent`, `stale` | `#8A5200` | `#E3B25F` |
| Carmim | `invalid`, `expired`, erros | `#A3281F` | `#EE9A92` |

Derivados, calculados a partir dos acima e também tokens: `superficie` (claro `#FFFFFF`, escuro `#1A2128`), `borda` (claro `#C9D0CA`, escuro `#303B45`) e `tinta-suave` (texto secundário; claro `#4B5967`, escuro `#A5B0BA`). Todos os pares texto/fundo acima têm contraste de pelo menos 4,5:1 (medido na T21a).

Token adicionado na T21b: `sobreposicao`, o fundo atrás de diálogos modais (classe `bg-sobreposicao`). Claro `rgb(24 33 43 / 0,6)` (a tinta do tema claro, escurece o papel claro); escuro `rgb(0 0 0 / 0,7)`. Motivo: `bg-tinta/60` no tema escuro usava a tinta clara (`#E4E8E3`) e clareava a tela em vez de escurecer. O token não é cor de texto nem de estado, então não entra na tabela de contraste.

## Tipografia

- Títulos e valores de destaque: **Source Serif 4** (variável), pesos 600 e 700.
- Texto, rótulos e tabelas: **Public Sans** (variável), pesos 400, 500 e 600.
- Ambas instaladas por `@fontsource-variable/*` e servidas do próprio domínio (a CSP não permite fontes de terceiros).
- Números: `font-variant-numeric: tabular-nums` em tabelas e valores.
- Escala (rem, base 16 px): 0,8125 (nota) / 0,9375 (rótulo) / 1 (texto) / 1,25 (subtítulo) / 1,625 (título de tela) / 2,125 (título de página, só em telas largas).
- Texto corrido com no máximo 70 caracteres por linha (`max-w-prose`). Alinhamento à esquerda; números alinhados à direita nas tabelas.
- Rótulos em caixa de frase, nunca em caixa alta.

## Espaçamento, forma e movimento

- Unidade de 4 px. Escala usada: 4, 8, 12, 16, 24, 32, 48.
- Raio: 4 px para selos e campos, 8 px para painéis. Sem sombras decorativas; hierarquia por borda de 1 px.
- Layout utilizável a partir de 360 px: navegação inferior fixa em telas estreitas e lateral a partir de 768 px.
- Foco visível: anel de 2 px em Azul-caneta com 2 px de afastamento, em todos os controles. O anel já aparece na cor final no primeiro quadro: a transição do `Button` cobre só fundo, borda, texto e opacidade, nunca `outline-color`.
- Navegação inferior fixa (T21b): `html` tem `scroll-padding-bottom: 5rem` abaixo de 768 px (16 px a partir daí), para que um controle focado por Tab não fique atrás da barra. Todo controle no fim da página herda isso. Diálogos modais rolam por dentro (`overflow-y-auto`) e ficam acima da barra.
- Botões de ação pendente em diálogo usam `aria-disabled` (continuam focáveis) em vez de `disabled`, para o foco não escapar.
- Movimento só em resposta a ação (abrir, trocar tema) e desligado com `prefers-reduced-motion`.
- Tema claro ou escuro segue o sistema (`prefers-color-scheme`). O alternador permite forçar claro, escuro ou voltar a seguir o sistema; a escolha fica em `localStorage`.

## Estados de validação

Regra: nenhum estado depende só de cor. Cada um tem ícone e texto próprios; a borda reforça (alguns estados compartilham o mesmo formato). O selo é o componente `StatusBadge` (`frontend/src/components/status/`).

| Estado | Significado | Texto do selo | Ícone | Cor | Borda |
| --- | --- | --- | --- | --- | --- |
| `verified` | as duas fontes concordam dentro da tolerância | Conferido | círculo com visto | Verde-conferido | sólida |
| `divergent` | as fontes discordam; os dois valores aparecem | Divergente | triângulo de alerta | Âmbar-alerta | sólida, espessa (2 px) |
| `single_source` | só uma fonte trouxe o campo | Fonte única | círculo com ponto central | Tinta-suave | sólida |
| `incomparable` | definições diferentes; não dá para comparar | Não comparável | sinal de igual cortado | Tinta-suave | tracejada |
| `missing` | nenhuma fonte trouxe o campo | Sem dado | círculo vazio com traço | Tinta-suave | pontilhada |
| `not_applicable` | o indicador não se aplica ao ativo (T21c) | Não se aplica | círculo cortado (`Ban`) | Tinta-suave | dupla (3 px) |
| `invalid` | valor fora do intervalo plausível ou ilegível | Inválido | círculo com X | Carmim | sólida, espessa (2 px) |

## Estados de atualização

Selo `FreshnessBadge`, mesmo formato do anterior. A idade vem do servidor; o navegador não calcula limites.

| Estado | Significado | Texto do selo | Ícone | Cor | Borda |
| --- | --- | --- | --- | --- | --- |
| `fresh` | dentro do prazo | Atualizado | relógio com visto | Verde-conferido | sólida |
| `stale` | passou do prazo de atenção | Desatualizado | ampulheta | Âmbar-alerta | sólida, espessa (2 px) |
| `expired` | passou do prazo; não use como atual | Vencido | relógio com alerta (o lucide-react não tem relógio com X) | Carmim | sólida, espessa (2 px), com a base tracejada |
| `unknown_reference_date` | a data-base não é conhecida (T21c) | Data-base desconhecida | calendário com X | Âmbar-alerta | pontilhada |

O selo tem `role="img"` e `aria-label` completo (por exemplo, "Estado da validação: Divergente").

## Resposta do agente (T21c)

Padrões novos, usados em `frontend/src/features/chat/`:

- **Tabela que vira cartões.** Abaixo de 768 px cada ativo é um cartão (título, selo de estado, conteúdo); a partir de 768 px é uma `<table>` com cabeçalhos de coluna e de linha. Só um dos dois existe no DOM (`matchMedia`), para não duplicar conteúdo para leitor de tela.
- **Divergência sem lado.** Os valores de um campo `divergent` usam a mesma caixa, o mesmo tamanho e o mesmo peso; a diferença e o limite vêm do servidor. O valor em destaque (serifa grande) só existe em `verified` e `single_source`.
- **Expansão** (`verified`): botão com `aria-expanded` e `aria-controls`; o painel traz as outras fontes e a diferença entre elas.
- **Aviso de lote desatualizado ou vencido** no cabeçalho: ícone, texto e cor (âmbar ou carmim). O estado do cabeçalho é o do catálogo, se descreve o mesmo snapshot; senão, o pior estado registrado na resposta.
- **Valores**: uma única função (`format.ts`) formata a string decimal em pt-BR (milhar com ponto, vírgula decimal, escala preservada; `%`, `R$`, `p.p.` para diferença de percentuais). Valor ilegível mostra ícone e "valor inválido".
- **Links de fonte**: só `https` em domínio conhecido, abrem em nova aba com `rel="noopener noreferrer"` e texto "(abre em nova aba)" para leitor de tela.
- **Seletor manual**: diálogo com `fieldset`/`legend` por grupo, caixas de 44 px de altura (o `label` inteiro é o alvo), foco preso, Esc fecha.

## Dados, exportação e aviso legal (T21e)

Padrões novos, usados em `frontend/src/features/data-status/` e `features/legal/`:

- **Selo de permissão de coleta** (`PermissionBadge`): mesmo formato do selo de estado, para o estado registrado de cada fonte. Os textos e os estados vêm de `features/data-status/sources.ts` (texto fixo do front; um teste confere com `config/sources.yaml`).

| Estado | Significado | Texto do selo | Ícone | Cor | Borda |
| --- | --- | --- | --- | --- | --- |
| `permitida` | licença de uso explícita | Permitida | escudo com visto | Verde-conferido | sólida |
| `indefinida` | permissão não comprovada; fonte habilitada por decisão e risco do autor | Indefinida | escudo com interrogação | Âmbar-alerta | tracejada, espessa (2 px) |
| `proibida` | vedação explícita | Proibida | escudo cortado | Carmim | sólida, espessa (2 px) |

- **Estado dos dados**: tudo vem pronto do catálogo. Selo de atualização, "X de Y ativos atualizados", sete linhas de contagem (selo de validação e número, como o servidor informou; chave nova vira "Estado não reconhecido: chave"; chave ausente vira "não informado", nunca zero) e lista de falhas (ticker, fonte, motivo como texto). Sem lote publicado: "Ainda não há dados coletados", com ícone, sem zeros.
- **Exportação**: botão com `aria-disabled` durante a leitura (continua focável), região `aria-live="polite"` com progresso, resultado ou erro (ícone e texto) e "Tentar de novo". Todas as partes ou nada.
- **Rodapé em todas as telas** (`LegalFooter`): frase "As respostas deste sistema não são recomendação de investimento." e o link "Aviso legal" (44 px de altura). Dentro do `AppLayout` fica acima da barra inferior; fora dele (`ScreenFrame`: entrar, verificação de sessão e de acesso, aviso legal) fica no fim da página.
- **Colunas de grade**: a coluna de conteúdo do `AppLayout` é `minmax(0,1fr)`; com `1fr` o conteúdo mais largo (palavra longa sem espaço) alargava a página em 768 a ~800 px.

## Estados de tela

Carregando, vazio e erro são componentes compartilhados (`frontend/src/components/state/`):

- Carregando: texto "Carregando..." com indicador giratório (parado com movimento reduzido) e `role="status"`.
- Vazio: título curto, uma frase dizendo o que fazer e, opcionalmente, uma ação.
- Erro: título, causa em linguagem simples, ação de tentar de novo; `role="alert"`. Não pede desculpa e nunca mostra zero ou tabela vazia no lugar de um dado que falhou.

## Valores e datas

- Valores financeiros chegam como string e são exibidos como vieram do servidor; o navegador não soma, não converte e não calcula valor de mercado.
- Todo número exibido traz fonte e data (T21c em diante).
- Textos em português do Brasil.

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
- Foco visível: anel de 2 px em Azul-caneta com 2 px de afastamento, em todos os controles.
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
| `invalid` | valor fora do intervalo plausível ou ilegível | Inválido | círculo com X | Carmim | sólida, espessa (2 px) |

## Estados de atualização

Selo `FreshnessBadge`, mesmo formato do anterior. A idade vem do servidor; o navegador não calcula limites.

| Estado | Significado | Texto do selo | Ícone | Cor | Borda |
| --- | --- | --- | --- | --- | --- |
| `fresh` | dentro do prazo | Atualizado | relógio com visto | Verde-conferido | sólida |
| `stale` | passou do prazo de atenção | Desatualizado | ampulheta | Âmbar-alerta | sólida, espessa (2 px) |
| `expired` | passou do prazo; não use como atual | Vencido | relógio com alerta (o lucide-react não tem relógio com X) | Carmim | sólida, espessa (2 px), com a base tracejada |

O selo tem `role="img"` e `aria-label` completo (por exemplo, "Estado da validação: Divergente").

## Estados de tela

Carregando, vazio e erro são componentes compartilhados (`frontend/src/components/state/`):

- Carregando: texto "Carregando..." com indicador giratório (parado com movimento reduzido) e `role="status"`.
- Vazio: título curto, uma frase dizendo o que fazer e, opcionalmente, uma ação.
- Erro: título, causa em linguagem simples, ação de tentar de novo; `role="alert"`. Não pede desculpa e nunca mostra zero ou tabela vazia no lugar de um dado que falhou.

## Valores e datas

- Valores financeiros chegam como string e são exibidos como vieram do servidor; o navegador não soma, não converte e não calcula valor de mercado.
- Todo número exibido traz fonte e data (T21c em diante).
- Textos em português do Brasil.

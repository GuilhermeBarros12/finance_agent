# Metodologia dos campos de ações

`config/methodologies.yaml` diz ao motor de validação se um campo pode ser comparado entre duas fontes (README 7.3; ADR 0001, D2; ADR 0002, E7). A versão atual, `provisoria-1`, nasceu com o veredito mais conservador porque os sites das fontes respondem `403` ao agente e a metodologia real ainda não foi lida.

## Vereditos

| Veredito | Significado | Consequência na validação |
| --- | --- | --- |
| `comparable` | O autor confirmou que as fontes usam a mesma fórmula, janela, base contábil e data-base. | Permite `verified` e `divergent`, conforme a tolerância. |
| `not_comparable` | As fontes calculam o indicador de formas diferentes. | Produz `incomparable`. |
| `insufficient_metadata` | A metodologia não foi lida ou a fonte não informa o bastante. | Produz `incomparable`. |
| `single_source` | Só uma fonte fornece o campo (hoje, `quote_price` pela brapi). | Produz `single_source`; não há comparação. |

Números próximos não bastam para `verified`: sem `comparable`, o resultado é `incomparable`. Nenhum campo está `comparable` hoje, e só o autor altera isso (P-04).

## Roteiro para o autor preencher (P-04)

Para cada um de `price_to_book`, `price_to_earnings`, `dividend_yield` e `roe`:

1. Abra a página de um ticker no Fundamentus e no StatusInvest, e a página de glossário ou ajuda de cada site.
2. Anote, por fonte:
   - `methodology_id`: um identificador curto (por exemplo `fundamentus_pl_12m`);
   - `formula`: como o indicador é calculado (por exemplo preço dividido por lucro por ação);
   - `window`: janela de tempo (12 meses, último exercício, último trimestre anualizado);
   - `basis`: base contábil (patrimônio final ou médio, lucro consolidado ou controlador);
   - `reference_date_available`: `true` se a página mostra a data-base do número, `false` se não.
3. Compare as duas fontes. Se fórmula, janela, base e data-base forem iguais, mude o `verdict` para `comparable`. Se forem diferentes, `not_comparable`. Se algo continuar desconhecido, mantenha `insufficient_metadata`.
4. Atualize `notes` com a origem da informação e `version` com um novo identificador.

O arquivo é validado por `collector.settings.load_methodologies`: veredito desconhecido, métrica ausente ou chave extra geram erro.

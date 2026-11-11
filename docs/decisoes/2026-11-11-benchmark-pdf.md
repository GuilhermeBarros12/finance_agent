# Benchmark de `pdf-lib` em Edge Function (orçamento 10 ativos / 15 páginas)

**Status: INCOMPLETO — medição hospedada pendente.** O critério de pronto (números do ambiente Supabase hospedado + recomendação) **não foi atingido**. Este documento registra o que existe e o que falta; a tabela hospedada abaixo está vazia de propósito.

Contexto: README §10.1/§10.3/§17 e critério 19.3. Limites do Free a verificar: CPU ~2 s, memória 256 MB, duração 150 s.
Protótipo descartável em `spike/pdf-benchmark/` (não entra no produto): `pdf-lib` 1.17.1 + `@pdf-lib/fontkit` 1.1.1, Noto Sans Regular/Bold (SIL OFL 1.1), dados 100% sintéticos, texto selecionável, tabelas, paginação manual e rodapé "Página X de Y".

## Validação do protótipo (local)
- `pdftotext` extrai o texto; acentuação do português correta; A4; fontes embutidas (`pdffonts`: emb = yes).
- O subsetting é efetivo: ~20–104 KB com subset contra ~565–650 KB sem.
- A calibração de páginas é aproximada: cenários de 1 ativo geram 9 e 16 páginas nos alvos 8 e 15. A coluna "real" abaixo é a verdade.

## Baseline LOCAL (Deno 2.9.6, Xeon 2,1 GHz, 5 repetições, processo único)
**Não é medição do ambiente hospedado** e não responde à pergunta. O CPU local vem de `Deno.cpuUsage()` e pode exceder o tempo total por contar threads auxiliares (GC). O RSS local não foi tabelado porque cresce monotonicamente no loop (processo reaproveitado), então não representa o pico por requisição.

| ativos | págs alvo (real) | subset | KB | total ms med/max | CPU ms med/max |
|---|---|---|---|---|---|
| 1 | 3 (3) | sim | 27 | 203/279 | 269/508 |
| 1 | 8 (9) | sim | 59 | 311/332 | 362/422 |
| 1 | 15 (16) | sim | 104 | 533/570 | 589/653 |
| 5 | 3 (3) | sim | 23 | 172/185 | 181/189 |
| 5 | 8 (8) | sim | 57 | 301/359 | 312/386 |
| 5 | 15 (15) | sim | 102 | 496/527 | 517/561 |
| 10 | 3 (3) | sim | 20 | 145/167 | 150/176 |
| 10 | 8 (8) | sim | 53 | 309/506 | 325/558 |
| 10 | 15 (15) | sim | 99 | 490/566 | 501/591 |
| 1 | 3 (3) | não | 570 | 303/332 | 336/387 |
| 1 | 8 (9) | não | 602 | 416/451 | 456/478 |
| 1 | 15 (16) | não | 647 | 634/696 | 692/716 |
| 5 | 3 (3) | não | 566 | 282/305 | 298/315 |
| 5 | 8 (8) | não | 600 | 428/444 | 452/481 |
| 5 | 15 (15) | não | 644 | 634/667 | 661/701 |
| 10 | 3 (3) | não | 564 | 250/288 | 263/306 |
| 10 | 8 (8) | não | 595 | 406/425 | 441/448 |
| 10 | 15 (15) | não | 641 | 608/735 | 628/812 |

Leitura **provisória e não conclusiva**: o pior caso local (10 ativos, 15 páginas, sem subsetting) fica em ~0,8 s de CPU, abaixo dos ~2 s. Isso ainda **não** diz se cabe no hospedado: o CPU do runtime hospedado, o cold start (carga de `npm:` + leitura dos ~1,1 MB de fontes) e a memória não foram medidos. O subsetting não reduziu o CPU de forma relevante neste teste; seu ganho é o tamanho do arquivo.

## Medição HOSPEDADA (pendente)
Não executada: a sessão que gerou o protótipo não tinha projeto Supabase, token nem rede para `*.supabase.co` / `api.supabase.com`. Para preencher: seguir `spike/pdf-benchmark/README.md` (projeto Free de teste, sem billing, `node bench.mjs 5`) e colar a tabela gerada aqui.

| ativos | págs (real) | subset | ok/N | total cliente ms | CPU ms | rss pico MB | falhas (546/504) |
|---|---|---|---|---|---|---|---|
| _a medir_ | | | | | | | |

## Recomendação
**Nenhuma ainda.** Não manter, reduzir nem reabrir o renderizador com base apenas no baseline local. Quando a tabela hospedada existir, decidir assim: cabe com folga (CPU < ~1 s e RSS bem abaixo de 256 MB no pior caso, sem 546) → manter 10/15; falha só nos maiores → reduzir ao maior cenário que passa com folga; falha mesmo nos pequenos → reabrir a escolha do renderizador.

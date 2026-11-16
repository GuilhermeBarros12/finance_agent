# Pendências do autor

Tudo o que depende de uma ação ou decisão do autor do projeto. Os agentes não resolvem estes itens: eles pulam a tarefa presa e seguem (ADR 0002, E11).

Quando resolver um item, marque a caixa e, se ele liberar uma tarefa, mude o estado dela em `docs/status-tarefas.md` de `bloqueada` para `pendente`.

## Seguram tarefas da leva autônoma

- [ ] **P-01 — Estrutura das páginas das fontes.** Abrir no navegador `https://www.fundamentus.com.br/resultado.php` e `https://statusinvest.com.br/acoes/petr4`. Copiar o cabeçalho da tabela e uma linha de exemplo de cada uma (ou o trecho de HTML correspondente) e entregar a uma sessão do Claude, que grava `docs/source-methodologies/estrutura-paginas.md` com valores fictícios. **Libera:** T12 e T13.
- [ ] **P-02 — Disparar o teste de bloqueio.** No GitHub: Actions, "Teste de acesso às fontes", Run workflow. Ele faz uma requisição a cada site e mostra o código HTTP. **Libera:** a decisão P-03.
- [ ] **P-03 — Decidir o que fazer se o teste der `403`** (ADR 0002, E13). Opções discutidas: (a) construir e resolver a coleta depois; (b) rodar o coletor do computador do autor; (c) seguir com uma fonte só, tudo `single_source`; (d) procurar outra segunda fonte com API. **Libera:** a coleta real.

## Seguram o uso com dados reais

- [ ] **P-04 — Metodologia dos indicadores.** Ler, nos dois sites, como cada um calcula P/VP, P/L, DY e ROE (fórmula, janela, base contábil, data-base) e preencher `config/methodologies.yaml`. Enquanto estiver em "metadados insuficientes", nenhum campo real recebe `verified` ou `divergent`.
- [ ] **P-05 — Parte hospedada.** Criar o projeto Supabase, configurar o Google OAuth, cadastrar segredos, publicar funções e frontend (T22a, T22b), ligar a coleta diária (T16), calibrar as tolerâncias (T17), avaliar o modelo (T20) e fazer a conferência manual (T24).

## Revisão e aceite

- [ ] **P-06 — Validar o visual** pelas capturas de tela em `docs/relatorio-execucao.md`, ao final da leva.
- [ ] **P-07 — Revisar e mesclar** o pull request de `fatia-acoes` para `main`.

## Repositório

- [ ] **P-08 — Proteger a `main`.** Settings, Rules, Rulesets: exigir pull request e o check `CI ok`.
- [ ] **P-09 — Conferir a licença e o contato de segurança.** A T02 usa "Guilherme" como titular da licença MIT e o recurso "Report a vulnerability" do GitHub como canal do `SECURITY.md`. Ative esse recurso em Settings, Advanced Security, "Private vulnerability reporting", ou troque o canal.
- [ ] **P-10 — Benchmark do PDF.** O branch `claude/happy-edison-uqdci8` tem o protótipo, sem pull request. Decidir se roda o benchmark agora ou junto da fatia de PDF.
- [x] **P-11 — Destravar a T06.** Liberada em 2026-11-14 para uma terceira rodada de correção (ver a nota em `docs/bloqueios.md`). Três correções pequenas (offset de fuso, substituto UTF-16, contagens em `docs/tarefas/T06.md`) em `tarefa/T06`; ver `docs/bloqueios.md`. **Libera:** T08, T10 e a cadeia seguinte.
- [x] **P-12 — Decidir o guarda do bundle.** Resolvida em 2026-11-14: o autor aprovou trocar `sb_secret_` por `sb_secret_[A-Za-z0-9_-]{20,}` em `scripts/ci/check_bundle.sh`, e a troca foi feita em `fatia-acoes`. **Libera:** o PR da T21a (branch `tarefa/T21a`).
- [ ] **P-16 — Confirmar o contrato da brapi.** A execução autônoma não conseguiu ler a documentação oficial (`https://brapi.dev/docs/acoes/cotacao`): o host não resolve na sessão. O adaptador da T11 assume `results`, `symbol`, `regularMarketPrice`, `regularMarketTime`, `currency`, instante em ISO 8601 com fuso e token em `Authorization: Bearer`. Conferir o caminho, os nomes dos campos e o formato do instante e, se divergirem, trocar as constantes no topo de `collector/src/collector/sources/brapi.py` e a fixture em `collector/tests/fixtures/brapi/`. **Libera:** a coleta real (T16).
- [ ] **P-17 — Decidir a calibragem da T14 (single_source x contrato).** O plano (T14, passo 5) manda gravar `single_source` com `delta_abs` e limite, mas a T06 e a RPC da T09 exigem exatamente uma observação e nenhum `comparison` em `single_source`. A solução adotada guarda o cálculo no texto do `reason` (`uncalibrated: delta_abs=... limit=... within_limit=...`) e **não publica** a segunda observação (`FieldResult.unpublished_observation_ids`). Consequência: com `within_limit=false` o banco fica só com o valor do Fundamentus como `single_source` e o do StatusInvest é descartado; a divergência só aparece no texto do `reason` (a T17 teria de ler texto livre). Alternativa a avaliar: `incomparable` com as duas observações e `reason` "uncalibrated: ..." (passa no contrato e na RPC, publica as duas e não escolhe lado, mas contraria o texto literal do plano). Ver `docs/tarefas/T14.md`. **Libera:** decisão antes da T17 e da T16.

## Para o futuro

- [ ] **P-14 — Carteira com ações fora do universo.** Hoje a carteira só aceita ações já coletadas (ADR 0002, E14).
- [ ] **P-15 — Segundo provedor de LLM.** Escolher por teste, sem Gemini presumido (ADR 0001, D6).
- [ ] **P-13 — Redistribuição dos dados da brapi.** Os termos proíbem. Reavaliar antes de abrir a aplicação a outras pessoas.

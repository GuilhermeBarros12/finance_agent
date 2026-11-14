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

## Para o futuro

- [ ] **P-11 — Carteira com ações fora do universo.** Hoje a carteira só aceita ações já coletadas (ADR 0002, E14).
- [ ] **P-12 — Segundo provedor de LLM.** Escolher por teste, sem Gemini presumido (ADR 0001, D6).
- [ ] **P-13 — Redistribuição dos dados da brapi.** Os termos proíbem. Reavaliar antes de abrir a aplicação a outras pessoas.

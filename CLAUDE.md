# Agente de Investimentos — instruções para agentes

Aplicação web pessoal que coleta indicadores de ações em duas fontes, compara campo a campo e mostra o resultado num chat, com fonte e data de cada número.

## Onde está cada coisa

| Documento | Uso |
| --- | --- |
| `docs/adr/0002-execucao-autonoma.md` | Decisões E1 a E20. **Prevalece sobre o ADR 0001.** |
| `docs/adr/0001-primeira-fatia-acoes.md` | Decisões D1 a D21. **Prevalece sobre o README.** |
| `docs/plano-execucao-fatia-acoes.md` | Tarefas, dependências e critérios de conclusão |
| `docs/status-tarefas.md` | Estado de cada tarefa. Vale a versão do branch `fatia-acoes` |
| `docs/pendencias.md` | O que depende do autor |
| `docs/bloqueios.md` | O que travou durante a execução |
| `docs/tarefas/Txx.md` | Explicação do que cada tarefa fez e por quê |
| `README.md` | Especificação completa. Leia só as seções citadas na tarefa |

## Como trabalhar

- `/executar-plano` percorre todas as tarefas liberadas, em sequência. `/tarefa T10` executa uma só. Os dois usam os sub-agents de `.claude/agents/`.
- Branch de integração: `fatia-acoes`. Cada tarefa tem o branch `tarefa/T10`, criado a partir dele, e um pull request **para `fatia-acoes`**.
- O orquestrador mescla em `fatia-acoes` quando o revisor aprova e o check `CI ok` passa.
- **Ninguém além do autor faz merge em `main`.**
- Só comece uma tarefa cujas dependências estejam `concluída`.
- Tarefa que trava: registre em `docs/bloqueios.md`, marque `bloqueada` e siga para a próxima.
- Mensagens de commit começam pelo ID da tarefa: `T10: ...`.
- Antes de qualquer commit, rode `bash scripts/ci/check_guardrails.sh`.
- Toda tarefa de código deixa `docs/tarefas/Txx.md` e atualiza `docs/data-dictionary.md` e `docs/api.md` quando mexe em banco ou endpoint.

## Limite da execução autônoma

O alvo é o sistema funcionando em ambiente local: Supabase local, dados sintéticos e `MOCK_LLM=true`. Sem projeto hospedado, sem segredos, sem scraping real, sem LLM real e sem deploy.

## Regras que a CI não perdoa

- Valores financeiros: `decimal.Decimal` em Python, string no JSON, `numeric` no banco. Sem `float`.
- Nenhum segredo no repositório. Só arquivos `.env*.example`, com valores vazios.
- Nada com prefixo `VITE_` pode ser segredo. A chave administrativa do Supabase não aparece em `frontend/` nem em workflows.
- Fixtures são sintéticas, escritas à mão, com tickers inventados.
- Actions fixadas em SHA completo. Sem commit vazio em workflow.
- Só a primeira fatia: nada de FIIs, ETFs, Tesouro, PDF ou Gemini.
- A CI não faz scraping e não chama LLM real.

## Regras que só a revisão pega

- Falha de coleta nunca vira zero, tabela vazia ou data de hoje.
- Um campo não herda a validação de outro. Divergência não é resolvida por média, por escolha de um lado nem pelo LLM.
- O `user_id` vem do JWT, nunca do corpo da requisição.
- A carteira guarda só o símbolo da ação e nunca é enviada ao LLM.
- Não escreva parser de Fundamentus ou StatusInvest sem `docs/source-methodologies/estrutura-paginas.md`.
- Nas telas: leia `.claude/skills/frontend-design/SKILL.md` e `docs/design.md` antes; nenhum estado indicado só por cor; o navegador não calcula valor de mercado.
- Não desative teste nem silencie lint para a CI passar.
- Se o plano contradisser o que você encontrar, pare a tarefa e registre o bloqueio.

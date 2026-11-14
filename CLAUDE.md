# Agente de Investimentos — instruções para agentes

Aplicação web pessoal que coleta indicadores de ações em duas fontes, compara campo a campo e mostra o resultado num chat, com fonte e data de cada número.

## Onde está cada coisa

| Documento | Uso |
| --- | --- |
| `docs/adr/0001-primeira-fatia-acoes.md` | Decisões aceitas. **Prevalece sobre o README.** |
| `docs/plano-execucao-fatia-acoes.md` | Tarefas (T01 a T24), dependências e critérios de conclusão |
| `docs/status-tarefas.md` | Estado de cada tarefa |
| `README.md` | Especificação completa. Leia só as seções citadas na tarefa |

## Como trabalhar

- Uma tarefa por branch (`tarefa/T10`) e por pull request. O comando `/tarefa T10` orquestra os sub-agents de `.claude/agents/`.
- Só comece uma tarefa cujas dependências estejam `concluída` em `docs/status-tarefas.md`.
- Mensagens de commit começam pelo ID da tarefa: `T10: ...`.
- Antes de qualquer commit, rode `bash scripts/ci/check_guardrails.sh`.
- Não faça merge em `main`. O autor aprova os pull requests.

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
- Não escreva parser de uma fonte antes de ela estar habilitada em `config/sources.yaml` (tarefa T01).
- Não desative teste nem silencie lint para a CI passar.
- Se o plano contradisser o que você encontrar, pare e relate.

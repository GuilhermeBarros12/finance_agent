# Bloqueios encontrados na execução

Registro do que travou uma tarefa durante a execução autônoma (ADR 0002, E11). O orquestrador acrescenta uma entrada, marca a tarefa como `bloqueada` em `docs/status-tarefas.md` e passa para a próxima tarefa liberada.

Bloqueios que dependem só do autor e já eram conhecidos antes da execução estão em `docs/pendencias.md`, não aqui.

## Quando registrar

- O revisor reprovou a tarefa duas vezes.
- A CI falhou duas vezes seguidas no pull request da tarefa.
- O plano contradiz o repositório ou uma documentação externa.
- A tarefa exige segredo, painel de serviço ou acesso que o agente não tem.

## Formato de cada entrada

```markdown
### Txx — <nome da tarefa> (AAAA-MM-DD)

- **Motivo:** uma frase.
- **O que foi tentado:** lista curta.
- **Evidência:** comando e trecho da saída, ou link do pull request.
- **Estado do código:** branch e o que ficou feito.
- **O que destrava:** a ação ou decisão necessária, e de quem.
```

## Entradas

Nenhuma até agora.

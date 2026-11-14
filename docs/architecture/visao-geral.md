# Visão geral da arquitetura

Estado após a T08 (banco). As demais partes entram nas tarefas seguintes.

```text
Coletor (Python)  --publica-->  Postgres (Supabase)  <--lê--  Edge Function  <--JWT--  Frontend (React)
                                   |                            ^
                                   |-- dados de mercado         |-- user_id vem do JWT
                                   |   (sem acesso do navegador)
                                   `-- dados privados (RLS de dono autorizado)
```

- **Dados de mercado** (`assets`, `data_sources`, `collection_runs`, `snapshots`, `observations`, `field_validations`, `active_snapshot`): escritos só pelo coletor, imutáveis depois de publicados, lidos só pela Edge Function. O navegador não tem grant nem política nessas tabelas.
- **Dados privados** (`allowed_users`, `conversations`, `messages`, `request_runs`, `llm_usage`, `portfolio_items`): o navegador lê o que é seu e gerencia conversas e carteira; mensagens, execuções e contador de LLM são escritos só pelo backend.
- Detalhes de tabelas e políticas em `docs/data-dictionary.md`.

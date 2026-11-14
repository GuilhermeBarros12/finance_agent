# Visão geral da arquitetura

Estado após a T09 (banco e publicação). As demais partes entram nas tarefas seguintes.

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

## Publicação (T09)

```text
Coletor --(papel collector_ingest)--> staging_* --publish_snapshot--> snapshots + observations + field_validations
                                                       |                 `-> active_snapshot (só snapshot publicado)
                                                       `-- tudo ou nada, numa transação
```

- O coletor conecta com o papel `collector_ingest` (não com `service_role`, D13). Ele insere em `collection_runs` e nas tabelas de staging, lê `assets` e `data_sources` e executa `publish_snapshot`. Não lê nada privado nem de snapshots.
- `publish_snapshot` valida o lote inteiro antes de copiar. Se algo falha, o último snapshot publicado continua ativo (README 6.4). Lote com ao menos metade do universo e menos que o total fica `partial`, com o manifesto de cobertura no snapshot.
- `prune_snapshots` (retenção de 30 dias, D11) roda como administrador, não apaga o snapshot ativo e é a única a ligar `app.retention_job`.
- A RPC não é exposta por HTTP: `anon`, `authenticated` e `service_role` não têm `execute`, então não há entrada em `docs/api.md` (que ainda não existe). A chamada é direta no Postgres, pelo coletor.

-- T18: idempotência do agente (D16). A T08 criou `request_runs` só com (user_id, request_id)
-- e status; o plano da T18 pede também o hash do corpo (mesmo request_id com corpo diferente
-- é conflito) e a resposta gravada (repetição devolve a mesma resposta sem duplicar mensagens).
-- Mudança só aditiva: nenhum grant, política ou constraint existente é alterado. O dono
-- autorizado continua só lendo (select de tabela, sem escrita); quem grava é o backend.

alter table public.request_runs
  add column body_hash text,
  add column response jsonb;

alter table public.request_runs
  add constraint request_runs_body_hash_check
    check (body_hash is null or body_hash ~ '^[0-9a-f]{64}$'),
  -- Resposta gravada só existe numa execução concluída.
  add constraint request_runs_response_check
    check (response is null or status = 'succeeded');

-- Retomada de reserva expirada: o backend filtra por status e updated_at.
create index request_runs_status_updated_idx
  on public.request_runs (status, updated_at);

-- T15: consulta mínima para o coletor recusar um segundo lote no mesmo dia (README 14.4, item 3).
-- O papel collector_ingest não lê collection_runs nem snapshots (D13: só insere staging e
-- executa publish_snapshot). Em vez de conceder SELECT nessas tabelas, esta função responde
-- apenas sim ou não, para o dia lógico informado (America/Sao_Paulo). O dia é o de started_at,
-- o mesmo que o coletor usa como data lógica (uma execução que cruza a meia-noite conta no dia em que começou).
create function public.collector_batch_done_on(p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.collection_runs r
    where r.status in ('succeeded', 'partial')
      and (r.started_at at time zone 'America/Sao_Paulo')::date = p_day
  );
$$;

revoke all on function public.collector_batch_done_on(date)
  from public, anon, authenticated, service_role;
grant execute on function public.collector_batch_done_on(date) to collector_ingest;

-- T15: collector_batch_done_on (guarda de um lote por dia). Roda como postgres; dados sintéticos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
grant collector_ingest to current_user;
grant usage on schema extensions to collector_ingest, authenticated, anon;

select ok(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.collector_batch_done_on(date)'::regprocedure and a.grantee = 0),
  'sem EXECUTE para PUBLIC (proacl)');
select ok(
  not has_function_privilege('anon', 'public.collector_batch_done_on(date)', 'execute')
  and not has_function_privilege('authenticated', 'public.collector_batch_done_on(date)', 'execute')
  and not has_function_privilege('service_role', 'public.collector_batch_done_on(date)', 'execute'),
  'anon, authenticated e service_role sem execute');
select ok(has_function_privilege('collector_ingest', 'public.collector_batch_done_on(date)', 'execute'),
  'collector_ingest executa');

-- Seed: execução succeeded encerrada em 2026-09-18T20:05Z (17:05 em Brasília).
select is(public.collector_batch_done_on('2026-09-18'), true, 'dia do lote concluído: true');
select is(public.collector_batch_done_on('2026-09-19'), false, 'outro dia: false');

-- Perto da meia-noite UTC o dia lógico é o de Brasília.
insert into public.collection_runs (id, started_at, finished_at, status)
values ('c0000000-0000-4000-8000-0000000000f1', '2030-01-02T01:00:00Z', '2030-01-02T01:30:00Z', 'partial');
select is(public.collector_batch_done_on('2030-01-01'), true, '01:30Z de 02/01 é 22:30 de 01/01 em Brasília');
select is(public.collector_batch_done_on('2030-01-02'), false, 'e não conta como 02/01');

-- Execução em andamento ou falha não conta como lote concluído.
insert into public.collection_runs (id, started_at, status)
values ('c0000000-0000-4000-8000-0000000000f2', '2030-02-01T12:00:00Z', 'running');
select is(public.collector_batch_done_on('2030-02-01'), false, 'running não conta');

select * from finish();
rollback;

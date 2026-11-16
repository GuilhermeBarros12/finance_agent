-- T09 (revisão): contrato do manifesto, instante com fuso, valores finitos e trava do staging.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);
grant collector_ingest to current_user;
grant usage on schema extensions to collector_ingest;

create function pg_temp.man(p_run uuid, p_at text default '2026-11-14T10:05:00Z', p_total int default 1,
  p_upd int default 1, p_failures jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('snapshot_id', 'snap-x', 'run_id', p_run, 'collected_at', p_at,
    'universe_version', 'v', 'assets_total', p_total, 'assets_updated', p_upd, 'failures', p_failures) $$;
grant execute on function pg_temp.man(uuid, text, int, int, jsonb) to public;

insert into public.collection_runs (id, started_at) values
  ('c5000000-0000-4000-8000-000000000001', '2026-11-14T09:00:00Z');
insert into public.staging_observations
  (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   collected_at, source_url, parser_version, raw_content_hash)
values ('e5000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi',
  'quote_price', '5,00', 5.00, 'BRL', 'BRL', '2026-11-14T09:30:00Z',
  'https://brapi.dev/exemplo/DEMO3', 't09', repeat('a', 64));
insert into public.staging_validations
  (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids)
values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'quote_price', 'single_source', 'fresh',
  'e5000000-0000-4000-8000-000000000001', array['e5000000-0000-4000-8000-000000000001']::uuid[]);

create function pg_temp.pub(p_manifest jsonb) returns uuid language sql as
  $$ select public.publish_snapshot('c5000000-0000-4000-8000-000000000001', $1) $$;
grant execute on function pg_temp.pub(jsonb) to public;
create temp table ativo0 as select snapshot_id from public.active_snapshot where universe = 'stocks';
grant select on ativo0 to public;

set local role collector_ingest;

-- failures é obrigatório e estruturado -----------------------------------------------------
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') - 'failures')$$,
  '%failures é obrigatório%', 'manifesto sem failures é recusado');
select throws_like($$select pg_temp.pub(jsonb_set(pg_temp.man('c5000000-0000-4000-8000-000000000001'), '{failures}', 'null'))$$,
  '%failures é obrigatório%', 'failures null é recusado');
select throws_like($$select pg_temp.pub(jsonb_set(pg_temp.man('c5000000-0000-4000-8000-000000000001'), '{failures}', '{}'))$$,
  '%failures é obrigatório%', 'failures objeto é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '["timeout"]'))$$,
  '%cada falha exige%', 'item de failures que não é objeto é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '[{"asset_id":"TEST4","source_id":"brapi"}]'))$$,
  '%cada falha exige%', 'falha sem reason é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '[{"asset_id":"TEST4","source_id":"brapi","reason":""}]'))$$,
  '%cada falha exige%', 'falha com reason vazio é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '[{"asset_id":"","source_id":"brapi","reason":"x"}]'))$$,
  '%cada falha exige%', 'falha com asset_id vazio é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '[{"asset_id":"TEST4","source_id":1,"reason":"x"}]'))$$,
  '%cada falha exige%', 'falha com source_id não textual é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', p_failures => '[{"asset_id":"TEST4","source_id":"brapi","reason":"x","extra":1}]'))$$,
  '%cada falha exige%', 'falha com chave extra é recusada');

-- chaves do manifesto -----------------------------------------------------------------------
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"universe":"stocks"}')$$,
  '%chaves não previstas: universe%', 'chave extra no manifesto é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') - 'snapshot_id')$$,
  '%snapshot_id é obrigatório%', 'manifesto sem snapshot_id é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"snapshot_id":""}')$$,
  '%snapshot_id é obrigatório%', 'snapshot_id vazio é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') - 'run_id')$$,
  '%run_id é obrigatório%', 'manifesto sem run_id é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000002'))$$,
  '%run_id do manifesto difere%', 'run_id diferente do informado é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') - 'assets_updated')$$,
  '%assets_updated deve ser número%', 'manifesto sem assets_updated é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"universe_version":""}')$$,
  '%universe_version é obrigatório%', 'universe_version vazio é recusado');

-- contagens ---------------------------------------------------------------------------------
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"assets_total":2.5}')$$,
  '%assets_total deve ser inteiro%', 'assets_total fracionário é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"assets_total":"1"}')$$,
  '%assets_total deve ser número%', 'assets_total texto é recusado');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"assets_total":9007199254740991}')$$,
  '%assets_total deve ser inteiro entre%', 'assets_total acima do integer é recusado com mensagem própria');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"assets_updated":2}')$$,
  '%assets_updated maior que assets_total%', 'assets_updated acima do total é recusado');

-- collected_at: instante ISO com fuso ------------------------------------------------------
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, 'now'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at "now" é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, 'today'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at "today" é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, 'infinity'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at "infinity" é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-11-14'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at só com data é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-11-14T10:05:00'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at sem fuso é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-11-14 10:05:00Z'),
  '%collected_at deve ser instante ISO 8601%', 'collected_at com espaço no lugar do T é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-11-14T10:05:00+00:60'),
  '%collected_at deve ser instante ISO 8601%', 'offset com minuto 60 é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-02-30T10:05:00Z'),
  '%collected_at não é um instante válido%', 'data inexistente é recusada');
select throws_like($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001') || '{"collected_at":20261114}')$$,
  '%collected_at é obrigatório%', 'collected_at numérico é recusado');
select throws_like(format($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001', %L))$$, '2026-09-18T20:04:59Z'),
  '%fora de ordem%', 'collected_at anterior ao do snapshot ativo é recusado');
reset role;
select ok((select snapshot_id from public.active_snapshot where universe = 'stocks') = (select snapshot_id from ativo0),
  'nenhuma recusa trocou o ponteiro ativo');
set local role collector_ingest;

-- NaN e Infinity no staging (checks) ---------------------------------------------------------
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus', 'quote_price', 'x', 'NaN', 'BRL', 'BRL',
  '2026-11-14T09:30:00Z', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'value_decimal NaN é recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus', 'quote_price', 'x', 'Infinity', 'BRL', 'BRL',
  '2026-11-14T09:30:00Z', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'value_decimal Infinity é recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus', 'quote_price', 'x', '-Infinity', 'BRL', 'BRL',
  '2026-11-14T09:30:00Z', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'value_decimal -Infinity é recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus', 'quote_price', '', 1, 'BRL', 'BRL',
  '2026-11-14T09:30:00Z', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'raw_value vazio é recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c5000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus', 'quote_price', 'x', 1, 'BRL', 'BRL',
  '2026-11-14T09:30:00Z', 'https://brapi.dev/x', '', repeat('a', 64))$$, '23514', null, 'parser_version vazio é recusado');

create function pg_temp.vval(p_col text, p_val text) returns void language plpgsql as $$
begin
  execute format($f$insert into public.staging_validations
    (run_id, asset_symbol, metric, status, freshness, observation_ids, delta_abs, limit_value, atol, rtol, tolerance_version)
    values ('c5000000-0000-4000-8000-000000000001', 'TEST4', 'roe', 'verified', 'fresh', '{}',
      %s, %s, %s, %s, 't')$f$,
    case when p_col = 'delta_abs' then quote_literal(p_val) || '::numeric' else '1' end,
    case when p_col = 'limit_value' then quote_literal(p_val) || '::numeric' else '3' end,
    case when p_col = 'atol' then quote_literal(p_val) || '::numeric' else '1' end,
    case when p_col = 'rtol' then quote_literal(p_val) || '::numeric' else '1' end);
end $$;
grant execute on function pg_temp.vval(text, text) to public;
select throws_ok($$select pg_temp.vval('delta_abs', 'NaN')$$, '23514', null, 'delta_abs NaN é recusado');
select throws_ok($$select pg_temp.vval('limit_value', 'NaN')$$, '23514', null, 'limit_value NaN é recusado');
select throws_ok($$select pg_temp.vval('atol', 'Infinity')$$, '23514', null, 'atol Infinity é recusado');
select throws_ok($$select pg_temp.vval('rtol', '-Infinity')$$, '23514', null, 'rtol -Infinity é recusado');
select throws_ok($$insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, observation_ids)
  values ('c5000000-0000-4000-8000-000000000001', 'TEST4', 'roe', 'incomparable', 'fresh',
          '{{"e5000000-0000-4000-8000-000000000001"},{"e5000000-0000-4000-8000-000000000001"}}')$$,
  '23514', null, 'observation_ids multidimensional é recusado');

-- Defesa na RPC (sem depender dos checks do staging) e checks das tabelas finais -------------
reset role;
select ok((select count(*) = 2 from pg_constraint
           where conname in ('observations_finite_check', 'field_validations_finite_check')),
  'tabelas finais têm check de valores finitos');
alter table public.staging_observations drop constraint staging_observations_finite_check;
update public.staging_observations set value_decimal = 'NaN' where id = 'e5000000-0000-4000-8000-000000000001';
select throws_like($$select public.publish_snapshot('c5000000-0000-4000-8000-000000000001',
  pg_temp.man('c5000000-0000-4000-8000-000000000001'))$$, '%valor não finito%',
  'a RPC recusa NaN mesmo sem o check do staging');
update public.staging_observations set value_decimal = 5 where id = 'e5000000-0000-4000-8000-000000000001';

-- Publicação válida e trava do staging ------------------------------------------------------
set local role collector_ingest;
select lives_ok($$select pg_temp.pub(pg_temp.man('c5000000-0000-4000-8000-000000000001',
  p_failures => '[{"asset_id":"TEST4","source_id":"brapi","reason":"timeout"}]'))$$,
  'manifesto completo e instante com fuso publicam');
reset role;
select ok(exists (select 1 from pg_locks l join pg_class c on c.oid = l.relation
                  where l.pid = pg_backend_pid() and l.mode = 'ShareRowExclusiveLock'
                    and c.relname = 'staging_observations'),
  'a publicação segura SHARE ROW EXCLUSIVE em staging_observations');
select ok(exists (select 1 from pg_locks l join pg_class c on c.oid = l.relation
                  where l.pid = pg_backend_pid() and l.mode = 'ShareRowExclusiveLock'
                    and c.relname = 'staging_validations'),
  'a publicação segura SHARE ROW EXCLUSIVE em staging_validations');
select is((select jsonb_array_length(failures) from public.snapshots
           where run_id = 'c5000000-0000-4000-8000-000000000001'), 1, 'falha do manifesto preservada no snapshot');

select * from finish();
rollback;

-- T09 (2a revisão): instantes futuros, infinitos, hora 24/segundo 60, tolerance_version vazio e lock_timeout.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);
grant collector_ingest to current_user;
grant usage on schema extensions to collector_ingest;

create function pg_temp.man(p_run uuid, p_at text) returns jsonb language sql as $$
  select jsonb_build_object('snapshot_id', 'snap-x', 'run_id', p_run, 'collected_at', p_at,
    'universe_version', 'v', 'assets_total', 1, 'assets_updated', 1, 'failures', '[]'::jsonb) $$;
grant execute on function pg_temp.man(uuid, text) to public;

-- Um run com 1 observação e a validação single_source do seu campo.
create function pg_temp.seed(p_n int) returns void language plpgsql as $$
declare v_run uuid := ('c6000000-0000-4000-8000-00000000000' || p_n)::uuid;
        v_obs uuid := ('e6000000-0000-4000-8000-00000000000' || p_n)::uuid;
begin
  insert into public.collection_runs (id, started_at) values (v_run, now() - interval '2 hours');
  insert into public.staging_observations
    (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
     collected_at, source_url, parser_version, raw_content_hash)
  values (v_obs, v_run, 'DEMO3', 'brapi', 'quote_price', '5,00', 5.00, 'BRL', 'BRL',
    now() - interval '1 hour', 'https://brapi.dev/exemplo/DEMO3', 't09', repeat('a', 64));
  insert into public.staging_validations
    (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids)
  values (v_run, 'DEMO3', 'quote_price', 'single_source', 'fresh', v_obs, array[v_obs]);
end $$;

-- Publica o run p_n e devolve a mensagem de erro (ou 'ok'); o erro desfaz só o bloco.
create function pg_temp.pub(p_n int, p_at text) returns text language plpgsql as $$
begin
  perform public.publish_snapshot(('c6000000-0000-4000-8000-00000000000' || p_n)::uuid,
    pg_temp.man(('c6000000-0000-4000-8000-00000000000' || p_n)::uuid, p_at));
  return 'ok';
exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.pub(int, text) to public;
grant execute on function pg_temp.seed(int) to public;

select pg_temp.seed(1);
select pg_temp.seed(2);
select pg_temp.seed(3);
select pg_temp.seed(4);
create temp table ativo0 as select snapshot_id from public.active_snapshot where universe = 'stocks';
grant select on ativo0 to public;
create temp table lt0 as select current_setting('lock_timeout') as v;
grant select on lt0 to public;

set local role collector_ingest;

-- collected_at do manifesto no futuro ---------------------------------------------------------
select alike(pg_temp.pub(1, '9999-12-31T23:59:59Z'), '%collected_at%está no futuro%',
  'manifesto com collected_at em 9999 é recusado');
select alike(pg_temp.pub(1, to_char(now() + interval '6 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  '%está no futuro%', 'manifesto 6 minutos à frente é recusado');
reset role;
select ok((select snapshot_id from public.active_snapshot where universe = 'stocks') = (select snapshot_id from ativo0),
  'recusas de futuro não trocaram o ponteiro');
set local role collector_ingest;

-- hora 24, segundo 60 ---------------------------------------------------------------------------
select alike(pg_temp.pub(4, '2026-11-14T24:00:00Z'), '%collected_at deve ser instante ISO 8601%', 'hora 24 é recusada');
select alike(pg_temp.pub(4, '2026-11-14T23:59:60Z'), '%collected_at deve ser instante ISO 8601%', 'segundo 60 é recusado');
select alike(pg_temp.pub(4, '2026-11-14T10:60:00Z'), '%collected_at deve ser instante ISO 8601%', 'minuto 60 é recusado');

-- infinitos no staging (checks) -----------------------------------------------------------------
create function pg_temp.ins(p_col text, p_val text) returns void language plpgsql as $$
begin
  execute format($f$insert into public.staging_observations
    (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
     collected_at, source_url, parser_version, raw_content_hash, %I)
    values ('c6000000-0000-4000-8000-000000000004', 'DEMO3', 'fundamentus', 'quote_price', 'x', 1, 'BRL', 'BRL',
     now() - interval '1 hour', 'https://brapi.dev/x', 't09', repeat('a', 64), %L)$f$,
    p_col, p_val);
end $$;
grant execute on function pg_temp.ins(text, text) to public;
select throws_ok($$select pg_temp.ins('reference_at', 'infinity')$$, '23514', null, 'staging: reference_at infinity recusado');
select throws_ok($$select pg_temp.ins('reference_at', '-infinity')$$, '23514', null, 'staging: reference_at -infinity recusado');
select throws_ok($$select pg_temp.ins('reference_date', 'infinity')$$, '23514', null, 'staging: reference_date infinity recusado');
select throws_ok($$select pg_temp.ins('reference_date', '-infinity')$$, '23514', null, 'staging: reference_date -infinity recusado');
select throws_ok($$select pg_temp.ins('period_start', 'infinity')$$, '23514', null, 'staging: period_start infinity recusado');
select throws_ok($$select pg_temp.ins('period_start', '-infinity')$$, '23514', null, 'staging: period_start -infinity recusado');
select throws_ok($$select pg_temp.ins('period_end', 'infinity')$$, '23514', null, 'staging: period_end infinity recusado');
select throws_ok($$select pg_temp.ins('period_end', '-infinity')$$, '23514', null, 'staging: period_end -infinity recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c6000000-0000-4000-8000-000000000004', 'DEMO3', 'fundamentus', 'quote_price', 'x', 1, 'BRL', 'BRL',
  'infinity', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'staging: collected_at infinity recusado');
select throws_ok($$insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency, collected_at, source_url, parser_version, raw_content_hash)
  values ('c6000000-0000-4000-8000-000000000004', 'DEMO3', 'fundamentus', 'quote_price', 'x', 1, 'BRL', 'BRL',
  '-infinity', 'https://brapi.dev/x', 't09', repeat('a', 64))$$, '23514', null, 'staging: collected_at -infinity recusado');
select throws_ok($$insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, observation_ids,
  delta_abs, limit_value, atol, rtol, tolerance_version)
  values ('c6000000-0000-4000-8000-000000000004', 'TEST4', 'roe', 'verified', 'fresh', '{}', 1, 3, 1, 1, '')$$,
  '23514', null, 'staging: tolerance_version vazio em verified é recusado');

-- RPC recusa futuro e infinito mesmo sem os checks do staging ---------------------------------
reset role;
alter table public.staging_observations drop constraint staging_observations_time_finite_check;
alter table public.staging_observations drop constraint staging_observations_period_check;
create function pg_temp.rpc_with(p_set text) returns text language plpgsql as $$
begin
  execute 'update public.staging_observations set ' || p_set
    || ' where id = ''e6000000-0000-4000-8000-000000000004''';
  perform public.publish_snapshot('c6000000-0000-4000-8000-000000000004',
    pg_temp.man('c6000000-0000-4000-8000-000000000004', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  return 'ok';
exception when others then return sqlerrm; end $$;
select alike(pg_temp.rpc_with($$collected_at = 'infinity'$$), '%infinito%', 'RPC: collected_at infinity recusado');
select alike(pg_temp.rpc_with($$collected_at = '-infinity'$$), '%infinito%', 'RPC: collected_at -infinity recusado');
select alike(pg_temp.rpc_with($$reference_at = 'infinity'$$), '%infinito%', 'RPC: reference_at infinity recusado');
select alike(pg_temp.rpc_with($$reference_at = '-infinity'$$), '%infinito%', 'RPC: reference_at -infinity recusado');
select alike(pg_temp.rpc_with($$reference_date = 'infinity'$$), '%infinito%', 'RPC: reference_date infinity recusado');
select alike(pg_temp.rpc_with($$reference_date = '-infinity'$$), '%infinito%', 'RPC: reference_date -infinity recusado');
select alike(pg_temp.rpc_with($$period_start = 'infinity'$$), '%infinito%', 'RPC: period_start infinity recusado');
select alike(pg_temp.rpc_with($$period_start = '-infinity'$$), '%infinito%', 'RPC: period_start -infinity recusado');
select alike(pg_temp.rpc_with($$period_end = 'infinity'$$), '%infinito%', 'RPC: period_end infinity recusado');
select alike(pg_temp.rpc_with($$period_end = '-infinity'$$), '%infinito%', 'RPC: period_end -infinity recusado');
select alike(pg_temp.rpc_with($$collected_at = now() + interval '6 minutes'$$), '%no futuro%', 'RPC: collected_at das observações no futuro recusado');
reset role;
select alike(pg_temp.rpc_with($$reference_at = now() + interval '6 minutes'$$), '%no futuro%', 'RPC: reference_at no futuro recusado');
select alike(pg_temp.rpc_with($$reference_date = current_date + 2$$), '%no futuro%', 'RPC: reference_date no futuro recusado');
select alike(pg_temp.rpc_with($$period_start = '2026-02-01', period_end = '2026-01-01'$$), '%período invertido%', 'RPC: período invertido recusado');
alter table public.staging_validations drop constraint staging_validations_tolerance_text_check;
update public.staging_validations set status = 'single_source', tolerance_version = '' where run_id = 'c6000000-0000-4000-8000-000000000004';
select alike(pg_temp.rpc_with($$value_decimal = 5$$), '%tolerance_version vazio%', 'RPC: tolerance_version vazio recusado');
update public.staging_validations set tolerance_version = null where run_id = 'c6000000-0000-4000-8000-000000000004';
select is(pg_temp.rpc_with($$collected_at = now() + interval '2 minutes'$$), 'ok', 'RPC: collected_at das observações dentro da tolerância é aceito');

-- Cadeia: futuro dentro da tolerância não trava a publicação seguinte --------------------------
set local role collector_ingest;
select is(pg_temp.pub(1, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'ok',
  'a publicação com o instante atual funciona depois das recusas');
select is(pg_temp.pub(2, to_char((now() + interval '2 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'ok',
  'collected_at 2 minutos à frente (dentro da tolerância) é aceito');
select is(pg_temp.pub(3, to_char((now() + interval '3 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), 'ok',
  'a publicação seguinte, posterior, funciona (sem travar)');
reset role;
select is(current_setting('lock_timeout'), (select v from lt0),
  'a RPC restaura o lock_timeout da sessão ao terminar');
set local role collector_ingest;


-- Tabelas finais: checks de finitude e de texto ---------------------------------------------
reset role;
insert into public.collection_runs (id, started_at) values ('c6000000-0000-4000-8000-000000000009', now() - interval '3 hours');
insert into public.snapshots (id, run_id, collected_at) values
  ('d6000000-0000-4000-8000-000000000009', 'c6000000-0000-4000-8000-000000000009', now());
create function pg_temp.fin(p_col text, p_val text) returns void language plpgsql as $$
begin
  execute format($f$insert into public.observations
    (snapshot_id, asset_id, source_id, metric, raw_value, value_decimal, unit, currency,
     source_url, parser_version, raw_content_hash, run_id, collected_at, %I)
    select 'd6000000-0000-4000-8000-000000000009', a.id, s.id, 'quote_price', 'x', 1, 'BRL', 'BRL',
      'https://brapi.dev/x', 't09', repeat('a', 64), 'c6000000-0000-4000-8000-000000000009', %L::timestamptz, %L
    from public.assets a, public.data_sources s where a.symbol = 'DEMO3' and s.code = 'brapi'$f$,
    case when p_col = 'collected_at' then 'created_at' else p_col end,
    case when p_col = 'collected_at' then p_val else 'now' end,
    case when p_col = 'collected_at' then 'now' else p_val end);
end $$;
select throws_ok($$select pg_temp.fin('reference_at', 'infinity')$$, '23514', null, 'observations: reference_at infinity recusado');
select throws_ok($$select pg_temp.fin('reference_date', '-infinity')$$, '23514', null, 'observations: reference_date -infinity recusado');
select throws_ok($$select pg_temp.fin('period_start', 'infinity')$$, '23514', null, 'observations: period_start infinity recusado');
select throws_ok($$select pg_temp.fin('period_end', '-infinity')$$, '23514', null, 'observations: period_end -infinity recusado');
select throws_ok($$select pg_temp.fin('collected_at', 'infinity')$$, '23514', null, 'observations: collected_at infinity recusado');
select throws_ok($$select pg_temp.fin('collected_at', '-infinity')$$, '23514', null, 'observations: collected_at -infinity recusado');
select lives_ok($$select pg_temp.fin('reference_date', '2026-11-13')$$, 'observations: data finita é aceita');
select throws_ok($$insert into public.field_validations (snapshot_id, asset_id, metric, status, freshness,
  delta_abs, limit_value, atol, rtol, tolerance_version)
  select 'd6000000-0000-4000-8000-000000000009', a.id, 'roe', 'verified', 'fresh', 1, 3, 1, 1, ''
  from public.assets a where a.symbol = 'DEMO3'$$, '23514', null, 'field_validations: tolerance_version vazio é recusado');

select * from finish();
rollback;

-- P-17: `incomparable` aceita a comparação da calibragem; os outros estados continuam sem.
-- Roda como postgres; troca de papel por `set local role`. Dados sintéticos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
grant collector_ingest to current_user;
grant usage on schema extensions to collector_ingest;

set local role collector_ingest;
insert into public.collection_runs (id, started_at)
  values ('c7000000-0000-4000-8000-000000000001', '2026-11-14T10:00:00Z');
insert into public.staging_observations
  (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   reference_date, collected_at, source_url, methodology_id, parser_version, raw_content_hash)
values
  ('e7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'DEMO3', 'fundamentus',
   'price_to_book', '1,40', 1.40, 'ratio', null, '2026-11-14', '2026-11-14T10:01:00Z',
   'https://www.fundamentus.com.br/exemplo/DEMO3', 'provisional', 'p17', repeat('a', 64)),
  ('e7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 'DEMO3', 'statusinvest',
   'price_to_book', '1,90', 1.90, 'ratio', null, '2026-11-14', '2026-11-14T10:02:00Z',
   'https://statusinvest.com.br/exemplo/DEMO3', 'provisional', 'p17', repeat('b', 64)),
  ('e7000000-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-000000000001', 'TEST4', 'brapi',
   'quote_price', '10,25', 10.25, 'BRL', 'BRL', '2026-11-14', '2026-11-14T10:01:00Z',
   'https://brapi.dev/exemplo/TEST4', 'provisional', 'p17', repeat('c', 64));

-- Os outros estados continuam sem comparação ------------------------------------------------
select throws_ok(
  $$insert into public.staging_validations
      (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids,
       delta_abs, limit_value, atol, rtol, tolerance_version)
    values ('c7000000-0000-4000-8000-000000000001', 'TEST4', 'quote_price', 'single_source', 'fresh',
      null, array['e7000000-0000-4000-8000-000000000003']::uuid[], 0.01, 0.03, 0.02, 0.02, 'draft-1')$$,
  '23514', null, 'single_source com comparação é barrado no staging');
select throws_ok(
  $$insert into public.staging_validations
      (run_id, asset_symbol, metric, status, freshness, observation_ids,
       delta_abs, limit_value, atol, rtol, tolerance_version)
    values ('c7000000-0000-4000-8000-000000000001', 'TEST4', 'roe', 'missing', 'unknown_reference_date',
      '{}', 0.01, 0.03, 0.02, 0.02, 'draft-1')$$,
  '23514', null, 'missing com comparação é barrado no staging');

-- Em incomparable a comparação é tudo ou nada -----------------------------------------------
select throws_ok(
  $$insert into public.staging_validations
      (run_id, asset_symbol, metric, status, freshness, observation_ids, delta_abs)
    values ('c7000000-0000-4000-8000-000000000001', 'DEMO3', 'price_to_book', 'incomparable', 'fresh',
      array['e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002']::uuid[], 0.50)$$,
  '23514', null, 'incomparable com comparação pela metade é barrado no staging');
select throws_ok(
  $$insert into public.staging_validations
      (run_id, asset_symbol, metric, status, freshness, observation_ids,
       delta_abs, limit_value, atol, rtol, tolerance_version)
    values ('c7000000-0000-4000-8000-000000000001', 'DEMO3', 'price_to_book', 'incomparable', 'fresh',
      array['e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002']::uuid[],
      -0.50, 0.03, 0.02, 0.02, 'draft-1')$$,
  '23514', null, 'incomparable com delta negativo é barrado no staging');

-- Calibragem: incomparable com as duas observações e a comparação completa -----------------
select lives_ok(
  $$insert into public.staging_validations
      (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids,
       delta_abs, limit_value, atol, rtol, tolerance_version, reason)
    values
      ('c7000000-0000-4000-8000-000000000001', 'DEMO3', 'price_to_book', 'incomparable', 'fresh', null,
       array['e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002']::uuid[],
       0.50, 0.038, 0.02, 0.02, 'draft-1', 'uncalibrated: tolerância draft-1 ainda não calibrada'),
      ('c7000000-0000-4000-8000-000000000001', 'TEST4', 'quote_price', 'single_source', 'fresh',
       'e7000000-0000-4000-8000-000000000003',
       array['e7000000-0000-4000-8000-000000000003']::uuid[],
       null, null, null, null, null, null)$$,
  'incomparable com comparação completa entra no staging');
select lives_ok(
  $$select public.publish_snapshot('c7000000-0000-4000-8000-000000000001',
    '{"snapshot_id":"snap-p17","run_id":"c7000000-0000-4000-8000-000000000001",
      "collected_at":"2026-11-14T10:05:00Z","universe_version":"p17-1","assets_total":2,"assets_updated":2,
      "failures":[]}'::jsonb)$$,
  'lote de calibragem é publicado como collector_ingest');
reset role;

select is(
  (select count(*)::int from public.observations where run_id = 'c7000000-0000-4000-8000-000000000001'),
  3, 'as duas observações do campo em calibragem são publicadas, com a da cotação');
select ok(
  (select f.status = 'incomparable' and f.selected_observation_id is null
          and cardinality(f.observation_ids) = 2
          and f.delta_abs::text = '0.50' and f.limit_value::text = '0.038'
          and f.atol::text = '0.02' and f.rtol::text = '0.02' and f.tolerance_version = 'draft-1'
   from public.field_validations f
   where f.metric = 'price_to_book'
     and f.snapshot_id = (select snapshot_id from public.active_snapshot where universe = 'stocks')),
  'a comparação da calibragem chega ao banco em colunas próprias, sem escolher lado');

-- A tabela publicada segue a mesma regra do staging ------------------------------------------
select ok(
  (select pg_get_constraintdef(c.oid) like '%incomparable%'
   from pg_constraint c
   where c.conname = 'field_validations_comparison_check'
     and c.conrelid = 'public.field_validations'::regclass),
  'field_validations aceita comparação em incomparable');

select * from finish();
rollback;

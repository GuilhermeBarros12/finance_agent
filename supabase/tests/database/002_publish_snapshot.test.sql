-- T09: publish_snapshot, papel collector_ingest e prune_snapshots.
-- Roda como postgres; troca de papel por `set local role`. Dados sintéticos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);
-- O papel de teste precisa poder assumir collector_ingest (revertido pelo rollback).
grant collector_ingest to current_user;
-- As funções do pgTAP ficam em extensions; os papéis testados precisam enxergá-las (revertido).
grant usage on schema extensions to collector_ingest, authenticated, anon;

-- Estado inicial (seed da T08): snapshot d0000000-...-001 publicado e ativo.
select is(
  (select snapshot_id from public.active_snapshot where universe = 'stocks'),
  'd0000000-0000-4000-8000-000000000001'::uuid,
  'ponto de partida: o snapshot do seed é o ativo');

-- Permissões das funções -----------------------------------------------------------------
select ok(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.publish_snapshot(uuid,jsonb)'::regprocedure and a.grantee = 0),
  'publish_snapshot: sem EXECUTE para PUBLIC (proacl)');
select ok(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.prune_snapshots(integer)'::regprocedure and a.grantee = 0),
  'prune_snapshots: sem EXECUTE para PUBLIC (proacl)');
select ok(
  not has_function_privilege('anon', 'public.publish_snapshot(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.publish_snapshot(uuid,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.publish_snapshot(uuid,jsonb)', 'execute'),
  'publish_snapshot: anon, authenticated e service_role sem execute');
select ok(
  not has_function_privilege('anon', 'public.prune_snapshots(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.prune_snapshots(integer)', 'execute')
  and not has_function_privilege('service_role', 'public.prune_snapshots(integer)', 'execute')
  and not has_function_privilege('collector_ingest', 'public.prune_snapshots(integer)', 'execute'),
  'prune_snapshots: anon, authenticated, service_role e collector_ingest sem execute');
select ok(has_function_privilege('collector_ingest', 'public.publish_snapshot(uuid,jsonb)', 'execute'),
  'collector_ingest executa publish_snapshot');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.publish_snapshot(uuid,jsonb)'::regprocedure),
  'publish_snapshot: security definer com search_path vazio');
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.prune_snapshots(integer)'::regprocedure),
  'prune_snapshots: security definer com search_path vazio');
select ok(not has_function_privilege('authenticated', 'public.reject_unpublished_active_snapshot()', 'execute'),
  'função de trigger do ponteiro sem execute para authenticated');

-- Papel collector_ingest: sem login/senha no repositório e sem poderes extras ----------
select ok((select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb
           and not rolbypassrls from pg_roles where rolname = 'collector_ingest'),
  'collector_ingest: nologin, sem superuser, createrole, createdb e bypassrls');
select ok((select rolpassword is null from pg_authid where rolname = 'collector_ingest'),
  'collector_ingest: nenhuma senha definida pela migration');

select ok(not exists (
  select 1 from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_name in ('messages', 'conversations', 'portfolio_items', 'allowed_users',
                         'llm_usage', 'request_runs')
    and (has_table_privilege('collector_ingest', format('public.%I', t.table_name),
           'select,insert,update,delete,truncate,references,trigger'))),
  'collector_ingest sem privilégio algum em tabelas privadas');
select ok(not exists (
  select 1 from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('messages', 'conversations', 'portfolio_items', 'allowed_users',
                         'llm_usage', 'request_runs')
    and has_column_privilege('collector_ingest', format('public.%I', c.table_name), c.column_name,
          'select,insert,update')),
  'collector_ingest sem privilégio de coluna em tabelas privadas');
select ok(
  not has_table_privilege('collector_ingest', 'public.snapshots', 'select,insert,update,delete,truncate')
  and not has_table_privilege('collector_ingest', 'public.observations', 'select,insert,update,delete,truncate')
  and not has_table_privilege('collector_ingest', 'public.field_validations', 'select,insert,update,delete,truncate')
  and not has_table_privilege('collector_ingest', 'public.active_snapshot', 'select,insert,update,delete,truncate'),
  'collector_ingest não toca snapshots, observations, field_validations nem active_snapshot');

set local role collector_ingest;
select throws_ok('select count(*) from public.messages', '42501', null,
  'collector_ingest não lê messages');
select throws_ok('select count(*) from public.conversations', '42501', null,
  'collector_ingest não lê conversations');
select throws_ok('select count(*) from public.portfolio_items', '42501', null,
  'collector_ingest não lê portfolio_items');
select throws_ok('delete from public.snapshots', '42501', null,
  'collector_ingest não apaga snapshots (sem grant)');
select throws_ok($$update public.snapshots set universe_version = 'x'$$, '42501', null,
  'collector_ingest não altera snapshots');
-- Ligar a variável de retenção não dá poder nenhum a quem não tem DELETE.
select set_config('app.retention_job', 'on', true);
select throws_ok('delete from public.snapshots', '42501', null,
  'collector_ingest com app.retention_job ligado continua sem apagar snapshot');
select throws_ok('delete from public.observations', '42501', null,
  'collector_ingest não apaga observations');
select throws_ok(
  $$insert into public.assets (symbol) values ('HACK3')$$, '42501', null,
  'collector_ingest não cria ativos');
select throws_ok(
  $$insert into public.collection_runs (id, status) values ('c9000000-0000-4000-8000-000000000009', 'succeeded')$$,
  '42501', null, 'collector_ingest não cria execução já encerrada (RLS)');
select ok((select count(*) from public.assets) = 2 and (select count(*) from public.data_sources) = 3,
  'collector_ingest lê assets e data_sources');
select throws_ok(
  $$select public.prune_snapshots(1)$$, '42501', null,
  'collector_ingest não executa prune_snapshots');
reset role;

set local role authenticated;
select throws_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$,
  '42501', null, 'authenticated não executa publish_snapshot');
reset role;
set local role anon;
select throws_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000a1', '{}'::jsonb)$$,
  '42501', null, 'anon não executa publish_snapshot');
reset role;

-- Publicação válida, feita como collector_ingest do começo ao fim ------------------------
set local role collector_ingest;
insert into public.collection_runs (id, started_at)
  values ('c1000000-0000-4000-8000-0000000000a1', '2026-11-14T10:00:00Z');
insert into public.staging_observations
  (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   reference_date, collected_at, source_url, methodology_id, parser_version, raw_content_hash)
values
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'fundamentus',
   'price_to_book', '1,40', 1.40, 'ratio', null, '2026-11-14', '2026-11-14T10:01:00Z',
   'https://www.fundamentus.com.br/exemplo/DEMO3', 'provisional', 't09', repeat('a', 64)),
  ('e1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'statusinvest',
   'price_to_book', '1,41', 1.41, 'ratio', null, '2026-11-14', '2026-11-14T10:02:00Z',
   'https://statusinvest.com.br/exemplo/DEMO3', 'provisional', 't09', repeat('b', 64)),
  ('e1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'fundamentus',
   'dividend_yield', '8,50%', 8.50, 'percent', null, '2026-11-14', '2026-11-14T10:01:00Z',
   'https://www.fundamentus.com.br/exemplo/DEMO3', 'provisional', 't09', repeat('a', 64)),
  ('e1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'statusinvest',
   'dividend_yield', '9,10%', 9.10, 'percent', null, '2026-11-14', '2026-11-14T10:02:00Z',
   'https://statusinvest.com.br/exemplo/DEMO3', 'provisional', 't09', repeat('b', 64)),
  ('e1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-0000000000a1', 'TEST4', 'brapi',
   'quote_price', '10,25', 10.25, 'BRL', 'BRL', '2026-11-14', '2026-11-14T10:01:00Z',
   'https://brapi.dev/exemplo/TEST4', 'provisional', 't09', repeat('c', 64));
insert into public.staging_validations
  (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids,
   delta_abs, limit_value, atol, rtol, tolerance_version, reason)
values
  ('c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'price_to_book', 'verified', 'fresh',
   'e1000000-0000-4000-8000-000000000001',
   array['e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002']::uuid[],
   0.01, 0.03, 0.02, 0.02, 't09', null),
  ('c1000000-0000-4000-8000-0000000000a1', 'DEMO3', 'dividend_yield', 'divergent', 'fresh', null,
   array['e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004']::uuid[],
   0.60, 0.20, 0.20, 0, 't09', 'acima da tolerância'),
  ('c1000000-0000-4000-8000-0000000000a1', 'TEST4', 'quote_price', 'single_source', 'fresh',
   'e1000000-0000-4000-8000-000000000005',
   array['e1000000-0000-4000-8000-000000000005']::uuid[],
   null, null, null, null, null, null),
  ('c1000000-0000-4000-8000-0000000000a1', 'TEST4', 'roe', 'missing', 'unknown_reference_date', null,
   '{}', null, null, null, null, null, 'nenhuma fonte trouxe o campo');
select lives_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000a1',
    '{"collected_at":"2026-11-14T10:05:00Z","universe_version":"t09-1","assets_total":2,
      "failures":[{"asset_id":"TEST4","source_id":"fundamentus","reason":"timeout"}]}'::jsonb)$$,
  'publicação válida roda como collector_ingest');
reset role;

select ok(
  (select s.id from public.snapshots s where s.run_id = 'c1000000-0000-4000-8000-0000000000a1')
  = (select snapshot_id from public.active_snapshot where universe = 'stocks'),
  'publicação válida troca o ponteiro ativo para o novo snapshot');
select ok(
  (select published_at is not null and assets_total = 2 and assets_updated = 2
          and universe_version = 't09-1' and jsonb_array_length(failures) = 1
   from public.snapshots where run_id = 'c1000000-0000-4000-8000-0000000000a1'),
  'snapshot publicado com contagens e falhas do manifesto');
select is(
  (select count(*)::int from public.observations where run_id = 'c1000000-0000-4000-8000-0000000000a1'),
  5, 'cinco observações copiadas');
select is(
  (select count(*)::int from public.field_validations f join public.snapshots s on s.id = f.snapshot_id
   where s.run_id = 'c1000000-0000-4000-8000-0000000000a1'),
  4, 'quatro validações copiadas');
select is(
  (select value_decimal::text from public.observations where id = 'e1000000-0000-4000-8000-000000000004'),
  '9.10', 'valor numeric preservado sem float');
select is(
  (select f.selected_observation_id from public.field_validations f
   where f.metric = 'price_to_book' and f.snapshot_id = (select snapshot_id from public.active_snapshot)),
  'e1000000-0000-4000-8000-000000000001'::uuid, 'id da observação preservado na validação');
select ok(
  (select f.selected_observation_id is null from public.field_validations f
   where f.metric = 'dividend_yield' and f.snapshot_id = (select snapshot_id from public.active_snapshot)),
  'divergent segue sem observação escolhida');
select is(
  (select count(*)::int from public.staging_observations where run_id = 'c1000000-0000-4000-8000-0000000000a1')
  + (select count(*)::int from public.staging_validations where run_id = 'c1000000-0000-4000-8000-0000000000a1'),
  0, 'staging do run limpo após publicar');
select is(
  (select status from public.collection_runs where id = 'c1000000-0000-4000-8000-0000000000a1'),
  'succeeded', 'execução marcada como succeeded');
select throws_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000a1',
    '{"collected_at":"2026-11-14T10:05:00Z","universe_version":"t09-1","assets_total":2}'::jsonb)$$,
  '23000', null, 'o mesmo run não publica duas vezes');
select throws_ok(
  $$update public.snapshots set universe_version = 'x' where run_id = 'c1000000-0000-4000-8000-0000000000a1'$$,
  '23000', null, 'snapshot publicado pela RPC é imutável');

-- A partir daqui o ativo é o snapshot t09; guardamos o id para provar que nada o troca.
create temp table t09_ativo as select snapshot_id from public.active_snapshot where universe = 'stocks';
grant select on t09_ativo to public;

-- Falhas de integridade: nenhuma troca o ponteiro ---------------------------------------
-- Staging vazio
insert into public.collection_runs (id) values ('c1000000-0000-4000-8000-0000000000b1');
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000b1',
    '{"collected_at":"2026-11-14T11:00:00Z","universe_version":"v","assets_total":2}'::jsonb)$$,
  '%staging sem observações%', 'staging vazio não publica');
select ok((select snapshot_id from public.active_snapshot where universe = 'stocks')
          = (select snapshot_id from t09_ativo), 'staging vazio não troca o ponteiro');
select is((select count(*)::int from public.snapshots where run_id = 'c1000000-0000-4000-8000-0000000000b1'),
  0, 'staging vazio não deixa snapshot');

-- Manifesto inválido
select throws_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000b1', '{"assets_total":2}'::jsonb)$$,
  '22023', null, 'manifesto sem campos obrigatórios é recusado');

-- Metade do universo: 1 ativo de 4 não publica
insert into public.staging_observations
  (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   collected_at, source_url, parser_version, raw_content_hash)
values ('e2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000b1', 'DEMO3', 'brapi',
   'quote_price', '5,00', 5.00, 'BRL', 'BRL', '2026-11-14T11:00:00Z',
   'https://brapi.dev/exemplo/DEMO3', 't09', repeat('d', 64));
insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids)
values ('c1000000-0000-4000-8000-0000000000b1', 'DEMO3', 'quote_price', 'single_source', 'fresh',
  'e2000000-0000-4000-8000-000000000001', array['e2000000-0000-4000-8000-000000000001']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000b1',
    '{"collected_at":"2026-11-14T11:00:00Z","universe_version":"v","assets_total":4}'::jsonb)$$,
  '%cobertura insuficiente%', 'menos da metade do universo não publica');
select ok((select snapshot_id from public.active_snapshot where universe = 'stocks')
          = (select snapshot_id from t09_ativo), 'cobertura insuficiente não troca o ponteiro');
select is((select count(*)::int from public.staging_observations where run_id = 'c1000000-0000-4000-8000-0000000000b1'),
  1, 'staging do lote recusado permanece intacto');

-- Exatamente metade (2 de 4) publica, como lote parcial
insert into public.staging_observations
  (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   collected_at, source_url, parser_version, raw_content_hash)
values ('e2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-0000000000b1', 'TEST4', 'brapi',
   'quote_price', '6,00', 6.00, 'BRL', 'BRL', '2026-11-14T11:00:00Z',
   'https://brapi.dev/exemplo/TEST4', 't09', repeat('e', 64));
insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids)
values ('c1000000-0000-4000-8000-0000000000b1', 'TEST4', 'quote_price', 'single_source', 'fresh',
  'e2000000-0000-4000-8000-000000000002', array['e2000000-0000-4000-8000-000000000002']::uuid[]);
select lives_ok(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000b1',
    '{"collected_at":"2026-11-14T11:00:00Z","universe_version":"v","assets_total":4}'::jsonb)$$,
  'exatamente metade do universo publica');
select is((select status from public.collection_runs where id = 'c1000000-0000-4000-8000-0000000000b1'),
  'partial', 'lote com cobertura parcial fica como partial');
select is((select assets_total::text || '/' || assets_updated::text from public.snapshots
           where run_id = 'c1000000-0000-4000-8000-0000000000b1'), '4/2',
  'o manifesto de cobertura registra 2 de 4');

-- Chave duplicada, ativo e fonte inexistentes, validações incoerentes
create function pg_temp.novo_run(p uuid) returns void language sql as
  $$ insert into public.collection_runs (id) values (p) $$;
create function pg_temp.obs(p_run uuid, p_id uuid, p_asset text, p_source text, p_metric text)
returns void language sql as $$
  insert into public.staging_observations
    (id, run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
     collected_at, source_url, parser_version, raw_content_hash)
  values (p_id, p_run, p_asset, p_source, p_metric, '1,00', 1.00,
    case p_metric when 'quote_price' then 'BRL' else 'ratio' end,
    case p_metric when 'quote_price' then 'BRL' else null end,
    '2026-11-14T12:00:00Z', 'https://brapi.dev/exemplo/x', 't09', repeat('f', 64)) $$;
create function pg_temp.val(p_run uuid, p_asset text, p_metric text, p_status text, p_ids uuid[])
returns void language sql as $$
  insert into public.staging_validations (run_id, asset_symbol, metric, status, freshness, observation_ids)
  values (p_run, p_asset, p_metric, p_status, 'fresh', p_ids) $$;

select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c1');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c1', 'e3000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c1', 'e3000000-0000-4000-8000-000000000002', 'DEMO3', 'brapi', 'quote_price');
select pg_temp.val('c1000000-0000-4000-8000-0000000000c1', 'DEMO3', 'quote_price', 'single_source',
  array['e3000000-0000-4000-8000-000000000001']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c1',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%observação duplicada%', 'chave duplicada (ativo, métrica, fonte) não publica');

select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c2');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c2', 'e4000000-0000-4000-8000-000000000001', 'XXXX9', 'brapi', 'quote_price');
select pg_temp.val('c1000000-0000-4000-8000-0000000000c2', 'XXXX9', 'quote_price', 'single_source',
  array['e4000000-0000-4000-8000-000000000001']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c2',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%ativo inexistente: XXXX9%', 'ativo inexistente impede a publicação');

select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c3');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c3', 'e5000000-0000-4000-8000-000000000001', 'DEMO3', 'fonte_fantasma', 'quote_price');
select pg_temp.val('c1000000-0000-4000-8000-0000000000c3', 'DEMO3', 'quote_price', 'single_source',
  array['e5000000-0000-4000-8000-000000000001']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c3',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%fonte inexistente: fonte_fantasma%', 'fonte inexistente impede a publicação');

-- Validação que aponta observação de outro ativo ou de outra métrica
select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c4');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c4', 'e6000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c4', 'e6000000-0000-4000-8000-000000000002', 'TEST4', 'brapi', 'quote_price');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c4', 'e6000000-0000-4000-8000-000000000003', 'DEMO3', 'brapi', 'price_to_book');
select pg_temp.val('c1000000-0000-4000-8000-0000000000c4', 'DEMO3', 'quote_price', 'single_source',
  array['e6000000-0000-4000-8000-000000000002']::uuid[]);  -- observação de TEST4
select pg_temp.val('c1000000-0000-4000-8000-0000000000c4', 'TEST4', 'quote_price', 'single_source',
  array['e6000000-0000-4000-8000-000000000002']::uuid[]);
select pg_temp.val('c1000000-0000-4000-8000-0000000000c4', 'DEMO3', 'price_to_book', 'single_source',
  array['e6000000-0000-4000-8000-000000000003']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c4',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":2}'::jsonb)$$,
  '%outro ativo, métrica ou execução%', 'validação com observação de outro ativo não publica');
delete from public.staging_validations where run_id = 'c1000000-0000-4000-8000-0000000000c4'
  and asset_symbol = 'DEMO3' and metric = 'quote_price';
select pg_temp.val('c1000000-0000-4000-8000-0000000000c4', 'DEMO3', 'quote_price', 'single_source',
  array['e6000000-0000-4000-8000-000000000003']::uuid[]);  -- observação de outra métrica
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c4',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":2}'::jsonb)$$,
  '%outro ativo, métrica ou execução%', 'validação com observação de outra métrica não publica');

-- Estado incoerente: verified com uma só observação / com duas observações da mesma fonte
select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c5');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c5', 'e7000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
insert into public.staging_validations
  (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids,
   delta_abs, limit_value, atol, rtol, tolerance_version)
values ('c1000000-0000-4000-8000-0000000000c5', 'DEMO3', 'quote_price', 'verified', 'fresh',
  'e7000000-0000-4000-8000-000000000001', array['e7000000-0000-4000-8000-000000000001']::uuid[],
  0, 0.1, 0.1, 0, 't09');
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c5',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%validação incoerente%', 'verified com uma só observação não publica');

-- Selecionada fora de observation_ids; divergent com seleção (barrado já no staging)
select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c6');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c6', 'e8000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c6', 'e8000000-0000-4000-8000-000000000002', 'DEMO3', 'fundamentus', 'quote_price');
insert into public.staging_validations
  (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids)
values ('c1000000-0000-4000-8000-0000000000c6', 'DEMO3', 'quote_price', 'incomparable', 'fresh',
  'e8000000-0000-4000-8000-000000000002', array['e8000000-0000-4000-8000-000000000001']::uuid[]);
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c6',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%selecionada fora de observation_ids%', 'observação selecionada fora de observation_ids não publica');
select throws_ok(
  $$insert into public.staging_validations
     (run_id, asset_symbol, metric, status, freshness, selected_observation_id, observation_ids,
      delta_abs, limit_value, atol, rtol, tolerance_version)
    values ('c1000000-0000-4000-8000-0000000000c6', 'DEMO3', 'roe', 'divergent', 'fresh',
      'e8000000-0000-4000-8000-000000000001', array['e8000000-0000-4000-8000-000000000001']::uuid[],
      1, 0.1, 0.1, 0, 't09')$$,
  '23514', null, 'divergent com observação escolhida é barrado no staging');

-- Observação sem validação do seu campo
select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000c7');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000c7', 'e9000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000c7',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%observação sem validação%', 'observação sem validação do campo não publica');

select ok((select snapshot_id from public.active_snapshot where universe = 'stocks')
          <> (select snapshot_id from t09_ativo), 'sanidade: o lote parcial b1 trocou o ponteiro');
update public.active_snapshot set snapshot_id = (select snapshot_id from t09_ativo) where universe = 'stocks';

-- Atomicidade: erro no meio da cópia não deixa snapshot parcial -----------------------------
select pg_temp.novo_run('c1000000-0000-4000-8000-0000000000d1');
select pg_temp.obs('c1000000-0000-4000-8000-0000000000d1', 'ea000000-0000-4000-8000-000000000001', 'DEMO3', 'brapi', 'quote_price');
select pg_temp.val('c1000000-0000-4000-8000-0000000000d1', 'DEMO3', 'quote_price', 'single_source',
  array['ea000000-0000-4000-8000-000000000001']::uuid[]);
create function public.t09_boom() returns trigger language plpgsql as
  $$ begin raise exception 'falha injetada no meio da publicação'; end $$;
create trigger t09_boom before insert on public.field_validations
  for each row execute function public.t09_boom();
select throws_like(
  $$select public.publish_snapshot('c1000000-0000-4000-8000-0000000000d1',
    '{"collected_at":"2026-11-14T12:00:00Z","universe_version":"v","assets_total":1}'::jsonb)$$,
  '%falha injetada%', 'erro no meio da cópia aborta a publicação');
drop trigger t09_boom on public.field_validations;
select is(
  (select count(*)::int from public.snapshots where run_id = 'c1000000-0000-4000-8000-0000000000d1')
  + (select count(*)::int from public.observations where run_id = 'c1000000-0000-4000-8000-0000000000d1'),
  0, 'atomicidade: nenhum snapshot nem observação parcial');
select ok((select snapshot_id from public.active_snapshot where universe = 'stocks')
          = (select snapshot_id from t09_ativo), 'atomicidade: o ponteiro não mudou');
select is(
  (select count(*)::int from public.staging_observations where run_id = 'c1000000-0000-4000-8000-0000000000d1'),
  1, 'atomicidade: o staging do lote falho permanece');

-- Ponteiro só para snapshot publicado -----------------------------------------------------
insert into public.collection_runs (id) values ('c1000000-0000-4000-8000-0000000000e1');
insert into public.snapshots (id, run_id, collected_at)
  values ('d1000000-0000-4000-8000-0000000000e1', 'c1000000-0000-4000-8000-0000000000e1', now());
select throws_ok(
  $$update public.active_snapshot set snapshot_id = 'd1000000-0000-4000-8000-0000000000e1'$$,
  '23000', null, 'active_snapshot não aponta para snapshot não publicado');

-- prune_snapshots -------------------------------------------------------------------------
-- Dois snapshots antigos: o do seed (publicado em 2026-09-18) volta a ser o ativo e deve
-- sobreviver; um snapshot antigo e inativo deve sumir com suas observações.
insert into public.collection_runs (id) values ('c1000000-0000-4000-8000-0000000000f1');
insert into public.snapshots (id, run_id, collected_at, assets_total, assets_updated)
  values ('d2000000-0000-4000-8000-0000000000f1', 'c1000000-0000-4000-8000-0000000000f1',
          now() - interval '90 days', 1, 1);
insert into public.observations
  (id, snapshot_id, asset_id, source_id, metric, raw_value, value_decimal, unit, currency,
   collected_at, source_url, run_id, parser_version, raw_content_hash)
values ('eb000000-0000-4000-8000-0000000000f1', 'd2000000-0000-4000-8000-0000000000f1',
  'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'quote_price',
  '3,00', 3.00, 'BRL', 'BRL', now() - interval '90 days', 'https://brapi.dev/exemplo/DEMO3',
  'c1000000-0000-4000-8000-0000000000f1', 't09', repeat('9', 64));
update public.snapshots set published_at = now() - interval '90 days'
  where id = 'd2000000-0000-4000-8000-0000000000f1';
update public.active_snapshot set snapshot_id = 'd0000000-0000-4000-8000-000000000001'
  where universe = 'stocks';
select ok((select published_at < now() - interval '30 days' from public.snapshots
           where id = 'd0000000-0000-4000-8000-000000000001'),
  'o snapshot ativo (seed) é mais velho que 30 dias');
insert into public.staging_observations
  (run_id, asset_symbol, source_code, metric, raw_value, value_decimal, unit, currency,
   collected_at, source_url, parser_version, raw_content_hash, created_at)
values ('c1000000-0000-4000-8000-0000000000f1', 'DEMO3', 'brapi', 'quote_price', '1,00', 1.00, 'BRL', 'BRL',
  now(), 'https://brapi.dev/exemplo/DEMO3', 't09', repeat('8', 64), now() - interval '60 days');

select throws_ok($$select public.prune_snapshots(0)$$, '22023', null, 'p_keep_days inválido é recusado');
select ok(public.prune_snapshots(30) >= 1, 'prune_snapshots apaga snapshots antigos');
select ok(exists (select 1 from public.snapshots where id = 'd0000000-0000-4000-8000-000000000001')
          and (select snapshot_id from public.active_snapshot where universe = 'stocks')
              = 'd0000000-0000-4000-8000-000000000001',
  'prune_snapshots não apaga o snapshot ativo, mesmo velho');
select ok(exists (select 1 from public.observations where snapshot_id = 'd0000000-0000-4000-8000-000000000001')
          and exists (select 1 from public.field_validations where snapshot_id = 'd0000000-0000-4000-8000-000000000001'),
  'observações e validações do ativo permanecem');
select is(
  (select count(*)::int from public.snapshots where id = 'd2000000-0000-4000-8000-0000000000f1')
  + (select count(*)::int from public.observations where snapshot_id = 'd2000000-0000-4000-8000-0000000000f1'),
  0, 'o snapshot antigo inativo some com suas observações');
select is(
  (select count(*)::int from public.staging_observations where run_id = 'c1000000-0000-4000-8000-0000000000f1'),
  0, 'staging abandonado antigo expira');
select ok(exists (select 1 from public.snapshots s
           where s.run_id = 'c1000000-0000-4000-8000-0000000000a1'),
  'snapshot recente (a1) sobrevive à retenção de 30 dias');
select is(coalesce(current_setting('app.retention_job', true), ''), 'off',
  'a variável de retenção volta a off ao fim do prune');
select throws_ok($$delete from public.snapshots where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23000', null, 'sem a rotina de retenção, snapshot publicado segue imutável');

select * from finish();
rollback;

-- T08: RLS, grants e integridade. Roda como postgres; troca de papel por `set local role`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Usuários sintéticos: ana (autorizada), bia (autorizada), caio (existe, não autorizado).
insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');
insert into public.allowed_users (user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

insert into public.conversations (id, user_id, title) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Conversa da Ana'),
  ('c2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Conversa da Bia'),
  ('c3000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Conversa do Caio');
insert into public.messages (conversation_id, user_id, role, sequence_no, content) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'user', 1, 'oi'),
  ('c3000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'user', 1, 'oi');
insert into public.portfolio_items (user_id, asset_id) values
  ('22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000001');

-- Estrutura -------------------------------------------------------------------------
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  'RLS habilitado em todas as tabelas de public');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'),
  13, 'treze tabelas em public (sem relatorios_pdf nem usage_counters)');

-- Seed ------------------------------------------------------------------------------
select is(
  (select array_agg(status order by status) from public.field_validations),
  array['divergent', 'incomparable', 'missing', 'verified'],
  'seed cobre divergent, incomparable, missing e verified');

-- anon não lê nada -------------------------------------------------------------------
set local role anon;
select throws_ok('select * from public.assets', '42501', null, 'anon não lê assets');
select throws_ok('select * from public.observations', '42501', null, 'anon não lê observations');
select throws_ok('select * from public.conversations', '42501', null, 'anon não lê conversations');
select throws_ok('select * from public.messages', '42501', null, 'anon não lê messages');
select throws_ok('select * from public.allowed_users', '42501', null, 'anon não lê allowed_users');
select throws_ok('select * from public.portfolio_items', '42501', null, 'anon não lê portfolio_items');
select throws_ok('select * from public.llm_usage', '42501', null, 'anon não lê llm_usage');
reset role;

-- Usuário não autorizado (caio) não lê nada ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select is((select count(*)::int from public.conversations), 0, 'não autorizado não lê conversations');
select is((select count(*)::int from public.messages), 0, 'não autorizado não lê messages');
select is((select count(*)::int from public.allowed_users), 0, 'não autorizado não vê allowed_users');
select throws_ok(
  $$insert into public.conversations (user_id, title) values ('33333333-3333-4333-8333-333333333333', 'x')$$,
  '42501', null, 'não autorizado não cria conversa');
select throws_ok('select * from public.assets', '42501', null, 'autenticado não lê dados de mercado');

-- Ana: dono autorizado ------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is((select count(*)::int from public.conversations), 1, 'dono lê só as suas conversas');
select is((select count(*)::int from public.messages), 1, 'dono lê só as suas mensagens');
select throws_ok(
  $$insert into public.messages (conversation_id, user_id, role, sequence_no, content)
    values ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'assistant', 2, 'falso')$$,
  '42501', null, 'cliente não insere mensagem com role assistant');
select throws_ok(
  $$insert into public.messages (conversation_id, user_id, role, sequence_no, content)
    values ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'user', 2, 'x')$$,
  '42501', null, 'cliente não insere mensagem nenhuma');
select throws_ok(
  $$insert into public.conversations (user_id, title) values ('22222222-2222-4222-8222-222222222222', 'x')$$,
  '42501', null, 'dono não cria conversa em nome de outro (RLS)');

-- Carteira: isolamento e FK ----------------------------------------------------------------
select is((select count(*)::int from public.portfolio_items), 0, 'usuário não lê a carteira de outro');
delete from public.portfolio_items;
reset role;
select is((select count(*)::int from public.portfolio_items), 1, 'delete na carteira de outro não apaga nada');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.portfolio_items (user_id, asset_id)
    values ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001')$$,
  'dono adiciona ação à carteira');
select throws_ok(
  $$insert into public.portfolio_items (user_id, asset_id)
    values ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-0000000000ff')$$,
  '23503', null, 'carteira recusa ativo que não existe em assets');
select throws_ok(
  $$insert into public.portfolio_items (user_id, asset_id)
    values ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'carteira recusa item duplicado');
reset role;

-- Integridade e imutabilidade (como postgres) -----------------------------------------------
select throws_ok(
  $$insert into public.messages (conversation_id, user_id, role, sequence_no, content)
    values ('c1000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'user', 5, 'x')$$,
  '23503', null, 'mensagem com dono diferente do da conversa é recusada (FK composta)');
select throws_ok(
  $$update public.snapshots set universe = 'outro' where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23000', null, 'snapshot publicado rejeita update');
select throws_ok(
  $$delete from public.snapshots where id = 'd0000000-0000-4000-8000-000000000001'$$,
  '23000', null, 'snapshot publicado rejeita delete');
select throws_ok(
  $$insert into public.observations (snapshot_id, asset_id, source_id, metric, raw_value, value_decimal,
      unit, collected_at, source_url, run_id, parser_version, raw_content_hash)
    values ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
      'b0000000-0000-4000-8000-000000000003', 'quote_price', '10,00', 10.00, 'BRL', now(),
      'https://brapi.dev/x', 'c0000000-0000-4000-8000-000000000001', 'seed-1', repeat('e', 64))$$,
  '23000', null, 'não entra observação em snapshot publicado');

-- Rotina de retenção: única exceção à imutabilidade (apaga em cascata).
select set_config('app.retention_job', 'on', true);
select lives_ok(
  $$delete from public.active_snapshot$$, 'ponteiro ativo pode ser removido');
select lives_ok(
  $$delete from public.snapshots where id = 'd0000000-0000-4000-8000-000000000001'$$,
  'retenção apaga snapshot publicado');

select * from finish();
rollback;

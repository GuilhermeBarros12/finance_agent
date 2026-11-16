-- T18: colunas de idempotência de request_runs (hash do corpo e resposta gravada).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.allowed_users (user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.conversations (id, user_id, title) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ana');

select has_column('public', 'request_runs', 'body_hash', 'request_runs.body_hash existe');
select has_column('public', 'request_runs', 'response', 'request_runs.response existe');

select lives_ok(
  $$insert into public.request_runs (user_id, request_id, conversation_id, body_hash)
    values ('11111111-1111-4111-8111-111111111111', '6e51ed30-9fd4-48fd-9a19-060f8197cda1',
            'c1000000-0000-4000-8000-000000000001', repeat('a', 64))$$,
  'reserva com hash de 64 hex é aceita');

select throws_ok(
  $$insert into public.request_runs (user_id, request_id, body_hash)
    values ('11111111-1111-4111-8111-111111111111', '7e51ed30-9fd4-48fd-9a19-060f8197cda1', 'ABC')$$,
  '23514', null, 'hash fora de SHA-256 hex minúsculo é recusado');

select throws_ok(
  $$insert into public.request_runs (user_id, request_id, status, response)
    values ('11111111-1111-4111-8111-111111111111', '8e51ed30-9fd4-48fd-9a19-060f8197cda1',
            'processing', '{}'::jsonb)$$,
  '23514', null, 'resposta gravada só existe em execução concluída');

select lives_ok(
  $$update public.request_runs set status = 'succeeded', response = '{"ok": true}'::jsonb
    where request_id = '6e51ed30-9fd4-48fd-9a19-060f8197cda1'$$,
  'concluir grava status e resposta juntos');

select throws_ok(
  $$insert into public.request_runs (user_id, request_id, conversation_id, body_hash)
    values ('11111111-1111-4111-8111-111111111111', '9e51ed30-9fd4-48fd-9a19-060f8197cda1',
            'c1000000-0000-4000-8000-000000000001', repeat('b', 64)),
           ('11111111-1111-4111-8111-111111111111', '6e51ed30-9fd4-48fd-9a19-060f8197cda1',
            'c1000000-0000-4000-8000-000000000001', repeat('b', 64))$$,
  '23505', null, 'o mesmo (user_id, request_id) continua único');

-- A conversa de outro dono continua barrada pela FK composta.
select throws_ok(
  $$insert into public.request_runs (user_id, request_id, conversation_id, body_hash)
    values ('22222222-2222-4222-8222-222222222222', 'ae51ed30-9fd4-48fd-9a19-060f8197cda1',
            'c1000000-0000-4000-8000-000000000001', repeat('c', 64))$$,
  '23503', null, 'request_runs não aceita conversa de outro dono');

-- O dono lê a própria execução, mas não escreve (grants da T08 intactos).
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select count(*)::int from public.request_runs), 1, 'o dono lê a própria execução');
select throws_ok(
  $$update public.request_runs set response = '{"forjada": true}'::jsonb$$,
  '42501', null, 'o dono não altera a resposta gravada');

select * from finish();
rollback;

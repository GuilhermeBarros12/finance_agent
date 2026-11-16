-- T21b: inserir mensagem move conversations.updated_at. Roda como postgres.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.allowed_users (user_id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.conversations (id, user_id, title) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ana'),
  ('c2000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Bia');

-- Recua updated_at sem disparar o gatilho de before update.
alter table public.conversations disable trigger conversations_touch;
update public.conversations set updated_at = '2020-01-01T00:00:00Z';
alter table public.conversations enable trigger conversations_touch;

select ok(not has_function_privilege('authenticated', 'public.touch_conversation_on_message()', 'execute')
  and not has_function_privilege('anon', 'public.touch_conversation_on_message()', 'execute'),
  'cliente não executa a função do gatilho');
select ok((select prosecdef from pg_proc where oid = 'public.touch_conversation_on_message()'::regprocedure),
  'security definer');
select ok((select proconfig from pg_proc where oid = 'public.touch_conversation_on_message()'::regprocedure)
  @> array['search_path=""'], 'search_path vazio');

insert into public.messages (conversation_id, user_id, role, sequence_no, content) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'user', 1, 'oi');

select ok((select updated_at > '2020-01-01T00:00:00Z' from public.conversations
  where id = 'c1000000-0000-4000-8000-000000000001'), 'mensagem nova move a conversa');
select is((select updated_at from public.conversations where id = 'c2000000-0000-4000-8000-000000000002'),
  '2020-01-01T00:00:00Z'::timestamptz, 'conversa de outro dono não muda');

-- O cliente continua sem escrever mensagens e sem alterar updated_at.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select throws_ok(
  $$insert into public.messages (conversation_id, user_id, role, sequence_no, content)
    values ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'user', 2, 'x')$$,
  '42501', null, 'o dono continua sem inserir mensagem');
select throws_ok(
  $$update public.conversations set updated_at = now()$$,
  '42501', null, 'o dono continua sem alterar updated_at');

select * from finish();
rollback;

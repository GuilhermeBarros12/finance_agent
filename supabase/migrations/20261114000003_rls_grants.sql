-- T08, arquivo 3 de 3: RLS e grants (README 8.3, com allowed_users no lugar de beta_users).
-- RLS não substitui grants: primeiro revoga tudo de anon e authenticated, depois concede
-- o mínimo por coluna. O Supabase concede tudo por padrão a tabelas novas em `public`.

alter table public.assets enable row level security;
alter table public.data_sources enable row level security;
alter table public.collection_runs enable row level security;
alter table public.snapshots enable row level security;
alter table public.observations enable row level security;
alter table public.field_validations enable row level security;
alter table public.active_snapshot enable row level security;
alter table public.allowed_users enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.request_runs enable row level security;
alter table public.llm_usage enable row level security;
alter table public.portfolio_items enable row level security;

-- Dados de mercado: nenhum acesso do navegador (sem política = negado). A leitura
-- passa pela Edge Function com o papel do backend.
revoke all on public.assets, public.data_sources, public.collection_runs,
  public.snapshots, public.observations, public.field_validations,
  public.active_snapshot, public.llm_usage
  from anon, authenticated;

revoke all on public.allowed_users, public.conversations, public.messages,
  public.request_runs, public.portfolio_items
  from anon, authenticated;

-- allowed_users: o usuário lê o próprio estado; só a administração altera.
grant select on public.allowed_users to authenticated;
create policy allowed_users_read_self
  on public.allowed_users for select to authenticated
  using (user_id = (select auth.uid()));

-- SECURITY INVOKER: a consulta a allowed_users continua sujeita a RLS.
create function public.is_allowed_user()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_users a
    where a.user_id = (select auth.uid()) and a.enabled
  );
$$;

revoke all on function public.is_allowed_user() from public;
grant execute on function public.is_allowed_user() to authenticated;

-- conversations: o dono autorizado lê, cria, renomeia e apaga.
grant select, delete on public.conversations to authenticated;
grant insert (user_id, title) on public.conversations to authenticated;
grant update (title) on public.conversations to authenticated;

create policy conversations_read_own
  on public.conversations for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy conversations_insert_own
  on public.conversations for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy conversations_update_own
  on public.conversations for update to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()))
  with check (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy conversations_delete_own
  on public.conversations for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

-- messages e request_runs: o dono lê; nenhuma escrita do cliente (D21: o backend grava).
grant select on public.messages to authenticated;
create policy messages_read_own
  on public.messages for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

grant select on public.request_runs to authenticated;
create policy request_runs_read_own
  on public.request_runs for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

-- llm_usage: contador global, sem acesso do cliente (RLS ligado, sem política, sem grant).

-- portfolio_items: o dono lê, adiciona e remove. Não há update.
grant select, delete on public.portfolio_items to authenticated;
grant insert (user_id, asset_id) on public.portfolio_items to authenticated;

create policy portfolio_items_read_own
  on public.portfolio_items for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy portfolio_items_insert_own
  on public.portfolio_items for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy portfolio_items_delete_own
  on public.portfolio_items for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

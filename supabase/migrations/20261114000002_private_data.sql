-- T08, arquivo 2 de 3: dados privados (um dono por linha). README 8.1 e 8.2,
-- ADR 0002 E14 a E16 (carteira). `allowed_users` substitui `beta_users`.

create table public.allowed_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_id_owner_unique unique (id, user_id),
  constraint conversations_title_check check (char_length(title) between 1 and 200)
);

create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at, id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null,
  role text not null,
  sequence_no integer not null,
  content text not null default '',
  content_version integer not null default 1,
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint messages_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references public.conversations (id, user_id) on delete cascade,
  constraint messages_sequence_unique unique (conversation_id, sequence_no),
  constraint messages_role_check check (role in ('user', 'assistant')),
  constraint messages_sequence_check check (sequence_no >= 1),
  constraint messages_content_version_check check (content_version >= 1),
  constraint messages_content_length_check check (char_length(content) <= 20000)
);

create index messages_conversation_sequence_idx
  on public.messages (conversation_id, sequence_no);

create table public.request_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  conversation_id uuid,
  status text not null default 'processing',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_runs_idempotency unique (user_id, request_id),
  constraint request_runs_conversation_fk
    foreign key (conversation_id, user_id)
    references public.conversations (id, user_id) on delete cascade,
  constraint request_runs_status_check
    check (status in ('processing', 'succeeded', 'failed'))
);

-- Contador global por dia e provedor (não é por usuário). Só o backend toca.
create table public.llm_usage (
  usage_date date not null,
  provider text not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (usage_date, provider),
  constraint llm_usage_count_check check (request_count >= 0)
);

-- Carteira: só o símbolo da ação. Sem quantidade, preço ou valor (E16). Nunca vai ao LLM.
create table public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id),
  created_at timestamptz not null default now(),
  constraint portfolio_items_unique unique (user_id, asset_id)
);

create index portfolio_items_user_idx on public.portfolio_items (user_id, created_at);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();
create trigger request_runs_touch before update on public.request_runs
  for each row execute function public.touch_updated_at();
create trigger llm_usage_touch before update on public.llm_usage
  for each row execute function public.touch_updated_at();

revoke all on function public.touch_updated_at() from public, anon, authenticated;

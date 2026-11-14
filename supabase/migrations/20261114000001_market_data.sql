-- T08, arquivo 1 de 3: dados de mercado (compartilhados, sem dono).
-- README 8.1 e 8.2. Chaves uuid, eventos timestamptz, valores numeric (nunca float).
-- Nenhuma tabela daqui é exposta ao navegador: o RLS é habilitado no arquivo 3 e a
-- leitura passa pela Edge Function.

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  asset_class text not null default 'stock',
  name text,
  reference_links jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint assets_symbol_unique unique (symbol),
  constraint assets_symbol_format check (symbol ~ '^[A-Z0-9]{1,12}$'),
  constraint assets_class_check check (asset_class in ('stock'))
);

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null,
  base_url text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint data_sources_code_unique unique (code),
  constraint data_sources_base_url_check check (base_url ~* '^https?://[^@\s]+$')
);

create table public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  parser_versions jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint collection_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint collection_runs_finished_check
    check (finished_at is null or finished_at >= started_at)
);

create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.collection_runs (id),
  universe text not null default 'stocks',
  collected_at timestamptz not null,
  universe_version text,
  assets_total integer not null default 0,
  assets_updated integer not null default 0,
  failures jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint snapshots_counts_check
    check (assets_total >= 0 and assets_updated >= 0 and assets_updated <= assets_total)
);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  asset_id uuid not null references public.assets (id),
  source_id uuid not null references public.data_sources (id),
  metric text not null,
  raw_value text not null,
  value_decimal numeric not null,
  unit text not null,
  currency text,
  period_start date,
  period_end date,
  reference_at timestamptz,
  reference_date date,
  collected_at timestamptz not null,
  source_url text not null,
  upstream_source text,
  methodology_id text not null default 'unknown',
  run_id uuid not null references public.collection_runs (id),
  parser_version text not null,
  raw_content_hash text not null,
  created_at timestamptz not null default now(),
  constraint observations_unique_per_source
    unique (snapshot_id, asset_id, metric, source_id),
  constraint observations_metric_check check (metric in (
    'quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe')),
  constraint observations_unit_check check (
    (metric = 'quote_price' and unit = 'BRL' and currency = 'BRL')
    or (metric in ('price_to_book', 'price_to_earnings') and unit = 'ratio' and currency is null)
    or (metric in ('dividend_yield', 'roe') and unit = 'percent' and currency is null)),
  constraint observations_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint observations_url_check check (source_url ~* '^https?://[^@\s]+$'),
  constraint observations_hash_check check (raw_content_hash ~ '^[0-9a-f]{64}$')
);

create index observations_snapshot_idx
  on public.observations (snapshot_id, asset_id, metric, source_id);

create table public.field_validations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots (id) on delete cascade,
  asset_id uuid not null references public.assets (id),
  metric text not null,
  status text not null,
  freshness text not null,
  -- Sem ON DELETE SET NULL: esse FK geraria um UPDATE em linha publicada na retenção.
  selected_observation_id uuid references public.observations (id),
  observation_ids uuid[] not null default '{}',
  delta_abs numeric,
  limit_value numeric,
  atol numeric,
  rtol numeric,
  tolerance_version text,
  reason text,
  created_at timestamptz not null default now(),
  constraint field_validations_unique unique (snapshot_id, asset_id, metric),
  constraint field_validations_metric_check check (metric in (
    'quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe')),
  constraint field_validations_status_check check (status in (
    'verified', 'divergent', 'single_source', 'incomparable',
    'missing', 'not_applicable', 'invalid')),
  constraint field_validations_freshness_check check (freshness in (
    'fresh', 'stale', 'expired', 'unknown_reference_date')),
  -- README 7.6: divergência não escolhe um lado.
  constraint field_validations_divergent_no_pick
    check (status <> 'divergent' or selected_observation_id is null),
  constraint field_validations_comparison_check check (
    (status in ('verified', 'divergent')
      and delta_abs is not null and limit_value is not null
      and atol is not null and rtol is not null and tolerance_version is not null
      and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)
    or (status not in ('verified', 'divergent')
      and delta_abs is null and limit_value is null and atol is null and rtol is null)),
  -- Ausência, não aplicável e inválido nunca apontam observação (README 7.5).
  constraint field_validations_no_selection_check check (
    status not in ('missing', 'invalid', 'not_applicable')
    or selected_observation_id is null)
);

create index field_validations_snapshot_idx
  on public.field_validations (snapshot_id, asset_id);

create table public.active_snapshot (
  universe text primary key,
  snapshot_id uuid not null references public.snapshots (id),
  updated_at timestamptz not null default now()
);

-- Imutabilidade (T08, passo 1). Um snapshot publicado (published_at preenchido) não
-- aceita update nem delete, e suas observações e validações também não mudam. A única
-- exceção é a rotina de retenção, que liga `app.retention_job` na própria transação
-- (set_config(..., true)) e libera SÓ o DELETE. UPDATE e INSERT seguem rejeitados.
-- Nota para a T09: selected_observation_id e observation_ids não garantem que a
-- observação pertença ao mesmo snapshot/métrica; a RPC de publicação deve validar.
create function public.reject_published_snapshot_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_snapshot_id uuid;
  v_published timestamptz;
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.retention_job', true), '') = 'on' then
    return old;
  end if;

  if tg_table_name = 'snapshots' then
    if tg_op in ('UPDATE', 'DELETE') and old.published_at is not null then
      raise exception 'snapshot % já publicado é imutável', old.id
        using errcode = 'integrity_constraint_violation';
    end if;
    return coalesce(new, old);
  end if;

  -- observations e field_validations
  v_snapshot_id := case when tg_op = 'DELETE' then old.snapshot_id else new.snapshot_id end;
  select s.published_at into v_published from public.snapshots s where s.id = v_snapshot_id;
  if v_published is not null
     or (tg_op = 'UPDATE' and old.snapshot_id is distinct from new.snapshot_id) then
    raise exception 'dados do snapshot % já publicado são imutáveis', v_snapshot_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger snapshots_immutable
  before update or delete on public.snapshots
  for each row execute function public.reject_published_snapshot_change();

create trigger observations_immutable
  before insert or update or delete on public.observations
  for each row execute function public.reject_published_snapshot_change();

create trigger field_validations_immutable
  before insert or update or delete on public.field_validations
  for each row execute function public.reject_published_snapshot_change();

create function public.reject_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'truncate de % é proibido (dados publicados são imutáveis)', tg_table_name
    using errcode = 'integrity_constraint_violation';
end;
$$;

create trigger snapshots_no_truncate before truncate on public.snapshots
  for each statement execute function public.reject_truncate();
create trigger observations_no_truncate before truncate on public.observations
  for each statement execute function public.reject_truncate();
create trigger field_validations_no_truncate before truncate on public.field_validations
  for each statement execute function public.reject_truncate();

-- `from public` não basta: o Supabase concede EXECUTE a anon e authenticated por default ACL.
revoke all on function public.reject_published_snapshot_change() from public, anon, authenticated;
revoke all on function public.reject_truncate() from public, anon, authenticated;

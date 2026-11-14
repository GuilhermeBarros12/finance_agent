-- T09: publicação atômica de snapshot, papel dedicado do coletor e retenção.
-- README 6.4, ADR 0001 D11 e D13. Valores continuam numeric (nunca float).

-- Um snapshot por execução do coletor.
alter table public.snapshots
  add constraint snapshots_run_unique unique (run_id);

-- O ponteiro ativo só pode apontar para snapshot já publicado, do mesmo universo.
create function public.reject_unpublished_active_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_published timestamptz;
  v_universe text;
begin
  select s.published_at, s.universe into v_published, v_universe
  from public.snapshots s where s.id = new.snapshot_id;
  if v_published is null then
    raise exception 'active_snapshot só aponta para snapshot publicado (%)', new.snapshot_id
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_universe is distinct from new.universe then
    raise exception 'snapshot % é do universo %, não de %', new.snapshot_id, v_universe, new.universe
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end;
$$;

create trigger active_snapshot_published_only
  before insert or update on public.active_snapshot
  for each row execute function public.reject_unpublished_active_snapshot();

revoke all on function public.reject_unpublished_active_snapshot() from public, anon, authenticated;

-- Reforço dos checks da T08: NaN e Infinity não são valores financeiros (numeric os aceita).
alter table public.observations
  add constraint observations_finite_check
    check (value_decimal <> 'NaN'::numeric and abs(value_decimal) <> 'Infinity'::numeric),
  add constraint observations_text_check
    check (raw_value <> '' and parser_version <> '' and methodology_id <> '');
alter table public.field_validations
  add constraint field_validations_finite_check check (
    coalesce(delta_abs <> 'NaN'::numeric and abs(delta_abs) <> 'Infinity'::numeric, true)
    and coalesce(limit_value <> 'NaN'::numeric and abs(limit_value) <> 'Infinity'::numeric, true)
    and coalesce(atol <> 'NaN'::numeric and abs(atol) <> 'Infinity'::numeric, true)
    and coalesce(rtol <> 'NaN'::numeric and abs(rtol) <> 'Infinity'::numeric, true));

-- Staging ---------------------------------------------------------------------------
-- Espelha observations e field_validations, mas com ids legíveis (symbol, code), como no
-- contrato Python. Sem FK para assets/data_sources e sem unique de negócio: quem decide é
-- publish_snapshot, que recusa o lote inteiro. `id` da observação é escolhido pelo coletor
-- e preservado na publicação, para as validações poderem referenciá-lo.
create table public.staging_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  asset_symbol text not null,
  source_code text not null,
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
  parser_version text not null,
  raw_content_hash text not null,
  created_at timestamptz not null default now(),
  constraint staging_observations_metric_check check (metric in (
    'quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe')),
  constraint staging_observations_unit_check check (
    (metric = 'quote_price' and unit = 'BRL' and currency = 'BRL')
    or (metric in ('price_to_book', 'price_to_earnings') and unit = 'ratio' and currency is null)
    or (metric in ('dividend_yield', 'roe') and unit = 'percent' and currency is null)),
  constraint staging_observations_period_check
    check (period_start is null or period_end is null or period_end >= period_start),
  constraint staging_observations_finite_check
    check (value_decimal <> 'NaN'::numeric and abs(value_decimal) <> 'Infinity'::numeric),
  constraint staging_observations_text_check
    check (raw_value <> '' and parser_version <> '' and methodology_id <> ''),
  constraint staging_observations_url_check check (source_url ~* '^https?://[^@\s]+$'),
  constraint staging_observations_hash_check check (raw_content_hash ~ '^[0-9a-f]{64}$')
);

create index staging_observations_run_idx on public.staging_observations (run_id);

create table public.staging_validations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  asset_symbol text not null,
  metric text not null,
  status text not null,
  freshness text not null,
  selected_observation_id uuid,
  observation_ids uuid[] not null default '{}',
  delta_abs numeric,
  limit_value numeric,
  atol numeric,
  rtol numeric,
  tolerance_version text,
  reason text,
  created_at timestamptz not null default now(),
  constraint staging_validations_metric_check check (metric in (
    'quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe')),
  constraint staging_validations_status_check check (status in (
    'verified', 'divergent', 'single_source', 'incomparable',
    'missing', 'not_applicable', 'invalid')),
  constraint staging_validations_freshness_check check (freshness in (
    'fresh', 'stale', 'expired', 'unknown_reference_date')),
  constraint staging_validations_divergent_no_pick
    check (status <> 'divergent' or selected_observation_id is null),
  constraint staging_validations_comparison_check check (
    (status in ('verified', 'divergent')
      and delta_abs is not null and limit_value is not null
      and atol is not null and rtol is not null and tolerance_version is not null
      and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)
    or (status not in ('verified', 'divergent')
      and delta_abs is null and limit_value is null and atol is null and rtol is null)),
  constraint staging_validations_finite_check check (
    coalesce(delta_abs <> 'NaN'::numeric and abs(delta_abs) <> 'Infinity'::numeric, true)
    and coalesce(limit_value <> 'NaN'::numeric and abs(limit_value) <> 'Infinity'::numeric, true)
    and coalesce(atol <> 'NaN'::numeric and abs(atol) <> 'Infinity'::numeric, true)
    and coalesce(rtol <> 'NaN'::numeric and abs(rtol) <> 'Infinity'::numeric, true)),
  constraint staging_validations_ids_check check (
    array_ndims(observation_ids) is null or array_ndims(observation_ids) = 1),
  constraint staging_validations_no_selection_check check (
    status not in ('missing', 'invalid', 'not_applicable')
    or selected_observation_id is null)
);

create index staging_validations_run_idx on public.staging_validations (run_id);

alter table public.staging_observations enable row level security;
alter table public.staging_validations enable row level security;

revoke all on public.staging_observations, public.staging_validations
  from public, anon, authenticated, service_role;

-- Papel do coletor (D13) -----------------------------------------------------------------
-- Criado SEM login e sem senha: nenhuma senha vai ao repositório. Para usar, o autor
-- executa, fora do código e uma única vez por ambiente:
--   alter role collector_ingest login password '<senha forte>';
-- e monta COLLECTOR_DATABASE_URL (segredo) com ela. Ver docs/tarefas/T09.md.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'collector_ingest') then
    create role collector_ingest nologin noinherit nocreatedb nocreaterole nosuperuser;
  end if;
end;
$$;

alter role collector_ingest set statement_timeout = '120s';

grant usage on schema public to collector_ingest;
grant select on public.assets, public.data_sources to collector_ingest;
grant insert on public.collection_runs to collector_ingest;
grant insert on public.staging_observations, public.staging_validations to collector_ingest;

create policy collector_read_assets on public.assets
  for select to collector_ingest using (true);
create policy collector_read_data_sources on public.data_sources
  for select to collector_ingest using (true);
-- A execução nasce em andamento; quem a encerra é publish_snapshot.
create policy collector_insert_runs on public.collection_runs
  for insert to collector_ingest
  with check (status = 'running' and finished_at is null);
create policy collector_insert_staging_observations on public.staging_observations
  for insert to collector_ingest with check (true);
create policy collector_insert_staging_validations on public.staging_validations
  for insert to collector_ingest with check (true);

-- publish_snapshot -----------------------------------------------------------------------
-- Manifesto (jsonb): mesmo contrato da SnapshotManifest da T06. Exatamente as chaves
-- snapshot_id, run_id (igual ao p_run_id), collected_at (ISO 8601 com fuso explícito),
-- universe_version, assets_total (inteiro >= 1), assets_updated (igual ao staging) e
-- failures (array obrigatório, itens {asset_id, source_id, reason} não vazios). Chave extra
-- é recusada. Falha de coleta nunca vira lista vazia por omissão.
create function public.publish_snapshot(p_run_id uuid, p_manifest jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_universe text;
  v_collected timestamptz;
  v_version text;
  v_total integer;
  v_failures jsonb;
  v_updated integer;
  v_run public.collection_runs%rowtype;
  v_snapshot uuid;
  v_bad text;
  v_n numeric;
  v_item jsonb;
  v_last timestamptz;
begin
  if p_run_id is null or p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'manifesto inválido: run_id e objeto são obrigatórios'
      using errcode = 'invalid_parameter_value';
  end if;
  select string_agg(k, ', ') into v_bad
  from jsonb_object_keys(p_manifest) k
  where k not in ('snapshot_id', 'run_id', 'collected_at', 'universe_version',
                  'assets_total', 'assets_updated', 'failures');
  if v_bad is not null then
    raise exception 'manifesto inválido: chaves não previstas: %', v_bad
      using errcode = 'invalid_parameter_value';
  end if;
  foreach v_item in array array[to_jsonb('snapshot_id'::text), to_jsonb('run_id'::text),
      to_jsonb('collected_at'::text), to_jsonb('universe_version'::text)] loop
    if jsonb_typeof(p_manifest -> (v_item #>> '{}')) is distinct from 'string'
       or (p_manifest ->> (v_item #>> '{}')) = '' then
      raise exception 'manifesto inválido: % é obrigatório (texto não vazio)', v_item #>> '{}'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if p_manifest ->> 'run_id' is distinct from p_run_id::text then
    raise exception 'manifesto inválido: run_id do manifesto difere do informado'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Instante ISO 8601 com fuso explícito (mesma regra da T06); sem 'now', 'infinity' ou data pura.
  v_bad := p_manifest ->> 'collected_at';
  if v_bad !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
     or (v_bad ~ '[+-][0-9]{2}:[0-9]{2}$'
         and (substring(v_bad from '[+-]([0-9]{2}):[0-9]{2}$')::int > 23
              or substring(v_bad from '[+-][0-9]{2}:([0-9]{2})$')::int > 59)) then
    raise exception 'manifesto inválido: collected_at deve ser instante ISO 8601 com fuso (ex.: 2026-09-18T21:00:00Z)'
      using errcode = 'invalid_parameter_value';
  end if;
  begin
    v_collected := v_bad::timestamptz;
  exception when others then
    raise exception 'manifesto inválido: collected_at não é um instante válido'
      using errcode = 'invalid_parameter_value';
  end;
  v_version := p_manifest ->> 'universe_version';

  foreach v_bad in array array['assets_total', 'assets_updated'] loop
    if jsonb_typeof(p_manifest -> v_bad) is distinct from 'number' then
      raise exception 'manifesto inválido: % deve ser número inteiro', v_bad
        using errcode = 'invalid_parameter_value';
    end if;
    v_n := (p_manifest ->> v_bad)::numeric;
    if v_n <> trunc(v_n) or v_n < 0 or v_n > 2147483647 then
      raise exception 'manifesto inválido: % deve ser inteiro entre 0 e 2147483647', v_bad
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  v_total := (p_manifest ->> 'assets_total')::numeric::integer;
  if v_total < 1 then
    raise exception 'manifesto inválido: assets_total deve ser >= 1'
      using errcode = 'invalid_parameter_value';
  end if;
  if (p_manifest ->> 'assets_updated')::numeric > v_total then
    raise exception 'manifesto inválido: assets_updated maior que assets_total'
      using errcode = 'invalid_parameter_value';
  end if;

  if jsonb_typeof(p_manifest -> 'failures') is distinct from 'array' then
    raise exception 'manifesto inválido: failures é obrigatório e deve ser um array'
      using errcode = 'invalid_parameter_value';
  end if;
  v_failures := p_manifest -> 'failures';
  for v_item in select value from jsonb_array_elements(v_failures) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k
                  where k not in ('asset_id', 'source_id', 'reason'))
       or jsonb_typeof(v_item -> 'asset_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'source_id') is distinct from 'string'
       or jsonb_typeof(v_item -> 'reason') is distinct from 'string'
       or (v_item ->> 'asset_id') = '' or (v_item ->> 'source_id') = ''
       or (v_item ->> 'reason') = '' then
      raise exception 'manifesto inválido: cada falha exige asset_id, source_id e reason (texto não vazio) e nada além'
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  v_universe := 'stocks';

  -- Serializa publicações do mesmo universo e trava a execução contra publicação dupla.
  perform pg_advisory_xact_lock(hashtextextended('publish_snapshot:' || v_universe, 0));
  -- Congela o staging durante a publicação: o collector_ingest só faz INSERT, que passa a
  -- esperar a transação terminar. Sem isso, linhas inseridas entre a validação e a cópia
  -- (READ COMMITTED) seriam copiadas sem terem sido validadas. A função é da dona das tabelas.
  lock table public.staging_observations, public.staging_validations in share row exclusive mode;
  select * into v_run from public.collection_runs where id = p_run_id for update;
  if not found then
    raise exception 'execução % não existe', p_run_id
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_run.status <> 'running' or exists (
       select 1 from public.snapshots s where s.run_id = p_run_id) then
    raise exception 'execução % já foi encerrada ou publicada', p_run_id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Publicação fora de ordem: nunca regride o snapshot ativo.
  select s.collected_at into v_last
  from public.active_snapshot a join public.snapshots s on s.id = a.snapshot_id
  where a.universe = v_universe;
  if v_last is not null and v_collected < v_last then
    raise exception 'collected_at (%) anterior ao do snapshot ativo (%): publicação fora de ordem', v_collected, v_last
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Integridade do staging: qualquer falha aborta tudo e active_snapshot não muda.
  if not exists (select 1 from public.staging_observations o where o.run_id = p_run_id) then
    raise exception 'staging sem observações para a execução %', p_run_id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Defesa em profundidade: os checks do staging já recusam, mas a RPC não depende deles.
  select string_agg(distinct x.k, ', ') into v_bad
  from (
    select o.asset_symbol || '/' || o.metric as k from public.staging_observations o
    where o.run_id = p_run_id
      and (o.value_decimal = 'NaN'::numeric or abs(o.value_decimal) = 'Infinity'::numeric)
    union all
    select v.asset_symbol || '/' || v.metric from public.staging_validations v
    where v.run_id = p_run_id
      and (v.delta_abs = 'NaN'::numeric or abs(v.delta_abs) = 'Infinity'::numeric
        or v.limit_value = 'NaN'::numeric or abs(v.limit_value) = 'Infinity'::numeric
        or v.atol = 'NaN'::numeric or abs(v.atol) = 'Infinity'::numeric
        or v.rtol = 'NaN'::numeric or abs(v.rtol) = 'Infinity'::numeric)
  ) x;
  if v_bad is not null then
    raise exception 'valor não finito (NaN ou Infinity) em: %', v_bad
      using errcode = 'integrity_constraint_violation';
  end if;

  select string_agg(distinct x.symbol, ', ') into v_bad
  from (
    select o.asset_symbol as symbol from public.staging_observations o where o.run_id = p_run_id
    union all
    select v.asset_symbol from public.staging_validations v where v.run_id = p_run_id
  ) x
  left join public.assets a on a.symbol = x.symbol
  where a.id is null;
  if v_bad is not null then
    raise exception 'ativo inexistente: %', v_bad using errcode = 'integrity_constraint_violation';
  end if;

  select string_agg(distinct o.source_code, ', ') into v_bad
  from public.staging_observations o
  left join public.data_sources s on s.code = o.source_code
  where o.run_id = p_run_id and s.id is null;
  if v_bad is not null then
    raise exception 'fonte inexistente: %', v_bad using errcode = 'integrity_constraint_violation';
  end if;

  select string_agg(distinct d.k, ', ') into v_bad
  from (
    select o.asset_symbol || '/' || o.metric || '/' || o.source_code as k
    from public.staging_observations o where o.run_id = p_run_id
    group by o.asset_symbol, o.metric, o.source_code having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'observação duplicada: %', v_bad using errcode = 'integrity_constraint_violation';
  end if;

  select string_agg(distinct d.k, ', ') into v_bad
  from (
    select v.asset_symbol || '/' || v.metric as k
    from public.staging_validations v where v.run_id = p_run_id
    group by v.asset_symbol, v.metric having count(*) > 1
  ) d;
  if v_bad is not null then
    raise exception 'validação duplicada: %', v_bad using errcode = 'integrity_constraint_violation';
  end if;

  -- Cobertura: pelo menos metade do universo declarado precisa ter observação.
  select count(distinct o.asset_symbol) into v_updated
  from public.staging_observations o where o.run_id = p_run_id;
  if v_updated > v_total then
    raise exception 'mais ativos com observação (%) do que o universo declarado (%)', v_updated, v_total
      using errcode = 'integrity_constraint_violation';
  end if;
  if v_updated * 2 < v_total then
    raise exception 'cobertura insuficiente: % de % ativos com observação (mínimo: metade)', v_updated, v_total
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Validações: cada uma só enxerga observações do mesmo run, ativo e métrica.
  select string_agg(v.asset_symbol || '/' || v.metric, ', ') into v_bad
  from public.staging_validations v
  where v.run_id = p_run_id
    and (
      cardinality(v.observation_ids) <> (
        select count(distinct x) from unnest(v.observation_ids) x)
      or cardinality(v.observation_ids) <> (
        select count(*) from unnest(v.observation_ids) x
        join public.staging_observations o
          on o.id = x and o.run_id = p_run_id
         and o.asset_symbol = v.asset_symbol and o.metric = v.metric));
  if v_bad is not null then
    raise exception 'validação referencia observação de outro ativo, métrica ou execução (ou repetida): %', v_bad
      using errcode = 'integrity_constraint_violation';
  end if;

  select string_agg(v.asset_symbol || '/' || v.metric, ', ') into v_bad
  from public.staging_validations v
  where v.run_id = p_run_id and v.selected_observation_id is not null
    and not (v.selected_observation_id = any (v.observation_ids));
  if v_bad is not null then
    raise exception 'observação selecionada fora de observation_ids: %', v_bad
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Regras de estado (README 7.5 e 7.6, espelhando a FieldValidation da T06).
  select string_agg(v.asset_symbol || '/' || v.metric || ' (' || v.status || ')', ', ') into v_bad
  from public.staging_validations v
  where v.run_id = p_run_id
    and (
      (v.status in ('missing', 'invalid', 'not_applicable') and cardinality(v.observation_ids) <> 0)
      or (v.status = 'single_source' and cardinality(v.observation_ids) <> 1)
      or (v.status = 'incomparable' and cardinality(v.observation_ids) < 1)
      or (v.status in ('verified', 'divergent') and (
            cardinality(v.observation_ids) < 2
            or (select count(distinct o.source_code) from public.staging_observations o
                where o.id = any (v.observation_ids)) < 2))
      or (v.status = 'verified' and v.delta_abs > v.limit_value)
      or (v.status = 'divergent' and v.delta_abs <= v.limit_value));
  if v_bad is not null then
    raise exception 'validação incoerente com o estado declarado: %', v_bad
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Toda observação precisa estar coberta pela validação do seu campo.
  select string_agg(o.asset_symbol || '/' || o.metric || '/' || o.source_code, ', ') into v_bad
  from public.staging_observations o
  where o.run_id = p_run_id
    and not exists (
      select 1 from public.staging_validations v
      where v.run_id = p_run_id and v.asset_symbol = o.asset_symbol
        and v.metric = o.metric and o.id = any (v.observation_ids));
  if v_bad is not null then
    raise exception 'observação sem validação do seu campo: %', v_bad
      using errcode = 'integrity_constraint_violation';
  end if;

  if (p_manifest ->> 'assets_updated')::numeric <> v_updated then
    raise exception 'manifesto inválido: assets_updated difere do staging (%)', v_updated
      using errcode = 'invalid_parameter_value';
  end if;

  -- Cópia e publicação na mesma transação.
  insert into public.snapshots
    (run_id, universe, collected_at, universe_version, assets_total, assets_updated, failures)
  values (p_run_id, v_universe, v_collected, v_version, v_total, v_updated, v_failures)
  returning id into v_snapshot;

  insert into public.observations
    (id, snapshot_id, asset_id, source_id, metric, raw_value, value_decimal, unit, currency,
     period_start, period_end, reference_at, reference_date, collected_at, source_url,
     upstream_source, methodology_id, run_id, parser_version, raw_content_hash)
  select o.id, v_snapshot, a.id, s.id, o.metric, o.raw_value, o.value_decimal, o.unit, o.currency,
         o.period_start, o.period_end, o.reference_at, o.reference_date, o.collected_at,
         o.source_url, o.upstream_source, o.methodology_id, p_run_id, o.parser_version,
         o.raw_content_hash
  from public.staging_observations o
  join public.assets a on a.symbol = o.asset_symbol
  join public.data_sources s on s.code = o.source_code
  where o.run_id = p_run_id;

  insert into public.field_validations
    (snapshot_id, asset_id, metric, status, freshness, selected_observation_id,
     observation_ids, delta_abs, limit_value, atol, rtol, tolerance_version, reason)
  select v_snapshot, a.id, v.metric, v.status, v.freshness, v.selected_observation_id,
         v.observation_ids, v.delta_abs, v.limit_value, v.atol, v.rtol, v.tolerance_version,
         v.reason
  from public.staging_validations v
  join public.assets a on a.symbol = v.asset_symbol
  where v.run_id = p_run_id;

  -- Trava a linha do snapshot e só então a publica.
  perform 1 from public.snapshots s where s.id = v_snapshot for update;
  update public.snapshots set published_at = now() where id = v_snapshot;

  insert into public.active_snapshot (universe, snapshot_id)
  values (v_universe, v_snapshot)
  on conflict (universe) do update
    set snapshot_id = excluded.snapshot_id, updated_at = now();

  update public.collection_runs
    set status = case when v_updated < v_total then 'partial' else 'succeeded' end,
        finished_at = greatest(now(), v_run.started_at)
    where id = p_run_id;

  delete from public.staging_validations where run_id = p_run_id;
  delete from public.staging_observations where run_id = p_run_id;

  return v_snapshot;
end;
$$;

-- `from public` não remove o EXECUTE que o Supabase concede por default ACL.
revoke all on function public.publish_snapshot(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.publish_snapshot(uuid, jsonb) to collector_ingest;

-- prune_snapshots (D11) ----------------------------------------------------------------
-- Apaga snapshots publicados há mais de N dias, nunca o ativo. É a única rotina que liga
-- `app.retention_job`, e só dentro da própria transação. Não é concedida a ninguém além
-- do dono (rodar como administrador do banco); o papel do coletor não a executa.
create function public.prune_snapshots(p_keep_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_keep_days is null or p_keep_days < 1 or p_keep_days > 36500 then
    raise exception 'p_keep_days deve estar entre 1 e 36500' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.retention_job', 'on', true);
  delete from public.snapshots s
  where s.published_at is not null
    and s.published_at < now() - make_interval(days => p_keep_days)
    and not exists (select 1 from public.active_snapshot a where a.snapshot_id = s.id);
  get diagnostics v_deleted = row_count;
  perform set_config('app.retention_job', 'off', true);

  -- Staging abandonado (execução que não chegou a publicar) também expira.
  delete from public.staging_validations
    where created_at < now() - make_interval(days => p_keep_days);
  delete from public.staging_observations
    where created_at < now() - make_interval(days => p_keep_days);

  return v_deleted;
end;
$$;

revoke all on function public.prune_snapshots(integer)
  from public, anon, authenticated, service_role;

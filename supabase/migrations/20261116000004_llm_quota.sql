-- T19: contador global de chamadas ao LLM (D16, README 17.2). Atômico no banco.
-- Só o backend (service_role) executa. A cota é consumida ANTES da chamada ao provedor
-- e não é devolvida se a chamada falhar (o provedor também conta tentativas).
--
-- Concorrência: o INSERT ... ON CONFLICT DO NOTHING garante a linha do dia; o UPDATE
-- condicional (request_count < p_limit) trava a linha, e quem espera reavalia a condição
-- sobre o valor já confirmado. N chamadas simultâneas nunca passam do limite.
create function public.consume_llm_quota(p_provider text, p_limit integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count integer;
begin
  if p_provider is null or p_provider !~ '^[a-z0-9_-]{1,32}$' then
    raise exception 'consume_llm_quota: provedor inválido' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 0 or p_limit > 1000000 then
    raise exception 'consume_llm_quota: limite inválido' using errcode = '22023';
  end if;

  insert into public.llm_usage (usage_date, provider, request_count)
  values (v_day, p_provider, 0)
  on conflict (usage_date, provider) do nothing;

  update public.llm_usage u
     set request_count = u.request_count + 1
   where u.usage_date = v_day
     and u.provider = p_provider
     and u.request_count < p_limit
  returning u.request_count into v_count;

  return v_count is not null;
end;
$$;

revoke all on function public.consume_llm_quota(text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_llm_quota(text, integer) to service_role;

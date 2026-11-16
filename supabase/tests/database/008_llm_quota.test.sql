-- T19: public.consume_llm_quota (contador global atômico de chamadas ao LLM). Roda como postgres.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(not exists (
  select 1 from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.consume_llm_quota(text, integer)'::regprocedure and a.grantee = 0),
  'sem EXECUTE para PUBLIC (proacl)');
select ok(
  not has_function_privilege('anon', 'public.consume_llm_quota(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.consume_llm_quota(text, integer)', 'execute'),
  'anon e authenticated sem execute');
select ok(has_function_privilege('service_role', 'public.consume_llm_quota(text, integer)', 'execute'),
  'service_role executa');
select ok(not has_function_privilege('collector_ingest', 'public.consume_llm_quota(text, integer)', 'execute'),
  'collector_ingest não executa');
select ok((select prosecdef from pg_proc where oid = 'public.consume_llm_quota(text, integer)'::regprocedure),
  'security definer');
select ok((select proconfig from pg_proc where oid = 'public.consume_llm_quota(text, integer)'::regprocedure)
  @> array['search_path=""'], 'search_path vazio');

-- Consome até o limite e recusa depois.
select is(public.consume_llm_quota('t19-a', 2), true, '1a chamada dentro do limite');
select is(public.consume_llm_quota('t19-a', 2), true, '2a chamada dentro do limite');
select is(public.consume_llm_quota('t19-a', 2), false, '3a chamada recusada');
select is(public.consume_llm_quota('t19-a', 2), false, 'continua recusada');
select is((select request_count from public.llm_usage where provider = 't19-a'), 2,
  'recusa não incrementa o contador');
select is((select usage_date from public.llm_usage where provider = 't19-a'),
  (now() at time zone 'America/Sao_Paulo')::date, 'dia em America/Sao_Paulo');

-- Limite zero: nada passa, a linha existe com 0.
select is(public.consume_llm_quota('t19-z', 0), false, 'limite 0 recusa');
select is((select request_count from public.llm_usage where provider = 't19-z'), 0, 'limite 0: contador em 0');

-- Provedores são independentes; baixar o limite depois do consumo recusa.
select is(public.consume_llm_quota('t19-b', 5), true, 'outro provedor tem contador próprio');
select is(public.consume_llm_quota('t19-b', 1), false, 'limite reduzido abaixo do consumo recusa');

-- Entradas inválidas.
select throws_ok($$select public.consume_llm_quota('Groq; drop', 5)$$, '22023', null, 'provedor inválido');
select throws_ok($$select public.consume_llm_quota('t19-a', -1)$$, '22023', null, 'limite negativo');

select * from finish();
rollback;

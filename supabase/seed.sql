-- Dados sintéticos para desenvolvimento local (T08). Tickers e valores inventados.
-- Cobre os quatro estados pedidos: verified, divergent, missing e incomparable.

insert into public.assets (id, symbol, asset_class, name) values
  ('a0000000-0000-4000-8000-000000000001', 'DEMO3', 'stock', 'Demo S.A. (fictícia)'),
  ('a0000000-0000-4000-8000-000000000002', 'TEST4', 'stock', 'Teste S.A. (fictícia)');

insert into public.data_sources (id, code, display_name, base_url) values
  ('b0000000-0000-4000-8000-000000000001', 'fundamentus', 'Fundamentus', 'https://www.fundamentus.com.br'),
  ('b0000000-0000-4000-8000-000000000002', 'statusinvest', 'StatusInvest', 'https://statusinvest.com.br'),
  ('b0000000-0000-4000-8000-000000000003', 'brapi', 'brapi', 'https://brapi.dev');

insert into public.collection_runs (id, started_at, finished_at, status, summary) values
  ('c0000000-0000-4000-8000-000000000001', '2026-09-18T20:00:00Z', '2026-09-18T20:05:00Z',
   'succeeded', '{"sintetico": true}');

-- Snapshot ainda não publicado: as observações entram antes do carimbo de publicação.
insert into public.snapshots
  (id, run_id, universe, collected_at, universe_version, assets_total, assets_updated)
values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'stocks', '2026-09-18T20:05:00Z', 'seed-1', 2, 2);

insert into public.observations
  (id, snapshot_id, asset_id, source_id, metric, raw_value, value_decimal, unit, currency,
   reference_date, collected_at, source_url, methodology_id, run_id, parser_version,
   raw_content_hash)
values
  -- DEMO3 price_to_book: duas fontes concordam (verified)
  ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'price_to_book', '1,50', 1.50, 'ratio', null, '2026-09-18', '2026-09-18T20:01:00Z',
   'https://www.fundamentus.com.br/exemplo/DEMO3', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('a', 64)),
  ('e0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
   'price_to_book', '1,51', 1.51, 'ratio', null, '2026-09-18', '2026-09-18T20:02:00Z',
   'https://statusinvest.com.br/exemplo/DEMO3', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('b', 64)),
  -- DEMO3 dividend_yield: fontes divergem (divergent)
  ('e0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'dividend_yield', '8,50%', 8.50, 'percent', null, '2026-09-18', '2026-09-18T20:01:00Z',
   'https://www.fundamentus.com.br/exemplo/DEMO3', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('a', 64)),
  ('e0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
   'dividend_yield', '9,10%', 9.10, 'percent', null, '2026-09-18', '2026-09-18T20:02:00Z',
   'https://statusinvest.com.br/exemplo/DEMO3', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('b', 64)),
  -- TEST4 price_to_earnings: janelas diferentes (incomparable)
  ('e0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'price_to_earnings', '12,0', 12.0, 'ratio', null, '2026-09-18', '2026-09-18T20:01:00Z',
   'https://www.fundamentus.com.br/exemplo/TEST4', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('c', 64)),
  ('e0000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
   'price_to_earnings', '9,8', 9.8, 'ratio', null, '2026-06-30', '2026-09-18T20:02:00Z',
   'https://statusinvest.com.br/exemplo/TEST4', 'provisional', 'c0000000-0000-4000-8000-000000000001',
   'seed-1', repeat('d', 64));
-- TEST4 roe: nenhuma observação utilizável (missing)

insert into public.field_validations
  (snapshot_id, asset_id, metric, status, freshness, selected_observation_id, observation_ids,
   delta_abs, limit_value, atol, rtol, tolerance_version, reason)
values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'price_to_book', 'verified', 'fresh', 'e0000000-0000-4000-8000-000000000001',
   array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002']::uuid[],
   0.01, 0.0302, 0.02, 0.02, 'seed-1', null),
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'dividend_yield', 'divergent', 'fresh', null,
   array['e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000004']::uuid[],
   0.60, 0.20, 0.20, 0, 'seed-1', 'Diferença acima da tolerância'),
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   'price_to_earnings', 'incomparable', 'fresh', null,
   array['e0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000006']::uuid[],
   null, null, null, null, null, 'Datas-base diferentes entre as fontes'),
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   'roe', 'missing', 'unknown_reference_date', null, '{}',
   null, null, null, null, null, 'Nenhuma fonte trouxe o campo');

-- Publicação (imutável a partir daqui) e ponteiro ativo.
update public.snapshots set published_at = '2026-09-18T20:06:00Z'
  where id = 'd0000000-0000-4000-8000-000000000001';

insert into public.active_snapshot (universe, snapshot_id)
  values ('stocks', 'd0000000-0000-4000-8000-000000000001');

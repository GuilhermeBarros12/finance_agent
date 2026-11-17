// Dados sintéticos escritos à mão para os testes e para a verificação visual (tickers
// inventados DEMO3 e TEST4). Os valores repetem o seed local (supabase/seed.sql).
import type { FreshnessStatus, ValidationStatus } from '@/components/status'
import type { EvidenceObservation, EvidenceValidation } from './contracts'

const UNIT: Record<string, string> = {
  quote_price: 'BRL',
  price_to_book: 'ratio',
  price_to_earnings: 'ratio',
  dividend_yield: 'percent',
  roe: 'percent',
}

export function obs(
  id: string,
  asset: string,
  metric: string,
  value: string,
  source = 'fundamentus',
  extra: Partial<EvidenceObservation> = {},
): EvidenceObservation {
  const host = source === 'statusinvest' ? 'statusinvest.com.br' : 'www.fundamentus.com.br'
  return {
    observation_id: id,
    asset_id: asset,
    metric,
    value_decimal: value,
    unit: UNIT[metric],
    source_id: source,
    source_url: `https://${host}/exemplo/${asset}`,
    reference_at: '2026-09-18',
    collected_at: '2026-09-18T20:01:00+00:00',
    ...extra,
  }
}

export function val(
  id: string,
  asset: string,
  metric: string,
  status: ValidationStatus,
  observationIds: string[],
  extra: Partial<EvidenceValidation> = {},
): EvidenceValidation {
  return {
    validation_id: id,
    asset_id: asset,
    metric,
    status,
    freshness: 'fresh' as FreshnessStatus,
    selected_observation_id: null,
    observation_ids: observationIds,
    comparison: null,
    reason: null,
    ...extra,
  }
}

const cmp = (delta: string, limit: string) => ({ delta_abs: delta, limit, atol: '0.20', rtol: '0', tolerance_version: 'seed-1' })

// O payload do seed: DEMO3 P/VP verified, DEMO3 DY divergent, TEST4 P/L incomparable, TEST4 ROE missing.
export function seedPayload(): Record<string, unknown> {
  return {
    content_version: 1,
    mode: 'deterministic',
    snapshot_id: 'd0000000-0000-4000-8000-000000000001',
    snapshot_collected_at: '2026-09-18T20:05:00+00:00',
    manifest: { assets_total: 12, assets_updated: 11 },
    sections: [
      { kind: 'metric_table', metric: 'price_to_book', validation_ids: ['v-pvp'] },
      { kind: 'metric_table', metric: 'dividend_yield', validation_ids: ['v-dy'] },
      { kind: 'limitation', validation_ids: ['v-pl', 'v-roe'] },
    ],
    evidence: {
      validations: [
        val('v-pvp', 'DEMO3', 'price_to_book', 'verified', ['o1', 'o2'], { selected_observation_id: 'o1', comparison: cmp('0.01', '0.0302') }),
        val('v-dy', 'DEMO3', 'dividend_yield', 'divergent', ['o3', 'o4'], { comparison: cmp('0.60', '0.20'), reason: 'Diferença acima da tolerância' }),
        val('v-pl', 'TEST4', 'price_to_earnings', 'incomparable', ['o5', 'o6'], { reason: 'Datas-base diferentes entre as fontes' }),
        val('v-roe', 'TEST4', 'roe', 'missing', [], { freshness: 'unknown_reference_date', reason: 'Nenhuma fonte trouxe o campo' }),
      ],
      observations: [
        obs('o1', 'DEMO3', 'price_to_book', '1.50'),
        obs('o2', 'DEMO3', 'price_to_book', '1.51', 'statusinvest', { collected_at: '2026-09-18T20:02:00+00:00' }),
        obs('o3', 'DEMO3', 'dividend_yield', '8.50'),
        obs('o4', 'DEMO3', 'dividend_yield', '9.10', 'statusinvest', { collected_at: '2026-09-18T20:02:00+00:00' }),
        obs('o5', 'TEST4', 'price_to_earnings', '12.0'),
        obs('o6', 'TEST4', 'price_to_earnings', '9.8', 'statusinvest', { reference_at: '2026-06-30' }),
      ],
    },
    warnings: [{ code: 'PARTIAL_COVERAGE', message: 'texto do servidor que não deve aparecer' }],
  }
}

export function catalogBody(snapshot: Record<string, unknown> | null = defaultSnapshot()): Record<string, unknown> {
  return {
    universe_version: snapshot ? 'seed-1' : null,
    assets: [
      { asset_id: 'DEMO3', name: 'Demo S.A. (fictícia)', reference_url: 'https://statusinvest.com.br/acoes/demo3' },
      { asset_id: 'TEST4', name: 'Teste S.A. (fictícia)', reference_url: 'https://statusinvest.com.br/acoes/test4' },
      { asset_id: 'ONEA3', name: 'Uma Fonte S.A. (fictícia)', reference_url: null },
    ],
    metrics: [
      { metric: 'quote_price', label: 'Cotação', unit: 'BRL' },
      { metric: 'price_to_book', label: 'P/VP', unit: 'ratio' },
      { metric: 'price_to_earnings', label: 'P/L', unit: 'ratio' },
      { metric: 'dividend_yield', label: 'Dividend yield', unit: 'percent' },
      { metric: 'roe', label: 'ROE', unit: 'percent' },
    ],
    snapshot,
  }
}

export function defaultSnapshot(freshness: FreshnessStatus = 'fresh'): Record<string, unknown> {
  return {
    snapshot_id: 'd0000000-0000-4000-8000-000000000001',
    collected_at: '2026-09-18T20:05:00+00:00',
    freshness,
    assets_total: 12,
    assets_updated: 11,
    failures: [],
    status_counts: { verified: 1, divergent: 1, single_source: 0, incomparable: 1, missing: 1, not_applicable: 0, invalid: 0 },
  }
}

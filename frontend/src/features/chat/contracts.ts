// Tipos e leitores defensivos das respostas do servidor. O navegador não confia no formato:
// o que não bate com o contrato (docs/api.md, docs/data-dictionary.md) é recusado, nunca
// "consertado". Valores financeiros ficam como string; aqui nada vira número.
import type { FreshnessStatus, ValidationStatus } from '@/components/status'

export const VALIDATION_STATUSES: readonly ValidationStatus[] = [
  'verified',
  'divergent',
  'single_source',
  'incomparable',
  'missing',
  'not_applicable',
  'invalid',
]
export const FRESHNESS_STATUSES: readonly FreshnessStatus[] = ['fresh', 'stale', 'expired', 'unknown_reference_date']

export const METRICS = ['quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe'] as const
export type Metric = (typeof METRICS)[number]

export type Unit = 'BRL' | 'ratio' | 'percent'

// Mesma tabela de METRIC_UNIT em collector/contracts.py (README 7.2).
export const METRIC_UNIT: Record<Metric, Unit> = {
  quote_price: 'BRL',
  price_to_book: 'ratio',
  price_to_earnings: 'ratio',
  dividend_yield: 'percent',
  roe: 'percent',
}

// Rótulos de reserva quando o catálogo ainda não chegou (o do catálogo, quando existe, vence).
export const METRIC_LABEL: Record<Metric, string> = {
  quote_price: 'Cotação',
  price_to_book: 'P/VP',
  price_to_earnings: 'P/L',
  dividend_yield: 'Dividend yield',
  roe: 'ROE',
}

export function isMetric(value: unknown): value is Metric {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isStringOrNull = (v: unknown): v is string | null => v === null || v === undefined || typeof v === 'string'
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)

// --- Payload da mensagem do assistente (versão 1, D21) ---

export interface Comparison {
  delta_abs: string
  limit: string
  atol: string
  rtol: string
  tolerance_version: string
}

export interface EvidenceValidation {
  validation_id: string
  asset_id: string
  metric: string
  status: ValidationStatus
  freshness: FreshnessStatus
  selected_observation_id: string | null
  observation_ids: string[]
  comparison: Comparison | null
  reason: string | null
}

export interface EvidenceObservation {
  observation_id: string
  asset_id: string
  metric: string
  value_decimal: string
  unit: string
  source_id: string
  source_url: string
  reference_at: string | null
  collected_at: string
}

export interface Section {
  kind: 'metric_table' | 'limitation'
  metric: string | null
  validation_ids: string[]
}

export interface PayloadWarning {
  code: string
  asset_id: string | null
  metric: string | null
}

export interface AnswerPayload {
  mode: string
  snapshot_id: string
  snapshot_collected_at: string
  manifest: { assets_total: number; assets_updated: number }
  sections: Section[]
  evidence: { validations: EvidenceValidation[]; observations: EvidenceObservation[] }
  warnings: PayloadWarning[]
}

function readComparison(raw: unknown): Comparison | null | undefined {
  if (raw === null || raw === undefined) return null
  if (!isObject(raw)) return undefined
  const { delta_abs, limit, atol, rtol, tolerance_version } = raw
  if (![delta_abs, limit, atol, rtol, tolerance_version].every(isString)) return undefined
  return { delta_abs, limit, atol, rtol, tolerance_version } as Comparison
}

function readValidation(raw: unknown): EvidenceValidation | null {
  if (!isObject(raw)) return null
  const comparison = readComparison(raw.comparison)
  if (
    !isString(raw.validation_id) ||
    !isString(raw.asset_id) ||
    !isString(raw.metric) ||
    !VALIDATION_STATUSES.includes(raw.status as ValidationStatus) ||
    !FRESHNESS_STATUSES.includes(raw.freshness as FreshnessStatus) ||
    !isStringOrNull(raw.selected_observation_id) ||
    !isStringArray(raw.observation_ids) ||
    comparison === undefined ||
    !isStringOrNull(raw.reason)
  ) {
    return null
  }
  return {
    validation_id: raw.validation_id,
    asset_id: raw.asset_id,
    metric: raw.metric,
    status: raw.status as ValidationStatus,
    freshness: raw.freshness as FreshnessStatus,
    selected_observation_id: raw.selected_observation_id ?? null,
    observation_ids: raw.observation_ids,
    comparison,
    reason: raw.reason ?? null,
  }
}

function readObservation(raw: unknown): EvidenceObservation | null {
  if (!isObject(raw)) return null
  if (
    !isString(raw.observation_id) ||
    !isString(raw.asset_id) ||
    !isString(raw.metric) ||
    !isString(raw.value_decimal) ||
    !isString(raw.unit) ||
    !isString(raw.source_id) ||
    !isString(raw.source_url) ||
    !isStringOrNull(raw.reference_at) ||
    !isString(raw.collected_at)
  ) {
    return null
  }
  return {
    observation_id: raw.observation_id,
    asset_id: raw.asset_id,
    metric: raw.metric,
    value_decimal: raw.value_decimal,
    unit: raw.unit,
    source_id: raw.source_id,
    source_url: raw.source_url,
    reference_at: raw.reference_at ?? null,
    collected_at: raw.collected_at,
  }
}

function readList<T>(raw: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null
  const out: T[] = []
  for (const item of raw) {
    const parsed = read(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

function readSection(raw: unknown): Section | null {
  if (!isObject(raw) || (raw.kind !== 'metric_table' && raw.kind !== 'limitation') || !isStringArray(raw.validation_ids)) {
    return null
  }
  if (raw.metric !== undefined && raw.metric !== null && !isString(raw.metric)) return null
  return { kind: raw.kind, metric: (raw.metric as string | undefined) ?? null, validation_ids: raw.validation_ids }
}

function readWarning(raw: unknown): PayloadWarning | null {
  if (!isObject(raw) || !isString(raw.code)) return null
  return {
    code: raw.code,
    asset_id: isString(raw.asset_id) ? raw.asset_id : null,
    metric: isString(raw.metric) ? raw.metric : null,
  }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Devolve null para qualquer payload fora da versão 1 ou malformado: a tela mostra
// "formato não reconhecido" em vez de adivinhar.
export function readPayload(raw: unknown, contentVersion?: unknown): AnswerPayload | null {
  if (!isObject(raw) || raw.content_version !== 1) return null
  if (contentVersion !== undefined && contentVersion !== 1) return null
  const manifest = raw.manifest
  if (!isObject(manifest) || !isCount(manifest.assets_total) || !isCount(manifest.assets_updated)) return null
  if (!isString(raw.snapshot_id) || !isString(raw.snapshot_collected_at) || !isString(raw.mode)) return null
  const evidence = raw.evidence
  if (!isObject(evidence)) return null
  const validations = readList(evidence.validations, readValidation)
  const observations = readList(evidence.observations, readObservation)
  const sections = readList(raw.sections, readSection)
  const warnings = readList(raw.warnings ?? [], readWarning)
  if (!validations || !observations || !sections || !warnings) return null
  return {
    mode: raw.mode,
    snapshot_id: raw.snapshot_id,
    snapshot_collected_at: raw.snapshot_collected_at,
    manifest: { assets_total: manifest.assets_total, assets_updated: manifest.assets_updated },
    sections,
    evidence: { validations, observations },
    warnings,
  }
}

// --- GET /catalog ---

export interface CatalogAsset {
  asset_id: string
  name: string
  reference_url: string | null
}
export interface CatalogMetric {
  metric: Metric
  label: string
  unit: Unit
}
export interface CatalogSnapshot {
  snapshot_id: string
  collected_at: string
  freshness: FreshnessStatus
  assets_total: number
  assets_updated: number
  // null = ausente ou ilegível no catálogo. A tela de dados mostra "não disponível", nunca
  // uma lista vazia nem zeros no lugar de um dado que não chegou.
  failures: CatalogFailure[] | null
  status_counts: Record<string, number> | null
}
export interface CatalogFailure {
  asset_id: string
  source_id: string
  reason: string
}
export interface Catalog {
  // Pode ser null (sem snapshot): nada depende dele na tela.
  universe_version: string | null
  assets: CatalogAsset[]
  metrics: CatalogMetric[]
  snapshot: CatalogSnapshot | null
}

function readFailure(raw: unknown): CatalogFailure | null {
  if (!isObject(raw) || !isString(raw.asset_id) || !isString(raw.source_id) || !isString(raw.reason)) return null
  return { asset_id: raw.asset_id, source_id: raw.source_id, reason: raw.reason }
}

// Chaves novas são toleradas (a tela as mostra como "estado não reconhecido"); um valor que
// não é contagem inteira torna o conjunto todo ilegível.
function readStatusCounts(raw: unknown): Record<string, number> | null {
  if (!isObject(raw)) return null
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
    out[key] = value
  }
  return out
}

const isUnit = (v: unknown): v is Unit => v === 'BRL' || v === 'ratio' || v === 'percent'

function readCatalogAsset(raw: unknown): CatalogAsset | null {
  if (!isObject(raw) || !isString(raw.asset_id) || !isString(raw.name) || !isStringOrNull(raw.reference_url)) return null
  return { asset_id: raw.asset_id, name: raw.name, reference_url: raw.reference_url ?? null }
}

function readCatalogMetric(raw: unknown): CatalogMetric | null {
  if (!isObject(raw) || !isMetric(raw.metric) || !isString(raw.label) || !isUnit(raw.unit)) return null
  return { metric: raw.metric, label: raw.label, unit: raw.unit }
}

export function readCatalog(raw: unknown): Catalog | null {
  if (!isObject(raw)) return null
  const assets = readList(raw.assets, readCatalogAsset)
  const metrics = readList(raw.metrics, readCatalogMetric)
  if (!assets || !metrics) return null
  if (!isStringOrNull(raw.universe_version)) return null
  let snapshot: CatalogSnapshot | null = null
  if (raw.snapshot !== null && raw.snapshot !== undefined) {
    const s = raw.snapshot
    if (
      !isObject(s) ||
      !isString(s.snapshot_id) ||
      !isString(s.collected_at) ||
      !FRESHNESS_STATUSES.includes(s.freshness as FreshnessStatus) ||
      !isCount(s.assets_total) ||
      !isCount(s.assets_updated)
    ) {
      return null
    }
    snapshot = {
      snapshot_id: s.snapshot_id,
      collected_at: s.collected_at,
      freshness: s.freshness as FreshnessStatus,
      assets_total: s.assets_total,
      assets_updated: s.assets_updated,
      failures: s.failures === undefined ? null : readList(s.failures, readFailure),
      status_counts: readStatusCounts(s.status_counts),
    }
  }
  return { universe_version: raw.universe_version ?? null, assets, metrics, snapshot }
}

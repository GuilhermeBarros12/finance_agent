/* eslint-disable */
// ARQUIVO GERADO por scripts/generate_ts_types.mjs a partir de schemas/*.schema.json.
// Não edite à mão. Para atualizar: python scripts/export_schemas.py && npm run gen:types


/**
 * Classe do ativo. Nesta fatia só existem ações (ADR 0001).
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "AssetClass".
 */
export type AssetClass = "stock"
export type AssetId = string
export type CollectedAt = string
export type Currency = (string | null)
export type MethodologyId = string
/**
 * Os cinco campos da fatia.
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "Metric".
 */
export type Metric = ("quote_price" | "price_to_book" | "price_to_earnings" | "dividend_yield" | "roe")
export type ObservationId = string
export type ParserVersion = string
export type PeriodEnd = (string | null)
export type PeriodStart = (string | null)
export type RawContentHash = string
export type RawValue = string
export type ReferenceAt = (string | null)
export type RunId = string
export type SourceId = string
export type SourceUrl = string
/**
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "Unit".
 */
export type Unit = ("BRL" | "ratio" | "percent")
export type UpstreamSource = (string | null)
export type ValueDecimal = string
export type AssetId1 = string
export type Atol = string
export type DeltaAbs = string
export type Limit = string
export type Rtol = string
export type ToleranceVersion = string
/**
 * Estados de atualização (README 6.4).
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "Freshness".
 */
export type Freshness = ("fresh" | "stale" | "expired" | "unknown_reference_date")
export type ObservationIds = string[]
export type Reason = (string | null)
export type SelectedObservationId = (string | null)
/**
 * Estados de validação (README 7.5).
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "ValidationStatus".
 */
export type ValidationStatus = ("verified" | "divergent" | "single_source" | "incomparable" | "missing" | "not_applicable" | "invalid")
export type AssetsTotal = number
export type AssetsUpdated = number
export type CollectedAt1 = string
export type AssetId2 = string
export type Reason1 = string
export type SourceId1 = string
export type Failures = SourceFailure[]
export type RunId1 = string
export type SnapshotId = string
export type UniverseVersion = string

export interface Contracts {
Observation?: Observation
FieldValidation?: FieldValidation
SnapshotManifest?: SnapshotManifest
}
/**
 * Um campo de um ativo em uma fonte (README 7.1).
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "Observation".
 */
export interface Observation {
asset_class: AssetClass
asset_id: AssetId
collected_at: CollectedAt
currency?: Currency
methodology_id?: MethodologyId
metric: Metric
observation_id: ObservationId
parser_version: ParserVersion
period_end?: PeriodEnd
period_start?: PeriodStart
raw_content_hash: RawContentHash
raw_value: RawValue
reference_at?: ReferenceAt
run_id: RunId
source_id: SourceId
source_url: SourceUrl
unit: Unit
upstream_source?: UpstreamSource
value_decimal: ValueDecimal
}
/**
 * Estado de validação de um campo de um ativo (README 7.5).
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "FieldValidation".
 */
export interface FieldValidation {
asset_id: AssetId1
comparison?: (Comparison | null)
freshness: Freshness
metric: Metric
observation_ids: ObservationIds
reason?: Reason
selected_observation_id?: SelectedObservationId
status: ValidationStatus
}
/**
 * Resultado numérico da comparação (README 7.4). Todos os decimais são string.
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "Comparison".
 */
export interface Comparison {
atol: Atol
delta_abs: DeltaAbs
limit: Limit
rtol: Rtol
tolerance_version: ToleranceVersion
}
/**
 * Resumo de um lote publicado.
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "SnapshotManifest".
 */
export interface SnapshotManifest {
assets_total: AssetsTotal
assets_updated: AssetsUpdated
collected_at: CollectedAt1
failures: Failures
run_id: RunId1
snapshot_id: SnapshotId
universe_version: UniverseVersion
}
/**
 * Falha de coleta de um ativo em uma fonte. Nunca vira zero nem dado vazio.
 * 
 * This interface was referenced by `Contracts`'s JSON-Schema
 * via the `definition` "SourceFailure".
 */
export interface SourceFailure {
asset_id: AssetId2
reason: Reason1
source_id: SourceId1
}

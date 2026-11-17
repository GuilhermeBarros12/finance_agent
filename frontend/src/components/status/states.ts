export type ValidationStatus =
  | 'verified'
  | 'divergent'
  | 'single_source'
  | 'incomparable'
  | 'missing'
  | 'not_applicable'
  | 'invalid'

export type FreshnessStatus = 'fresh' | 'stale' | 'expired' | 'unknown_reference_date'

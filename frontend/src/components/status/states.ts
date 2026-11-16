export type ValidationStatus =
  | 'verified'
  | 'divergent'
  | 'single_source'
  | 'incomparable'
  | 'missing'
  | 'invalid'

export type FreshnessStatus = 'fresh' | 'stale' | 'expired'

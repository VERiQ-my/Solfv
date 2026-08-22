/**
 * Mirrors the engine's output shape (Contract 2). These types are transcribed
 * from `analysis/pipeline.py` — if that contract moves, this file moves with it.
 *
 * Nullability here is meaningful, not defensive. A `null` ratio means the
 * engine refused to compute it from a quarantined figure, and the UI must
 * render that as "withheld", never as zero.
 */

/** Navigation targets. Kept here so pages can type their own `go` prop. */
export type Page =
  | 'analysis' | 'overview' | 'saydo' | 'benchmark'
  | 'risk' | 'privacy' | 'history' | 'metering'

export type Trust = 'VERIFIED' | 'DERIVED' | 'UNVERIFIED'
export type CheckStatus = 'PASS' | 'FAIL' | 'UNVERIFIABLE'
export type Verdict = 'SUPPORTED' | 'CONTRADICTED' | 'UNVERIFIABLE'
export type BenchVerdict = 'BETTER' | 'IN_LINE' | 'WORSE'
export type Zone = 'SAFE' | 'GREY' | 'DISTRESS'

/** [x0, top, x1, bottom] in pdfplumber page coordinates. */
export type Bbox = [number, number, number, number]

export interface LineItem {
  canonical_key: string
  label_as_printed: string | null
  value: number
  page: number | null
  bbox: Bbox | null
  trust: Trust
  /** Which passing identity vouched for this figure. Empty = traced, not cross-checked. */
  checked_by?: string[]
  derived?: boolean
  derivation?: string
}

export interface Check {
  name: string
  formula: string
  expected: number | null
  actual: number | null
  delta: number | null
  delta_pct: number | null
  tolerance: number
  passed: boolean
  status: CheckStatus
  detail: string
  affected_keys: string[]
}

export interface RiskDriver {
  name: string
  label: string
  weight: number
  value: number
  contribution: number
}

export interface Risk {
  score: number | null
  zone: Zone | null
  variant: string | null
  drivers: RiskDriver[]
  withheld?: string[]
  reason?: string
}

export interface BenchmarkRow {
  metric: string
  label: string
  company: number
  sector_median: number
  peer_count: number
  higher_is_better: boolean
  is_percentage: boolean
  percentile: number | null
  gap_pct: number | null
  verdict: BenchVerdict
}

export interface Gap {
  sentence: string
  page: number | null
  metric: string
  claimed: string
  actual: string
  verdict: Verdict
  basis?: string
}

export interface Summary {
  line_item_count: number
  trust: Record<Trust, number>
  checks_passed: number
  checks_failed: number
  checks_unverifiable: number
}

export interface PrivacyBucket {
  entity_type: string
  label: string
  count: number
  transmitted: number
  pages: (number | null)[]
}

export interface PrivacyLedger {
  entries: unknown[]
  summary: PrivacyBucket[]
  detected: number
  masked: number
  transmitted: number
  pages_scanned: number
  pages_transmitted: number
}

export type Ratios = Record<string, number | null>

export interface SessionEnvelope {
  session_id: string
  expires_at: number
  expires_in: number
  ttl_minutes: number
  source: string | null
  document: string | null
  pages_total: number | null
  pages_rendered: number[]
  page_dimensions: Record<string, { width: number; height: number }>
  warnings: string[]
  paid: boolean
}

export interface Analysis extends SessionEnvelope {
  entity: string | null
  period: string | null
  prior_period: string | null
  currency: string | null
  unit: string | null
  ticker: string | null
  line_items: LineItem[]
  prior_line_items: LineItem[]
  checks: Check[]
  quarantined: string[]
  ratios: Ratios
  prior_ratios: Ratios
  risk: Risk
  benchmark: BenchmarkRow[]
  say_do_gap: Gap[]
  summary: Summary
}

export interface UploadResult extends SessionEnvelope {
  privacy_ledger: PrivacyLedger
  targeted_pages: Record<string, number[]>
}

export interface QuerySource {
  page: number | null
  bbox: Bbox | null
}

export interface QueryInput {
  canonical_key: string
  label: string | null
  value: number | null
  page: number | null
  bbox: Bbox | null
}

export interface QueryHit {
  answer: string
  value: number | null
  source: QuerySource | null
  trust: Trust
  inputs?: QueryInput[]
  not_found?: false
}

export interface QueryMiss {
  not_found: true
  message: string
}

export type QueryResult = QueryHit | QueryMiss

export interface PaymentQuote {
  required: boolean
  price_sol: number
  price_lamports: number
  treasury: string | null
  cluster: string
  rpc_url: string
  model: string
}

/** One row of the Supabase audit history.
 *
 *  Results only — the audit table holds no document, no page image and no
 *  personal data, so there is deliberately no field here for any of them. */
export interface HistoryRow {
  id: string
  created_at: string
  entity: string | null
  period: string | null
  ticker: string | null
  document_name: string | null
  source: string | null
  pages_total: number | null
  checks_passed: number | null
  checks_failed: number | null
  checks_unverifiable: number | null
  line_item_count: number | null
  trust_verified: number | null
  trust_derived: number | null
  trust_unverified: number | null
  quarantined: string[] | null
  risk_score: number | null
  risk_zone: Zone | null
  risk_variant: string | null
  ratios: Ratios | null
  pii_detected: number | null
  pii_transmitted: number | null
}

export interface HistoryResult {
  available: boolean
  rows: HistoryRow[]
  reason?: string
}

/**
 * Mirrors the engine's output shape (Contract 2). These types are transcribed
 * from `analysis/pipeline.py` — if that contract moves, this file moves with it.
 *
 * Nullability here is meaningful, not defensive. A `null` ratio means the
 * engine refused to compute it from a quarantined figure, and the UI must
 * render that as "withheld", never as zero.
 */

/** Top-level navigation. Six destinations, matching the design system's
 *  sidebar. Analysis is the only one that carries sub-navigation, because the
 *  engine's outputs are all lenses on a single reconciled document rather than
 *  separate places to be. */
export type Section =
  | 'dashboard' | 'analysis' | 'market' | 'expenses' | 'solana' | 'privacy'

/** Lenses on the selected document, shown as tabs inside Analysis. */
export type AnalysisTab =
  | 'documents' | 'overview' | 'provenance' | 'saydo' | 'benchmark' | 'risk' | 'candidates'

/** A resolved location. `tab` is only meaningful when `section` is 'analysis'. */
export interface Route {
  section: Section
  tab: AnalysisTab
}

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

/** Live cluster state. Every field is nullable and carries `reason` when the
 *  RPC could not answer — there is no fallback figure for a balance. */
export interface SolanaNetwork {
  cluster: string
  rpc_url: string
  treasury: string | null
  reachable: boolean
  version: string | null
  slot: number | null
  balance_sol: number | null
  reason: string | null
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

/* -------------------------------------------------------------------------- */
/* Market data (Twelve Data, proxied by the engine)                            */
/* -------------------------------------------------------------------------- */

export interface MarketStatus {
  configured: boolean
  provider: string
  reason: string | null
  cache_ttl: number
  filing_exchange: string | null
}

export interface MarketMatch {
  symbol: string
  name: string | null
  exchange: string | null
  country: string | null
  currency: string | null
  type: string | null
}

export interface MarketSearchResult {
  results: MarketMatch[]
}

/** Every numeric field is nullable: Twelve Data omits fields per instrument,
 *  and a missing figure must not be rendered as zero. */
export interface MarketQuote {
  symbol: string
  name: string | null
  exchange: string | null
  currency: string | null
  datetime: string | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  previous_close: number | null
  change: number | null
  percent_change: number | null
  volume: number | null
  average_volume: number | null
  fifty_two_week_high: number | null
  fifty_two_week_low: number | null
  is_market_open: boolean | null
}

export interface Candle {
  datetime: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export interface MarketTimeSeries {
  symbol: string
  currency: string | null
  exchange: string | null
  interval: string
  values: Candle[]
}

/* -------------------------------------------------------------------------- */
/* Crypto market (CoinGecko, proxied by the engine)                            */
/* -------------------------------------------------------------------------- */

export interface CryptoAsset {
  asset_id: string
  symbol: string | null
  name: string | null
  image: string | null
  price: number | null
  market_cap: number | null
  market_cap_rank: number | null
  volume_24h: number | null
  change_24h_pct: number | null
  change_7d_pct: number | null
  high_24h: number | null
  low_24h: number | null
  ath: number | null
  ath_change_pct: number | null
  circulating_supply: number | null
  vs_currency: string
  last_updated: string | null
}

export interface CryptoMarket {
  provider: string
  vs_currency: string
  fetched_at: string
  assets: CryptoAsset[]
}

export interface CryptoStatus {
  market: {
    configured: boolean
    provider: string
    plan: string
    vs_currency: string
    top_n: number
    cache_ttl: number
    reason: string | null
  }
  advisor: {
    configured: boolean
    provider: string
    model: string
    max_candidates: number
    reason: string | null
  }
}

/* -------------------------------------------------------------------------- */
/* AI research advisor (DeepSeek, with a deterministic fallback)              */
/* -------------------------------------------------------------------------- */

export type AdvisorVerdict =
  | 'CANDIDATE_FOR_REVIEW'
  | 'HIGH_RISK'
  | 'INSUFFICIENT_EVIDENCE'
  | 'NOT_ALIGNED'

export interface AdvisorCandidateMarket {
  price: number | null
  market_cap: number | null
  volume_24h: number | null
  change_24h_pct: number | null
  change_7d_pct: number | null
  vs_currency: string
}

export interface AdvisorCandidate {
  asset_id: string
  symbol: string | null
  name: string | null
  image: string | null
  verdict: AdvisorVerdict
  confidence: number
  rationale: string[]
  supporting_evidence: string[]
  risk_factors: string[]
  market_data_timestamp: string | null
  market: AdvisorCandidateMarket
}

/* -------------------------------------------------------------------------- */
/* Solana devnet x402 paper-order flow                                         */
/* -------------------------------------------------------------------------- */

export interface PaperStatus {
  network: string
  rpc_url: string
  usdc_mint: string
  usdc_decimals: number
  recipient: string
  amount_base_units: number
  amount_usdc: number
  caip_network: string
  memo_prefix: string
  rpc: {
    network: string
    rpc_url: string
    recipient: string
    usdc_mint: string
    amount_base_units: number
    reachable: boolean
    slot: number | null
    version: string | null
    reason: string | null
  }
  ledger: { backend: 'postgres' | 'sqlite' | null; sqlite_path?: string; reason: string | null }
}

export interface PaperRequirements {
  x402Version: number
  scheme: string
  network: string          // CAIP-2, e.g. "solana:EtWTR..."
  amount: string           // base units, string per x402
  asset: string            // mint
  assetDecimals: number
  payTo: string
  maxTimeoutSeconds: number
  extra: { memo: string; network?: string; rpcUrl?: string }
  resource: string
}

export interface PaperQuote {
  resource_key: string
  verify_hash: string
  requirements: PaperRequirements
  already_paid: boolean
}

export interface PaymentRecord {
  id: number | string
  resource_key: string
  verify_hash: string
  expected_memo: string
  expected_amount_base_units: number
  expected_mint: string
  expected_recipient: string
  network: string
  transaction_signature: string
  payer_wallet: string
  commitment: string
  slot: number | null
  block_time: number | null
  status: string
  created_at: string
  verified_at?: string
}

export interface PaperOrderReceipt {
  status: 'paper_order_created'
  execution_mode: 'simulated'
  order_id: string
  created_at: string
  asset_id: string
  notional_usd: number
  reference_price_usd: number
  reference_price_source: string
  reference_price_at: string
  simulated_quantity: number
  verify_hash: string
  payment_transaction_signature: string
  payment_slot: number | null
  payment_block_time: number | null
  payment_network: string
  explorer_url: string | null
  disclaimer: string
}

export interface PaperOrderResult {
  status: 'paper_order_created'
  resource_key: string
  receipt: PaperOrderReceipt
  payment: PaymentRecord
}

export interface AdvisorReport {
  report_hash: string
  generated_at: string
  source: 'deepseek' | 'fallback'
  model: string | null
  candidates: AdvisorCandidate[]
  overall_summary: string
  limitations: string[]
  market_snapshot:
    | { provider: string; vs_currency?: string; fetched_at?: string; assets_considered: number }
    | null
  analysis_features: Record<string, unknown>
  reason?: string
}

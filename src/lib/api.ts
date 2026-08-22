/** Thin client over Contract 2. No reshaping — the engine's response is the
 *  single source of truth and reaches the components verbatim. */

import type {
  AdvisorReport, Analysis, CryptoMarket, CryptoStatus, HistoryResult,
  MarketQuote, MarketSearchResult, MarketStatus, MarketTimeSeries, PaperOrderResult,
  PaperQuote, PaperStatus, PaymentQuote, PaymentRecord, QueryResult, SolanaNetwork,
  UploadResult,
} from '../types'
import { apiAuthHeaders } from './auth'

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8000'

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...apiAuthHeaders(), ...(init?.headers || {}) },
    })
  } catch {
    throw new ApiError(
      `Cannot reach the SOLFV engine at ${API_BASE}. Start it with ` +
      `\`python -m uvicorn backend.main:app --port 8000\` from engine/.`,
      0,
    )
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      (body && (body.detail || body.message)) || `Request failed (${response.status})`
    throw new ApiError(String(detail), response.status)
  }
  return body as T
}

async function requestImage(path: string): Promise<string> {
  const response = await fetch(`${API_BASE}${path}`, { headers: apiAuthHeaders() })
  if (!response.ok) throw new ApiError(`Source page request failed (${response.status})`, response.status)
  return URL.createObjectURL(await response.blob())
}

export const api = {
  health: () => request<Record<string, unknown>>('/health'),

  /** Load a hand-verified extraction. `doctored` is the deliberate break. */
  demo: (variant: 'clean' | 'doctored') =>
    request<UploadResult>(`/demo/${variant}`, { method: 'POST' }),

  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>('/upload', { method: 'POST', body: form })
  },

  analysis: (sid: string) => request<Analysis>(`/analysis/${sid}`),

  query: (sid: string, question: string) =>
    request<QueryResult>(`/query/${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),

  purge: (sid: string) =>
    request<{ purged: boolean }>(`/session/${sid}`, { method: 'DELETE' }),

  quote: () => request<PaymentQuote>('/payment/quote'),

  /** Live cluster state and treasury balance. */
  network: () => request<SolanaNetwork>('/payment/network'),

  /** Past reconciled analyses. Outlives the session TTL because it holds
   *  results, not documents. */
  history: (limit = 50) => request<HistoryResult>(`/history?limit=${limit}`),

  /** URL for a rendered source page. Only targeted pages are rasterised. */
  pageImage: (sid: string, page: number) => requestImage(`/page/${sid}/${page}`),

  /* Market data. Proxied through the engine, never called from the browser —
   * the Twelve Data key is billable, and a key the frontend can read is a key
   * that has already leaked. */

  marketStatus: () => request<MarketStatus>('/market/status'),

  marketSearch: (query: string) =>
    request<MarketSearchResult>(`/market/search?q=${encodeURIComponent(query)}`),

  marketQuote: (symbol: string, exchange?: string) =>
    request<MarketQuote>(
      `/market/quote?symbol=${encodeURIComponent(symbol)}` +
      (exchange ? `&exchange=${encodeURIComponent(exchange)}` : ''),
    ),

  marketSeries: (symbol: string, interval = '1day', outputsize = 260, exchange?: string) =>
    request<MarketTimeSeries>(
      `/market/timeseries?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}&outputsize=${outputsize}` +
      (exchange ? `&exchange=${encodeURIComponent(exchange)}` : ''),
    ),

  /* Crypto market — CoinGecko, proxied by the engine. Same reason: the key is
   * billable and rate-limited, and the frontend must never carry it. */

  cryptoStatus: () => request<CryptoStatus>('/crypto/status'),

  cryptoMarket: (limit = 25) =>
    request<CryptoMarket>(`/crypto/market?limit=${limit}`),

  /* AI research advisor — DeepSeek from the backend, with a deterministic
   * fallback when the key is absent. Returns candidates a human must review;
   * never emits BUY/SELL. Framed as research support under Malaysian rules. */

  advisor: (sid: string, limit = 25) =>
    request<AdvisorReport>(`/advisor/${sid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit }),
    }),

  /* Solana devnet x402 paper-order flow — SOLANA TRACK.
   * The advisor recommends candidates for free; only "simulate a purchase"
   * triggers the payment gate, which verifies a real devnet USDC transfer
   * before returning the paper receipt. No cryptocurrency is bought. */

  paperStatus: () => request<PaperStatus>('/paper/status'),

  paperQuote: (sid: string, assetId: string, notionalUsd: number) =>
    request<PaperQuote>(
      `/paper/${sid}/quote?asset_id=${encodeURIComponent(assetId)}` +
      `&notional_usd=${notionalUsd}`,
    ),

  paperOrder: (sid: string, assetId: string, notionalUsd: number,
                signature?: string) =>
    request<PaperOrderResult>(`/paper/${sid}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_id: assetId,
        notional_usd: notionalUsd,
        transaction_signature: signature ?? null,
      }),
    }),

  paperHistory: (limit = 50) =>
    request<{ rows: PaymentRecord[] }>(`/paper/history?limit=${limit}`),
}

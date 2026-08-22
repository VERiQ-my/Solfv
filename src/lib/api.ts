/** Thin client over Contract 2. No reshaping — the engine's response is the
 *  single source of truth and reaches the components verbatim. */

import type {
  Analysis, HistoryResult, MarketQuote, MarketSearchResult, MarketStatus,
  MarketTimeSeries, PaymentQuote, QueryResult, SolanaNetwork, UploadResult,
} from '../types'

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
    response = await fetch(`${API_BASE}${path}`, init)
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
  pageImage: (sid: string, page: number) => `${API_BASE}/page/${sid}/${page}`,

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
}

/** Market Intelligence — the live price feed, and what it does to the engine.
 *
 *  The chart is the visible half. The load-bearing half is the panel at the
 *  bottom: the same feed fills `market_data` for the analysis pipeline, and two
 *  concrete things change when it resolves — Altman moves from the Z'' private
 *  variant to the original listed-company Z, and the market-vs-narrative Say–Do
 *  rows become testable instead of UNVERIFIABLE.
 *
 *  Everything is proxied through the engine. The Twelve Data key is billable
 *  and never reaches the browser.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Card, Empty, Icon, NotConfigured, Segmented, Spinner, Stat,
} from '../components/ui'
import { api } from '../lib/api'
import { useSession } from '../state'
import type { Candle, MarketMatch, MarketQuote, MarketStatus } from '../types'

type Range = '1m' | '6m' | '1y' | '5y'

/** Twelve Data charges per request, so each range is one call sized to it
 *  rather than one huge series trimmed client-side. */
const RANGES: Record<Range, { label: string; interval: string; size: number }> = {
  '1m': { label: '1M', interval: '1day', size: 22 },
  '6m': { label: '6M', interval: '1day', size: 130 },
  '1y': { label: '1Y', interval: '1day', size: 260 },
  '5y': { label: '5Y', interval: '1week', size: 260 },
}

export default function Market() {
  const { analysis } = useSession()
  const [status, setStatus] = useState<MarketStatus | null>(null)
  const [symbol, setSymbol] = useState('')
  const [exchange, setExchange] = useState<string | undefined>()
  const [range, setRange] = useState<Range>('1y')

  const [quote, setQuote] = useState<MarketQuote | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api.marketStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  // Seed from the selected document, so arriving here after a reconciliation
  // lands on the issuer just analysed rather than an empty box.
  useEffect(() => {
    if (!symbol && analysis?.ticker && status?.configured) {
      setSymbol(analysis.ticker)
      setExchange(status.filing_exchange ?? undefined)
    }
  }, [analysis?.ticker, status, symbol])

  const load = useCallback(async (target: string, ex: string | undefined, span: Range) => {
    if (!target) return
    setLoading(true)
    setError(null)
    const { interval, size } = RANGES[span]
    try {
      const [nextQuote, series] = await Promise.all([
        api.marketQuote(target, ex),
        api.marketSeries(target, interval, size, ex),
      ])
      setQuote(nextQuote)
      setCandles(series.values)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setQuote(null)
      setCandles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (symbol) void load(symbol, exchange, range)
  }, [symbol, exchange, range, load])

  if (status && !status.configured) {
    return (
      <div className="space-y-xl">
        <Heading />
        <NotConfigured
          icon="key_off"
          title="No market feed is connected"
          body="Market Intelligence proxies Twelve Data through the engine. Without a key there is nothing to chart, and the analysis pipeline runs without market enrichment."
          requirement={
            <>
              Add <code className="mono text-secondary">TWELVE_DATA_API_KEY</code> to the{' '}
              <code className="mono text-secondary">.env</code> at the repository root and
              restart the engine.
              <p className="mt-sm">{status.reason}</p>
            </>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-xl">
      <Heading />

      <SymbolPicker
        onPick={(match) => { setSymbol(match.symbol); setExchange(match.exchange ?? undefined) }}
        current={symbol}
        exchange={exchange}
        suggestion={analysis?.ticker ?? null}
        filingExchange={status?.filing_exchange ?? null}
      />

      {error && (
        <div className="flex items-start gap-md p-md rounded-lg border border-warning/30 bg-warning/5">
          <Icon name="error" className="text-warning shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">
              The feed refused {symbol}{exchange ? ` on ${exchange}` : ''}.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs break-words">{error}</p>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              Plan coverage is the usual cause — a key that resolves US equities will still
              refuse Bursa Malaysia symbols below the Pro tier. Reconciliation is unaffected.
            </p>
          </div>
        </div>
      )}

      {!symbol ? (
        <Card title="No instrument selected" icon="query_stats">
          <Empty
            icon="search"
            title="Search for an instrument"
            body="Look up a listed company by name or ticker to chart its price and feed the engine's risk model."
          />
        </Card>
      ) : (
        <>
          <QuoteRow quote={quote} loading={loading} />

          <Card
            title={quote?.name || symbol}
            subtitle={[quote?.exchange, quote?.currency].filter(Boolean).join(' · ') || undefined}
            icon="show_chart"
            action={
              <Segmented
                value={range}
                onChange={setRange}
                options={(Object.keys(RANGES) as Range[]).map(id => ({
                  id, label: RANGES[id].label,
                }))}
              />
            }
          >
            {loading && candles.length === 0 ? (
              <Spinner label="Loading price history…" />
            ) : candles.length < 2 ? (
              <Empty
                icon="show_chart"
                title="No price history returned"
                body="The feed had no series for this instrument over the selected range."
              />
            ) : (
              <PriceChart candles={candles} currency={quote?.currency ?? null} />
            )}
          </Card>
        </>
      )}

      <EngineLink analysisTicker={analysis?.ticker ?? null} warnings={analysis?.warnings ?? []} />
    </div>
  )
}

function Heading() {
  return (
    <header className="flex flex-col md:flex-row md:items-end justify-between gap-md">
      <div className="min-w-0">
        <span className="eyebrow">Twelve Data · proxied by the engine</span>
        <h2 className="text-headline-lg md:text-display-lg text-primary mt-xs">
          Market Intelligence
        </h2>
        <p className="text-body-lg text-on-surface-variant mt-xs max-w-prose">
          Live pricing for listed issuers, and the feed that upgrades the engine's distress
          model from the private-company variant to the listed one.
        </p>
      </div>
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* Symbol search                                                               */
/* -------------------------------------------------------------------------- */

function SymbolPicker({
  onPick, current, exchange, suggestion, filingExchange,
}: {
  onPick: (match: MarketMatch) => void
  current: string
  exchange?: string
  suggestion: string | null
  filingExchange: string | null
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MarketMatch[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // Debounced: search fires per keystroke otherwise, and the free tier allows
  // eight requests a minute.
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (query.trim().length < 2) { setResults([]); return }
    timer.current = window.setTimeout(() => {
      setSearching(true)
      api.marketSearch(query.trim())
        .then(response => { setResults(response.results); setOpen(true) })
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 450)
    return () => window.clearTimeout(timer.current)
  }, [query])

  return (
    <Card title="Instrument" icon="search">
      <div className="relative">
        <Icon
          name="search"
          className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant
                     text-[20px] pointer-events-none"
        />
        <input
          className="input pl-xl"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search by company name or ticker — Apple, AAPL, 1155…"
          aria-label="Search for an instrument"
        />
        {searching && (
          <span className="spinner absolute right-sm top-1/2 -translate-y-1/2 text-secondary" />
        )}

        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-xs w-full max-h-72 overflow-y-auto rounded-md
                         border border-hairline bg-surface-container-lowest shadow-raise">
            {results.map((match, index) => (
              <li key={`${match.symbol}-${match.exchange}-${index}`}>
                <button
                  onClick={() => { onPick(match); setOpen(false); setQuery('') }}
                  className="w-full text-left px-md py-sm hover:bg-surface-container-low
                             transition-colors flex items-center gap-sm"
                >
                  <b className="mono text-body-md text-primary w-20 shrink-0 truncate">
                    {match.symbol}
                  </b>
                  <span className="flex-1 min-w-0 truncate text-body-md text-on-surface">
                    {match.name}
                  </span>
                  <span className="chip shrink-0">{match.exchange}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-sm mt-md">
        {current && (
          <span className="badge-info">
            Charting {current}{exchange ? ` · ${exchange}` : ''}
          </span>
        )}
        {suggestion && suggestion !== current && (
          <button
            className="chip normal-case hover:bg-secondary/10 hover:text-secondary transition-colors"
            onClick={() => onPick({
              symbol: suggestion, name: null, exchange: filingExchange,
              country: null, currency: null, type: null,
            })}
          >
            <Icon name="description" className="text-[14px]" />
            Use the selected document's ticker ({suggestion})
          </button>
        )}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Quote                                                                       */
/* -------------------------------------------------------------------------- */

const num = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-MY', {
        minimumFractionDigits: digits, maximumFractionDigits: digits,
      }).format(value)

const compact = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 })
        .format(value)

function QuoteRow({ quote, loading }: { quote: MarketQuote | null; loading: boolean }) {
  if (!quote) {
    return loading ? <Spinner label="Loading quote…" /> : null
  }

  const up = (quote.percent_change ?? 0) >= 0
  const inBand =
    quote.close != null && quote.fifty_two_week_low != null && quote.fifty_two_week_high != null
      ? (quote.close - quote.fifty_two_week_low) /
        Math.max(1e-9, quote.fifty_two_week_high - quote.fifty_two_week_low)
      : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
      <Stat
        label="Last price" icon="payments"
        value={`${quote.currency ?? ''} ${num(quote.close)}`.trim()}
        hint={
          <span className={`inline-flex items-center gap-xs mono px-xs py-px rounded
            ${up ? 'text-success bg-success/10' : 'text-danger bg-danger/10'}`}>
            <Icon name={up ? 'arrow_upward' : 'arrow_downward'} className="text-[14px]" />
            {num(quote.change)} ({num(quote.percent_change)}%)
          </span>
        }
      />
      <Stat
        label="Day range" icon="expand"
        value={`${num(quote.low)} – ${num(quote.high)}`}
        hint={`Opened ${num(quote.open)} · previous close ${num(quote.previous_close)}`}
      />
      <Stat
        label="52-week range" icon="calendar_month"
        value={`${num(quote.fifty_two_week_low)} – ${num(quote.fifty_two_week_high)}`}
        hint={inBand != null ? `${(inBand * 100).toFixed(0)}% of the way up the band` : undefined}
      >
        {inBand != null && (
          <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden mt-xs">
            <div className="h-full rounded-full bg-secondary"
                 style={{ width: `${Math.max(0, Math.min(100, inBand * 100))}%` }} />
          </div>
        )}
      </Stat>
      <Stat
        label="Volume" icon="bar_chart"
        value={compact(quote.volume)}
        hint={
          <>
            {quote.average_volume != null && `avg ${compact(quote.average_volume)} · `}
            <span className={quote.is_market_open ? 'text-success' : ''}>
              {quote.is_market_open ? 'market open' : 'market closed'}
            </span>
          </>
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chart                                                                       */
/* -------------------------------------------------------------------------- */

/** An inline SVG area chart. No charting dependency: one series, one axis pair,
 *  and the design tokens already define every colour it needs. */
function PriceChart({ candles, currency }: { candles: Candle[]; currency: string | null }) {
  const [hover, setHover] = useState<number | null>(null)

  const points = useMemo(
    () => candles.filter(c => c.close != null) as (Candle & { close: number })[],
    [candles],
  )

  const { path, area, low, high, first, last, gain } = useMemo(() => {
    const closes = points.map(p => p.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    // A flat series would divide by zero and collapse the plot onto one edge.
    const span = max - min || Math.abs(max) || 1
    const pad = span * 0.08

    const x = (index: number) => (index / Math.max(1, points.length - 1)) * 100
    const y = (value: number) => 100 - ((value - (min - pad)) / (span + pad * 2)) * 100

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(3)},${y(p.close).toFixed(3)}`)
    return {
      path: line.join(' '),
      area: `${line.join(' ')} L100,100 L0,100 Z`,
      low: min,
      high: max,
      first: closes[0],
      last: closes[closes.length - 1],
      gain: closes[closes.length - 1] >= closes[0],
    }
  }, [points])

  const change = first ? ((last - first) / Math.abs(first)) * 100 : 0
  const active = hover != null ? points[hover] : null
  const tone = gain ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))'

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-md mb-md">
        <b className={`mono text-headline-md ${gain ? 'text-success' : 'text-danger'}`}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
        </b>
        <span className="text-body-sm text-on-surface-variant">
          over {points.length} sessions · {currency ?? ''} {num(low)} to {num(high)}
        </span>
        {active && (
          <span className="ml-auto chip-info normal-case">
            {active.datetime} · <b className="mono ml-xs">{num(active.close)}</b>
          </span>
        )}
      </div>

      <div
        className="relative w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={event => {
          const box = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - box.left) / box.width
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-[260px] md:h-[320px] overflow-visible"
          role="img"
          aria-label={`Price history, ${change.toFixed(2)}% over the period`}
        >
          <defs>
            <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
              <stop offset="100%" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 25, 50, 75, 100].map(line => (
            <line
              key={line} x1="0" x2="100" y1={line} y2={line}
              stroke="rgb(var(--c-hairline))" strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill="url(#price-fill)" />
          <path
            d={path} fill="none" stroke={tone} strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {active && hover != null && (
            <line
              x1={(hover / Math.max(1, points.length - 1)) * 100}
              x2={(hover / Math.max(1, points.length - 1)) * 100}
              y1="0" y2="100"
              stroke="rgb(var(--c-secondary))" strokeWidth="1" strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        <div className="flex justify-between mt-xs text-body-sm text-on-surface-variant mono">
          <span>{points[0]?.datetime}</span>
          <span>{points[points.length - 1]?.datetime}</span>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* What the feed changes in the engine                                         */
/* -------------------------------------------------------------------------- */

function EngineLink({
  analysisTicker, warnings,
}: { analysisTicker: string | null; warnings: string[] }) {
  const refusals = warnings.filter(w => w.toLowerCase().includes('market data'))

  return (
    <Card title="What this feed changes in the engine" icon="conversion_path">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
        <div className="p-md rounded-md border border-hairline bg-surface-container-low">
          <b className="block text-body-md text-primary">
            Market cap → the Altman variant
          </b>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Without it the engine scores <span className="mono">Z''</span>, the variant for
            private companies, which substitutes book equity. With it the engine runs the
            original listed-company <span className="mono">Z</span> — different coefficients,
            different thresholds, a different verdict at the margin.
          </p>
        </div>
        <div className="p-md rounded-md border border-hairline bg-surface-container-low">
          <b className="block text-body-md text-primary">
            One-year price move → the Say–Do Gap
          </b>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Claims about shareholder value have nothing to test against without a price
            series, so they resolve UNVERIFIABLE. The feed turns them into rows the
            arithmetic can actually settle.
          </p>
        </div>
      </div>

      {analysisTicker && (
        <p className="mt-md pt-md border-t border-hairline text-body-sm text-on-surface-variant">
          The selected document reports ticker{' '}
          <b className="mono text-primary">{analysisTicker}</b>. The engine attempts this
          lookup automatically on every reconciliation.
        </p>
      )}

      {refusals.length > 0 && (
        <div className="mt-md flex items-start gap-sm p-md rounded-md
                        border border-warning/30 bg-warning/5">
          <Icon name="info" className="text-warning shrink-0 text-[18px]" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">
              Enrichment was refused for the selected document.
            </b>
            {refusals.map((reason, index) => (
              <p key={index} className="text-body-sm text-on-surface-variant mt-xs break-words">
                {reason}
              </p>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

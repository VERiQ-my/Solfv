/** Crypto Candidates — the research shortlist for the selected document.
 *
 *  This tab does not tell anyone what to buy. It shows which crypto assets
 *  the engine's reconciled analysis makes worth a human's second look, given
 *  a live snapshot of the market. Verdicts come from a closed vocabulary
 *  designed to describe *fit*, never action, because automated investment
 *  advice is a regulated activity in Malaysia.
 *
 *  The advisor call is free — the payment gate lives on paper-order
 *  execution, not on analysis. Every candidate is enriched with the
 *  provenance a reviewer needs: what evidence supported it, what risks were
 *  called out, and whether the shortlist came from DeepSeek or the
 *  deterministic fallback.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Card, Empty, Icon, NotConfigured, PageIntro, Spinner, Stat,
} from '../components/ui'
import { api, ApiError } from '../lib/api'
import { payWithPhantom, PhantomError } from '../lib/phantom'
import { useSession } from '../state'
import type {
  AdvisorCandidate, AdvisorReport, AdvisorVerdict, CryptoStatus,
  PaperOrderReceipt, PaperQuote,
} from '../types'

const VERDICT_COPY: Record<AdvisorVerdict, {
  label: string
  tone: 'good' | 'warn' | 'bad' | 'muted'
  hint: string
}> = {
  CANDIDATE_FOR_REVIEW: {
    label: 'Candidate for review',
    tone: 'good',
    hint: 'Fits the company profile; a human should weigh it against their own thesis.',
  },
  HIGH_RISK: {
    label: 'High risk',
    tone: 'bad',
    hint: 'Volatility or the company baseline pushes this into a materially riskier bucket.',
  },
  INSUFFICIENT_EVIDENCE: {
    label: 'Insufficient evidence',
    tone: 'warn',
    hint: 'The reconciled analysis has too many gaps for a fit judgement to hold.',
  },
  NOT_ALIGNED: {
    label: 'Not aligned',
    tone: 'muted',
    hint: 'Present in the universe but does not fit this company at this time.',
  },
}

const VERDICT_SURFACE: Record<AdvisorVerdict, string> = {
  CANDIDATE_FOR_REVIEW: 'border-success/30 bg-success/5',
  HIGH_RISK: 'border-danger/30 bg-danger/5',
  INSUFFICIENT_EVIDENCE: 'border-warning/30 bg-warning/5',
  NOT_ALIGNED: 'border-hairline bg-surface-container-low',
}

const VERDICT_TEXT: Record<AdvisorVerdict, string> = {
  CANDIDATE_FOR_REVIEW: 'text-success',
  HIGH_RISK: 'text-danger',
  INSUFFICIENT_EVIDENCE: 'text-warning',
  NOT_ALIGNED: 'text-on-surface-variant',
}

const money = (value: number | null | undefined, currency = 'USD') =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-MY', {
        style: 'currency', currency: currency.toUpperCase(),
        maximumFractionDigits: value < 1 ? 4 : 2,
      }).format(value)

const compact = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 })
        .format(value)

const pct = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? null
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`

export default function CryptoCandidates() {
  const { analysis, sid } = useSession()
  const [status, setStatus] = useState<CryptoStatus | null>(null)
  const [report, setReport] = useState<AdvisorReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [purchasing, setPurchasing] = useState<AdvisorCandidate | null>(null)

  useEffect(() => {
    void api.cryptoStatus().then(setStatus).catch(() => setStatus(null))
  }, [])

  const load = useCallback(async () => {
    if (!sid) return
    setLoading(true)
    setError(null)
    try {
      setReport(await api.advisor(sid, 25))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [sid])

  // Fire once when the session lands here with an analysis. Subsequent runs
  // are user-triggered — a click on "Re-run", not an effect — because each
  // run costs a CoinGecko call and, when configured, a DeepSeek call.
  useEffect(() => {
    if (sid && analysis && !report && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, analysis?.session_id])

  if (!analysis) return null

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="Research support — not investment advice"
        title="Crypto Candidates"
        lede={`Which crypto assets are worth a human's second look given the reconciled analysis of ${analysis.entity ?? 'this document'}. Verdicts describe fit, never action. No trade is executed here.`}
      />

      <AdvisorProvenance status={status} report={report} loading={loading}
                          error={error} onRerun={load} />

      {error && (
        <div className="flex items-start gap-md p-md rounded-lg
                        border border-warning/30 bg-warning/5">
          <Icon name="error" className="text-warning shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">
              The advisor call failed.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs break-words">
              {error}
            </p>
          </div>
        </div>
      )}

      {loading && !report && <Spinner label="Fetching market snapshot and shortlisting candidates…" />}

      {report && report.candidates.length === 0 && (
        <Card title="No candidates shortlisted" icon="filter_alt_off">
          <Empty
            icon="inbox"
            title="Nothing in the current universe matched the policy"
            body={report.reason || report.overall_summary ||
              'The analysis produced no shortlisted candidates from the current market snapshot.'}
          />
        </Card>
      )}

      {report && report.candidates.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
            <Stat
              label="Candidates" icon="list_alt"
              value={report.candidates.length}
              hint={<>from {report.market_snapshot?.assets_considered ?? '—'} assets considered</>}
            />
            <Stat
              label="Top verdict" icon="rule"
              value={topVerdict(report.candidates)}
              hint={report.source === 'deepseek' ? 'chosen by DeepSeek' : 'chosen by fallback'}
            />
            <Stat
              label="Company risk zone" icon="monitoring"
              value={(analysis.risk.zone as string | null) ?? '—'}
              tone={analysis.risk.zone === 'DISTRESS' ? 'bad'
                : analysis.risk.zone === 'GREY' ? undefined : 'good'}
              hint={analysis.risk.variant ?? '—'}
            />
            <Stat
              label="Snapshot" icon="schedule"
              value={report.market_snapshot?.provider ?? '—'}
              hint={report.market_snapshot?.fetched_at ?? '—'}
            />
          </div>

          {report.overall_summary && (
            <Card title="Overall summary" icon="notes">
              <p className="text-body-md text-on-surface-variant">
                {report.overall_summary}
              </p>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
            {report.candidates.map(candidate => (
              <CandidateCard
                key={candidate.asset_id}
                candidate={candidate}
                onSimulate={() => setPurchasing(candidate)}
              />
            ))}
          </div>

          <Card title="Limitations" icon="gavel">
            <ul className="space-y-sm">
              {report.limitations.map((line, i) => (
                <li key={i} className="flex items-start gap-sm text-body-sm text-on-surface-variant">
                  <Icon name="info" className="text-[16px] text-on-surface-variant shrink-0 mt-px" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {purchasing && sid && (
        <SimulatePurchaseModal
          sid={sid}
          candidate={purchasing}
          onClose={() => setPurchasing(null)}
        />
      )}

      {status && !status.market.configured && (
        <NotConfigured
          icon="key_off"
          title="No CoinGecko key is set"
          body="The engine is falling back to the public CoinGecko endpoint, which is heavily rate-limited. A demo key is enough for this build."
          requirement={
            <>
              Set <code className="mono text-secondary">COINGECKO_DEMO_API_KEY</code> in
              the <code className="mono text-secondary">.env</code> at the repository root
              and restart the engine.
            </>
          }
        />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Provenance bar — where this shortlist came from                             */
/* -------------------------------------------------------------------------- */

function AdvisorProvenance({
  status, report, loading, error, onRerun,
}: {
  status: CryptoStatus | null
  report: AdvisorReport | null
  loading: boolean
  error: string | null
  onRerun: () => void
}) {
  const advisorMode: 'live' | 'fallback' | 'unknown' =
    report?.source === 'deepseek' ? 'live'
      : report?.source === 'fallback' ? 'fallback'
        : status?.advisor.configured ? 'live' : status ? 'fallback' : 'unknown'

  // Prefer the fallback's real reason (e.g. DeepSeek 401) over the generic
  // "key not set" guess. Only when there is truly no reason on the report do
  // we fall back to the status endpoint's static message.
  const advisorHint = advisorMode === 'live'
    ? 'DeepSeek — live shortlist'
    : advisorMode === 'fallback'
      ? (report?.reason
          ?? status?.advisor.reason
          ?? 'Deterministic rules — DeepSeek unavailable.')
      : 'unknown'

  return (
    <Card
      title="Advisor provenance"
      subtitle="Every field on this page is either read from a live feed or explicitly withheld with the reason attached."
      icon="conversion_path"
      action={
        <button className="btn-secondary btn-sm" onClick={onRerun} disabled={loading}>
          <Icon name="refresh" className="text-[16px]" />
          {loading ? 'Working…' : 'Re-run'}
        </button>
      }
    >
      {report?.source === 'fallback' && report.reason && (
        <div className="mb-md flex items-start gap-md p-md rounded-md
                        border border-warning/30 bg-warning/5">
          <Icon name="warning" className="text-warning shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">
              The live DeepSeek call did not go through. Falling back to deterministic rules.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs break-words">
              {report.reason}
            </p>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-md">
        <ProvenanceCell
          label="AI model"
          value={report?.model ?? status?.advisor.model ?? '—'}
          hint={advisorHint}
          tone={advisorMode === 'live' ? 'good' : advisorMode === 'fallback' ? 'warn' : 'muted'}
        />
        <ProvenanceCell
          label="Market provider"
          value={report?.market_snapshot?.provider ?? status?.market.provider ?? 'CoinGecko'}
          hint={status?.market.configured
            ? `${status.market.plan} plan · cached ${status.market.cache_ttl}s`
            : 'public endpoint — heavily rate-limited'}
          tone={status?.market.configured ? 'good' : 'warn'}
        />
        <ProvenanceCell
          label="Snapshot fetched"
          value={report?.market_snapshot?.fetched_at ?? '—'}
          hint={report ? `${report.market_snapshot?.assets_considered ?? '—'} assets considered` : 'awaiting first run'}
        />
        <ProvenanceCell
          label="Report hash"
          value={report ? `${report.report_hash.slice(0, 12)}…` : '—'}
          hint={report ? report.generated_at : 'the same inputs produce the same hash'}
        />
      </dl>
    </Card>
  )
}

function ProvenanceCell({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint: string
  tone?: 'good' | 'warn' | 'muted'
}) {
  const toneCls = tone === 'good' ? 'text-success'
    : tone === 'warn' ? 'text-warning' : 'text-on-surface-variant'
  return (
    <div className="rounded-md bg-surface-container-low p-md">
      <dt className="eyebrow">{label}</dt>
      <dd className="mono text-body-md text-primary mt-xs truncate">{value}</dd>
      <small className={`text-body-sm mt-xs block ${toneCls}`}>{hint}</small>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One candidate                                                               */
/* -------------------------------------------------------------------------- */

function CandidateCard({ candidate, onSimulate }: {
  candidate: AdvisorCandidate
  onSimulate: () => void
}) {
  const copy = VERDICT_COPY[candidate.verdict]
  const change24 = pct(candidate.market.change_24h_pct)
  const change7d = pct(candidate.market.change_7d_pct)
  const up24 = (candidate.market.change_24h_pct ?? 0) >= 0
  // Do not offer simulated purchase on candidates the advisor already
  // flagged as unfit — the whole point of the verdict vocabulary is that
  // "insufficient evidence" and "not aligned" mean stop, not proceed.
  const purchasable = candidate.verdict === 'CANDIDATE_FOR_REVIEW'
                    || candidate.verdict === 'HIGH_RISK'

  return (
    <div className={`rounded-lg border p-lg space-y-md ${VERDICT_SURFACE[candidate.verdict]}`}>
      <div className="flex items-start gap-md">
        {candidate.image ? (
          <img
            src={candidate.image}
            alt=""
            className="h-10 w-10 rounded-full bg-surface-container-lowest shrink-0"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-surface-container-high shrink-0
                          flex items-center justify-center text-primary">
            <Icon name="currency_bitcoin" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-sm">
            <b className="text-headline-md text-primary truncate">
              {candidate.name ?? candidate.asset_id}
            </b>
            <span className="mono text-body-sm text-on-surface-variant">
              {candidate.symbol}
            </span>
          </div>
          <div className="mt-xs flex items-center gap-sm flex-wrap">
            <span className={`inline-flex items-center gap-xs px-sm py-xs rounded-full
                              text-body-sm border ${VERDICT_SURFACE[candidate.verdict]}
                              ${VERDICT_TEXT[candidate.verdict]}`}>
              <Icon name={copy.tone === 'good' ? 'check_circle'
                : copy.tone === 'bad' ? 'gpp_bad'
                  : copy.tone === 'warn' ? 'warning' : 'block'} className="text-[16px]" />
              {copy.label}
            </span>
            <span className="chip mono">
              confidence {(candidate.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="mono text-headline-md text-primary">
            {money(candidate.market.price, candidate.market.vs_currency)}
          </div>
          {change24 && (
            <div className={`mono text-body-sm ${up24 ? 'text-success' : 'text-danger'}`}>
              24h {change24}
            </div>
          )}
        </div>
      </div>

      <p className="text-body-sm text-on-surface-variant">{copy.hint}</p>

      <dl className="grid grid-cols-3 gap-sm">
        <MarketFig label="Market cap" value={compact(candidate.market.market_cap)} />
        <MarketFig label="24h volume" value={compact(candidate.market.volume_24h)} />
        <MarketFig label="7d change" value={change7d ?? '—'}
                   tone={change7d ? ((candidate.market.change_7d_pct ?? 0) >= 0 ? 'good' : 'bad') : undefined} />
      </dl>

      {candidate.rationale.length > 0 && (
        <div>
          <span className="eyebrow">Why it made the shortlist</span>
          <ul className="mt-xs space-y-xs">
            {candidate.rationale.map((line, i) => (
              <li key={i} className="flex items-start gap-sm text-body-sm text-on-surface">
                <Icon name="chevron_right" className="text-[16px] text-on-surface-variant shrink-0 mt-px" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidate.supporting_evidence.length > 0 && (
        <div>
          <span className="eyebrow">Evidence drawn from the analysis</span>
          <div className="mt-xs flex flex-wrap gap-xs">
            {candidate.supporting_evidence.map((line, i) => (
              <span key={i} className="chip mono text-body-sm">{line}</span>
            ))}
          </div>
        </div>
      )}

      {candidate.risk_factors.length > 0 && (
        <div>
          <span className="eyebrow text-danger">Risks called out</span>
          <ul className="mt-xs space-y-xs">
            {candidate.risk_factors.map((line, i) => (
              <li key={i} className="flex items-start gap-sm text-body-sm text-danger">
                <Icon name="warning" className="text-[16px] shrink-0 mt-px" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-sm border-t border-hairline flex items-center justify-between gap-sm">
        <p className="text-body-sm text-on-surface-variant">
          Snapshot: {candidate.market_data_timestamp ?? '—'}. No trade executed —
          this is research support only.
        </p>
        {purchasable && (
          <button className="btn-primary btn-sm shrink-0" onClick={onSimulate}>
            <Icon name="account_balance_wallet" className="text-[16px]" />
            Simulate purchase
          </button>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Simulate-purchase modal — x402 payment gate + Phantom + paper receipt      */
/* -------------------------------------------------------------------------- */

function SimulatePurchaseModal({
  sid, candidate, onClose,
}: {
  sid: string
  candidate: AdvisorCandidate
  onClose: () => void
}) {
  const [notional, setNotional] = useState('10')
  const [quote, setQuote] = useState<PaperQuote | null>(null)
  const [receipt, setReceipt] = useState<PaperOrderReceipt | null>(null)
  const [phase, setPhase] = useState<
    'idle' | 'quoting' | 'connecting' | 'signing' | 'verifying' | 'done' | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)

  const notionalNum = Number(notional)
  const notionalValid = Number.isFinite(notionalNum) && notionalNum > 0 && notionalNum <= 100_000
  const symbol = candidate.symbol ?? candidate.asset_id.toUpperCase()

  const loadQuote = useCallback(async () => {
    if (!notionalValid) return
    setPhase('quoting'); setError(null); setQuote(null)
    try {
      setQuote(await api.paperQuote(sid, candidate.asset_id, notionalNum))
      setPhase('idle')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setPhase('error')
    }
  }, [sid, candidate.asset_id, notionalNum, notionalValid])

  const payAndCreate = useCallback(async () => {
    if (!quote) return
    setError(null)

    let signature: string
    try {
      setPhase('connecting')
      // Phantom's own popup handles the connect + sign UX; we just await it.
      setPhase('signing')
      const result = await payWithPhantom(quote.requirements)
      signature = result.signature
    } catch (caught) {
      if (caught instanceof PhantomError && caught.code === 'user-cancelled') {
        setError('You cancelled the Phantom signature request.')
      } else if (caught instanceof PhantomError) {
        setError(caught.message)
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      setPhase('error')
      return
    }

    try {
      setPhase('verifying')
      const outcome = await api.paperOrder(sid, candidate.asset_id, notionalNum, signature)
      setReceipt(outcome.receipt)
      setPhase('done')
    } catch (caught) {
      // A 402 here means the backend saw the tx but rejected it. Show the
      // engine's reason — that is exactly what a reviewer needs to see.
      if (caught instanceof ApiError) {
        setError(`Backend refused the payment (${caught.status}): ${caught.message}`)
      } else {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
      setPhase('error')
    }
  }, [quote, sid, candidate.asset_id, notionalNum])

  const busy = phase === 'quoting' || phase === 'connecting'
            || phase === 'signing' || phase === 'verifying'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-md
                 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg
                   bg-surface shadow-raise border border-hairline"
        onClick={event => event.stopPropagation()}
      >
        <header className="flex items-start gap-md p-lg border-b border-hairline">
          {candidate.image && (
            <img src={candidate.image} alt=""
                 className="h-10 w-10 rounded-full shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <span className="eyebrow">Simulate purchase · devnet x402</span>
            <h3 className="text-headline-md text-primary mt-xs">
              {candidate.name ?? candidate.asset_id}{' '}
              <span className="mono text-body-md text-on-surface-variant">{symbol}</span>
            </h3>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              Phantom will sign a real devnet USDC payment plus a memo bound to
              this analysis. No cryptocurrency is bought or transferred.
            </p>
          </div>
          <button className="icon-btn h-8 w-8" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <div className="p-lg space-y-md">
          {!receipt && (
            <>
              <label className="block">
                <span className="eyebrow">Simulated notional (USD)</span>
                <input
                  className="input mt-xs"
                  type="number" min="1" max="100000" step="1"
                  value={notional}
                  onChange={e => setNotional(e.target.value)}
                  disabled={busy || phase === 'done'}
                />
                <small className="text-body-sm text-on-surface-variant">
                  Paper amount used for the receipt only. The actual on-chain
                  transfer is a fixed devnet USDC settlement fee.
                </small>
              </label>

              {!quote && (
                <button className="btn-primary btn-full" disabled={busy || !notionalValid}
                        onClick={loadQuote}>
                  <Icon name="request_quote" className="text-[16px]" />
                  {phase === 'quoting' ? 'Fetching payment terms…' : 'Get payment requirements'}
                </button>
              )}

              {quote && (
                <PaymentRequirementsCard quote={quote} />
              )}

              {quote && (
                <button className="btn-primary btn-full"
                        disabled={busy}
                        onClick={payAndCreate}>
                  <Icon name="account_balance_wallet" className="text-[16px]" />
                  {phase === 'connecting' ? 'Connecting Phantom…'
                    : phase === 'signing' ? 'Waiting for Phantom signature…'
                    : phase === 'verifying' ? 'Verifying on Solana devnet…'
                    : 'Connect Phantom & pay'}
                </button>
              )}
            </>
          )}

          {receipt && <PaperReceiptCard receipt={receipt} />}

          {error && (
            <div className="flex items-start gap-md p-md rounded-md
                            border border-danger/30 bg-danger/5">
              <Icon name="error" className="text-danger shrink-0" />
              <div className="min-w-0">
                <b className="block text-body-md text-primary">Payment could not complete.</b>
                <p className="text-body-sm text-on-surface-variant mt-xs break-words">{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PaymentRequirementsCard({ quote }: { quote: PaperQuote }) {
  const req = quote.requirements
  const usdc = Number(req.amount) / (10 ** req.assetDecimals)
  return (
    <div className="rounded-md border border-warning/30 bg-warning/5 p-md">
      <div className="flex items-center gap-sm mb-sm">
        <Icon name="lock" className="text-warning" />
        <b className="text-body-md text-primary">HTTP 402 · payment required</b>
      </div>
      <dl className="grid grid-cols-2 gap-sm text-body-sm">
        <div><dt className="eyebrow">Amount</dt><dd className="mono text-primary">{usdc} USDC</dd></div>
        <div><dt className="eyebrow">Network</dt><dd className="mono text-primary">{req.network}</dd></div>
        <div className="col-span-2"><dt className="eyebrow">Recipient</dt>
          <dd className="mono text-body-sm text-primary break-all">{req.payTo}</dd></div>
        <div className="col-span-2"><dt className="eyebrow">Memo (SHA-256 of analysis)</dt>
          <dd className="mono text-body-sm text-primary break-all">{req.extra.memo}</dd></div>
      </dl>
      {quote.already_paid && (
        <p className="mt-sm text-body-sm text-success">
          ✓ This resource already has a verified payment on the ledger — the
          receipt will be regenerated without a new charge.
        </p>
      )}
    </div>
  )
}

function PaperReceiptCard({ receipt }: { receipt: PaperOrderReceipt }) {
  return (
    <div className="rounded-md border border-success/30 bg-success/5 p-md space-y-sm">
      <div className="flex items-center gap-sm">
        <Icon name="check_circle" className="text-success" />
        <b className="text-body-md text-primary">Paper order created</b>
      </div>
      <dl className="grid grid-cols-2 gap-sm text-body-sm">
        <div><dt className="eyebrow">Order id</dt>
          <dd className="mono text-primary">{receipt.order_id}</dd></div>
        <div><dt className="eyebrow">Asset</dt>
          <dd className="mono text-primary uppercase">{receipt.asset_id}</dd></div>
        <div><dt className="eyebrow">Notional</dt>
          <dd className="mono text-primary">${receipt.notional_usd}</dd></div>
        <div><dt className="eyebrow">Reference price</dt>
          <dd className="mono text-primary">${receipt.reference_price_usd}</dd></div>
        <div className="col-span-2"><dt className="eyebrow">Simulated quantity</dt>
          <dd className="mono text-primary">{receipt.simulated_quantity.toFixed(8)}</dd></div>
        <div className="col-span-2"><dt className="eyebrow">Devnet transaction</dt>
          <dd className="mono text-body-sm text-primary break-all">
            {receipt.payment_transaction_signature}
          </dd></div>
      </dl>
      {receipt.explorer_url && (
        <a className="btn-secondary btn-sm" href={receipt.explorer_url}
           target="_blank" rel="noreferrer noopener">
          View on Solana Explorer
          <Icon name="open_in_new" className="text-[14px]" />
        </a>
      )}
      <p className="pt-sm border-t border-hairline text-body-sm text-on-surface-variant">
        {receipt.disclaimer}
      </p>
    </div>
  )
}

function MarketFig({ label, value, tone }: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  const toneCls = tone === 'good' ? 'text-success'
    : tone === 'bad' ? 'text-danger' : 'text-primary'
  return (
    <div className="rounded-md bg-surface-container-lowest p-sm">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mono text-body-md mt-xs ${toneCls}`}>{value}</dd>
    </div>
  )
}

function topVerdict(candidates: AdvisorCandidate[]): string {
  if (!candidates.length) return '—'
  return VERDICT_COPY[candidates[0].verdict].label
}

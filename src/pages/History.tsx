/** The audit history — the one part of SOLFV that outlives a session.
 *
 *  It persists *results*, never documents. The uploaded file, the rendered
 *  pages and every detected personal-data value are destroyed with the session
 *  exactly as before; what survives is the reconciled outcome, which is public
 *  filing data plus our own arithmetic.
 *
 *  That distinction is the whole reason the product can still say "there is no
 *  database" about the documents themselves, so this page states it plainly
 *  rather than leaving a reader to infer it.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, Empty, Icon, PageIntro, StatusPill, ZoneTag } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, ratio as fmtRatio } from '../lib/format'
import { api } from '../lib/api'
import type { HistoryResult, HistoryRow } from '../types'

export default function History() {
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResult(await api.history(100))
    } catch (caught) {
      setError(String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rows = result?.rows ?? []
  const failures = rows.filter(row => (row.checks_failed ?? 0) > 0).length

  return (
    <div className="content">
      <PageIntro
        eyebrow="PERSISTED AUDIT TRAIL"
        title="History"
        lede="Every reconciliation SOLFV has run, kept beyond the session. Results only — the documents themselves were purged on their timers and were never written anywhere."
      >
        <button className="btn ghost" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" />Refresh
        </button>
      </PageIntro>

      {!loading && result && !result.available && (
        <div className="alert alert-fail">
          <Icon name="cloud_off" />
          <div>
            <b>The audit history is unavailable.</b>
            <p>{result.reason || error || 'The engine could not reach Supabase.'}</p>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <section className="stat-row">
          <article className="stat">
            <p className="stat-label">Analyses recorded</p>
            <strong className="stat-value mono">{rows.length}</strong>
            <span className="stat-hint">across every session</span>
          </article>
          <article className={`stat ${failures ? 'stat-bad' : 'stat-good'}`}>
            <p className="stat-label">Failed reconciliation</p>
            <strong className="stat-value mono">{failures}</strong>
            <span className="stat-hint">documents that did not balance</span>
          </article>
          <article className="stat">
            <p className="stat-label">Entities covered</p>
            <strong className="stat-value mono">
              {new Set(rows.map(row => row.entity).filter(Boolean)).size}
            </strong>
            <span className="stat-hint">distinct companies</span>
          </article>
          <article className="stat stat-good">
            <p className="stat-label">Personal data stored</p>
            <strong className="stat-value mono">0</strong>
            <span className="stat-hint">counts only, never values</span>
          </article>
        </section>
      )}

      <Card
        title="Reconciliation log"
        subtitle="Newest first. Each row is one document run through the engine."
        icon="history"
        action={<span className="card-tag">RESULTS ONLY</span>}
      >
        {loading ? (
          <div className="spinner-block"><div className="spinner" /><span>Loading history…</span></div>
        ) : rows.length === 0 ? (
          <Empty
            icon="inbox"
            title="Nothing recorded yet"
            body={
              result?.available
                ? 'Analyse a document and it will appear here.'
                : 'Once Supabase is reachable, every analysis will be logged here automatically.'
            }
          />
        ) : (
          <div className="history-table">
            <div className="history-head">
              <span>ANALYSED</span><span>ENTITY</span><span>PERIOD</span>
              <span>RECONCILIATION</span><span>TRUST</span><span>RISK</span><span>PII</span>
            </div>
            {rows.map(row => <HistoryRowView key={row.id} row={row} />)}
          </div>
        )}
      </Card>

      <Card title="What is and is not persisted" icon="database" className="method-card">
        <div className="method-grid">
          <div>
            <b>Stored: the reconciled result</b>
            <p>
              Canonical figures, check outcomes, ratios, the Z-score and the
              Say–Do verdicts. All of it derived from a published annual report
              and our own deterministic arithmetic.
            </p>
          </div>
          <div>
            <b>Never stored: the document</b>
            <p>
              The uploaded PDF and every rendered page live in a scratch
              directory destroyed with the session. Nothing writes them to
              Supabase, and there is no column that could hold them.
            </p>
          </div>
          <div>
            <b>Never stored: personal data</b>
            <p>
              Two integers are kept — how many entities were detected and how
              many were transmitted. The count is the compliance claim; the
              value would be the exposure.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}

function HistoryRowView({ row }: { row: HistoryRow }) {
  const failed = (row.checks_failed ?? 0) > 0
  const total = (row.checks_passed ?? 0) + (row.checks_failed ?? 0) + (row.checks_unverifiable ?? 0)
  const when = new Date(row.created_at)

  return (
    <details className={`history-row ${failed ? 'has-failure' : ''}`}>
      <summary>
        <span className="history-when">
          <b>{when.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}</b>
          <small className="mono">{when.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}</small>
        </span>
        <span className="history-entity">
          <b>{row.entity || row.document_name || 'Untitled'}</b>
          <small>{row.ticker || row.source || '—'}</small>
        </span>
        <span className="mono history-period">{row.period || '—'}</span>
        <span className="history-checks">
          <StatusPill status={failed ? 'FAIL' : 'PASS'} />
          <small className="mono">{row.checks_passed ?? 0}/{total}</small>
        </span>
        <span className="history-trust mono">
          {row.trust_verified ?? 0}/{row.line_item_count ?? 0}
        </span>
        <span className="history-risk">
          <ZoneTag zone={row.risk_zone} />
        </span>
        <span className="history-pii mono">
          {row.pii_detected ?? 0} / <b className="good">{row.pii_transmitted ?? 0}</b>
        </span>
      </summary>

      <div className="history-detail">
        <div className="history-ratios">
          {RATIO_ORDER.map(key => (
            <div key={key}>
              <small>{RATIO_LABELS[key]}</small>
              <b className="mono">{fmtRatio(key, row.ratios?.[key] ?? null)}</b>
            </div>
          ))}
        </div>
        {row.quarantined && row.quarantined.length > 0 && (
          <p className="history-quarantine">
            <Icon name="gpp_bad" />
            Quarantined: {row.quarantined.map(key => key.replace(/_/g, ' ')).join(', ')}
          </p>
        )}
        <p className="muted-note">
          <Icon name="info" />
          {row.pages_total ? `${row.pages_total} pages in the source document. ` : ''}
          {row.risk_score != null
            ? `Altman ${row.risk_variant} scored ${row.risk_score.toFixed(2)}.`
            : 'The Z-score was withheld for this document.'}
        </p>
      </div>
    </details>
  )
}

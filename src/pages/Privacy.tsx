/** Privacy & security settings — the masking posture, and the audit log.
 *
 *  The honest claim, and the strong one, is architectural: personal data is
 *  detected locally, and the pages that carry it are pages we never transmit,
 *  because extraction targets only the handful holding the financial
 *  statements. Zero transmitted is a property of the design, not a promise.
 *
 *  The audit log lives here rather than on its own screen because it is the
 *  same argument continued: what survives a session is the reconciled result,
 *  and this is the page that has to account for every byte that persists.
 */

import { Card, Empty, Icon, PageIntro, Spinner, StatusPill, ZoneTag } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, countdown, ratio as fmtRatio } from '../lib/format'
import { useHistory } from '../lib/useHistory'
import { useSession } from '../state'
import type { HistoryRow } from '../types'

const DETECTORS: [string, string][] = [
  ['NRIC', '6-2-4 with separators required — a bare 12-digit run is indistinguishable from a financial figure'],
  ['Passport', 'Single letter A/H/K followed by eight digits'],
  ['Mobile', 'Malaysian mobile prefixes only'],
  ['Email', 'Standard addressing'],
  ['Bank account', 'Only behind a context keyword — a bare digit-run regex masks the balance sheet'],
  ['Personal name', 'Honorific-prefixed names, which are personal data under PDPA'],
]

export default function Privacy() {
  const { analysis, ledger, expiresIn, activeId, remove } = useSession()

  const transmitted = ledger?.transmitted ?? 0
  const detected = ledger?.detected ?? 0
  const scanned = ledger?.pages_scanned ?? analysis?.pages_total ?? 0
  const sent = ledger?.pages_transmitted ?? 0
  const reduction = scanned ? 1 - sent / scanned : 0

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="PDPA"
        title="Privacy & Security"
        lede="Personal data is detected and masked on this machine before any external call. The documents themselves are never written to a database — only the reconciled results are."
      />

      {analysis ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
            <article className={`lg:col-span-7 card card-hover border
              ${transmitted === 0 ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'}`}>
              <div className="card-body flex items-start gap-md">
                <Icon
                  name={transmitted === 0 ? 'verified_user' : 'gpp_maybe'}
                  className={`text-[40px] shrink-0 ${transmitted === 0 ? 'text-success' : 'text-warning'}`}
                />
                <div className="min-w-0">
                  <strong className="mono block text-display-lg leading-none text-primary">
                    {transmitted}
                  </strong>
                  <b className="block text-title-md text-primary mt-xs">
                    personal data entities transmitted
                  </b>
                  <p className="text-body-md text-on-surface-variant mt-sm">
                    {detected} detected across {scanned || '—'} pages. Extraction targets only
                    the {sent} pages carrying the financial statements, so the pages holding
                    personal data were never sent.
                  </p>
                  <div className="mt-md flex flex-wrap gap-sm">
                    <span className="badge">Strict PII masking · default</span>
                    <span className="badge-neutral">Local detection</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="lg:col-span-5 card card-hover">
              <div className="card-body space-y-sm">
                <span className="eyebrow">Session expires in</span>
                <strong className="mono block text-display-lg leading-none text-primary">
                  {countdown(expiresIn)}
                </strong>
                <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-1000
                      ${expiresIn < 300 ? 'bg-danger' : 'bg-secondary'}`}
                    style={{ width: `${(expiresIn / (analysis.ttl_minutes * 60)) * 100}%` }}
                  />
                </div>
                <p className="text-body-sm text-on-surface-variant">
                  Documents live in memory and in a scratch directory, both destroyed on this
                  timer. There is nothing to breach because nothing is stored.
                </p>
                <button
                  className="btn-danger btn-full"
                  onClick={() => activeId && remove(activeId)}
                >
                  <Icon name="delete_forever" className="text-[16px]" />
                  Purge this document now
                </button>
              </div>
            </article>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter items-start">
            <Card
              title="Detection ledger"
              subtitle="What was found, and how much of it left the machine. The ledger never records the matched value."
              icon="policy"
              bodyClassName=""
            >
              {!ledger || ledger.summary.length === 0 ? (
                <div className="p-lg">
                  <Empty
                    icon="shield"
                    title="No personal data detected"
                    body="No NRIC, passport, phone, email, bank account or honorific-prefixed name matched anywhere in this document."
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Entity type</th>
                        <th className="text-right">Detected</th>
                        <th className="text-right">Transmitted</th>
                        <th>Pages</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.summary.map(bucket => (
                        <tr key={bucket.entity_type}>
                          <td>
                            <span className="flex items-center gap-sm">
                              <span className="dot bg-secondary" />{bucket.label}
                            </span>
                          </td>
                          <td className="mono text-right">{bucket.count}</td>
                          <td className={`mono text-right font-semibold
                            ${bucket.transmitted === 0 ? 'text-success' : 'text-danger'}`}>
                            {bucket.transmitted}
                          </td>
                          <td className="mono text-on-surface-variant">
                            {bucket.pages.filter(p => p != null).slice(0, 6).join(', ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="flex items-start gap-xs px-lg py-md border-t border-hairline
                            text-body-sm text-on-surface-variant">
                <Icon name="lock" className="text-[16px] shrink-0 mt-px" />
                Raw matches are never logged — recording them would recreate the exposure the
                masking just removed.
              </p>
            </Card>

            <Card
              title="Page targeting"
              subtitle="Why so little of the document ever leaves."
              icon="filter_center_focus"
            >
              <div className="grid grid-cols-3 gap-sm">
                {([
                  ['Pages in document', scanned || '—', ''],
                  ['Pages transmitted', sent, ''],
                  ['Never transmitted', Math.max(0, scanned - sent), 'text-success'],
                ] as const).map(([label, value, tone]) => (
                  <div key={label} className="rounded-md bg-surface-container-low p-md">
                    <small className="eyebrow block">{label}</small>
                    <b className={`mono block text-headline-md mt-xs ${tone || 'text-primary'}`}>
                      {value}
                    </b>
                  </div>
                ))}
              </div>

              <div className="h-2 rounded-full bg-success/20 overflow-hidden mt-md">
                <div className="h-full rounded-full bg-warning"
                     style={{ width: `${scanned ? (sent / scanned) * 100 : 0}%` }} />
              </div>

              <p className="text-body-sm text-on-surface-variant mt-sm">
                {scanned ? `${(reduction * 100).toFixed(0)}% of this document is never sent anywhere. ` : ''}
                Keyword targeting locates the statement and narrative pages, and only those are
                rasterised and transmitted. Cost, latency and exposure all stop depending on how
                long the report is.
              </p>

              <h4 className="text-label-md uppercase text-on-surface-variant mt-lg pt-md
                             border-t border-hairline">
                What the detector looks for
              </h4>
              <dl className="mt-sm space-y-sm">
                {DETECTORS.map(([name, note]) => (
                  <div key={name} className="grid grid-cols-[8rem_1fr] gap-sm">
                    <dt className="text-body-md text-primary">{name}</dt>
                    <dd className="text-body-sm text-on-surface-variant">{note}</dd>
                  </div>
                ))}
              </dl>
              <p className="flex items-start gap-xs mt-md text-body-sm text-on-surface-variant">
                <Icon name="info" className="text-[16px] shrink-0 mt-px" />
                Company registration numbers look NRIC-adjacent and appear constantly. They are
                cleared before matching, so they are never masked.
              </p>
            </Card>
          </div>
        </>
      ) : (
        <Card title="No document selected" icon="shield">
          <Empty
            icon="shield"
            title="The privacy ledger is per-document"
            body="Select a reconciled document in the Analysis Lab to see what was detected in it and how much of it left this machine. The audit log below is not session-scoped and is shown regardless."
          />
        </Card>
      )}

      <AuditLog />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Audit log — the persisted half                                              */
/* -------------------------------------------------------------------------- */

function AuditLog() {
  const { rows, available, reason, loading, reload } = useHistory(100)

  return (
    <>
      <Card
        title="Audit log aggregation"
        subtitle="Every reconciliation SOLFV has run, kept beyond the session. Results only — the documents were purged on their timers and were never written anywhere."
        icon="history"
        bodyClassName=""
        action={
          <>
            <span className="badge-neutral">Results only</span>
            <button className="icon-btn" onClick={() => void reload()} disabled={loading}
                    aria-label="Refresh audit log">
              <Icon name="refresh" />
            </button>
          </>
        }
      >
        {!loading && !available && (
          <div className="flex items-start gap-md m-lg p-md rounded-md
                          border border-warning/30 bg-warning/5">
            <Icon name="cloud_off" className="text-warning shrink-0" />
            <div>
              <b className="block text-body-md text-primary">The audit history is unavailable.</b>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                {reason || 'The engine could not reach Supabase.'}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <Spinner label="Loading audit log…" />
        ) : rows.length === 0 ? (
          <div className="p-lg">
            <Empty
              icon="inbox"
              title="Nothing recorded yet"
              body={available
                ? 'Analyse a document and it will appear here.'
                : 'Once Supabase is reachable, every analysis will be logged here automatically.'}
            />
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {rows.map(row => <AuditRow key={row.id} row={row} />)}
          </div>
        )}
      </Card>

      <Card title="What is and is not persisted" icon="database">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
          {[
            ['Stored: the reconciled result',
              'Canonical figures, check outcomes, ratios, the Z-score and the Say–Do verdicts. All of it derived from a published annual report and our own deterministic arithmetic.'],
            ['Never stored: the document',
              'The uploaded PDF and every rendered page live in a scratch directory destroyed with the session. Nothing writes them to Supabase, and there is no column that could hold them.'],
            ['Never stored: personal data',
              'Two integers are kept — how many entities were detected and how many were transmitted. The count is the compliance claim; the value would be the exposure.'],
          ].map(([title, body]) => (
            <div key={title}>
              <b className="block text-body-md text-primary">{title}</b>
              <p className="text-body-sm text-on-surface-variant mt-xs">{body}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function AuditRow({ row }: { row: HistoryRow }) {
  const failed = (row.checks_failed ?? 0) > 0
  const total = (row.checks_passed ?? 0) + (row.checks_failed ?? 0) + (row.checks_unverifiable ?? 0)
  const when = new Date(row.created_at)

  return (
    <details className={`group ${failed ? 'bg-danger/5' : ''}`}>
      <summary className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[5rem_1fr_6rem_9rem_5rem_7rem_6rem]
                          items-center gap-sm px-lg py-sm cursor-pointer
                          hover:bg-surface-container-low transition-colors list-none">
        <span className="min-w-0">
          <b className="block text-body-md text-primary">
            {when.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}
          </b>
          <small className="mono block text-body-sm text-on-surface-variant">
            {when.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
          </small>
        </span>

        <span className="min-w-0">
          <b className="block text-body-md text-primary truncate">
            {row.entity || row.document_name || 'Untitled'}
          </b>
          <small className="block text-body-sm text-on-surface-variant truncate">
            {row.ticker || row.source || '—'}
          </small>
        </span>

        <span className="hidden md:block mono text-body-md text-on-surface-variant">
          {row.period || '—'}
        </span>

        <span className="hidden md:flex items-center gap-sm">
          <StatusPill status={failed ? 'FAIL' : 'PASS'} />
          <small className="mono text-on-surface-variant">{row.checks_passed ?? 0}/{total}</small>
        </span>

        <span className="hidden md:block mono text-body-md text-on-surface-variant">
          {row.trust_verified ?? 0}/{row.line_item_count ?? 0}
        </span>

        <span className="hidden md:block"><ZoneTag zone={row.risk_zone} /></span>

        <span className="mono text-body-md text-on-surface-variant text-right">
          {row.pii_detected ?? 0} / <b className="text-success">{row.pii_transmitted ?? 0}</b>
        </span>
      </summary>

      <div className="px-lg pb-lg space-y-md">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-sm">
          {RATIO_ORDER.map(key => (
            <div key={key} className="rounded bg-surface-container-low p-sm">
              <small className="block text-body-sm text-on-surface-variant truncate">
                {RATIO_LABELS[key]}
              </small>
              <b className="mono block text-body-md text-primary">
                {fmtRatio(key, row.ratios?.[key] ?? null)}
              </b>
            </div>
          ))}
        </div>

        {row.quarantined && row.quarantined.length > 0 && (
          <p className="flex items-start gap-xs text-body-sm text-danger">
            <Icon name="gpp_bad" className="text-[16px] shrink-0 mt-px" />
            Quarantined: {row.quarantined.map(key => key.replace(/_/g, ' ')).join(', ')}
          </p>
        )}

        <p className="flex items-start gap-xs text-body-sm text-on-surface-variant">
          <Icon name="info" className="text-[16px] shrink-0 mt-px" />
          {row.pages_total ? `${row.pages_total} pages in the source document. ` : ''}
          {row.risk_score != null
            ? `Altman ${row.risk_variant} scored ${row.risk_score.toFixed(2)}.`
            : 'The Z-score was withheld for this document.'}
        </p>
      </div>
    </details>
  )
}

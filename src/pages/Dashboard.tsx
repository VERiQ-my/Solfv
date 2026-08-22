/** Command Center — the portfolio view across every reconciliation ever run.
 *
 *  Everything here is aggregated from the persisted audit history, which holds
 *  results and nothing else. That is a real constraint on what this page can
 *  show: there are no balances or holdings to total, because the product never
 *  held any. What it can total is verdicts — how many documents balanced, how
 *  many were refused, and where the distress scores landed — and that is the
 *  portfolio-level question this screen exists to answer.
 */

import { Card, Empty, Icon, Meter, PageIntro, Spinner, Stat, StatusPill, ZoneTag } from '../components/ui'
import { useHistory } from '../lib/useHistory'
import { useNav } from '../nav'
import { useSession } from '../state'
import type { HistoryRow, Zone } from '../types'

const ZONE_FILL: Record<Zone, string> = {
  SAFE: 'bg-success', GREY: 'bg-warning', DISTRESS: 'bg-danger',
}

export default function Dashboard() {
  const { rows, available, reason, loading, reload } = useHistory(100)
  const { documents, busy } = useSession()
  const { go } = useNav()

  const failures = rows.filter(row => (row.checks_failed ?? 0) > 0)
  const entities = new Set(rows.map(row => row.entity).filter(Boolean)).size
  const scored = rows.filter(row => row.risk_score != null)
  const withheld = rows.length - scored.length

  const zones = (['SAFE', 'GREY', 'DISTRESS'] as Zone[]).map(zone => ({
    zone,
    count: rows.filter(row => row.risk_zone === zone).length,
  }))

  const checksPassed = rows.reduce((total, row) => total + (row.checks_passed ?? 0), 0)
  const checksRun = rows.reduce(
    (total, row) =>
      total + (row.checks_passed ?? 0) + (row.checks_failed ?? 0) + (row.checks_unverifiable ?? 0),
    0,
  )
  const verified = rows.reduce((total, row) => total + (row.trust_verified ?? 0), 0)
  const extracted = rows.reduce((total, row) => total + (row.line_item_count ?? 0), 0)
  const piiDetected = rows.reduce((total, row) => total + (row.pii_detected ?? 0), 0)
  const piiTransmitted = rows.reduce((total, row) => total + (row.pii_transmitted ?? 0), 0)

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="Portfolio"
        title="Command Center"
        lede="Every reconciliation this engine has run, aggregated. Results persist; the documents behind them were purged on their own timers."
      >
        <button className="btn-secondary" onClick={() => void reload()} disabled={loading}>
          <Icon name="refresh" className="text-[16px]" />Refresh
        </button>
        <button className="btn-primary" onClick={() => go('analysis', 'documents')}>
          <Icon name="add" className="text-[16px]" />Insert documents
        </button>
      </PageIntro>

      {!loading && !available && (
        <div className="flex items-start gap-md p-md rounded-lg border border-warning/30 bg-warning/5">
          <Icon name="cloud_off" className="text-warning shrink-0" />
          <div className="min-w-0">
            <b className="block text-body-md text-primary">
              The audit history is unavailable, so this page has nothing to aggregate.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              {reason || 'The engine could not reach Supabase.'} The Analysis Lab is
              unaffected — reconciliation runs entirely in-process and does not depend on
              this table.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <Stat
          label="Analyses recorded" icon="inventory_2" value={rows.length}
          hint={`${entities} distinct ${entities === 1 ? 'entity' : 'entities'}`}
        />
        <Stat
          label="Failed reconciliation" icon="gpp_bad" value={failures.length}
          tone={failures.length ? 'bad' : 'good'}
          hint="documents that did not balance"
        />
        <Stat
          label="Identity checks passed" icon="rule"
          value={checksRun ? `${Math.round((checksPassed / checksRun) * 100)}%` : '—'}
          hint={`${checksPassed} of ${checksRun} run`}
        >
          {checksRun > 0 && (
            <Meter value={checksPassed / checksRun} tone="navy" className="mt-xs" />
          )}
        </Stat>
        <Stat
          label="Personal data stored" icon="shield" value={0} tone="good"
          hint={`${piiDetected} detected · ${piiTransmitted} transmitted · counts only`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        <Card
          title="Distress distribution"
          subtitle="Altman zone across every scored document."
          icon="monitoring"
          className="lg:col-span-5"
        >
          {rows.length === 0 ? (
            <Empty
              icon="analytics" title="Nothing scored yet"
              body="Reconcile a document and its Altman zone lands here."
            />
          ) : (
            <div className="space-y-md">
              {zones.map(({ zone, count }) => (
                <div key={zone} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-sm">
                  <ZoneTag zone={zone} />
                  <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <div
                      className={`h-full rounded-full ${ZONE_FILL[zone]} transition-[width] duration-500`}
                      style={{ width: `${rows.length ? (count / rows.length) * 100 : 0}%` }}
                    />
                  </div>
                  <b className="mono text-body-md text-primary text-right">{count}</b>
                </div>
              ))}

              <div className="pt-md mt-md border-t border-hairline grid grid-cols-2 gap-sm">
                <div className="rounded-md bg-surface-container-low p-md">
                  <small className="eyebrow block">Scored</small>
                  <b className="mono block text-headline-md text-primary mt-xs">{scored.length}</b>
                </div>
                <div className="rounded-md bg-surface-container-low p-md">
                  <small className="eyebrow block">Withheld</small>
                  <b className="mono block text-headline-md text-warning mt-xs">{withheld}</b>
                </div>
              </div>
              <p className="text-body-sm text-on-surface-variant">
                A withheld score is a refusal, not a gap: the engine will not score a document
                whose inputs failed reconciliation.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="This session"
          subtitle="Documents currently held in memory, purging on their own timers."
          icon="pending_actions"
          className="lg:col-span-7"
          bodyClassName=""
        >
          {documents.length === 0 ? (
            <div className="p-lg">
              <Empty
                icon="folder_open" title="No documents in this session"
                body="Insert reports in the Analysis Lab and they will appear here while they live."
                action={
                  <button className="btn-primary" onClick={() => go('analysis', 'documents')}>
                    Open the Analysis Lab
                  </button>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-hairline">
              {documents.map(doc => {
                const failed = (doc.analysis?.summary.checks_failed ?? 0) > 0
                const pending = doc.status === 'queued' || doc.status === 'analysing'
                return (
                  <button
                    key={doc.id}
                    onClick={() => go('analysis', 'documents')}
                    className="w-full text-left flex items-center gap-md px-lg py-sm
                               hover:bg-surface-container-low transition-colors"
                  >
                    <span className={`shrink-0 ${pending ? 'text-secondary'
                      : doc.status === 'failed' ? 'text-danger'
                        : failed ? 'text-warning' : 'text-success'}`}>
                      {pending ? <span className="spinner" />
                        : <Icon name={doc.status === 'ready'
                            ? (failed ? 'gpp_bad' : 'verified') : 'error'} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <b className="block text-body-md text-primary truncate">
                        {doc.analysis?.entity || doc.name}
                      </b>
                      <small className="block text-body-sm text-on-surface-variant truncate">
                        {doc.status === 'ready'
                          ? `${doc.analysis?.summary.line_item_count ?? 0} figures · ${doc.analysis?.period ?? '—'}`
                          : doc.status === 'failed' ? (doc.error || 'Failed') : 'Analysing…'}
                      </small>
                    </span>
                    {doc.analysis && <ZoneTag zone={doc.analysis.risk.zone} />}
                  </button>
                )
              })}
            </div>
          )}
          {busy && (
            <p className="px-lg py-sm border-t border-hairline text-body-sm text-secondary
                          flex items-center gap-sm">
              <span className="spinner" />The engine is still working through the queue.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Recent reconciliations"
        subtitle="Newest first. Each row is one document run through the engine."
        icon="receipt_long"
        bodyClassName=""
        action={
          <button className="btn-secondary btn-sm" onClick={() => go('privacy')}>
            Full audit log
          </button>
        }
      >
        {loading ? (
          <Spinner label="Loading reconciliations…" />
        ) : rows.length === 0 ? (
          <div className="p-lg">
            <Empty
              icon="inbox" title="Nothing recorded yet"
              body="Analyse a document and it will appear here."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th>Analysed</th>
                  <th>Entity</th>
                  <th>Period</th>
                  <th>Reconciliation</th>
                  <th className="text-right">Trust</th>
                  <th>Risk</th>
                  <th className="text-right">PII sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map(row => <RecentRow key={row.id} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <p className="px-lg py-sm border-t border-hairline text-body-sm text-on-surface-variant">
            Showing {Math.min(10, rows.length)} of {rows.length}. Across the whole log,{' '}
            <b className="mono text-primary">{verified}</b> of{' '}
            <b className="mono text-primary">{extracted}</b> extracted figures were verified.
          </p>
        )}
      </Card>
    </div>
  )
}

function RecentRow({ row }: { row: HistoryRow }) {
  const failed = (row.checks_failed ?? 0) > 0
  const total = (row.checks_passed ?? 0) + (row.checks_failed ?? 0) + (row.checks_unverifiable ?? 0)
  const when = new Date(row.created_at)

  return (
    <tr className={`row-hover ${failed ? 'bg-danger/5' : ''}`}>
      <td className="mono text-on-surface-variant whitespace-nowrap">
        {when.toLocaleDateString('en-MY', { day: '2-digit', month: 'short' })}
        {' '}
        {when.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
      </td>
      <td>
        <b className="block text-body-md text-primary truncate max-w-[22ch]">
          {row.entity || row.document_name || 'Untitled'}
        </b>
        <small className="block text-body-sm text-on-surface-variant">
          {row.ticker || row.source || '—'}
        </small>
      </td>
      <td className="mono text-on-surface-variant">{row.period || '—'}</td>
      <td>
        <span className="flex items-center gap-sm">
          <StatusPill status={failed ? 'FAIL' : 'PASS'} />
          <small className="mono text-on-surface-variant">{row.checks_passed ?? 0}/{total}</small>
        </span>
      </td>
      <td className="mono text-right">
        {row.trust_verified ?? 0}/{row.line_item_count ?? 0}
      </td>
      <td><ZoneTag zone={row.risk_zone} /></td>
      <td className="mono text-right">
        <b className={row.pii_transmitted ? 'text-danger' : 'text-success'}>
          {row.pii_transmitted ?? 0}
        </b>
        <span className="text-on-surface-variant"> / {row.pii_detected ?? 0}</span>
      </td>
    </tr>
  )
}

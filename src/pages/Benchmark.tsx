/** Peer benchmark — the company against its Bursa sector.
 *
 *  A single set of statements can never tell you whether 2.4x gearing is
 *  alarming. Comparative positioning against a population is exactly what a
 *  credit bureau sells, which is why this page exists at all.
 *
 *  The peer set is a committed fixture, not a live pull. If it is absent the
 *  page degrades to an explanation rather than an error — the benchmark is
 *  first on the cut list and must never take the dashboard down with it.
 */

import { Card, Empty, Icon, PageIntro, StatusPill } from '../components/ui'
import { percent, ratio as fmtRatio, signedPercent } from '../lib/format'
import { useSession } from '../state'
import type { BenchmarkRow } from '../types'

const VERDICT_EDGE: Record<string, string> = {
  BETTER: 'border-l-success', IN_LINE: 'border-l-secondary', WORSE: 'border-l-danger',
}

export default function Benchmark() {
  const { analysis } = useSession()
  if (!analysis) return null

  const rows = analysis.benchmark
  const peerCount = rows[0]?.peer_count ?? 0

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow={analysis.ticker ? `${analysis.ticker} · Bursa Malaysia` : 'Bursa Malaysia'}
        title="Sector benchmark"
        lede={
          peerCount
            ? `Each ratio placed against the median of ${peerCount} sector peers. "In line" means within 20% of that median.`
            : 'Each ratio placed against its sector median.'
        }
      />

      {rows.length === 0 ? (
        <Card title="No peer set loaded" icon="query_stats">
          <Empty
            icon="group_off"
            title="The benchmark is unavailable"
            body="No peer fixture was loaded for this session, so the engine returned an empty benchmark rather than comparing against nothing. Every other panel is unaffected — this is the intended degradation."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
            {(['BETTER', 'IN_LINE', 'WORSE'] as const).map(verdict => (
              <article
                key={verdict}
                className={`card card-hover border-l-4 ${VERDICT_EDGE[verdict]}`}
              >
                <div className="card-body space-y-sm">
                  <StatusPill status={verdict} />
                  <strong className="mono block text-display-lg leading-none text-primary">
                    {rows.filter(r => r.verdict === verdict).length}
                  </strong>
                  <p className="text-body-sm text-on-surface-variant">of {rows.length} ratios</p>
                </div>
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
            {rows.map(row => <BenchRow key={row.metric} row={row} />)}
          </div>
        </>
      )}

      <Card title="What the peer set is" icon="dataset">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
          {[
            ['Cached, not live', 'The peer pull runs once during the build and the result is committed. The app reads that file, so a rate-limited market data API at demo time costs us nothing.'],
            ['Median, not mean', 'One distressed peer would drag a mean far enough to flatter this company. The median holds up on a small sector sample.'],
            ['Direction-aware', 'Lower gearing is better; lower interest cover is worse. Each verdict is read against the direction that ratio should move.'],
          ].map(([title, body]) => (
            <div key={title}>
              <b className="block text-body-md text-primary">{title}</b>
              <p className="text-body-sm text-on-surface-variant mt-xs">{body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function BenchRow({ row }: { row: BenchmarkRow }) {
  const format = (value: number) =>
    row.is_percentage ? percent(value, 2) : fmtRatio(row.metric, value)

  // Both bars share a scale so their lengths are directly comparable.
  const ceiling = Math.max(Math.abs(row.company), Math.abs(row.sector_median)) || 1
  const companyWidth = `${Math.min(100, (Math.abs(row.company) / ceiling) * 100)}%`
  const medianWidth = `${Math.min(100, (Math.abs(row.sector_median) / ceiling) * 100)}%`

  return (
    <article className={`card card-hover border-l-4 ${VERDICT_EDGE[row.verdict]}`}>
      <header className="card-header">
        <div className="min-w-0">
          <b className="block text-title-md text-primary truncate">{row.label}</b>
          <small className="block text-body-sm text-on-surface-variant">
            {row.higher_is_better ? 'Higher is better' : 'Lower is better'}
            {row.percentile != null && ` · ${row.percentile.toFixed(0)}th percentile`}
          </small>
        </div>
        <StatusPill status={row.verdict} />
      </header>

      <div className="card-body space-y-md">
        {([
          ['This company', companyWidth, format(row.company), 'bg-primary'],
          ['Sector median', medianWidth, format(row.sector_median), 'bg-secondary'],
        ] as const).map(([key, width, value, fill]) => (
          <div key={key} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-sm">
            <span className="text-body-sm text-on-surface-variant">{key}</span>
            <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
              <div className={`h-full rounded-full ${fill} transition-[width] duration-500`}
                   style={{ width }} />
            </div>
            <b className="mono text-body-md text-primary text-right tabular-nums">{value}</b>
          </div>
        ))}
      </div>

      {row.gap_pct != null && (
        <footer className="px-lg py-sm border-t border-hairline flex items-center gap-xs
                           text-body-sm text-on-surface-variant">
          {/* Verdict icon, not a trend arrow: for a lower-is-better ratio a
              negative gap is the good outcome, and an up-arrow beside "−99.9%"
              reads as a contradiction. */}
          <Icon
            name={row.verdict === 'WORSE' ? 'thumb_down'
              : row.verdict === 'BETTER' ? 'thumb_up' : 'drag_handle'}
            className={`text-[16px] ${row.verdict === 'WORSE' ? 'text-danger'
              : row.verdict === 'BETTER' ? 'text-success' : ''}`}
          />
          <span className="mono">{signedPercent(row.gap_pct)}</span>
          against the median of {row.peer_count} peers
        </footer>
      )}
    </article>
  )
}

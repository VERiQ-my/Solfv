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

export default function Benchmark() {
  const { analysis } = useSession()
  if (!analysis) return null

  const rows = analysis.benchmark
  const peerCount = rows[0]?.peer_count ?? 0

  return (
    <div className="content">
      <PageIntro
        eyebrow={analysis.ticker ? `${analysis.ticker} · BURSA MALAYSIA` : 'BURSA MALAYSIA'}
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
          <section className="bench-summary">
            {(['BETTER', 'IN_LINE', 'WORSE'] as const).map(verdict => (
              <article key={verdict} className={`bench-tile bench-${verdict.toLowerCase()}`}>
                <StatusPill status={verdict} />
                <strong>{rows.filter(r => r.verdict === verdict).length}</strong>
                <p>of {rows.length} ratios</p>
              </article>
            ))}
          </section>

          <div className="bench-list">
            {rows.map(row => <BenchRow key={row.metric} row={row} />)}
          </div>
        </>
      )}

      <Card title="What the peer set is" icon="dataset" className="method-card">
        <div className="method-grid">
          <div>
            <b>Cached, not live</b>
            <p>
              The peer pull runs once during the build and the result is committed.
              The app reads that file, so a rate-limited market data API at demo time
              costs us nothing.
            </p>
          </div>
          <div>
            <b>Median, not mean</b>
            <p>
              One distressed peer would drag a mean far enough to flatter this
              company. The median holds up on a small sector sample.
            </p>
          </div>
          <div>
            <b>Direction-aware</b>
            <p>
              Lower gearing is better; lower interest cover is worse. Each verdict is
              read against the direction that ratio should move.
            </p>
          </div>
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
    <article className={`bench-row bench-${row.verdict.toLowerCase()}`}>
      <header>
        <div>
          <b>{row.label}</b>
          <small>
            {row.higher_is_better ? 'Higher is better' : 'Lower is better'}
            {row.percentile != null && ` · ${row.percentile.toFixed(0)}th percentile`}
          </small>
        </div>
        <StatusPill status={row.verdict} />
      </header>

      <div className="bench-bars">
        <div className="bench-bar">
          <span className="bench-key">This company</span>
          <div className="bench-track"><i className="bench-fill company" style={{ width: companyWidth }} /></div>
          <b className="mono">{format(row.company)}</b>
        </div>
        <div className="bench-bar">
          <span className="bench-key">Sector median</span>
          <div className="bench-track"><i className="bench-fill median" style={{ width: medianWidth }} /></div>
          <b className="mono">{format(row.sector_median)}</b>
        </div>
      </div>

      {row.gap_pct != null && (
        <footer>
          {/* Verdict icon, not a trend arrow: for a lower-is-better ratio a
              negative gap is the good outcome, and an up-arrow beside "−99.9%"
              reads as a contradiction. */}
          <Icon name={
            row.verdict === 'WORSE' ? 'thumb_down'
              : row.verdict === 'BETTER' ? 'thumb_up' : 'drag_handle'
          } />
          {signedPercent(row.gap_pct)} against the median of {row.peer_count} peers
        </footer>
      )}
    </article>
  )
}

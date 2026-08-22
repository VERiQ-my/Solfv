/** The Say–Do Gap — what management asserted, against what the figures show.
 *
 *  Given room to breathe on purpose: this is the differentiator, and the
 *  comparison only lands if the sentence and the number sit side by side.
 *
 *  Every verdict here is deterministic. The model's only job, done upstream
 *  during extraction, was turning a sentence into {metric, direction}; the
 *  judgement is arithmetic, and `basis` shows the rule that produced it.
 */

import { Card, Empty, Icon, PageIntro, StatusPill } from '../components/ui'
import { RATIO_LABELS, VERDICT_COPY, ratio as fmtRatio } from '../lib/format'
import { useSession } from '../state'
import type { Verdict } from '../types'

const ORDER: Verdict[] = ['CONTRADICTED', 'UNVERIFIABLE', 'SUPPORTED']

export default function SayDo() {
  const { analysis } = useSession()
  if (!analysis) return null

  const gaps = [...analysis.say_do_gap].sort(
    (a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict),
  )
  const tally = (verdict: Verdict) => gaps.filter(g => g.verdict === verdict).length

  return (
    <div className="content">
      <PageIntro
        eyebrow="FORENSIC NARRATIVE ANALYSIS"
        title="Say–Do Gap"
        lede="We read the management commentary, turn each assertion into a testable claim, and check it against the reconciled figures. This is what a forensic accountant does by hand."
      />

      <section className="verdict-row">
        {ORDER.map(verdict => (
          <article key={verdict} className={`verdict-tile verdict-${verdict.toLowerCase()}`}>
            <StatusPill status={verdict} />
            <strong>{tally(verdict)}</strong>
            <p>{VERDICT_COPY[verdict]}</p>
          </article>
        ))}
      </section>

      {gaps.length === 0 ? (
        <Card title="No claims tested" icon="balance">
          <Empty
            icon="menu_book"
            title="No narrative claims were extracted"
            body="This document had no management commentary the extractor could turn into a testable assertion — or the narrative pass did not run."
          />
        </Card>
      ) : (
        <div className="gap-list">
          {gaps.map((gap, index) => (
            <article key={index} className={`gap-card verdict-${gap.verdict.toLowerCase()}`}>
              <header>
                <div className="gap-meta">
                  <StatusPill status={gap.verdict} />
                  <span className="gap-metric">
                    {RATIO_LABELS[gap.metric] || gap.metric.replace(/_/g, ' ')}
                  </span>
                  {gap.page != null && (
                    <span className="gap-page"><Icon name="description" />page {gap.page}</span>
                  )}
                </div>
                <span className="gap-claimed">claimed “{gap.claimed}”</span>
              </header>

              <div className="gap-body">
                <div className="gap-said">
                  <small>MANAGEMENT SAID</small>
                  <blockquote>“{gap.sentence}”</blockquote>
                </div>
                <div className="gap-arrow"><Icon name="arrow_forward" /></div>
                <div className="gap-did">
                  <small>THE NUMBERS SAY</small>
                  <b className="mono">{gap.actual}</b>
                  {gap.basis && <p>{gap.basis}</p>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Card title="How a verdict is reached" icon="rule_settings" className="method-card">
        <div className="method-grid">
          <div>
            <b>1 · The model reads, it does not judge</b>
            <p>
              Extraction turns a sentence into <code>{'{metric, direction}'}</code> and
              stops there. It never sees a computed ratio, so it cannot talk itself
              into agreeing with management.
            </p>
          </div>
          <div>
            <b>2 · The arithmetic decides</b>
            <p>
              A claim of “strong” liquidity is tested against a threshold; a claim of
              “improving” is tested against the year-on-year move. Same input, same
              verdict, every time.
            </p>
          </div>
          <div>
            <b>3 · Missing beats guessing</b>
            <p>
              When the metric is absent or quarantined, the row reads UNVERIFIABLE.
              The engine never converts an absence into an accusation.
            </p>
          </div>
        </div>
        {analysis.prior_period && (
          <p className="method-foot">
            Year-on-year comparisons run {analysis.period} against {analysis.prior_period},
            both read from the comparative columns printed in the same statements.
            {' '}
            {Object.entries(analysis.prior_ratios)
              .filter(([, value]) => value != null)
              .slice(0, 3)
              .map(([key, value]) => `${RATIO_LABELS[key] ?? key} ${fmtRatio(key, value)}`)
              .join(' · ')}
          </p>
        )}
      </Card>
    </div>
  )
}

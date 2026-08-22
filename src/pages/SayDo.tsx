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

const VERDICT_EDGE: Record<Verdict, string> = {
  CONTRADICTED: 'border-l-danger',
  UNVERIFIABLE: 'border-l-outline-variant',
  SUPPORTED: 'border-l-success',
}

export default function SayDo() {
  const { analysis } = useSession()
  if (!analysis) return null

  const gaps = [...analysis.say_do_gap].sort(
    (a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict),
  )
  const tally = (verdict: Verdict) => gaps.filter(g => g.verdict === verdict).length

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="Forensic narrative analysis"
        title="Say–Do Gap"
        lede="We read the management commentary, turn each assertion into a testable claim, and check it against the reconciled figures. This is what a forensic accountant does by hand."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-gutter">
        {ORDER.map(verdict => (
          <article key={verdict} className={`card card-hover border-l-4 ${VERDICT_EDGE[verdict]}`}>
            <div className="card-body space-y-sm">
              <StatusPill status={verdict} />
              <strong className="mono block text-display-lg leading-none text-primary">
                {tally(verdict)}
              </strong>
              <p className="text-body-sm text-on-surface-variant">{VERDICT_COPY[verdict]}</p>
            </div>
          </article>
        ))}
      </div>

      {gaps.length === 0 ? (
        <Card title="No claims tested" icon="balance">
          <Empty
            icon="menu_book"
            title="No narrative claims were extracted"
            body="This document had no management commentary the extractor could turn into a testable assertion — or the narrative pass did not run."
          />
        </Card>
      ) : (
        <div className="space-y-gutter">
          {gaps.map((gap, index) => (
            <article
              key={index}
              className={`card card-hover border-l-4 ${VERDICT_EDGE[gap.verdict]}`}
            >
              <header className="card-header flex-wrap gap-sm">
                <div className="flex flex-wrap items-center gap-sm min-w-0">
                  <StatusPill status={gap.verdict} />
                  <span className="text-label-md uppercase text-on-surface-variant">
                    {RATIO_LABELS[gap.metric] || gap.metric.replace(/_/g, ' ')}
                  </span>
                  {gap.page != null && (
                    <span className="inline-flex items-center gap-xs text-body-sm
                                     text-on-surface-variant mono">
                      <Icon name="description" className="text-[16px]" />page {gap.page}
                    </span>
                  )}
                </div>
                <span className="text-body-sm text-on-surface-variant italic">
                  claimed “{gap.claimed}”
                </span>
              </header>

              <div className="card-body grid grid-cols-1 md:grid-cols-[1fr_auto_1fr]
                              items-center gap-md">
                <div className="min-w-0">
                  <small className="eyebrow block mb-xs">Management said</small>
                  <blockquote className="text-body-lg text-on-surface italic
                                         border-l-2 border-hairline pl-md">
                    “{gap.sentence}”
                  </blockquote>
                </div>

                <div className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center
                                rounded-full bg-surface-container-high text-on-surface-variant">
                  <Icon name="arrow_forward" className="text-[20px]" />
                </div>

                <div className="min-w-0 md:text-right">
                  <small className="eyebrow block mb-xs">The numbers say</small>
                  <b className={`mono block text-headline-md
                    ${gap.verdict === 'CONTRADICTED' ? 'text-danger'
                      : gap.verdict === 'SUPPORTED' ? 'text-success' : 'text-on-surface-variant'}`}>
                    {gap.actual}
                  </b>
                  {gap.basis && (
                    <p className="text-body-sm text-on-surface-variant mt-xs">{gap.basis}</p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Card title="How a verdict is reached" icon="rule_settings">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-lg">
          {[
            {
              title: '1 · The model reads, it does not judge',
              body: <>Extraction turns a sentence into <code className="mono text-secondary">{'{metric, direction}'}</code> and
                stops there. It never sees a computed ratio, so it cannot talk itself into
                agreeing with management.</>,
            },
            {
              title: '2 · The arithmetic decides',
              body: <>A claim of “strong” liquidity is tested against a threshold; a claim of
                “improving” is tested against the year-on-year move. Same input, same verdict,
                every time.</>,
            },
            {
              title: '3 · Missing beats guessing',
              body: <>When the metric is absent or quarantined, the row reads UNVERIFIABLE. The
                engine never converts an absence into an accusation.</>,
            },
          ].map(item => (
            <div key={item.title}>
              <b className="block text-body-md text-primary">{item.title}</b>
              <p className="text-body-sm text-on-surface-variant mt-xs">{item.body}</p>
            </div>
          ))}
        </div>
        {analysis.prior_period && (
          <p className="mt-lg pt-md border-t border-hairline text-body-sm text-on-surface-variant">
            Year-on-year comparisons run {analysis.period} against {analysis.prior_period},
            both read from the comparative columns printed in the same statements.{' '}
            <span className="mono">
              {Object.entries(analysis.prior_ratios)
                .filter(([, value]) => value != null)
                .slice(0, 3)
                .map(([key, value]) => `${RATIO_LABELS[key] ?? key} ${fmtRatio(key, value)}`)
                .join(' · ')}
            </span>
          </p>
        )}
      </Card>
    </div>
  )
}

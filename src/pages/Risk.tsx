/** Altman Z — distress scoring with its drivers exposed.
 *
 *  `drivers` is the whole point of this page. Showing which components pushed
 *  the score down satisfies the explainability requirement without an LLM
 *  anywhere near it: the arithmetic is the explanation.
 *
 *  When a component's inputs were quarantined the engine withholds the score
 *  entirely rather than scoring around the gap. That empty state is the honest
 *  one, and this page treats it as a result, not an error.
 */

import { Card, Delta, Empty, Icon, PageIntro, ZoneTag } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, ratio as fmtRatio, yoy } from '../lib/format'
import { useSession } from '../state'

const ZONE_COPY: Record<string, string> = {
  SAFE: 'The score sits above the distress thresholds for this variant.',
  GREY: 'Between the safe and distress thresholds — the model does not resolve this either way.',
  DISTRESS: 'The score falls below the distress threshold for this variant.',
}

const ZONE_SURFACE: Record<string, string> = {
  SAFE: 'border-success/30 bg-success/5',
  GREY: 'border-warning/30 bg-warning/5',
  DISTRESS: 'border-danger/30 bg-danger/5',
}

export default function Risk() {
  const { analysis } = useSession()
  if (!analysis) return null

  const { risk, ratios, prior_ratios, quarantined } = analysis
  const withheld = risk.score == null

  // Ordered by how much each component actually moved the score.
  const drivers = [...risk.drivers].sort((a, b) => a.contribution - b.contribution)
  const span = Math.max(...drivers.map(d => Math.abs(d.contribution)), 0.0001)

  return (
    <div className="space-y-xl">
      <PageIntro
        eyebrow="Distress model"
        title="Credit risk"
        lede={
          risk.variant === 'Z'
            ? 'Original Altman Z for listed companies, using market capitalisation for the equity term.'
            : "Altman Z'' for private and non-manufacturing companies, using book equity."
        }
      />

      {withheld ? (
        <Card title="Score withheld" icon="gpp_bad">
          <Empty
            icon="block"
            title="The engine refuses to score this document"
            body={
              risk.reason ||
              `The Z-score depends on ${quarantined.length ? quarantined.map(k => k.replace(/_/g, ' ')).join(', ') : 'figures'} that failed reconciliation. Scoring around a quarantined figure would produce a confident number from a balance sheet that does not balance.`
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
          <article className={`lg:col-span-5 card card-hover border ${ZONE_SURFACE[risk.zone || '']}`}>
            <div className="card-body space-y-md">
              <span className="eyebrow">Altman {risk.variant}</span>
              <strong className="mono block text-display-lg leading-none text-primary">
                {risk.score!.toFixed(2)}
              </strong>
              <ZoneTag zone={risk.zone} />
              <p className="text-body-md text-on-surface-variant">
                {ZONE_COPY[risk.zone || '']}
              </p>
              <ZoneScale zone={risk.zone} variant={risk.variant} score={risk.score!} />
            </div>
          </article>

          <Card
            title="What moved the score"
            subtitle="Each weighted component's contribution. The explanation is the arithmetic itself."
            icon="insights"
            className="lg:col-span-7"
          >
            <div className="space-y-md">
              {drivers.map(driver => {
                const negative = driver.contribution < 0
                return (
                  <div
                    key={driver.name}
                    className="grid grid-cols-[1fr_auto] sm:grid-cols-[10rem_1fr_auto]
                               items-center gap-sm"
                  >
                    <div className="min-w-0">
                      <b className="block text-body-md text-primary truncate">
                        {driver.name}
                        <em className="not-italic text-on-surface-variant mono ml-xs">
                          × {driver.weight}
                        </em>
                      </b>
                      <small className="block text-body-sm text-on-surface-variant truncate">
                        {driver.label}
                      </small>
                    </div>

                    <div className="hidden sm:block h-2 rounded-full bg-surface-container-high
                                    overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500
                          ${negative ? 'bg-danger' : 'bg-success'}`}
                        style={{ width: `${(Math.abs(driver.contribution) / span) * 100}%` }}
                      />
                    </div>

                    <div className="text-right shrink-0">
                      <b className={`mono block text-body-md
                        ${negative ? 'text-danger' : 'text-primary'}`}>
                        {driver.contribution.toFixed(3)}
                      </b>
                      <small className="mono block text-body-sm text-on-surface-variant">
                        raw {driver.value.toFixed(4)}
                      </small>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}

      <Card
        title="Ratio movement"
        icon="ssid_chart"
        subtitle={
          analysis.prior_period
            ? `${analysis.period} against ${analysis.prior_period}.`
            : 'No comparative period was extracted.'
        }
        bodyClassName=""
      >
        <div className="divide-y divide-hairline">
          {RATIO_ORDER.map(key => {
            const move = yoy(key, ratios, prior_ratios)
            const value = ratios[key]
            return (
              <div
                key={key}
                className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_auto_5rem_7rem]
                  items-center gap-sm px-lg py-sm
                  ${value == null ? 'bg-surface-container-low/50' : ''}`}
              >
                <span className="text-body-md text-on-surface">{RATIO_LABELS[key]}</span>
                <b className="hidden sm:block mono text-body-md text-on-surface-variant text-right">
                  {fmtRatio(key, prior_ratios[key])}
                </b>
                <Icon name="arrow_right_alt" className="hidden sm:block text-on-surface-variant" />
                <b className={`mono text-body-md text-right
                  ${value == null ? 'text-on-surface-variant' : 'text-primary'}`}>
                  {fmtRatio(key, value)}
                </b>
                <div className="flex justify-end">
                  {value == null
                    ? (
                      <span className="inline-flex items-center gap-xs text-body-sm text-warning">
                        <Icon name="block" className="text-[16px]" />withheld
                      </span>
                    )
                    : move
                      ? <Delta change={move.change} improved={move.improved} />
                      : <span className="text-body-sm text-on-surface-variant">—</span>}
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

/** Where the score falls between the variant's published thresholds. */
function ZoneScale({
  zone, variant, score,
}: { zone: string | null; variant: string | null; score: number }) {
  const thresholds = variant === 'Z' ? [1.81, 2.99] : [1.1, 2.6]
  const ceiling = Math.max(thresholds[1] * 1.6, score * 1.15)
  const position = `${Math.max(2, Math.min(98, (score / ceiling) * 100))}%`

  return (
    <div className="pt-sm">
      <div className="relative flex h-2 rounded-full overflow-hidden bg-surface-container-high">
        <i className="bg-danger" style={{ width: `${(thresholds[0] / ceiling) * 100}%` }} />
        <i className="bg-warning"
           style={{ width: `${((thresholds[1] - thresholds[0]) / ceiling) * 100}%` }} />
        <i className="bg-success flex-1" />
        <span
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full
                     bg-primary ring-2 ring-surface-container-lowest"
          style={{ left: position }}
          title={`Score ${score.toFixed(2)}`}
        />
      </div>
      <div className="flex justify-between mt-xs text-body-sm text-on-surface-variant mono">
        <span>distress</span>
        <span>&lt; {thresholds[0]}</span>
        <span>&gt; {thresholds[1]}</span>
        <span>safe</span>
      </div>
      <p className="mt-sm text-body-sm text-on-surface-variant">
        This document sits in the <b className="text-primary">{(zone || 'unknown').toLowerCase()}</b> band.
      </p>
    </div>
  )
}

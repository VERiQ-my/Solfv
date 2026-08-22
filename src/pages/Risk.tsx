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

import { Card, Empty, Icon, PageIntro, ZoneTag } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, ratio as fmtRatio, yoy } from '../lib/format'
import { Delta } from '../components/ui'
import { useSession } from '../state'

const ZONE_COPY: Record<string, { title: string; body: string }> = {
  SAFE: {
    title: 'Safe zone',
    body: 'The score sits above the distress thresholds for this variant.',
  },
  GREY: {
    title: 'Grey zone',
    body: 'Between the safe and distress thresholds — the model does not resolve this either way.',
  },
  DISTRESS: {
    title: 'Distress zone',
    body: 'The score falls below the distress threshold for this variant.',
  },
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
    <div className="content">
      <PageIntro
        eyebrow="DISTRESS MODEL"
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
        <section className="risk-hero">
          <article className={`risk-score zone-bg-${(risk.zone || '').toLowerCase()}`}>
            <span className="eyebrow">ALTMAN {risk.variant}</span>
            <strong className="mono">{risk.score!.toFixed(2)}</strong>
            <ZoneTag zone={risk.zone} />
            <p>{ZONE_COPY[risk.zone || '']?.body}</p>
            <ZoneScale zone={risk.zone} variant={risk.variant} score={risk.score!} />
          </article>

          <Card
            title="What moved the score"
            subtitle="Each weighted component's contribution. The explanation is the arithmetic itself."
            icon="insights"
            className="risk-drivers"
          >
            <div className="driver-list">
              {drivers.map(driver => (
                <div className="driver" key={driver.name}>
                  <div className="driver-copy">
                    <b>{driver.name}<em> × {driver.weight}</em></b>
                    <small>{driver.label}</small>
                  </div>
                  <div className="driver-track">
                    <i
                      className={driver.contribution < 0 ? 'negative' : ''}
                      style={{ width: `${(Math.abs(driver.contribution) / span) * 100}%` }}
                    />
                  </div>
                  <div className="driver-figures">
                    <b className="mono">{driver.contribution.toFixed(3)}</b>
                    <small className="mono">raw {driver.value.toFixed(4)}</small>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      <Card
        title="Ratio movement"
        subtitle={
          analysis.prior_period
            ? `${analysis.period} against ${analysis.prior_period}.`
            : 'No comparative period was extracted.'
        }
        icon="ssid_chart"
      >
        <div className="movement-list">
          {RATIO_ORDER.map(key => {
            const move = yoy(key, ratios, prior_ratios)
            const value = ratios[key]
            return (
              <div className={`movement ${value == null ? 'withheld' : ''}`} key={key}>
                <span>{RATIO_LABELS[key]}</span>
                <b className="mono">{fmtRatio(key, prior_ratios[key])}</b>
                <Icon name="arrow_right_alt" />
                <b className="mono">{fmtRatio(key, value)}</b>
                {value == null
                  ? <span className="withheld-tag"><Icon name="block" />withheld</span>
                  : move
                    ? <Delta change={move.change} improved={move.improved} />
                    : <span className="muted">—</span>}
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
    <div className="zone-scale">
      <div className="zone-track">
        <i className="zone-distress" style={{ width: `${(thresholds[0] / ceiling) * 100}%` }} />
        <i className="zone-grey" style={{ width: `${((thresholds[1] - thresholds[0]) / ceiling) * 100}%` }} />
        <i className="zone-safe" />
        <span className="zone-marker" style={{ left: position }} title={`Score ${score.toFixed(2)}`} />
      </div>
      <div className="zone-labels">
        <span>distress</span>
        <span>&lt; {thresholds[0]}</span>
        <span>grey</span>
        <span>&gt; {thresholds[1]}</span>
        <span>safe</span>
      </div>
      <p className="zone-current">
        This document sits in the <b>{(zone || 'unknown').toLowerCase()}</b> band.
      </p>
    </div>
  )
}

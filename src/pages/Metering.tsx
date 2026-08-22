/** Per-document metering, settled on Solana.
 *
 *  The business story, not the integration: a credit bureau sells per-query
 *  decisioning, so pay-per-report with no subscription is a coherent commercial
 *  model for this as an API product.
 *
 *  The gate is off by default and deliberately off the critical path. An
 *  external network dependency must never sit upstream of the analysis — if
 *  devnet is congested, the reconciliation engine still runs.
 */

import { useEffect, useState } from 'react'
import { Card, Icon, PageIntro } from '../components/ui'
import { api } from '../lib/api'
import { useSession } from '../state'
import type { PaymentQuote } from '../types'

export default function Metering() {
  const { analysis } = useSession()
  const [quote, setQuote] = useState<PaymentQuote | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.quote().then(setQuote).catch(caught => setError(String(caught)))
  }, [])

  const gated = quote?.required ?? false

  return (
    <div className="content">
      <PageIntro
        eyebrow="COMMERCIAL MODEL"
        title="Metering & settlement"
        lede="One report, one payment. No seats, no subscription, no minimum commitment — the unit of value is a document analysed."
      />

      <section className="split-2">
        <Card
          title="Gate status"
          subtitle="Whether settlement is enforced before an analysis can be read."
          icon="toll"
        >
          <div className={`gate ${gated ? 'gate-on' : 'gate-off'}`}>
            <Icon name={gated ? 'lock' : 'lock_open'} />
            <div>
              <b>{gated ? 'Metering enforced' : 'Metering bypassed'}</b>
              <p>
                {gated
                  ? 'Each session must settle before /analysis returns a result.'
                  : 'PAYMENT_REQUIRED is false, so every analysis is readable. This is the default, and the demo runs this way on purpose.'}
              </p>
            </div>
          </div>

          <div className="quote-figures">
            <div>
              <small>PRICE PER REPORT</small>
              <b className="mono">{quote ? `${quote.price_sol} SOL` : '—'}</b>
            </div>
            <div>
              <small>CLUSTER</small>
              <b className="mono">{quote?.cluster ?? '—'}</b>
            </div>
            <div>
              <small>THIS SESSION</small>
              <b className="mono">{analysis?.paid ? 'settled' : gated ? 'unsettled' : 'not metered'}</b>
            </div>
          </div>

          {quote?.treasury ? (
            <div className="treasury">
              <small>TREASURY</small>
              <b className="mono">{quote.treasury}</b>
            </div>
          ) : (
            <p className="muted-note">
              <Icon name="info" />
              No treasury address is configured, so no transaction can be requested
              from this build. Set <code>SOLANA_TREASURY</code> to enable settlement.
            </p>
          )}

          {error && (
            <p className="muted-note bad"><Icon name="error" />{error}</p>
          )}
        </Card>

        <Card title="Why this shape" icon="lightbulb" className="method-card">
          <div className="method-grid single">
            <div>
              <b>Metering matches the product</b>
              <p>
                Credit decisioning is already sold per query. A per-document price is
                the same unit an analyst already thinks in, and it prices honestly for
                a firm that reviews forty reports a year rather than four thousand.
              </p>
            </div>
            <div>
              <b>Settlement is not the demo</b>
              <p>
                The gate defaults off because an RPC timeout must never stand between
                a judge and the reconciliation engine. Payment is a separate beat,
                shown after the pipeline has already proved itself.
              </p>
            </div>
            <div>
              <b>Verification is server-side</b>
              <p>
                A signature is confirmed against the cluster before a session unlocks.
                A client claiming it paid is not evidence of anything.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <Card title="What settlement would cost at volume" icon="calculate">
        <div className="pricing-table">
          <div className="pricing-head">
            <span>REPORTS / MONTH</span><span>SOL</span><span>PER REPORT</span>
          </div>
          {[10, 100, 1000, 10000].map(volume => (
            <div className="pricing-row" key={volume}>
              <span className="mono">{volume.toLocaleString()}</span>
              <b className="mono">
                {quote ? (volume * quote.price_sol).toFixed(2) : '—'}
              </b>
              <span className="mono">{quote ? `${quote.price_sol} SOL` : '—'}</span>
            </div>
          ))}
        </div>
        <p className="muted-note">
          <Icon name="info" />
          Flat per-document pricing, no tiering. The cost of analysing a report does
          not depend on its length — page targeting sends the same handful of pages
          whether the document runs to 40 pages or 400.
        </p>
      </Card>
    </div>
  )
}

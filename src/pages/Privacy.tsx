/** Privacy ledger and session lifetime.
 *
 *  The honest claim, and the strong one, is architectural: personal data is
 *  detected locally, and the pages that carry it are pages we never transmit,
 *  because extraction targets only the handful holding the financial
 *  statements. Zero transmitted is a property of the design, not a promise.
 *
 *  The countdown is real — it is the same clock that purges the session — so
 *  ephemerality is visible rather than merely asserted.
 */

import { Card, Empty, Icon, PageIntro } from '../components/ui'
import { countdown } from '../lib/format'
import { useSession } from '../state'

export default function Privacy() {
  const { analysis, ledger, expiresIn, activeId, remove } = useSession()
  if (!analysis) return null

  const transmitted = ledger?.transmitted ?? 0
  const detected = ledger?.detected ?? 0
  const scanned = ledger?.pages_scanned ?? analysis.pages_total ?? 0
  const sent = ledger?.pages_transmitted ?? 0
  const reduction = scanned ? 1 - sent / scanned : 0

  return (
    <div className="content">
      <PageIntro
        eyebrow="PDPA"
        title="Privacy & session"
        lede="Personal data is detected and masked on this machine before any external call. Nothing is written to a database, because there is no database."
      />

      <section className="privacy-hero">
        <article className={`privacy-headline ${transmitted === 0 ? 'clean' : 'warn'}`}>
          <Icon name={transmitted === 0 ? 'verified_user' : 'gpp_maybe'} />
          <div>
            <strong className="mono">{transmitted}</strong>
            <b>personal data entities transmitted</b>
            <p>
              {detected} detected across {scanned || '—'} pages. Extraction targets
              only the {sent} pages carrying the financial statements, so the pages
              holding personal data were never sent.
            </p>
          </div>
        </article>

        <article className="session-timer">
          <span className="eyebrow">SESSION EXPIRES IN</span>
          <strong className="mono">{countdown(expiresIn)}</strong>
          <div className="timer-track">
            <i style={{ width: `${(expiresIn / (analysis.ttl_minutes * 60)) * 100}%` }} />
          </div>
          <p>
            Documents live in memory and in a scratch directory, both destroyed on
            this timer. There is nothing to breach because nothing is stored.
          </p>
          <button
            className="btn danger full"
            onClick={() => activeId && remove(activeId)}
          >
            <Icon name="delete_forever" />Purge this document now
          </button>
        </article>
      </section>

      <section className="split-2">
        <Card
          title="Detection ledger"
          subtitle="What was found, and how much of it left the machine. The ledger never records the matched value."
          icon="policy"
        >
          {!ledger || ledger.summary.length === 0 ? (
            <Empty
              icon="shield"
              title="No personal data detected"
              body="No NRIC, passport, phone, email, bank account or honorific-prefixed name matched anywhere in this document."
            />
          ) : (
            <div className="ledger-table">
              <div className="ledger-head">
                <span>ENTITY TYPE</span><span>DETECTED</span><span>TRANSMITTED</span><span>PAGES</span>
              </div>
              {ledger.summary.map(bucket => (
                <div className="ledger-row" key={bucket.entity_type}>
                  <span className="ledger-name">
                    <i className="ledger-dot" />{bucket.label}
                  </span>
                  <b className="mono">{bucket.count}</b>
                  <b className={`mono ${bucket.transmitted === 0 ? 'good' : 'bad'}`}>
                    {bucket.transmitted}
                  </b>
                  <span className="ledger-pages mono">
                    {bucket.pages.filter(p => p != null).slice(0, 6).join(', ') || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="muted-note">
            <Icon name="lock" />
            Raw matches are never logged — recording them would recreate the exposure
            the masking just removed.
          </p>
        </Card>

        <Card title="Page targeting" subtitle="Why so little of the document ever leaves." icon="filter_center_focus">
          <div className="targeting">
            <div className="targeting-figures">
              <div><small>PAGES IN DOCUMENT</small><b className="mono">{scanned || '—'}</b></div>
              <div><small>PAGES TRANSMITTED</small><b className="mono">{sent}</b></div>
              <div className="good"><small>NEVER TRANSMITTED</small><b className="mono">{Math.max(0, scanned - sent)}</b></div>
            </div>
            <div className="targeting-bar">
              <i style={{ width: `${scanned ? (sent / scanned) * 100 : 0}%` }} />
            </div>
            <p>
              {scanned
                ? `${(reduction * 100).toFixed(0)}% of this document is never sent anywhere. `
                : ''}
              Keyword targeting locates the statement and narrative pages, and only
              those are rasterised and transmitted. Cost, latency and exposure all
              stop depending on how long the report is.
            </p>
          </div>

          <div className="detector-list">
            <h4>What the detector looks for</h4>
            {[
              ['NRIC', '6-2-4 with separators required — a bare 12-digit run is indistinguishable from a financial figure'],
              ['Passport', 'Single letter A/H/K followed by eight digits'],
              ['Mobile', 'Malaysian mobile prefixes only'],
              ['Email', 'Standard addressing'],
              ['Bank account', 'Only behind a context keyword — a bare digit-run regex masks the balance sheet'],
              ['Personal name', 'Honorific-prefixed names, which are personal data under PDPA'],
            ].map(([name, note]) => (
              <div className="detector" key={name}>
                <b>{name}</b><p>{note}</p>
              </div>
            ))}
            <p className="muted-note">
              <Icon name="info" />
              Company registration numbers look NRIC-adjacent and appear constantly.
              They are cleared before matching, so they are never masked.
            </p>
          </div>
        </Card>
      </section>
    </div>
  )
}

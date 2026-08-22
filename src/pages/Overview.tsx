/** The verdict at a glance.
 *
 *  Ordered the way the thesis reads: what the document is, whether the numbers
 *  reconcile, what they imply, and where management's story diverges. The
 *  reconciliation strip sits above the ratios on purpose — a failing identity
 *  is the reason a ratio below it may be missing.
 */

import { Card, Delta, Icon, PageIntro, SourceLink, Stat, StatusPill, ZoneTag } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, exact, money, ratio as fmtRatio, signed, yoy } from '../lib/format'
import { useSession } from '../state'
import type { Analysis, Check, Page } from '../types'
import type { Focus } from '../state'

export default function Overview({ go }: { go: (page: Page) => void }) {
  const { analysis, setFocus } = useSession()
  if (!analysis) return null

  const { summary, checks, ratios, prior_ratios, risk, quarantined } = analysis
  const failing = checks.filter(c => c.status === 'FAIL')

  const byKey = new Map(analysis.line_items.map(item => [item.canonical_key, item]))
  const focusKey = (key: string): Focus | null => {
    const item = byKey.get(key)
    if (!item || item.page == null) return null
    return {
      page: item.page, bbox: item.bbox, value: item.value,
      label: item.label_as_printed || key,
    }
  }
  const trace = (key: string) => {
    const next = focusKey(key)
    if (next) { setFocus(next); go('analysis') }
  }

  return (
    <div className="content">
      <PageIntro
        eyebrow={[analysis.ticker, analysis.period].filter(Boolean).join(' · ')}
        title={analysis.entity || 'Untitled document'}
        lede={`${summary.line_item_count} figures extracted, reconciled against ${checks.length} accounting identities, and badged for trust before a single ratio was computed.`}
      >
        <button className="btn ghost" onClick={() => go('analysis')}>
          <Icon name="fact_check" />Inspect figures
        </button>
      </PageIntro>

      {failing.length > 0 && (
        <div className="alert alert-fail">
          <Icon name="gpp_bad" />
          <div>
            <b>{failing.length} reconciliation {failing.length === 1 ? 'check has' : 'checks have'} failed.</b>
            <p>
              {quarantined.length} figure{quarantined.length === 1 ? '' : 's'} quarantined
              — {quarantined.map(k => k.replace(/_/g, ' ')).join(', ')}. Every ratio built
              on {quarantined.length === 1 ? 'it' : 'them'} is withheld rather than estimated.
            </p>
          </div>
          <button className="btn danger" onClick={() => go('analysis')}>See the evidence</button>
        </div>
      )}

      <section className="stat-row">
        <Stat
          label="Reconciliation"
          value={`${summary.checks_passed}/${checks.length}`}
          tone={summary.checks_failed ? 'bad' : 'good'}
          hint={
            summary.checks_failed
              ? `${summary.checks_failed} failed · ${summary.checks_unverifiable} unverifiable`
              : `${summary.checks_unverifiable} unverifiable · 0 failed`
          }
        />
        <Stat
          label="Figures verified"
          value={`${summary.trust.VERIFIED}/${summary.line_item_count}`}
          tone={summary.trust.UNVERIFIED ? 'warn' : 'good'}
          hint={`${summary.trust.DERIVED} derived · ${summary.trust.UNVERIFIED} unverified`}
        />
        <Stat
          label={risk.variant ? `Altman ${risk.variant}` : 'Altman Z'}
          value={risk.score != null ? risk.score.toFixed(2) : '—'}
          tone={risk.zone === 'DISTRESS' ? 'bad' : risk.zone === 'GREY' ? 'warn' : risk.zone ? 'good' : 'muted'}
          hint={<ZoneTag zone={risk.zone} />}
        />
        <Stat
          label="Narrative claims tested"
          value={String(analysis.say_do_gap.length)}
          tone={analysis.say_do_gap.some(g => g.verdict === 'CONTRADICTED') ? 'bad' : 'muted'}
          hint={`${analysis.say_do_gap.filter(g => g.verdict === 'CONTRADICTED').length} contradicted by the figures`}
        />
      </section>

      <section className="split-2">
        <Card
          title="Reconciliation engine"
          subtitle="Deterministic accounting identities. No model output reaches this panel unchecked."
          icon="rule"
          action={<span className="card-tag">NO AI</span>}
        >
          <div className="check-list">
            {checks.map(check => <CheckRow key={check.name} check={check} unit={analysis.unit} />)}
          </div>
        </Card>

        <Card
          title="Say–Do Gap"
          subtitle="Management's claims, tested against the figures."
          icon="balance"
          action={<button className="btn text" onClick={() => go('saydo')}>All {analysis.say_do_gap.length}</button>}
        >
          {analysis.say_do_gap.length === 0 ? (
            <p className="muted-note">No narrative claims were extracted from this document.</p>
          ) : (
            <div className="gap-preview">
              {analysis.say_do_gap.slice(0, 3).map((gap, index) => (
                <article key={index} className={`gap-mini verdict-${gap.verdict.toLowerCase()}`}>
                  <StatusPill status={gap.verdict} />
                  <blockquote>“{gap.sentence}”</blockquote>
                  <p className="mono">{gap.actual}</p>
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>

      <Card
        title="Ratio pack"
        subtitle={
          analysis.prior_period
            ? `${analysis.period} against ${analysis.prior_period}. A withheld ratio is one built on a quarantined figure.`
            : 'A withheld ratio is one whose inputs are missing or quarantined.'
        }
        icon="functions"
      >
        <div className="ratio-grid">
          {RATIO_ORDER.map(key => {
            const value = ratios[key]
            const move = yoy(key, ratios, prior_ratios)
            const withheld = value == null
            return (
              <article key={key} className={`ratio-cell ${withheld ? 'withheld' : ''}`}>
                <p>{RATIO_LABELS[key]}</p>
                <strong className="mono">{fmtRatio(key, value)}</strong>
                {withheld ? (
                  <span className="withheld-tag">
                    <Icon name="block" />Withheld — built on a quarantined figure
                  </span>
                ) : (
                  <div className="ratio-foot">
                    {move ? <Delta change={move.change} improved={move.improved} /> : <span className="muted">no comparative</span>}
                    {prior_ratios[key] != null && (
                      <span className="muted mono">was {fmtRatio(key, prior_ratios[key])}</span>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </Card>

      <section className="split-2">
        <Card title="Balance sheet" subtitle="Click any figure to open its source cell." icon="account_balance">
          <BalanceRows keys={[
            'total_assets', 'current_assets', 'cash', 'receivables', 'inventory',
            'total_liabilities', 'current_liabilities', 'total_equity', 'retained_earnings',
          ]} analysis={analysis} onTrace={trace} />
        </Card>
        <Card title="Income & cash flow" subtitle="Click any figure to open its source cell." icon="payments">
          <BalanceRows keys={[
            'revenue', 'cogs', 'gross_profit', 'opex', 'ebit',
            'interest_expense', 'pat', 'operating_cf',
          ]} analysis={analysis} onTrace={trace} />
        </Card>
      </section>
    </div>
  )
}

function CheckRow({ check, unit }: { check: Check; unit: string | null }) {
  const failed = check.status === 'FAIL'
  return (
    <article className={`check check-${check.status.toLowerCase()}`}>
      <header>
        <b>{check.name}</b>
        <StatusPill status={check.status} />
      </header>
      <code>{check.formula}</code>
      {check.expected != null && check.actual != null ? (
        <div className="check-figures">
          <div><small>EXPECTED</small><b className="mono">{exact(check.expected, unit)}</b></div>
          <div><small>ACTUAL</small><b className="mono">{exact(check.actual, unit)}</b></div>
          <div className={failed ? 'bad' : ''}>
            <small>DELTA</small>
            <b className="mono">{signed(check.delta)}</b>
          </div>
        </div>
      ) : (
        <p className="check-detail">{check.detail}</p>
      )}
      {check.expected != null && <p className="check-detail">{check.detail}</p>}
    </article>
  )
}

function BalanceRows({
  keys, analysis, onTrace,
}: { keys: string[]; analysis: Analysis; onTrace: (key: string) => void }) {
  const byKey = new Map(analysis.line_items.map(item => [item.canonical_key, item]))
  return (
    <div className="figure-rows">
      {keys.map(key => {
        const item = byKey.get(key)
        if (!item) {
          return (
            <div className="figure-row absent" key={key}>
              <span>{key.replace(/_/g, ' ')}</span>
              <span className="muted">not in the document</span>
            </div>
          )
        }
        return (
          <div className={`figure-row trust-row-${item.trust.toLowerCase()}`} key={key}>
            <span className="figure-label">
              {item.label_as_printed || key.replace(/_/g, ' ')}
              {item.derived && <em className="derived-tag">{item.derivation}</em>}
            </span>
            <SourceLink page={item.page} onClick={() => onTrace(key)}>
              <span className="mono">{money(item.value, analysis.currency || 'MYR', analysis.unit)}</span>
            </SourceLink>
          </div>
        )
      })}
    </div>
  )
}

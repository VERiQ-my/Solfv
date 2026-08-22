/** The verdict at a glance.
 *
 *  Ordered the way the thesis reads: what the document is, whether the numbers
 *  reconcile, what they imply, and where management's story diverges. The
 *  reconciliation strip sits above the ratios on purpose — a failing identity
 *  is the reason a ratio below it may be missing.
 */

import {
  Card, Delta, Icon, SourceLink, Spotlight, SpotlightNote, Stat, StatusPill, ZoneTag,
} from '../components/ui'
import {
  RATIO_LABELS, RATIO_ORDER, exact, money, ratio as fmtRatio, signed, yoy,
} from '../lib/format'
import { useNav } from '../nav'
import { useSession } from '../state'
import type { Analysis, Check } from '../types'
import type { Focus } from '../state'

export default function Overview() {
  const { analysis, setFocus } = useSession()
  const { goTab } = useNav()
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
    if (next) { setFocus(next); goTab('provenance') }
  }

  const contradicted = analysis.say_do_gap.filter(g => g.verdict === 'CONTRADICTED')

  return (
    <div className="space-y-xl">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div className="min-w-0">
          <span className="eyebrow">
            {[analysis.ticker, analysis.period].filter(Boolean).join(' · ') || 'Reconciled'}
          </span>
          <h2 className="text-headline-lg text-primary mt-xs truncate">
            {analysis.entity || 'Untitled document'}
          </h2>
          <p className="text-body-md text-on-surface-variant mt-xs max-w-prose">
            {summary.line_item_count} figures extracted, reconciled against {checks.length}{' '}
            accounting identities, and badged for trust before a single ratio was computed.
          </p>
        </div>
        <button className="btn-secondary shrink-0" onClick={() => goTab('provenance')}>
          <Icon name="fact_check" className="text-[16px]" />Inspect figures
        </button>
      </header>

      {failing.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-md p-md rounded-lg
                        border border-danger/30 bg-danger/5">
          <Icon name="gpp_bad" className="text-danger text-[24px] shrink-0" />
          <div className="flex-1 min-w-0">
            <b className="block text-body-md text-primary">
              {failing.length} reconciliation {failing.length === 1 ? 'check has' : 'checks have'} failed.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              {quarantined.length} figure{quarantined.length === 1 ? '' : 's'} quarantined
              — {quarantined.map(k => k.replace(/_/g, ' ')).join(', ')}. Every ratio built
              on {quarantined.length === 1 ? 'it' : 'them'} is withheld rather than estimated.
            </p>
          </div>
          <button className="btn-danger shrink-0" onClick={() => goTab('provenance')}>
            See the evidence
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <Stat
          label="Reconciliation" icon="rule"
          value={`${summary.checks_passed}/${checks.length}`}
          tone={summary.checks_failed ? 'bad' : 'good'}
          hint={
            summary.checks_failed
              ? `${summary.checks_failed} failed · ${summary.checks_unverifiable} unverifiable`
              : `${summary.checks_unverifiable} unverifiable · 0 failed`
          }
        />
        <Stat
          label="Figures verified" icon="verified"
          value={`${summary.trust.VERIFIED}/${summary.line_item_count}`}
          tone={summary.trust.UNVERIFIED ? 'warn' : 'good'}
          hint={`${summary.trust.DERIVED} derived · ${summary.trust.UNVERIFIED} unverified`}
        />
        <Stat
          label={risk.variant ? `Altman ${risk.variant}` : 'Altman Z'} icon="monitoring"
          value={risk.score != null ? risk.score.toFixed(2) : '—'}
          tone={risk.zone === 'DISTRESS' ? 'bad'
            : risk.zone === 'GREY' ? 'warn' : risk.zone ? 'good' : 'muted'}
          hint={<ZoneTag zone={risk.zone} />}
        />
        <Stat
          label="Narrative claims tested" icon="balance"
          value={String(analysis.say_do_gap.length)}
          tone={contradicted.length ? 'bad' : 'muted'}
          hint={`${contradicted.length} contradicted by the figures`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        <Card
          title="Reconciliation engine"
          subtitle="Deterministic accounting identities. No model output reaches this panel unchecked."
          icon="rule"
          action={<span className="badge-neutral">No AI</span>}
          className="lg:col-span-8"
        >
          <div className="space-y-md">
            {checks.map(check => (
              <CheckRow key={check.name} check={check} unit={analysis.unit} />
            ))}
          </div>
        </Card>

        <Spotlight
          title="Say–Do Gap"
          icon="balance"
          className="lg:col-span-4"
          footer={
            <button
              className="btn bg-on-primary text-primary hover:bg-surface-variant btn-full"
              onClick={() => goTab('saydo')}
            >
              All {analysis.say_do_gap.length} claims
            </button>
          }
        >
          {analysis.say_do_gap.length === 0 ? (
            <p className="text-body-sm text-[rgb(190_198_224)]">
              No narrative claims were extracted from this document.
            </p>
          ) : (
            analysis.say_do_gap.slice(0, 3).map((gap, index) => (
              <SpotlightNote
                key={index}
                title={gap.verdict.replace('_', ' ')}
                icon={gap.verdict === 'CONTRADICTED' ? 'warning'
                  : gap.verdict === 'SUPPORTED' ? 'check_circle' : 'help'}
                tone={gap.verdict === 'CONTRADICTED' ? 'bad'
                  : gap.verdict === 'SUPPORTED' ? 'good' : 'neutral'}
              >
                <blockquote className="italic">“{gap.sentence}”</blockquote>
                <p className="mono text-tertiary-fixed mt-xs">{gap.actual}</p>
              </SpotlightNote>
            ))
          )}
        </Spotlight>
      </div>

      <Card
        title="Ratio pack"
        icon="functions"
        subtitle={
          analysis.prior_period
            ? `${analysis.period} against ${analysis.prior_period}. A withheld ratio is one built on a quarantined figure.`
            : 'A withheld ratio is one whose inputs are missing or quarantined.'
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-md">
          {RATIO_ORDER.map(key => {
            const value = ratios[key]
            const move = yoy(key, ratios, prior_ratios)
            const withheld = value == null
            return (
              <article
                key={key}
                className={`p-md rounded-md border ${withheld
                  ? 'border-dashed border-outline-variant bg-surface-container-low/50'
                  : 'border-hairline bg-surface'}`}
              >
                <p className="text-body-sm text-on-surface-variant">{RATIO_LABELS[key]}</p>
                <strong className={`mono block text-headline-md mt-xs
                  ${withheld ? 'text-on-surface-variant' : 'text-primary'}`}>
                  {fmtRatio(key, value)}
                </strong>
                {withheld ? (
                  <span className="mt-sm inline-flex items-start gap-xs text-body-sm text-warning">
                    <Icon name="block" className="text-[16px] shrink-0" />
                    Withheld — built on a quarantined figure
                  </span>
                ) : (
                  <div className="mt-sm flex items-center justify-between gap-sm">
                    {move
                      ? <Delta change={move.change} improved={move.improved} />
                      : <span className="text-body-sm text-on-surface-variant">no comparative</span>}
                    {prior_ratios[key] != null && (
                      <span className="mono text-body-sm text-on-surface-variant">
                        was {fmtRatio(key, prior_ratios[key])}
                      </span>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <Card
          title="Balance sheet" icon="account_balance"
          subtitle="Click any figure to open its source cell."
          bodyClassName=""
        >
          <BalanceRows analysis={analysis} onTrace={trace} keys={[
            'total_assets', 'current_assets', 'cash', 'receivables', 'inventory',
            'total_liabilities', 'current_liabilities', 'total_equity', 'retained_earnings',
          ]} />
        </Card>
        <Card
          title="Income & cash flow" icon="payments"
          subtitle="Click any figure to open its source cell."
          bodyClassName=""
        >
          <BalanceRows analysis={analysis} onTrace={trace} keys={[
            'revenue', 'cogs', 'gross_profit', 'opex', 'ebit',
            'interest_expense', 'pat', 'operating_cf',
          ]} />
        </Card>
      </div>
    </div>
  )
}

const CHECK_TONE: Record<string, string> = {
  PASS: 'border-hairline bg-surface',
  FAIL: 'border-danger/30 bg-danger/5',
  UNVERIFIABLE: 'border-dashed border-outline-variant bg-surface-container-low/50',
}

function CheckRow({ check, unit }: { check: Check; unit: string | null }) {
  const failed = check.status === 'FAIL'
  return (
    <article className={`p-md rounded-md border ${CHECK_TONE[check.status]}`}>
      <header className="flex items-center justify-between gap-sm">
        <b className="text-body-md text-primary">{check.name}</b>
        <StatusPill status={check.status} />
      </header>
      <code className="block mt-xs text-body-sm mono text-on-surface-variant break-words">
        {check.formula}
      </code>

      {check.expected != null && check.actual != null ? (
        <div className="grid grid-cols-3 gap-sm mt-sm">
          {([
            ['Expected', exact(check.expected, unit), false],
            ['Actual', exact(check.actual, unit), false],
            ['Delta', signed(check.delta), failed],
          ] as const).map(([label, value, bad]) => (
            <div key={label} className="rounded bg-surface-container-low p-sm">
              <small className="eyebrow block">{label}</small>
              <b className={`mono block mt-px ${bad ? 'text-danger' : 'text-primary'}`}>
                {value}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-body-sm text-on-surface-variant mt-sm">{check.detail}</p>
      )}
      {check.expected != null && (
        <p className="text-body-sm text-on-surface-variant mt-sm">{check.detail}</p>
      )}
    </article>
  )
}

const TRUST_EDGE: Record<string, string> = {
  VERIFIED: 'border-l-success',
  DERIVED: 'border-l-secondary',
  UNVERIFIED: 'border-l-warning',
}

function BalanceRows({
  keys, analysis, onTrace,
}: { keys: string[]; analysis: Analysis; onTrace: (key: string) => void }) {
  const byKey = new Map(analysis.line_items.map(item => [item.canonical_key, item]))
  return (
    <div className="divide-y divide-hairline">
      {keys.map(key => {
        const item = byKey.get(key)
        if (!item) {
          return (
            <div key={key} className="flex items-center justify-between gap-md px-lg py-sm
                                      border-l-4 border-l-transparent">
              <span className="text-body-md text-on-surface-variant capitalize">
                {key.replace(/_/g, ' ')}
              </span>
              <span className="text-body-sm text-on-surface-variant italic">
                not in the document
              </span>
            </div>
          )
        }
        return (
          <div
            key={key}
            className={`flex items-center justify-between gap-md px-lg py-sm border-l-4
                        ${TRUST_EDGE[item.trust]}`}
          >
            <span className="text-body-md text-on-surface min-w-0">
              <span className="block truncate">
                {item.label_as_printed || key.replace(/_/g, ' ')}
              </span>
              {item.derived && (
                <em className="block text-body-sm text-on-surface-variant not-italic mono">
                  {item.derivation}
                </em>
              )}
            </span>
            <SourceLink page={item.page} onClick={() => onTrace(key)} className="shrink-0">
              {money(item.value, analysis.currency || 'MYR', analysis.unit)}
            </SourceLink>
          </div>
        )
      })}
    </div>
  )
}

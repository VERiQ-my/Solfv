/** Expense Management — the cost base of the reconciled document.
 *
 *  The design's version of this screen manages a live vendor ledger. SOLFV has
 *  no ledger: it reads published statements. What it does have, and what this
 *  screen shows, is every cost line the engine extracted, each one traceable to
 *  the cell it was read from and carrying the trust badge the reconciliation
 *  gave it.
 *
 *  That makes it a genuinely different product from the design's — an audit of
 *  reported costs rather than a controller's workflow — and the panel at the
 *  bottom says exactly what the latter would require.
 */

import { Card, Delta, Empty, Icon, Meter, PageIntro, SourceLink, Stat, TrustBadge } from '../components/ui'
import { money, percent } from '../lib/format'
import { useNav } from '../nav'
import { useSession } from '../state'
import type { Analysis, LineItem } from '../types'

/** The cost side of the canonical chart of accounts, in P&L order. */
const COST_KEYS = ['cogs', 'opex', 'interest_expense', 'dividends'] as const

const COST_COPY: Record<string, { label: string; note: string; icon: string }> = {
  cogs: {
    label: 'Cost of sales', icon: 'inventory',
    note: 'Direct cost of what was sold — the largest lever on gross margin.',
  },
  opex: {
    label: 'Operating expenses', icon: 'business_center',
    note: 'Running the business: administration, distribution, staff.',
  },
  interest_expense: {
    label: 'Finance costs', icon: 'percent',
    note: 'The cost of the debt on the balance sheet.',
  },
  dividends: {
    label: 'Dividends paid', icon: 'savings',
    note: 'A distribution rather than an expense, shown here because it competes for the same cash.',
  },
}

/** Bar colour per line, so the same cost reads the same in every panel. */
const COST_FILL: Record<string, string> = {
  cogs: 'navy', opex: 'blue', interest_expense: 'warn', dividends: 'muted',
}

export default function Expenses() {
  const { analysis, setFocus } = useSession()
  const { go, goTab } = useNav()

  if (!analysis) {
    return (
      <div className="space-y-xl">
        <Heading />
        <Card title="No document selected" icon="receipt_long">
          <Empty
            icon="folder_open"
            title="The cost base comes from a reconciled document"
            body="This screen reads the cost lines the engine extracted from a company's published statements. Insert a report and select it to see them."
            action={
              <button className="btn-primary" onClick={() => go('analysis', 'documents')}>
                Open the Analysis Lab
              </button>
            }
          />
        </Card>
        <NotBuilt />
      </div>
    )
  }

  const byKey = new Map(analysis.line_items.map(item => [item.canonical_key, item]))
  const priorByKey = new Map(analysis.prior_line_items.map(item => [item.canonical_key, item]))

  interface CostLine { key: string; item: LineItem; prior: LineItem | undefined }

  const lines: CostLine[] = COST_KEYS.flatMap(key => {
    const item = byKey.get(key)
    return item ? [{ key: key as string, item, prior: priorByKey.get(key) }] : []
  })

  const revenue = byKey.get('revenue')?.value ?? null
  // Dividends are a distribution, not a cost of operating, so they are excluded
  // from the cost base even though the table lists them.
  const operatingKeys = ['cogs', 'opex', 'interest_expense']
  const costBase = lines
    .filter(line => operatingKeys.includes(line.key))
    .reduce((total, line) => total + line.item.value, 0)
  const priorCostBase = lines
    .filter(line => operatingKeys.includes(line.key) && line.prior)
    .reduce((total, line) => total + (line.prior?.value ?? 0), 0)

  const costRatio = revenue ? costBase / revenue : null
  const move = priorCostBase
    ? { change: (costBase - priorCostBase) / Math.abs(priorCostBase), improved: costBase < priorCostBase }
    : null

  const largest = [...lines]
    .filter(line => operatingKeys.includes(line.key))
    .sort((a, b) => b.item.value - a.item.value)[0]

  const quarantined = lines.filter(line => analysis.quarantined.includes(line.key))

  const trace = (item: LineItem) => {
    if (item.page == null) return
    setFocus({
      page: item.page, bbox: item.bbox, value: item.value,
      label: item.label_as_printed || item.canonical_key,
    })
    goTab('provenance')
  }

  return (
    <div className="space-y-xl">
      <Heading entity={analysis.entity} period={analysis.period} />

      {quarantined.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-md p-md rounded-lg
                        border border-danger/30 bg-danger/5">
          <Icon name="gpp_bad" className="text-danger text-[24px] shrink-0" />
          <div className="flex-1 min-w-0">
            <b className="block text-body-md text-primary">
              {quarantined.length} cost line{quarantined.length > 1 ? 's' : ''} failed reconciliation.
            </b>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              {quarantined.map(line => COST_COPY[line.key]?.label ?? line.key).join(', ')} —
              every total on this page that depends on {quarantined.length > 1 ? 'them' : 'it'} is
              built on a figure the engine could not stand behind.
            </p>
          </div>
          <button className="btn-danger shrink-0" onClick={() => goTab('overview')}>
            See the evidence
          </button>
        </div>
      )}

      {lines.length === 0 ? (
        <Card title="No cost lines extracted" icon="receipt_long">
          <Empty
            icon="search_off"
            title="This document reported no cost lines"
            body="The engine found no cost of sales, operating expenses, finance costs or dividends in the statements it read."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
            <Stat
              label="Operating cost base" icon="payments"
              value={money(costBase, analysis.currency || 'MYR', analysis.unit)}
              hint={<>cost of sales + opex + finance costs</>}
            />
            <Stat
              label="Cost ratio" icon="percent"
              value={costRatio != null ? percent(costRatio) : '—'}
              tone={costRatio != null && costRatio > 1 ? 'bad' : undefined}
              hint={revenue
                ? <>of {money(revenue, analysis.currency || 'MYR', analysis.unit)} revenue</>
                : 'no revenue figure extracted'}
            >
              {costRatio != null && (
                <Meter
                  value={Math.min(1, costRatio)}
                  tone={costRatio > 1 ? 'bad' : costRatio > 0.9 ? 'warn' : 'navy'}
                  className="mt-xs"
                />
              )}
            </Stat>
            <Stat
              label="Largest cost line" icon="leaderboard"
              value={largest
                ? money(largest.item.value, analysis.currency || 'MYR', analysis.unit)
                : '—'}
              hint={largest ? (COST_COPY[largest.key]?.label ?? largest.key) : undefined}
            />
            <Stat
              label="Year on year" icon="ssid_chart"
              value={move ? `${move.change >= 0 ? '+' : ''}${(move.change * 100).toFixed(1)}%` : '—'}
              tone={move ? (move.improved ? 'good' : 'bad') : 'muted'}
              hint={analysis.prior_period
                ? <>against {analysis.prior_period}</>
                : 'no comparative period extracted'}
            />
          </div>

          <Card
            title="Cost structure"
            subtitle="Every cost line the engine extracted, with the trust badge reconciliation gave it. Click a figure to open the cell it was read from."
            icon="table_rows"
            action={<span className="badge-neutral">From the statements</span>}
            bodyClassName=""
          >
            <div className="divide-y divide-hairline">
              {lines.map(({ key, item, prior }) => {
                const share = revenue ? item.value / revenue : null
                const yoy = prior && prior.value
                  ? {
                      change: (item.value - prior.value) / Math.abs(prior.value),
                      improved: item.value < prior.value,
                    }
                  : null
                const isQuarantined = analysis.quarantined.includes(key)
                const copy = COST_COPY[key]

                return (
                  <div key={key} className={`px-lg py-md ${isQuarantined ? 'bg-danger/5' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-md">
                      <div className="flex items-start gap-md min-w-0">
                        <span className="h-9 w-9 shrink-0 rounded-md grid place-items-center
                                         bg-surface-container-high text-on-surface-variant">
                          <Icon name={copy?.icon ?? 'receipt'} className="text-[18px]" />
                        </span>
                        <div className="min-w-0">
                          <b className="block text-body-md text-primary">
                            {item.label_as_printed || copy?.label || key.replace(/_/g, ' ')}
                          </b>
                          <small className="block text-body-sm text-on-surface-variant">
                            {copy?.note}
                          </small>
                        </div>
                      </div>

                      <div className="flex items-center gap-md shrink-0">
                        <TrustBadge trust={item.trust} checkedBy={item.checked_by} />
                        <div className="text-right">
                          <SourceLink page={item.page} onClick={() => trace(item)}>
                            {money(item.value, analysis.currency || 'MYR', analysis.unit)}
                          </SourceLink>
                          {prior && (
                            <small className="block text-body-sm text-on-surface-variant mono">
                              was {money(prior.value, analysis.currency || 'MYR', analysis.unit)}
                            </small>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_6rem]
                                    items-center gap-sm mt-sm sm:pl-[3.25rem]">
                      <Meter
                        value={share ?? 0}
                        tone={COST_FILL[key] ?? 'blue'}
                        label={`${copy?.label ?? key} as a share of revenue`}
                      />
                      <span className="mono text-body-sm text-on-surface-variant text-right">
                        {share != null ? percent(share) : '—'}
                      </span>
                      <div className="hidden sm:flex justify-end">
                        {yoy
                          ? <Delta change={yoy.change} improved={yoy.improved} />
                          : <span className="text-body-sm text-on-surface-variant">—</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="flex items-start gap-xs px-lg py-md border-t border-hairline
                          text-body-sm text-on-surface-variant">
              <Icon name="info" className="text-[16px] shrink-0 mt-px" />
              Bars show each line as a share of revenue
              {revenue
                ? ` (${money(revenue, analysis.currency || 'MYR', analysis.unit)})`
                : ', which this document did not report'}
              . A cost exceeding revenue produces a bar at full width, not a bar past the end.
            </p>
          </Card>
        </>
      )}

      <NotBuilt />
    </div>
  )
}

function Heading({ entity, period }: { entity?: string | null; period?: string | null }) {
  return (
    <PageIntro
      eyebrow={[entity, period].filter(Boolean).join(' · ') || 'Reported costs'}
      title="Expense Management"
      lede="The cost base as the company reported it, reconciled before it was totalled. Every line traces to the cell it was read from."
    />
  )
}

function NotBuilt() {
  return (
    <Card title="What a live expense ledger would need" icon="construction">
      <p className="text-body-md text-on-surface-variant">
        The design for this screen manages vendor liabilities and budget control in real
        time. SOLFV reads published statements — it has no ledger, no vendors and no
        approval workflow — so those panels would be numbers with nothing behind them.
        Building them for real needs three things that do not exist yet:
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-3 gap-md mt-md">
        {[
          ['table_view', 'A ledger table',
            'Supabase already holds the audit history. A vendors + invoices schema alongside it would give this screen real rows.'],
          ['edit_note', 'An entry path',
            'Either a form in this app or an import from an accounting system. Without one the table stays empty however well it is designed.'],
          ['approval', 'An approval model',
            'Budget control implies limits, owners and a state machine. That is a workflow product, not a reporting one.'],
        ].map(([icon, title, body]) => (
          <li key={title} className="p-md rounded-md border border-dashed border-outline-variant
                                     bg-surface-container-low/50">
            <Icon name={icon} className="text-on-surface-variant" />
            <b className="block text-body-md text-primary mt-xs">{title}</b>
            <p className="text-body-sm text-on-surface-variant mt-xs">{body}</p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

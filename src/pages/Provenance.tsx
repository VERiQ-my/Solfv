/** The split screen: extracted figures on the left, the source document on the
 *  right, live highlight between them. This layout *is* the product concept.
 *
 *  The query bar sits above it because a query answer is just another way to
 *  arrive at a source cell — a hit sets the same focus a table click does, and
 *  a miss says so plainly. The refusal is guaranteed upstream by a dict lookup,
 *  so there is nothing here that could soften it into a guess.
 */

import { useMemo, useState } from 'react'
import { SourcePane } from '../components/SourcePane'
import {
  Card, Empty, Icon, Segmented, SourceLink, StatusPill, TrustBadge,
} from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, exact, money, ratio as fmtRatio } from '../lib/format'
import { api } from '../lib/api'
import { useSession } from '../state'
import type { Focus } from '../state'
import type { QueryResult, Trust } from '../types'

type Filter = 'all' | Trust

const SUGGESTIONS = [
  'What is the current ratio?',
  'What was revenue?',
  'What is the gearing?',
  'How many employees are there?',
]

const TRUST_DOT: Record<Trust, string> = {
  VERIFIED: 'bg-success', DERIVED: 'bg-secondary', UNVERIFIED: 'bg-warning',
}

export default function Provenance() {
  const { sid, analysis, focus, setFocus } = useSession()
  const [filter, setFilter] = useState<Filter>('all')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<QueryResult | null>(null)
  const [asking, setAsking] = useState(false)
  // On narrow screens the two panes become tabs; there is no room for both.
  const [mobileTab, setMobileTab] = useState<'figures' | 'source'>('figures')

  const items = useMemo(() => {
    if (!analysis) return []
    return filter === 'all'
      ? analysis.line_items
      : analysis.line_items.filter(item => item.trust === filter)
  }, [analysis, filter])

  if (!analysis) return null

  const counts = analysis.summary.trust

  const focusItem = (key: string) => {
    const item = analysis.line_items.find(i => i.canonical_key === key)
    if (!item || item.page == null) return
    setFocus({
      page: item.page, bbox: item.bbox, value: item.value,
      label: item.label_as_printed || key,
    })
    setMobileTab('source')
  }

  const focusRatio = (key: string) => {
    const inputs = RATIO_INPUTS[key] ?? []
    const cells = inputs
      .map(input => analysis.line_items.find(i => i.canonical_key === input))
      .filter((i): i is NonNullable<typeof i> => Boolean(i && i.page != null))
    if (!cells.length) return
    const [first, ...rest] = cells
    setFocus({
      page: first.page, bbox: first.bbox, value: first.value,
      label: `${RATIO_LABELS[key]} — ${first.label_as_printed || first.canonical_key}`,
      related: rest.map(cell => ({
        page: cell.page, bbox: cell.bbox,
        label: cell.label_as_printed || cell.canonical_key,
      })),
    })
    setMobileTab('source')
  }

  const ask = async (raw?: string) => {
    const text = (raw ?? question).trim()
    if (!text || !sid) return
    setQuestion(text)
    setAsking(true)
    setAnswer(null)
    try {
      const result = await api.query(sid, text)
      setAnswer(result)
      if (!('not_found' in result && result.not_found)) {
        const hit = result as Extract<QueryResult, { answer: string }>
        const cells = hit.inputs?.filter(input => input.page != null) ?? []
        const primary = hit.source?.page != null
          ? { page: hit.source.page, bbox: hit.source.bbox, label: text, value: hit.value }
          : cells.length
            ? {
                page: cells[0].page, bbox: cells[0].bbox, value: cells[0].value,
                label: cells[0].label || cells[0].canonical_key,
              }
            : null
        if (primary) {
          const rest = (hit.source?.page != null ? cells : cells.slice(1))
          setFocus({
            ...primary,
            related: rest.map(cell => ({
              page: cell.page, bbox: cell.bbox,
              label: cell.label || cell.canonical_key,
            })),
          } as Focus)
          setMobileTab('source')
        }
      }
    } catch (error) {
      setAnswer({ not_found: true, message: String(error) })
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="space-y-xl">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div className="min-w-0">
          <span className="eyebrow">Click to source</span>
          <h2 className="text-headline-lg text-primary mt-xs truncate">
            {analysis.entity || 'Document'} — figures &amp; provenance
          </h2>
          <p className="text-body-md text-on-surface-variant mt-xs max-w-prose">
            Every figure traces to a page and a cell in the original document, or it is
            not trusted. Nothing on this screen is unsourced.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-sm shrink-0">
          {(['VERIFIED', 'DERIVED', 'UNVERIFIED'] as Trust[]).map(trust => (
            <span key={trust} className="chip">
              <span className={`dot ${TRUST_DOT[trust]}`} />
              {counts[trust]} {trust.toLowerCase()}
            </span>
          ))}
        </div>
      </header>

      <Card
        title="Ask the document"
        subtitle="A structured lookup, not a chatbot. It retrieves figures; it never generates them."
        icon="search"
        action={<span className="badge-neutral">Cannot hallucinate</span>}
      >
        <form
          className="flex flex-col sm:flex-row gap-sm"
          onSubmit={event => { event.preventDefault(); void ask() }}
        >
          <div className="relative flex-1">
            <Icon
              name="quick_reference_all"
              className="absolute left-sm top-1/2 -translate-y-1/2 text-on-surface-variant
                         text-[20px] pointer-events-none"
            />
            <input
              className="input pl-xl"
              value={question}
              onChange={event => setQuestion(event.target.value)}
              placeholder="Ask for any figure or ratio in this document…"
              aria-label="Ask the document"
            />
          </div>
          <button className="btn-primary shrink-0" type="submit" disabled={asking || !question.trim()}>
            {asking ? <span className="spinner" /> : <Icon name="arrow_forward" className="text-[16px]" />}
            Ask
          </button>
        </form>

        <div className="flex flex-wrap gap-xs mt-md">
          {SUGGESTIONS.map(text => (
            <button
              key={text}
              className="chip normal-case hover:bg-secondary/10 hover:text-secondary transition-colors"
              onClick={() => void ask(text)}
            >
              {text}
            </button>
          ))}
        </div>

        {answer && (
          'not_found' in answer && answer.not_found ? (
            <div className="mt-md flex items-start gap-md p-md rounded-md
                            border border-warning/30 bg-warning/5">
              <Icon name="do_not_disturb_on" className="text-warning text-[24px] shrink-0" />
              <div className="min-w-0">
                <b className="block text-body-md text-primary">
                  Not found — and that is a fact, not a guess.
                </b>
                <p className="text-body-md text-on-surface-variant mt-xs">{answer.message}</p>
                <small className="block text-body-sm text-on-surface-variant mt-sm">
                  The lookup is a dictionary hit or miss, so absence is provable. A vector
                  search would have returned the nearest chunks regardless.
                </small>
              </div>
            </div>
          ) : (
            <div className="mt-md p-md rounded-md border border-hairline bg-surface-container-low">
              <header className="flex items-center gap-sm">
                <TrustBadge trust={answer.trust} />
                <span className="text-body-sm text-on-surface-variant">
                  retrieved, not generated
                </span>
              </header>
              <p className="text-body-lg text-primary mt-sm">{answer.answer}</p>
              {answer.inputs && answer.inputs.length > 0 && (
                <div className="flex flex-wrap gap-sm mt-md">
                  {answer.inputs.map(input => (
                    <button
                      key={input.canonical_key}
                      onClick={() => focusItem(input.canonical_key)}
                      className="text-left px-md py-sm rounded border border-hairline
                                 bg-surface-container-lowest hover:border-secondary
                                 transition-colors"
                    >
                      <small className="block text-body-sm text-on-surface-variant">
                        {input.label || input.canonical_key}
                      </small>
                      <b className="mono text-primary">{exact(input.value, analysis.unit)}</b>
                      {input.page != null && (
                        <span className="ml-xs text-body-sm text-secondary mono">
                          p.{input.page}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </Card>

      {/* Pane switch, small screens only. */}
      <div className="lg:hidden">
        <Segmented
          value={mobileTab}
          onChange={setMobileTab}
          options={[
            { id: 'figures', label: 'Figures' },
            { id: 'source', label: focus?.page != null ? `Source · p.${focus.page}` : 'Source' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter items-start">
        <div className={`lg:col-span-7 space-y-gutter
                         ${mobileTab === 'figures' ? '' : 'hidden lg:block'}`}>
          <Card
            title="Extracted figures"
            icon="table_rows"
            bodyClassName=""
            action={
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'VERIFIED', label: `Verified ${counts.VERIFIED}` },
                  { id: 'DERIVED', label: `Derived ${counts.DERIVED}` },
                  { id: 'UNVERIFIED', label: `Unverified ${counts.UNVERIFIED}` },
                ]}
              />
            }
          >
            {items.length === 0 ? (
              <div className="p-lg">
                <Empty
                  icon="filter_alt_off"
                  title="No figures at this trust level"
                  body="Every extracted figure sits in another band."
                />
              </div>
            ) : (
              <div className="divide-y divide-hairline max-h-[560px] overflow-y-auto">
                {items.map(item => {
                  const current = focus?.bbox && item.bbox &&
                    focus.bbox.join() === item.bbox.join()
                  return (
                    <button
                      key={item.canonical_key}
                      onClick={() => focusItem(item.canonical_key)}
                      className={`w-full text-left grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_auto_auto_auto]
                        items-center gap-sm px-lg py-sm transition-colors
                        hover:bg-surface-container-low
                        ${current ? 'bg-secondary/5 shadow-[inset_3px_0_0_0_rgb(var(--c-secondary))]' : ''}`}
                    >
                      <span className="min-w-0">
                        <b className="block text-body-md text-primary truncate">
                          {item.label_as_printed || item.canonical_key.replace(/_/g, ' ')}
                        </b>
                        <small className="block text-body-sm text-on-surface-variant truncate">
                          {item.canonical_key}
                          {item.checked_by?.length
                            ? ` · cleared by ${item.checked_by.length} check${item.checked_by.length > 1 ? 's' : ''}`
                            : item.derived ? ` · ${item.derivation}` : ''}
                        </small>
                      </span>
                      <span className="mono text-body-md text-primary text-right">
                        {money(item.value, analysis.currency || 'MYR', analysis.unit)}
                      </span>
                      <span className="hidden sm:block">
                        <TrustBadge trust={item.trust} checkedBy={item.checked_by} />
                      </span>
                      <span className="hidden sm:flex items-center gap-xs text-body-sm
                                       text-secondary mono">
                        {item.page != null
                          ? <><Icon name="my_location" className="text-[14px]" />p.{item.page}</>
                          : <em className="text-on-surface-variant not-italic">no cell</em>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title="Ratios trace too" icon="account_tree">
            <p className="text-body-md text-on-surface-variant">
              Provenance survives one level of arithmetic — a ratio boxes every cell it
              was built from.
            </p>
            <div className="flex flex-wrap gap-sm mt-md">
              {RATIO_ORDER.map(key => {
                const withheld = analysis.ratios[key] == null
                return (
                  <button
                    key={key}
                    disabled={withheld}
                    onClick={() => focusRatio(key)}
                    className={`inline-flex items-center gap-sm px-md py-sm rounded border
                      text-body-sm transition-colors
                      ${withheld
                        ? 'border-dashed border-outline-variant text-on-surface-variant cursor-not-allowed'
                        : 'border-hairline text-on-surface hover:border-secondary hover:text-secondary'}`}
                  >
                    {RATIO_LABELS[key]}
                    <b className="mono">{fmtRatio(key, analysis.ratios[key])}</b>
                  </button>
                )
              })}
            </div>
          </Card>
        </div>

        <div className={`lg:col-span-5 lg:sticky lg:top-0
                         ${mobileTab === 'source' ? '' : 'hidden lg:block'}`}>
          <SourcePane />
        </div>
      </div>

      {analysis.quarantined.length > 0 && (
        <Card
          title="Quarantined figures"
          subtitle="Failed reconciliation. Withheld from every downstream calculation."
          icon="gpp_bad"
          bodyClassName=""
        >
          <div className="divide-y divide-hairline">
            {analysis.quarantined.map(key => {
              const item = analysis.line_items.find(i => i.canonical_key === key)
              return (
                <div key={key} className="flex items-center gap-md px-lg py-sm">
                  <StatusPill status="FAIL" />
                  <span className="flex-1 min-w-0 truncate text-body-md text-on-surface">
                    {item?.label_as_printed || key.replace(/_/g, ' ')}
                  </span>
                  <SourceLink page={item?.page ?? null} onClick={() => focusItem(key)}>
                    {money(item?.value ?? null, analysis.currency || 'MYR', analysis.unit)}
                  </SourceLink>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

/** Mirrors RATIO_INPUTS in analysis/query.py — which cells back each ratio. */
const RATIO_INPUTS: Record<string, string[]> = {
  current_ratio: ['current_assets', 'current_liabilities'],
  gearing: ['st_debt', 'lt_debt', 'total_equity'],
  interest_cover: ['ebit', 'interest_expense'],
  gross_margin: ['gross_profit', 'revenue'],
  net_margin: ['pat', 'revenue'],
  roe: ['pat', 'total_equity'],
}

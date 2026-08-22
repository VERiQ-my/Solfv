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
import { Card, Empty, Icon, PageIntro, SourceLink, StatusPill, TrustBadge } from '../components/ui'
import { RATIO_LABELS, RATIO_ORDER, exact, money, ratio as fmtRatio } from '../lib/format'
import { api } from '../lib/api'
import { useSession } from '../state'
import type { Focus } from '../state'
import type { QueryResult, Trust } from '../types'

const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All figures' },
  { id: 'VERIFIED', label: 'Verified' },
  { id: 'DERIVED', label: 'Derived' },
  { id: 'UNVERIFIED', label: 'Unverified' },
]

const SUGGESTIONS = [
  'What is the current ratio?',
  'What was revenue?',
  'What is the gearing?',
  'How many employees are there?',
]

/** `embedded` drops the page heading — on the Analysis page this sits beneath
 *  the document queue and a second full-height title would read as a new page. */
export default function Provenance({ embedded = false }: { embedded?: boolean }) {
  const { sid, analysis, focus, setFocus } = useSession()
  const [filter, setFilter] = useState('all')
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

  const legend = (
    <div className="trust-legend">
      {(['VERIFIED', 'DERIVED', 'UNVERIFIED'] as Trust[]).map(trust => (
        <span key={trust} className={`legend trust-${trust.toLowerCase()}`}>
          <i />{counts[trust]} {trust.toLowerCase()}
        </span>
      ))}
    </div>
  )

  return (
    <div className={embedded ? 'embedded-detail' : 'content'}>
      {embedded ? (
        <div className="embedded-head">
          <div>
            <span className="eyebrow">CLICK-TO-SOURCE</span>
            <b>{analysis.entity || 'Document'} — figures & provenance</b>
          </div>
          {legend}
        </div>
      ) : (
        <PageIntro
          eyebrow="CLICK-TO-SOURCE"
          title="Figures & provenance"
          lede="Every figure traces to a page and a cell in the original document, or it is not trusted. Nothing on this screen is unsourced."
        >
          {legend}
        </PageIntro>
      )}

      <Card
        title="Ask the document"
        subtitle="A structured lookup, not a chatbot. It retrieves figures; it never generates them."
        icon="search"
        action={<span className="card-tag">CANNOT HALLUCINATE</span>}
      >
        <form className="query-bar" onSubmit={event => { event.preventDefault(); void ask() }}>
          <Icon name="quick_reference_all" />
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="Ask for any figure or ratio in this document…"
            aria-label="Ask the document"
          />
          <button className="btn primary" type="submit" disabled={asking || !question.trim()}>
            {asking ? <span className="spinner small" /> : <Icon name="arrow_forward" />}
            Ask
          </button>
        </form>

        <div className="suggestions">
          {SUGGESTIONS.map(text => (
            <button key={text} className="chip" onClick={() => void ask(text)}>{text}</button>
          ))}
        </div>

        {answer && (
          'not_found' in answer && answer.not_found ? (
            <div className="answer answer-miss">
              <Icon name="do_not_disturb_on" />
              <div>
                <b>Not found — and that is a fact, not a guess.</b>
                <p>{answer.message}</p>
                <small>
                  The lookup is a dictionary hit or miss, so absence is provable.
                  A vector search would have returned the nearest chunks regardless.
                </small>
              </div>
            </div>
          ) : (
            <div className="answer answer-hit">
              <header>
                <TrustBadge trust={answer.trust} />
                <span className="muted">retrieved, not generated</span>
              </header>
              <p className="answer-text">{answer.answer}</p>
              {answer.inputs && answer.inputs.length > 0 && (
                <div className="answer-inputs">
                  {answer.inputs.map(input => (
                    <button
                      key={input.canonical_key}
                      className="input-cell"
                      onClick={() => focusItem(input.canonical_key)}
                    >
                      <small>{input.label || input.canonical_key}</small>
                      <b className="mono">{exact(input.value, analysis.unit)}</b>
                      {input.page != null && <span>p.{input.page}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </Card>

      <div className="pane-tabs">
        <button className={mobileTab === 'figures' ? 'selected' : ''} onClick={() => setMobileTab('figures')}>
          <Icon name="table_rows" />Figures
        </button>
        <button className={mobileTab === 'source' ? 'selected' : ''} onClick={() => setMobileTab('source')}>
          <Icon name="description" />Source{focus?.page != null && ` · p.${focus.page}`}
        </button>
      </div>

      <section className={`split-screen tab-${mobileTab}`}>
        <div className="pane pane-figures">
          <div className="filter-tabs">
            {FILTERS.map(option => (
              <button
                key={option.id}
                className={filter === option.id ? 'selected' : ''}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
                {option.id !== 'all' && (
                  <em>{counts[option.id as Trust]}</em>
                )}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <Empty
              icon="filter_alt_off"
              title="No figures at this trust level"
              body="Every extracted figure sits in another band."
            />
          ) : (
            <div className="item-table">
              <div className="item-head">
                <span>FIGURE</span><span>VALUE</span><span>TRUST</span><span>SOURCE</span>
              </div>
              {items.map(item => {
                const active = focus?.bbox && item.bbox &&
                  focus.bbox.join() === item.bbox.join()
                return (
                  <button
                    key={item.canonical_key}
                    className={`item-row ${active ? 'active' : ''}`}
                    onClick={() => focusItem(item.canonical_key)}
                  >
                    <span className="item-name">
                      <b>{item.label_as_printed || item.canonical_key.replace(/_/g, ' ')}</b>
                      <small>
                        {item.canonical_key}
                        {item.checked_by?.length
                          ? ` · cleared by ${item.checked_by.length} check${item.checked_by.length > 1 ? 's' : ''}`
                          : item.derived ? ` · ${item.derivation}` : ''}
                      </small>
                    </span>
                    <span className="mono item-value">
                      {money(item.value, analysis.currency || 'MYR', analysis.unit)}
                    </span>
                    <TrustBadge trust={item.trust} checkedBy={item.checked_by} />
                    <span className="item-source">
                      {item.page != null
                        ? <><Icon name="my_location" />p.{item.page}</>
                        : <em className="muted">no cell</em>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="ratio-trace">
            <h4>Ratios trace too</h4>
            <p>Provenance survives one level of arithmetic — a ratio boxes every cell it was built from.</p>
            <div className="ratio-chips">
              {RATIO_ORDER.map(key => (
                <button
                  key={key}
                  className={`chip ${analysis.ratios[key] == null ? 'chip-disabled' : ''}`}
                  disabled={analysis.ratios[key] == null}
                  onClick={() => focusRatio(key)}
                >
                  {RATIO_LABELS[key]}
                  <b className="mono">{fmtRatio(key, analysis.ratios[key])}</b>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pane pane-source">
          <SourcePane />
        </div>
      </section>

      {analysis.quarantined.length > 0 && (
        <Card title="Quarantined figures" subtitle="Failed reconciliation. Withheld from every downstream calculation." icon="gpp_bad">
          <div className="quarantine-list">
            {analysis.quarantined.map(key => {
              const item = analysis.line_items.find(i => i.canonical_key === key)
              return (
                <div className="quarantine-row" key={key}>
                  <StatusPill status="FAIL" />
                  <span>{item?.label_as_printed || key.replace(/_/g, ' ')}</span>
                  <SourceLink page={item?.page ?? null} onClick={() => focusItem(key)}>
                    <span className="mono">{money(item?.value ?? null, analysis.currency || 'MYR', analysis.unit)}</span>
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

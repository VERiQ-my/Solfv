/** The Analysis page — where the SOLFV engine runs over everything finance inserted.
 *
 *  Documents arrive as a batch and are worked through one at a time. This page
 *  owns the queue: what has been reconciled, what failed, and what the engine
 *  refuses to stand behind. Selecting a row opens that document's figures and
 *  provenance below, so the batch view and the detail view are one screen
 *  rather than a navigation step apart.
 *
 *  Each row's verdict comes straight from the engine. Nothing here re-derives
 *  a status from the figures — a row is red because a reconciliation check
 *  failed, not because this component formed an opinion.
 */

import { useCallback, useRef, useState } from 'react'
import Provenance from './Provenance'
import { Card, Empty, Icon, PageIntro, StatusPill, ZoneTag } from '../components/ui'
import { countdown } from '../lib/format'
import { useSession } from '../state'
import type { Doc } from '../state'

export default function Analysis() {
  const {
    documents, activeId, active, setActive, addFiles, loadDemo,
    retry, remove, busy,
  } = useSession()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const take = useCallback((list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) addFiles(files)
  }, [addFiles])

  const ready = documents.filter(doc => doc.status === 'ready')
  const failing = ready.filter(doc => (doc.analysis?.summary.checks_failed ?? 0) > 0)
  const contradicted = ready.reduce(
    (total, doc) =>
      total + (doc.analysis?.say_do_gap.filter(g => g.verdict === 'CONTRADICTED').length ?? 0),
    0,
  )
  const quarantined = ready.reduce(
    (total, doc) => total + (doc.analysis?.quarantined.length ?? 0), 0,
  )

  return (
    <div className="content">
      <PageIntro
        eyebrow="SOLFV ENGINE"
        title="Analysis"
        lede="Every document inserted by finance is run through the same pipeline: page targeting, local PII masking, extraction, then deterministic reconciliation before any figure is displayed."
      >
        <button className="btn ghost" onClick={() => input.current?.click()}>
          <Icon name="add" />Insert documents
        </button>
        <input
          ref={input} type="file" accept=".pdf,.xlsx,.xls" multiple hidden
          onChange={event => { take(event.target.files); event.target.value = '' }}
        />
      </PageIntro>

      <section className="batch-row">
        <article className="batch-tile">
          <small>DOCUMENTS</small>
          <strong className="mono">{documents.length}</strong>
          <span>{ready.length} reconciled{busy ? ' · working' : ''}</span>
        </article>
        <article className={`batch-tile ${failing.length ? 'bad' : ''}`}>
          <small>FAILED RECONCILIATION</small>
          <strong className="mono">{failing.length}</strong>
          <span>{quarantined} figure{quarantined === 1 ? '' : 's'} quarantined</span>
        </article>
        <article className={`batch-tile ${contradicted ? 'bad' : ''}`}>
          <small>CLAIMS CONTRADICTED</small>
          <strong className="mono">{contradicted}</strong>
          <span>across the batch</span>
        </article>
        <article className="batch-tile">
          <small>FIGURES VERIFIED</small>
          <strong className="mono">
            {ready.reduce((t, d) => t + (d.analysis?.summary.trust.VERIFIED ?? 0), 0)}
          </strong>
          <span>
            of {ready.reduce((t, d) => t + (d.analysis?.summary.line_item_count ?? 0), 0)} extracted
          </span>
        </article>
      </section>

      <Card
        title="Document queue"
        subtitle="Each document is a separate engine session with its own purge timer."
        icon="inventory_2"
        action={
          documents.length > 0
            ? <span className="card-tag">{ready.length}/{documents.length} READY</span>
            : undefined
        }
      >
        {documents.length === 0 ? (
          <Empty
            icon="folder_open"
            title="No documents inserted yet"
            body="Drop annual reports or spreadsheets below and the engine will reconcile each one."
          />
        ) : (
          <div className="doc-table">
            <div className="doc-head">
              <span>DOCUMENT</span><span>PERIOD</span><span>RECONCILIATION</span>
              <span>TRUST</span><span>RISK</span><span>EXPIRES</span><span />
            </div>
            {documents.map(doc => (
              <DocRow
                key={doc.id}
                doc={doc}
                selected={doc.id === activeId}
                onSelect={() => doc.status === 'ready' && setActive(doc.id)}
                onRetry={() => retry(doc.id)}
                onRemove={() => remove(doc.id)}
              />
            ))}
          </div>
        )}

        <div
          className={`insert-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault(); setDragging(false); take(event.dataTransfer.files)
          }}
        >
          <Icon name="upload_file" />
          <div>
            <b>Insert more documents</b>
            <p>Drop native-text PDFs or spreadsheets here. Several at once is fine — they are queued and analysed in turn.</p>
          </div>
          <div className="insert-actions">
            <button className="btn ghost" onClick={() => input.current?.click()}>Browse</button>
            <button className="btn ghost" onClick={() => loadDemo('clean')}>Add sample</button>
            <button className="btn ghost" onClick={() => loadDemo('doctored')}>Add doctored</button>
          </div>
        </div>
      </Card>

      {active?.status === 'ready' && active.analysis ? (
        <>
          <div className="detail-divider">
            <span><Icon name="south" />Detail for <b>{active.analysis.entity || active.name}</b></span>
          </div>
          <Provenance embedded />
        </>
      ) : documents.length > 0 && (
        <Card title="Nothing selected" icon="ads_click">
          <Empty
            icon="table_rows"
            title="Select a reconciled document"
            body="Pick a row above to inspect its figures, trace each one to its source cell, and query it."
          />
        </Card>
      )}
    </div>
  )
}

function DocRow({
  doc, selected, onSelect, onRetry, onRemove,
}: {
  doc: Doc
  selected: boolean
  onSelect: () => void
  onRetry: () => void
  onRemove: () => void
}) {
  const analysis = doc.analysis
  const failed = (analysis?.summary.checks_failed ?? 0) > 0
  const pending = doc.status === 'queued' || doc.status === 'analysing'

  return (
    <div
      className={`doc-row ${selected ? 'selected' : ''} ${failed ? 'has-failure' : ''} ${pending ? 'pending' : ''}`}
      onClick={onSelect}
      role="row"
    >
      <span className="doc-name">
        <i className={`doc-status doc-${doc.status}`}>
          {pending
            ? <span className="spinner small" />
            : <Icon name={doc.status === 'ready' ? (failed ? 'gpp_bad' : 'verified') : 'error'} />}
        </i>
        <span>
          <b>{analysis?.entity || doc.name}</b>
          <small>
            {doc.status === 'queued' && 'Queued'}
            {doc.status === 'analysing' && 'Targeting pages, masking, extracting…'}
            {doc.status === 'failed' && (doc.error || 'Failed')}
            {doc.status === 'ready' && (
              `${analysis?.summary.line_item_count ?? 0} figures · ${analysis?.pages_total ?? '—'} pages`
            )}
          </small>
        </span>
      </span>

      <span className="doc-period mono">{analysis?.period ?? '—'}</span>

      <span className="doc-checks">
        {analysis ? (
          <StatusPill status={failed ? 'FAIL' : 'PASS'} />
        ) : <em className="muted">—</em>}
        {analysis && (
          <small className="mono">
            {analysis.summary.checks_passed}/{analysis.checks.length}
          </small>
        )}
      </span>

      <span className="doc-trust">
        {analysis ? (
          <span className="trust-mini">
            <i className="trust-verified" style={{ flex: analysis.summary.trust.VERIFIED || 0 }} />
            <i className="trust-derived" style={{ flex: analysis.summary.trust.DERIVED || 0 }} />
            <i className="trust-unverified" style={{ flex: analysis.summary.trust.UNVERIFIED || 0 }} />
          </span>
        ) : <em className="muted">—</em>}
        {analysis && (
          <small className="mono">
            {analysis.summary.trust.VERIFIED}/{analysis.summary.line_item_count}
          </small>
        )}
      </span>

      <span className="doc-risk">
        {analysis ? <ZoneTag zone={analysis.risk.zone} /> : <em className="muted">—</em>}
      </span>

      <span className="doc-expiry mono">
        {doc.status === 'ready' ? countdown(doc.expiresIn) : '—'}
      </span>

      <span className="doc-actions">
        {doc.status === 'failed' && (
          <button className="icon-btn" title="Retry"
                  onClick={event => { event.stopPropagation(); onRetry() }}>
            <Icon name="refresh" />
          </button>
        )}
        <button className="icon-btn" title="Remove and purge"
                onClick={event => { event.stopPropagation(); onRemove() }}>
          <Icon name="close" />
        </button>
      </span>
    </div>
  )
}

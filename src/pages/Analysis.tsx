/** The Analysis Lab — where the SOLFV engine runs over everything finance inserted.
 *
 *  This is the hub. Documents arrive as a batch and are worked through one at a
 *  time; the tabs above are lenses on whichever one is selected, so the batch
 *  view and the detail views are one place rather than a navigation step apart.
 *
 *  Each row's verdict comes straight from the engine. Nothing here re-derives a
 *  status from the figures — a row is red because a reconciliation check failed,
 *  not because this component formed an opinion.
 */

import { useCallback, useRef, useState } from 'react'
import Benchmark from './Benchmark'
import CryptoCandidates from './CryptoCandidates'
import Overview from './Overview'
import Provenance from './Provenance'
import Risk from './Risk'
import SayDo from './SayDo'
import {
  Card, Empty, Icon, PageIntro, Spotlight, SpotlightNote, StatusPill, Stat, ZoneTag,
} from '../components/ui'
import { countdown } from '../lib/format'
import { ANALYSIS_TABS, useNav } from '../nav'
import { useSession } from '../state'
import type { Doc } from '../state'

export default function Analysis() {
  const { analysis } = useSession()
  const { tab, goTab } = useNav()

  // A lens without a document would render an empty frame and imply the data
  // simply is not there. Fall back to the queue instead.
  const active = ANALYSIS_TABS.find(item => item.id === tab)
  const effective = active && active.needsDocument && !analysis ? 'documents' : tab

  return (
    <>
      <PageIntro
        eyebrow="SOLFV Engine"
        title="Analysis Lab"
        lede="Every document finance inserts runs the same pipeline: page targeting, local PII masking, extraction, then deterministic reconciliation before a single figure is shown."
      />

      <div className="flex items-center gap-xs overflow-x-auto -mx-margin-mobile
                      px-margin-mobile md:mx-0 md:px-0 border-b border-hairline">
        {ANALYSIS_TABS.map(item => {
          const disabled = item.needsDocument && !analysis
          const current = effective === item.id
          return (
            <button
              key={item.id}
              disabled={disabled}
              onClick={() => goTab(item.id)}
              title={disabled ? 'Select a reconciled document first' : undefined}
              className={`inline-flex items-center gap-xs px-md py-sm shrink-0
                text-body-md border-b-2 -mb-px transition-colors duration-200
                disabled:opacity-40 disabled:cursor-not-allowed
                ${current
                  ? 'border-secondary text-secondary font-semibold'
                  : 'border-transparent text-on-surface-variant hover:text-primary'}`}
            >
              <Icon name={item.icon} className="text-[18px]" filled={current} />
              {item.label}
            </button>
          )
        })}
      </div>

      {effective === 'documents' && <Documents />}
      {effective === 'overview' && <Overview />}
      {effective === 'provenance' && <Provenance />}
      {effective === 'saydo' && <SayDo />}
      {effective === 'benchmark' && <Benchmark />}
      {effective === 'risk' && <Risk />}
      {effective === 'candidates' && <CryptoCandidates />}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The queue and the insertion surface                                         */
/* -------------------------------------------------------------------------- */

/** The pipeline, named. Shown while a document is in flight so the wait reads
 *  as a sequence of guarantees rather than an opaque spinner. */
const STAGES = [
  { icon: 'find_in_page', label: 'Page targeting', detail: 'Only statement pages are read' },
  { icon: 'shield_lock', label: 'PII masking', detail: 'Applied locally, before any call' },
  { icon: 'document_scanner', label: 'Extraction', detail: 'Figures traced to source cells' },
  { icon: 'balance', label: 'Reconciliation', detail: 'Deterministic identity checks' },
]

function Documents() {
  const {
    documents, activeId, active, setActive, addFiles, loadDemo, retry, remove, busy,
  } = useSession()
  const { goTab } = useNav()
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
  const verified = ready.reduce((t, d) => t + (d.analysis?.summary.trust.VERIFIED ?? 0), 0)
  const extracted = ready.reduce((t, d) => t + (d.analysis?.summary.line_item_count ?? 0), 0)

  return (
    <div className="space-y-xl">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter">
        <Stat
          label="Documents" icon="inventory_2" value={documents.length}
          hint={<>{ready.length} reconciled{busy ? ' · working' : ''}</>}
        />
        <Stat
          label="Failed reconciliation" icon="gpp_bad" value={failing.length}
          tone={failing.length ? 'bad' : undefined}
          hint={<>{quarantined} figure{quarantined === 1 ? '' : 's'} quarantined</>}
        />
        <Stat
          label="Claims contradicted" icon="balance" value={contradicted}
          tone={contradicted ? 'bad' : undefined}
          hint="across the batch"
        />
        <Stat
          label="Figures verified" icon="verified" value={verified}
          hint={<>of {extracted} extracted</>}
        />
      </div>

      {/* The insertion surface. Given the whole width and the left two-thirds of
          the fold, because inserting a document is the one action this page
          exists to invite. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        <div
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault(); setDragging(false); take(event.dataTransfer.files)
          }}
          className={`lg:col-span-8 rounded-lg border-2 border-dashed p-lg md:p-xl
            flex flex-col items-center text-center gap-md transition-colors duration-200
            ${dragging
              ? 'border-secondary bg-secondary/5'
              : 'border-outline-variant bg-surface-container-lowest hover:border-outline'}`}
        >
          <div className={`h-14 w-14 rounded-full flex items-center justify-center
            transition-colors duration-200
            ${dragging ? 'bg-secondary text-on-secondary' : 'bg-surface-container-high text-primary'}`}>
            <Icon name={dragging ? 'file_download' : 'upload_file'} className="text-[28px]" />
          </div>

          <div>
            <b className="block text-headline-md text-primary">
              {dragging ? 'Release to insert' : 'Insert company documents'}
            </b>
            <p className="text-body-md text-on-surface-variant mt-xs max-w-prose">
              Drop native-text annual reports or spreadsheets here. Several at once is
              fine — they queue and are analysed in turn, each in its own engine session.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-sm">
            <button className="btn-primary" onClick={() => input.current?.click()}>
              <Icon name="add" className="text-[16px]" />Browse files
            </button>
            <button className="btn-secondary" onClick={() => loadDemo('clean')}>
              <Icon name="science" className="text-[16px]" />Add sample
            </button>
            <button className="btn-secondary" onClick={() => loadDemo('doctored')}>
              <Icon name="report" className="text-[16px]" />Add doctored
            </button>
            <input
              ref={input} type="file" accept=".pdf,.xlsx,.xls" multiple hidden
              onChange={event => { take(event.target.files); event.target.value = '' }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-sm pt-sm
                          border-t border-hairline w-full mt-sm">
            <span className="chip">PDF</span>
            <span className="chip">XLSX</span>
            <span className="chip">XLS</span>
            <span className="text-body-sm text-on-surface-variant">
              Native text only — scanned images cannot be traced to a source cell
            </span>
          </div>
        </div>

        <Card
          title="What happens on insert"
          icon="conveyor_belt"
          className="lg:col-span-4"
        >
          <ol className="space-y-md">
            {STAGES.map((stage, index) => (
              <li key={stage.label} className="flex items-start gap-md">
                <span className={`h-8 w-8 shrink-0 rounded-full flex items-center
                  justify-center ${busy
                    ? 'bg-secondary/10 text-secondary animate-pulse'
                    : 'bg-surface-container-high text-on-surface-variant'}`}>
                  <Icon name={stage.icon} className="text-[18px]" />
                </span>
                <div className="min-w-0">
                  <b className="block text-body-md text-primary">
                    <span className="mono text-on-surface-variant mr-xs">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {stage.label}
                  </b>
                  <small className="text-body-sm text-on-surface-variant">
                    {stage.detail}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card
        title="Document queue"
        subtitle="Each document is a separate engine session with its own purge timer."
        icon="table_rows"
        action={<span className="chip">{ready.length}/{documents.length} ready</span>}
        bodyClassName=""
      >
        {documents.length === 0 ? (
          <div className="p-lg">
            <Empty
              icon="folder_open"
              title="No documents inserted yet"
              body="Use the panel above and the engine will reconcile each one."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Period</th>
                  <th>Reconciliation</th>
                  <th>Trust</th>
                  <th>Risk</th>
                  <th className="text-right">Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {active?.status === 'ready' && active.analysis ? (
        <Spotlight
          title="Selected document"
          icon="ads_click"
          footer={
            <button
              className="btn bg-on-primary text-primary hover:bg-surface-variant btn-full"
              onClick={() => goTab('overview')}
            >
              Open the overview
              <Icon name="arrow_forward" className="text-[16px]" />
            </button>
          }
        >
          <SpotlightNote
            title={active.analysis.entity || active.name}
            icon="description"
            tone="neutral"
          >
            {active.analysis.summary.line_item_count} figures extracted,{' '}
            <span className="mono text-tertiary-fixed">
              {active.analysis.summary.trust.VERIFIED}
            </span>{' '}
            verified against{' '}
            <span className="mono">{active.analysis.summary.checks_passed}</span> passing
            identity checks.
          </SpotlightNote>

          {active.analysis.summary.checks_failed > 0 ? (
            <SpotlightNote title="Reconciliation failed" icon="warning" tone="bad">
              {active.analysis.summary.checks_failed} identity check
              {active.analysis.summary.checks_failed > 1 ? 's' : ''} did not hold, and{' '}
              {active.analysis.quarantined.length} figure
              {active.analysis.quarantined.length === 1 ? ' was' : 's were'} quarantined
              from every downstream ratio.
            </SpotlightNote>
          ) : (
            <SpotlightNote title="Statements balance" icon="verified" tone="good">
              Every identity check the engine could run on this document held within
              tolerance.
            </SpotlightNote>
          )}
        </Spotlight>
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
  const total = analysis?.summary.line_item_count || 1

  return (
    <tr
      onClick={onSelect}
      className={`row-hover transition-colors
        ${doc.status === 'ready' ? 'cursor-pointer' : ''}
        ${selected ? 'bg-secondary/5 shadow-[inset_3px_0_0_0_rgb(var(--c-secondary))]' : ''}`}
    >
      <td>
        <div className="flex items-center gap-sm min-w-0">
          <span className={`shrink-0 ${
            pending ? 'text-secondary'
              : doc.status === 'failed' ? 'text-danger'
                : failed ? 'text-warning' : 'text-success'}`}>
            {pending
              ? <span className="spinner" />
              : <Icon name={
                  doc.status === 'ready' ? (failed ? 'gpp_bad' : 'verified') : 'error'
                } />}
          </span>
          <span className="min-w-0">
            <b className="block text-body-md text-primary truncate">
              {analysis?.entity || doc.name}
            </b>
            <small className="block text-body-sm text-on-surface-variant truncate">
              {doc.status === 'queued' && 'Queued'}
              {doc.status === 'analysing' && 'Targeting pages, masking, extracting…'}
              {doc.status === 'failed' && (doc.error || 'Failed')}
              {doc.status === 'ready' && (
                `${analysis?.summary.line_item_count ?? 0} figures · ${analysis?.pages_total ?? '—'} pages`
              )}
            </small>
          </span>
        </div>
      </td>

      <td className="mono text-on-surface-variant">{analysis?.period ?? '—'}</td>

      <td>
        {analysis ? (
          <div className="flex items-center gap-sm">
            <StatusPill status={failed ? 'FAIL' : 'PASS'} />
            <small className="mono text-on-surface-variant">
              {analysis.summary.checks_passed}/{analysis.checks.length}
            </small>
          </div>
        ) : <span className="text-on-surface-variant">—</span>}
      </td>

      <td>
        {analysis ? (
          <div className="flex items-center gap-sm">
            <span className="flex h-1.5 w-20 rounded-full overflow-hidden
                             bg-surface-container-high shrink-0">
              <i className="bg-success" style={{ flex: analysis.summary.trust.VERIFIED }} />
              <i className="bg-secondary" style={{ flex: analysis.summary.trust.DERIVED }} />
              <i className="bg-warning" style={{ flex: analysis.summary.trust.UNVERIFIED }} />
            </span>
            <small className="mono text-on-surface-variant">
              {Math.round((analysis.summary.trust.VERIFIED / total) * 100)}%
            </small>
          </div>
        ) : <span className="text-on-surface-variant">—</span>}
      </td>

      <td>
        {analysis ? <ZoneTag zone={analysis.risk.zone} />
          : <span className="text-on-surface-variant">—</span>}
      </td>

      <td className="mono text-right text-on-surface-variant">
        {doc.status === 'ready' ? countdown(doc.expiresIn) : '—'}
      </td>

      <td>
        <div className="flex items-center justify-end gap-xs">
          {doc.status === 'failed' && (
            <button
              className="icon-btn h-8 w-8" title="Retry"
              onClick={event => { event.stopPropagation(); onRetry() }}
            >
              <Icon name="refresh" className="text-[18px]" />
            </button>
          )}
          <button
            className="icon-btn h-8 w-8 hover:text-danger" title="Remove and purge"
            onClick={event => { event.stopPropagation(); onRemove() }}
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>
      </td>
    </tr>
  )
}

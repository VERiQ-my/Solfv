/** The entry point. Nothing else in the app renders until a document is loaded,
 *  because every other page is a view onto one analysis.
 *
 *  Three ways in: upload a real report, load the hand-verified extraction, or
 *  load the doctored copy. The doctored path is not a toy — it is how you see
 *  the reconciliation engine refuse a number, which is the entire thesis.
 */

import { useCallback, useRef, useState } from 'react'
import { Icon } from '../components/ui'

interface Props {
  busy: boolean
  error: string | null
  onDemo: (variant: 'clean' | 'doctored') => void
  onFiles: (files: File[]) => void
  onDismissError: () => void
}

const POINTS = [
  ['rule', 'Reconciliation before display',
    'Three accounting identities, deterministic, no model in the loop.'],
  ['my_location', 'Cell-level provenance',
    'Every figure carries the page and coordinates it was read from.'],
  ['balance', 'Narrative tested against numbers',
    "Management's claims checked against the figures that would prove them."],
  ['shield_lock', 'No database',
    'Processed in memory, purged on a timer you can watch count down.'],
]

export default function Landing({
  busy, error, onDemo, onFiles, onDismissError,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const take = useCallback((list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) onFiles(files)
  }, [onFiles])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-margin-mobile md:px-xl py-xl space-y-xl">
        <header className="text-center">
          <span className="eyebrow">SOLFV · Financial report intelligence</span>
          <h1 className="text-headline-lg md:text-display-lg text-primary mt-sm">
            The model extracts.<br />The arithmetic decides.
          </h1>
          <p className="text-body-lg text-on-surface-variant mt-md max-w-2xl mx-auto">
            Upload a Malaysian annual report and every figure is reconciled against
            accounting identities before it reaches a dashboard. A number that fails is
            quarantined, not displayed with a caveat.
          </p>
        </header>

        <div
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault()
            setDragging(false)
            take(event.dataTransfer.files)
          }}
          className={`rounded-lg border-2 border-dashed p-xl flex flex-col items-center
            text-center gap-md transition-colors duration-200
            ${dragging
              ? 'border-secondary bg-secondary/5'
              : 'border-outline-variant bg-surface-container-lowest hover:border-outline'}`}
        >
          {busy ? (
            <>
              <span className="spinner h-10 w-10 border-4 text-secondary" />
              <b className="text-headline-md text-primary">Reconciling…</b>
              <p className="text-body-md text-on-surface-variant max-w-prose">
                Targeting statement pages, masking personal data, then checking every figure.
              </p>
            </>
          ) : (
            <>
              <div className={`h-14 w-14 rounded-full grid place-items-center
                ${dragging ? 'bg-secondary text-on-secondary' : 'bg-surface-container-high text-primary'}`}>
                <Icon name="upload_file" className="text-[28px]" />
              </div>
              <b className="text-headline-md text-primary">
                {dragging ? 'Release to insert' : 'Drop the documents finance sent over'}
              </b>
              <p className="text-body-md text-on-surface-variant max-w-prose">
                Native-text PDFs or spreadsheets, as many as you like. No OCR — a scanned
                document is rejected, loudly.
              </p>
              <button className="btn-primary" onClick={() => input.current?.click()}>
                <Icon name="folder_open" className="text-[16px]" />Choose files
              </button>
              <input
                ref={input} type="file" accept=".pdf,.xlsx,.xls" multiple hidden
                onChange={event => { take(event.target.files); event.target.value = '' }}
              />
            </>
          )}
        </div>

        {error && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-md p-md rounded-lg
                          border border-danger/30 bg-danger/5">
            <Icon name="error" className="text-danger text-[24px] shrink-0" />
            <div className="flex-1 min-w-0">
              <b className="block text-body-md text-primary">Could not analyse that.</b>
              <p className="text-body-sm text-on-surface-variant mt-xs break-words">{error}</p>
            </div>
            <button className="btn-secondary shrink-0" onClick={onDismissError}>Dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
          <DemoCard
            disabled={busy} onClick={() => onDemo('clean')}
            icon="verified" tone="good" title="Verified extraction"
            body="A real 179-page annual report, hand-transcribed and bbox-resolved. 19 figures, 2 identities pass, 1 unverifiable."
            action="Load clean document"
          />
          <DemoCard
            disabled={busy} onClick={() => onDemo('doctored')}
            icon="report" tone="bad" title="Doctored document"
            body="The same report with one balance-sheet figure edited. Watch the identity fail, three keys quarantine, and the Z-score be withheld."
            action="Break it on purpose"
          />
        </div>

        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          {POINTS.map(([icon, title, body]) => (
            <li key={title} className="flex items-start gap-md p-md rounded-md
                                       border border-hairline bg-surface-container-lowest">
              <Icon name={icon} className="text-secondary shrink-0" />
              <div className="min-w-0">
                <b className="block text-body-md text-primary">{title}</b>
                <p className="text-body-sm text-on-surface-variant mt-px">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function DemoCard({
  disabled, onClick, icon, tone, title, body, action,
}: {
  disabled: boolean
  onClick: () => void
  icon: string
  tone: 'good' | 'bad'
  title: string
  body: string
  action: string
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="card card-hover text-left p-lg flex flex-col gap-sm
                 hover:border-secondary disabled:opacity-40 disabled:cursor-not-allowed
                 transition-colors group"
    >
      <span className={`h-10 w-10 rounded-full grid place-items-center
        ${tone === 'good' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
        <Icon name={icon} />
      </span>
      <b className="text-title-md text-primary">{title}</b>
      <p className="text-body-sm text-on-surface-variant flex-1">{body}</p>
      <em className="not-italic inline-flex items-center gap-xs text-label-md text-secondary">
        {action}
        <Icon name="arrow_forward" className="text-[16px] transition-transform
                                              group-hover:translate-x-0.5" />
      </em>
    </button>
  )
}

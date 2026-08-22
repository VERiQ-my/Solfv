/** The dashboard's first run. It renders inside the shell in place of the
 *  Analysis hub while the library is empty, because a queue with nothing in it
 *  says less than the three ways to put something in it.
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
  /** The signed-in analyst's name, so the empty dashboard is addressed to
   *  someone rather than being a marketing page they already converted on. */
  greeting?: string
}

export default function Landing({
  busy, error, onDemo, onFiles, onDismissError, greeting,
}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const take = useCallback((list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) onFiles(files)
  }, [onFiles])

  return (
    <div className="landing">
      <div className="landing-inner">
        <header className="landing-head">
          <span className="eyebrow">
            {greeting ? `WELCOME, ${greeting.toUpperCase()}` : 'SOLFV · FINANCIAL REPORT INTELLIGENCE'}
          </span>
          <h1>Nothing in memory yet.</h1>
          <p>
            Insert a Malaysian annual report and every figure is reconciled against
            accounting identities before it reaches your dashboard. A number that
            fails is quarantined, not displayed with a caveat.
          </p>
        </header>

        <div
          className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault()
            setDragging(false)
            take(event.dataTransfer.files)
          }}
        >
          {busy ? (
            <>
              <div className="spinner large" />
              <b>Reconciling…</b>
              <p>Targeting statement pages, masking personal data, then checking every figure.</p>
            </>
          ) : (
            <>
              <Icon name="upload_file" />
              <b>Drop the documents finance sent over</b>
              <p>
                Native-text PDFs or spreadsheets, as many as you like. No OCR —
                a scanned document is rejected, loudly.
              </p>
              <button className="btn primary" onClick={() => input.current?.click()}>
                <Icon name="folder_open" />Choose files
              </button>
              <input
                ref={input}
                type="file"
                accept=".pdf,.xlsx,.xls"
                multiple
                hidden
                onChange={event => { take(event.target.files); event.target.value = '' }}
              />
            </>
          )}
        </div>

        {error && (
          <div className="alert alert-fail landing-alert">
            <Icon name="error" />
            <div><b>Could not analyse that.</b><p>{error}</p></div>
            <button className="btn ghost" onClick={onDismissError}>Dismiss</button>
          </div>
        )}

        <div className="landing-demos">
          <button className="demo-card" disabled={busy} onClick={() => onDemo('clean')}>
            <span className="demo-icon clean"><Icon name="verified" /></span>
            <b>Verified extraction</b>
            <p>
              A real 179-page annual report, hand-transcribed and bbox-resolved.
              19 figures, 2 identities pass, 1 unverifiable.
            </p>
            <em>Load clean document<Icon name="arrow_forward" /></em>
          </button>

          <button className="demo-card" disabled={busy} onClick={() => onDemo('doctored')}>
            <span className="demo-icon doctored"><Icon name="report" /></span>
            <b>Doctored document</b>
            <p>
              The same report with one balance-sheet figure edited. Watch the identity
              fail, three keys quarantine, and the Z-score be withheld.
            </p>
            <em>Break it on purpose<Icon name="arrow_forward" /></em>
          </button>
        </div>

        <ul className="landing-points">
          <li>
            <Icon name="rule" />
            <div>
              <b>Reconciliation before display</b>
              <p>Three accounting identities, deterministic, no model in the loop.</p>
            </div>
          </li>
          <li>
            <Icon name="my_location" />
            <div>
              <b>Cell-level provenance</b>
              <p>Every figure carries the page and coordinates it was read from.</p>
            </div>
          </li>
          <li>
            <Icon name="balance" />
            <div>
              <b>Narrative tested against numbers</b>
              <p>Management's claims checked against the figures that would prove them.</p>
            </div>
          </li>
          <li>
            <Icon name="shield_lock" />
            <div>
              <b>No database</b>
              <p>Processed in memory, purged on a timer you can watch count down.</p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  )
}

/** The right half of the split screen: the source document with the exact cell
 *  boxed.
 *
 *  Bboxes arrive in pdfplumber point coordinates. The rendered page is a PNG of
 *  arbitrary pixel size, so every box is scaled by the rendered/points ratio
 *  and positioned absolutely over the image.
 *
 *  When the session came from a fixture there is no PDF on disk to rasterise.
 *  Rather than showing nothing, the pane falls back to a to-scale schematic of
 *  the page with the box in its true position. The coordinates are real either
 *  way; only the paper behind them is missing, and the pane says so.
 */

import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { exact } from '../lib/format'
import { useSession } from '../state'
import { Empty, Icon } from './ui'
import type { Bbox } from '../types'

/** A4 in points — pdfplumber's default page box, used only for the schematic. */
const FALLBACK_PAGE = { width: 595.276, height: 841.89 }

interface Boxed {
  bbox: Bbox
  label: string
  primary: boolean
}

export function SourcePane() {
  const { sid, analysis, focus } = useSession()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'missing'>('idle')

  const page = focus?.page ?? null

  const dimensions = useMemo(() => {
    if (!analysis || page == null) return FALLBACK_PAGE
    return analysis.page_dimensions?.[String(page)] ?? FALLBACK_PAGE
  }, [analysis, page])

  const src = sid && page != null ? api.pageImage(sid, page) : null

  useEffect(() => {
    if (!src) { setStatus('idle'); return }
    setStatus('loading')
    // Probe the image rather than relying on <img onError> alone, so the
    // schematic swaps in without a flash of broken-image chrome.
    const probe = new Image()
    probe.onload = () => setStatus('ready')
    probe.onerror = () => setStatus('missing')
    probe.src = src
    return () => { probe.onload = null; probe.onerror = null }
  }, [src])

  const boxes = useMemo<Boxed[]>(() => {
    if (!focus) return []
    const out: Boxed[] = []
    if (focus.bbox) out.push({ bbox: focus.bbox, label: focus.label, primary: true })
    for (const related of focus.related ?? []) {
      if (related.bbox && related.page === focus.page) {
        out.push({ bbox: related.bbox, label: related.label, primary: false })
      }
    }
    return out
  }, [focus])

  if (!focus || page == null) {
    return (
      <div className="source-pane">
        <Empty
          icon="ads_click"
          title="Nothing selected"
          body="Click any figure with a crosshair to open the page it was read from and box the exact cell."
        />
      </div>
    )
  }

  return (
    <div className="source-pane">
      <header className="source-head">
        <div>
          <span className="eyebrow">SOURCE DOCUMENT</span>
          <b>Page {page}</b>
        </div>
        <div className="source-head-meta">
          {focus.value != null && (
            <span className="mono">{exact(focus.value, analysis?.unit)}</span>
          )}
          <span className="source-label">{focus.label}</span>
        </div>
      </header>

      <div className="source-scroll">
        <div
          className="source-canvas"
          style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
        >
          {status === 'ready' && src ? (
            <img src={src} alt={`Page ${page} of the source document`} />
          ) : (
            <Schematic loading={status === 'loading'} />
          )}

          {boxes.map((box, index) => (
            <Highlight key={index} box={box} dimensions={dimensions} />
          ))}
        </div>
      </div>

      {status === 'missing' && (
        <p className="source-note">
          <Icon name="info" />
          This session was loaded from a verified fixture, so the original PDF is
          not on disk. The coordinates below are the real ones — upload the report
          to see them over the page itself.
        </p>
      )}
      {boxes.length > 1 && (
        <p className="source-note">
          <Icon name="account_tree" />
          Boxed {boxes.length} cells: the figure and the inputs it was computed from.
        </p>
      )}
    </div>
  )
}

function Highlight({
  box, dimensions,
}: { box: Boxed; dimensions: { width: number; height: number } }) {
  const [x0, top, x1, bottom] = box.bbox
  // Percentages, so the overlay tracks the image at any rendered size.
  const style = {
    left: `${(x0 / dimensions.width) * 100}%`,
    top: `${(top / dimensions.height) * 100}%`,
    width: `${((x1 - x0) / dimensions.width) * 100}%`,
    height: `${((bottom - top) / dimensions.height) * 100}%`,
  }
  return (
    <div className={`highlight ${box.primary ? 'primary' : 'secondary'}`} style={style}>
      <span className="highlight-tag">{box.label}</span>
    </div>
  )
}

/** To-scale stand-in for the page. Deliberately abstract — it must never be
 *  mistaken for a rendering of the real document. */
function Schematic({ loading }: { loading: boolean }) {
  return (
    <div className="schematic">
      {loading && <div className="schematic-loading"><div className="spinner" /></div>}
      <div className="schematic-rule w-40" />
      <div className="schematic-rule w-70" />
      <div className="schematic-gap" />
      {Array.from({ length: 16 }, (_, index) => (
        <div key={index} className="schematic-row">
          <i className="schematic-rule" style={{ width: `${38 + (index % 5) * 9}%` }} />
          <i className="schematic-figure" />
          <i className="schematic-figure" />
        </div>
      ))}
    </div>
  )
}

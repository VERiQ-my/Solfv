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
  const [src, setSrc] = useState<string | null>(null)

  const page = focus?.page ?? null

  const dimensions = useMemo(() => {
    if (!analysis || page == null) return FALLBACK_PAGE
    return analysis.page_dimensions?.[String(page)] ?? FALLBACK_PAGE
  }, [analysis, page])

  useEffect(() => {
    if (!sid || page == null) { setSrc(null); setStatus('idle'); return }
    let active = true
    let objectUrl: string | null = null
    setStatus('loading')
    void api.pageImage(sid, page)
      .then(url => {
        objectUrl = url
        if (active) { setSrc(url); setStatus('ready') }
      })
      .catch(() => { if (active) { setSrc(null); setStatus('missing') } })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sid, page])

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
      <div className="card p-lg">
        <Empty
          icon="ads_click"
          title="Nothing selected"
          body="Click any figure with a crosshair to open the page it was read from and box the exact cell."
        />
      </div>
    )
  }

  return (
    <div className="card flex flex-col overflow-hidden">
      <header className="card-header">
        <div className="min-w-0">
          <span className="eyebrow">Source document</span>
          <b className="block text-title-md text-primary">Page {page}</b>
        </div>
        <div className="text-right min-w-0">
          {focus.value != null && (
            <span className="mono block text-body-md text-primary">
              {exact(focus.value, analysis?.unit)}
            </span>
          )}
          <span className="block text-body-sm text-on-surface-variant truncate max-w-[16ch]">
            {focus.label}
          </span>
        </div>
      </header>

      <div className="p-md bg-surface-container-low max-h-[600px] overflow-auto">
        <div
          className="relative w-full mx-auto bg-surface-container-lowest rounded
                     border border-hairline overflow-hidden shadow-panel"
          style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
        >
          {status === 'ready' && src ? (
            <img
              src={src}
              alt={`Page ${page} of the source document`}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <Schematic loading={status === 'loading'} />
          )}

          {boxes.map((box, index) => (
            <Highlight key={index} box={box} dimensions={dimensions} />
          ))}
        </div>
      </div>

      {(status === 'missing' || boxes.length > 1) && (
        <footer className="px-lg py-md border-t border-hairline space-y-xs">
          {status === 'missing' && (
            <p className="flex items-start gap-xs text-body-sm text-on-surface-variant">
              <Icon name="info" className="text-[16px] shrink-0 mt-px" />
              This session was loaded from a verified fixture, so the original PDF is not
              on disk. The coordinates boxed here are the real ones — upload the report to
              see them over the page itself.
            </p>
          )}
          {boxes.length > 1 && (
            <p className="flex items-start gap-xs text-body-sm text-on-surface-variant">
              <Icon name="account_tree" className="text-[16px] shrink-0 mt-px" />
              Boxed {boxes.length} cells: the figure and the inputs it was computed from.
            </p>
          )}
        </footer>
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
    <div
      style={style}
      className={`absolute rounded-sm pointer-events-none animate-fade-up
        ${box.primary
          ? 'border-2 border-secondary bg-secondary/15 shadow-[0_0_0_3px_rgb(var(--c-secondary)/0.15)]'
          : 'border border-dashed border-warning bg-warning/10'}`}
    >
      <span className={`absolute -top-5 left-0 whitespace-nowrap rounded-sm px-xs
        text-label-sm uppercase
        ${box.primary
          ? 'bg-secondary text-on-secondary'
          : 'bg-warning text-on-warning'}`}>
        {box.label}
      </span>
    </div>
  )
}

/** To-scale stand-in for the page. Deliberately abstract — it must never be
 *  mistaken for a rendering of the real document. */
function Schematic({ loading }: { loading: boolean }) {
  return (
    <div className="absolute inset-0 p-[6%] flex flex-col gap-[1.5%]
                    bg-surface-container-lowest">
      {loading && (
        <div className="absolute inset-0 grid place-items-center bg-surface-container-lowest/70">
          <span className="spinner text-secondary" />
        </div>
      )}
      <div className="h-[1.4%] w-[40%] rounded-full bg-surface-container-high" />
      <div className="h-[1.4%] w-[70%] rounded-full bg-surface-container-high" />
      <div className="h-[4%]" />
      {Array.from({ length: 16 }, (_, index) => (
        <div key={index} className="flex items-center gap-[3%]">
          <i
            className="h-[1.2%] min-h-[3px] rounded-full bg-surface-container-high"
            style={{ width: `${38 + (index % 5) * 9}%` }}
          />
          <i className="h-[1.2%] min-h-[3px] w-[12%] rounded-full bg-surface-container-high ml-auto" />
          <i className="h-[1.2%] min-h-[3px] w-[12%] rounded-full bg-surface-container-high" />
        </div>
      ))}
    </div>
  )
}

/** The document library.
 *
 *  Finance drops in a batch; SOLFV analyses each document independently and
 *  the Analysis page is where that queue is worked through. One engine session
 *  per document, because the engine's contract is per-document and its TTL is
 *  per-document — sharing a session across files would mean one purge taking
 *  the whole batch with it.
 *
 *  Every page other than Analysis reads `analysis`, the currently selected
 *  document, so the rest of the app stays a view onto one report at a time.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { ReactNode } from 'react'
import { ApiError, api } from './lib/api'
import type { Analysis, Bbox, PrivacyLedger } from './types'

export type DocStatus = 'queued' | 'analysing' | 'ready' | 'failed'

export interface Doc {
  /** Local id. Becomes stable for the document's lifetime; `sid` arrives later. */
  id: string
  sid: string | null
  name: string
  status: DocStatus
  error?: string
  analysis?: Analysis
  ledger?: PrivacyLedger
  expiresIn: number
  addedAt: number
}

export interface Focus {
  page: number | null
  bbox: Bbox | null
  label: string
  value?: number | null
  related?: { page: number | null; bbox: Bbox | null; label: string }[]
}

interface LibraryState {
  documents: Doc[]
  active: Doc | null
  activeId: string | null
  /** The selected document's analysis — what every non-Analysis page renders. */
  analysis: Analysis | null
  ledger: PrivacyLedger | null
  sid: string | null
  expiresIn: number
  busy: boolean
  error: string | null
  focus: Focus | null

  setActive: (id: string) => void
  setFocus: (focus: Focus | null) => void
  addFiles: (files: File[]) => void
  loadDemo: (variant: 'clean' | 'doctored') => void
  retry: (id: string) => void
  remove: (id: string) => void
  purgeAll: () => void
  dismissError: () => void
}

const Ctx = createContext<LibraryState | null>(null)

export function useSession(): LibraryState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

let counter = 0
const nextId = () => `doc-${++counter}-${Date.now().toString(36)}`

export function SessionProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<Doc[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)

  // Files that failed keep their source so Retry does not need the picker again.
  const sources = useRef(new Map<string, File | 'clean' | 'doctored'>())

  const patch = useCallback((id: string, fields: Partial<Doc>) => {
    setDocuments(current =>
      current.map(doc => (doc.id === id ? { ...doc, ...fields } : doc)))
  }, [])

  /** Run one document through the engine. */
  const analyse = useCallback(async (
    id: string,
    source: File | 'clean' | 'doctored',
  ) => {
    patch(id, { status: 'analysing', error: undefined })
    try {
      const result = typeof source === 'string'
        ? await api.demo(source)
        : await api.upload(source)
      const detail = await api.analysis(result.session_id)

      patch(id, {
        sid: result.session_id,
        status: 'ready',
        analysis: detail,
        ledger: result.privacy_ledger,
        expiresIn: detail.expires_in,
        name: detail.entity || result.document || (typeof source === 'string' ? source : source.name),
      })
      // First document to land becomes the selection, so the batch is never
      // sitting on an empty screen waiting for a click.
      setActiveId(current => current ?? id)
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : String(caught)
      patch(id, { status: 'failed', error: message })
      setError(message)
    }
  }, [patch])

  const enqueue = useCallback((
    entries: { name: string; source: File | 'clean' | 'doctored' }[],
  ) => {
    if (!entries.length) return
    setError(null)

    const created: Doc[] = entries.map(entry => ({
      id: nextId(),
      sid: null,
      name: entry.name,
      status: 'queued',
      expiresIn: 0,
      addedAt: Date.now(),
    }))
    created.forEach((doc, index) => sources.current.set(doc.id, entries[index].source))
    setDocuments(current => [...current, ...created])

    // Sequential on purpose: extraction is the expensive step and a parallel
    // burst of vision calls is how a demo machine falls over.
    void created.reduce(
      (chain, doc, index) => chain.then(() => analyse(doc.id, entries[index].source)),
      Promise.resolve(),
    )
  }, [analyse])

  const addFiles = useCallback((files: File[]) => {
    enqueue(files.map(file => ({ name: file.name, source: file })))
  }, [enqueue])

  const loadDemo = useCallback((variant: 'clean' | 'doctored') => {
    enqueue([{
      name: variant === 'clean' ? 'Verified extraction' : 'Doctored document',
      source: variant,
    }])
  }, [enqueue])

  const retry = useCallback((id: string) => {
    const source = sources.current.get(id)
    if (source) void analyse(id, source)
  }, [analyse])

  const remove = useCallback((id: string) => {
    const doc = documents.find(entry => entry.id === id)
    if (doc?.sid) void api.purge(doc.sid).catch(() => { /* TTL sweeps it anyway */ })
    sources.current.delete(id)
    setDocuments(current => current.filter(entry => entry.id !== id))
    setActiveId(current => {
      if (current !== id) return current
      const remaining = documents.filter(entry => entry.id !== id && entry.status === 'ready')
      return remaining[0]?.id ?? null
    })
    setFocus(null)
  }, [documents])

  const purgeAll = useCallback(() => {
    documents.forEach(doc => {
      if (doc.sid) void api.purge(doc.sid).catch(() => { /* TTL sweeps it anyway */ })
    })
    sources.current.clear()
    setDocuments([])
    setActiveId(null)
    setFocus(null)
  }, [documents])

  // One clock for the whole library. Each document purges on its own TTL.
  useEffect(() => {
    if (!documents.some(doc => doc.status === 'ready')) return
    const timer = window.setInterval(() => {
      setDocuments(current => {
        let changed = false
        const next = current.map(doc => {
          if (doc.status !== 'ready' || doc.expiresIn <= 0) return doc
          changed = true
          const remaining = doc.expiresIn - 1
          return remaining <= 0
            ? { ...doc, expiresIn: 0, status: 'failed' as DocStatus,
                error: 'Session expired and was purged.', analysis: undefined }
            : { ...doc, expiresIn: remaining }
        })
        return changed ? next : current
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [documents])

  const active = useMemo(
    () => documents.find(doc => doc.id === activeId) ?? null,
    [documents, activeId],
  )

  // Selecting a different document must not leave the source pane boxing a
  // cell from the previous one.
  const selectActive = useCallback((id: string) => {
    setActiveId(id)
    setFocus(null)
  }, [])

  const value = useMemo<LibraryState>(() => ({
    documents,
    active,
    activeId,
    analysis: active?.analysis ?? null,
    ledger: active?.ledger ?? null,
    sid: active?.sid ?? null,
    expiresIn: active?.expiresIn ?? 0,
    busy: documents.some(doc => doc.status === 'queued' || doc.status === 'analysing'),
    error,
    focus,
    setActive: selectActive,
    setFocus,
    addFiles,
    loadDemo,
    retry,
    remove,
    purgeAll,
    dismissError: () => setError(null),
  }), [documents, active, activeId, error, focus, selectActive,
      addFiles, loadDemo, retry, remove, purgeAll])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

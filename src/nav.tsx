/** Navigation state.
 *
 *  A context rather than props because navigation is genuinely global here:
 *  Overview links into Provenance, the Dashboard links into Analysis, and an
 *  empty state on any screen offers the route that would fill it. Threading a
 *  `go` prop through six levels to support that would be noise.
 *
 *  Still not a router. There are no deep links worth preserving — a URL that
 *  outlived its session would promise data the engine's TTL already destroyed.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AnalysisTab, Route, Section } from './types'

interface NavState extends Route {
  go: (section: Section, tab?: AnalysisTab) => void
  /** Convenience for the Analysis sub-tabs, which never change section. */
  goTab: (tab: AnalysisTab) => void
}

const Ctx = createContext<NavState | null>(null)

export function useNav(): NavState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useNav must be used inside <NavProvider>')
  return value
}

export function NavProvider({
  children, onNavigate, initialSection = 'analysis',
}: {
  children: ReactNode
  onNavigate?: () => void
  /** Where a fresh mount starts. App passes 'dashboard' — a login lands on the
   *  Command Center, which reads the persisted history and therefore has
   *  something to say before anything is inserted. */
  initialSection?: Section
}) {
  const [section, setSection] = useState<Section>(initialSection)
  const [tab, setTab] = useState<AnalysisTab>('documents')

  const go = useCallback((next: Section, nextTab?: AnalysisTab) => {
    setSection(next)
    if (nextTab) setTab(nextTab)
    onNavigate?.()
  }, [onNavigate])

  const goTab = useCallback((next: AnalysisTab) => {
    setSection('analysis')
    setTab(next)
    onNavigate?.()
  }, [onNavigate])

  const value = useMemo<NavState>(
    () => ({ section, tab, go, goTab }),
    [section, tab, go, goTab],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** The sidebar, in design order. Icons are Material Symbols names. */
export const SECTIONS: {
  id: Section; label: string; short: string; icon: string
}[] = [
  { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'dashboard' },
  { id: 'analysis', label: 'Analysis', short: 'Analysis', icon: 'analytics' },
  { id: 'market', label: 'Market Intelligence', short: 'Market', icon: 'query_stats' },
  { id: 'expenses', label: 'Expense Management', short: 'Expenses', icon: 'receipt_long' },
  { id: 'solana', label: 'Solana Investments', short: 'Solana', icon: 'account_balance_wallet' },
  { id: 'privacy', label: 'Privacy Settings', short: 'Privacy', icon: 'security' },
]

/** Analysis sub-tabs. Everything past 'documents' needs a selected document. */
export const ANALYSIS_TABS: {
  id: AnalysisTab; label: string; icon: string; needsDocument: boolean
}[] = [
  { id: 'documents', label: 'Documents', icon: 'inventory_2', needsDocument: false },
  { id: 'overview', label: 'Overview', icon: 'summarize', needsDocument: true },
  { id: 'provenance', label: 'Provenance', icon: 'fact_check', needsDocument: true },
  { id: 'saydo', label: 'Say–Do Gap', icon: 'balance', needsDocument: true },
  { id: 'benchmark', label: 'Sector Benchmark', icon: 'leaderboard', needsDocument: true },
  { id: 'risk', label: 'Credit Risk', icon: 'monitoring', needsDocument: true },
]

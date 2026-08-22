/** App shell and routing.
 *
 *  Routing is a switch over a union rather than a router: a handful of views
 *  over an in-memory library, no deep links worth preserving, and a URL that
 *  outlived its session would only promise data the TTL already destroyed.
 *
 *  Analysis is the hub — the engine's queue over everything finance inserted.
 *  Every other view is a lens on whichever document is selected there.
 */

import { useEffect, useState } from 'react'
import Analysis from './pages/Analysis'
import Benchmark from './pages/Benchmark'
import History from './pages/History'
import Landing from './pages/Landing'
import Metering from './pages/Metering'
import Overview from './pages/Overview'
import Privacy from './pages/Privacy'
import Risk from './pages/Risk'
import SayDo from './pages/SayDo'
import { Logo } from './components/Logo'
import { Icon } from './components/ui'
import { countdown } from './lib/format'
import { SessionProvider, useSession } from './state'
import type { Page } from './types'

const NAV: { id: Page; label: string; short: string; icon: string }[] = [
  { id: 'analysis', label: 'Analysis', short: 'Analysis', icon: 'fact_check' },
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'dashboard' },
  { id: 'saydo', label: 'Say–Do Gap', short: 'Say–Do', icon: 'balance' },
  { id: 'benchmark', label: 'Sector benchmark', short: 'Peers', icon: 'query_stats' },
  { id: 'risk', label: 'Credit risk', short: 'Risk', icon: 'monitoring' },
  { id: 'privacy', label: 'Privacy & session', short: 'Privacy', icon: 'shield_lock' },
  { id: 'history', label: 'History', short: 'History', icon: 'history' },
  { id: 'metering', label: 'Metering', short: 'Metering', icon: 'toll' },
]

/** Views that render without a document selected: the queue itself, and the
 *  persisted history, which by definition outlives every session. */
const STANDALONE = new Set<Page>(['analysis', 'history'])

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  )
}

function Shell() {
  const {
    documents, analysis, active, busy, error, expiresIn,
    purgeAll, addFiles, loadDemo, dismissError,
  } = useSession()
  const [page, setPage] = useState<Page>('analysis')
  const [drawer, setDrawer] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const stored = localStorage.getItem('solfv-theme')
      if (stored === 'light' || stored === 'dark') return stored
    } catch { /* private mode or blocked storage — fall through to the default */ }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('solfv-theme', theme) } catch { /* non-fatal */ }
  }, [theme])

  // A page that needs a selected document should not strand the user on an
  // empty view when the library empties or the selection is purged.
  useEffect(() => {
    if (!analysis && !STANDALONE.has(page)) setPage('analysis')
  }, [analysis, page])

  const go = (next: Page) => { setPage(next); setDrawer(false) }

  if (documents.length === 0) {
    return (
      <div className="app-shell landing-shell">
        <TopBar
          theme={theme} onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onMenu={() => setDrawer(true)} bare
        />
        <Landing
          busy={busy} error={error} onDemo={loadDemo}
          onFiles={addFiles} onDismissError={dismissError}
        />
      </div>
    )
  }

  const expiring = expiresIn > 0 && expiresIn < 300
  const needsDocument = !STANDALONE.has(page)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo subtitle="Institutional Intelligence" />
        </div>

        <nav className="side-nav">
          {NAV.map(item => {
            const disabled = !STANDALONE.has(item.id) && !analysis
            return (
              <button
                key={item.id}
                className={`${page === item.id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => !disabled && go(item.id)}
                disabled={disabled}
                title={disabled ? 'Select a reconciled document first' : undefined}
              >
                <Icon name={item.icon} />{item.label}
                {item.id === 'analysis' && busy && <span className="spinner small nav-spin" />}
                {item.id === 'saydo' && analysis && analysis.say_do_gap.some(g => g.verdict === 'CONTRADICTED') && (
                  <em className="nav-flag">
                    {analysis.say_do_gap.filter(g => g.verdict === 'CONTRADICTED').length}
                  </em>
                )}
                {item.id === 'analysis' && analysis && analysis.summary.checks_failed > 0 && (
                  <em className="nav-flag danger">!</em>
                )}
              </button>
            )
          })}
        </nav>

        {analysis && (
          <div className="sidebar-doc">
            <span className="eyebrow">SELECTED DOCUMENT</span>
            <b>{analysis.entity || active?.name}</b>
            <small>
              {[analysis.period, analysis.ticker].filter(Boolean).join(' · ')}
              {analysis.pages_total ? ` · ${analysis.pages_total} pages` : ''}
            </small>
            <div className={`session-chip ${expiring ? 'expiring' : ''}`}>
              <Icon name="timer" />
              <span>Purges in <b className="mono">{countdown(expiresIn)}</b></span>
            </div>
          </div>
        )}

        <div className="sidebar-bottom">
          <button className="btn ghost full" onClick={purgeAll}>
            <Icon name="delete_forever" />Purge all ({documents.length})
          </button>
          <span><Icon name="database_off" />Documents in memory only · never stored</span>
          <span><Icon name="lock" />PII masked before any external call</span>
        </div>
      </aside>

      <main className="main">
        <TopBar
          theme={theme}
          onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onMenu={() => setDrawer(true)}
          expiresIn={analysis ? expiresIn : undefined}
        />

        <StatusStrip />

        {page === 'analysis' && <Analysis />}
        {page === 'history' && <History />}
        {needsDocument && analysis && (
          <>
            {page === 'overview' && <Overview go={go} />}
            {page === 'saydo' && <SayDo />}
            {page === 'benchmark' && <Benchmark />}
            {page === 'risk' && <Risk />}
            {page === 'privacy' && <Privacy />}
            {page === 'metering' && <Metering />}
          </>
        )}
      </main>

      <div className={`drawer ${drawer ? 'open' : ''}`}>
        <div className="drawer-panel">
          <div className="drawer-head">
            <Logo />
            <button className="icon-btn" onClick={() => setDrawer(false)} aria-label="Close menu">
              <Icon name="close" />
            </button>
          </div>
          <nav className="side-nav">
            {NAV.map(item => {
              const disabled = !STANDALONE.has(item.id) && !analysis
              return (
                <button
                  key={item.id}
                  className={`${page === item.id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
                  onClick={() => !disabled && go(item.id)}
                  disabled={disabled}
                >
                  <Icon name={item.icon} />{item.label}
                </button>
              )
            })}
          </nav>
          <button className="btn ghost full" onClick={() => { purgeAll(); setDrawer(false) }}>
            <Icon name="delete_forever" />Purge all
          </button>
        </div>
        <button className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
      </div>

      <nav className="bottom-nav">
        {NAV.slice(0, 5).map(item => {
          const disabled = !STANDALONE.has(item.id) && !analysis
          return (
            <button
              key={item.id}
              className={`${page === item.id ? 'active' : ''}`}
              onClick={() => !disabled && go(item.id)}
              disabled={disabled}
            >
              <Icon name={item.icon} /><span>{item.short}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

function TopBar({
  theme, onTheme, onMenu, expiresIn, bare,
}: {
  theme: 'light' | 'dark'
  onTheme: () => void
  onMenu: () => void
  expiresIn?: number
  bare?: boolean
}) {
  return (
    <header className="topbar">
      {!bare && (
        <button className="mobile-menu" onClick={onMenu} aria-label="Open menu">
          <Icon name="menu" />
        </button>
      )}
      <div className="topbar-brand"><Logo /></div>
      <div className="topbar-spacer" />
      {expiresIn != null && (
        <div className={`topbar-timer ${expiresIn < 300 ? 'expiring' : ''}`}>
          <Icon name="timer" /><b className="mono">{countdown(expiresIn)}</b>
        </div>
      )}
      <button className="icon-btn" onClick={onTheme} aria-label="Toggle colour theme">
        <Icon name={theme === 'light' ? 'dark_mode' : 'light_mode'} />
      </button>
    </header>
  )
}

/** The honest one-line state of the batch, always visible. */
function StatusStrip() {
  const { documents, analysis, busy } = useSession()
  const ready = documents.filter(doc => doc.status === 'ready')
  const failed = ready.filter(doc => (doc.analysis?.summary.checks_failed ?? 0) > 0).length

  return (
    <div className={`status-strip ${failed ? 'bad' : 'good'}`}>
      <span className="status-dot" />
      <span>
        <b>
          {busy ? 'Reconciling…' : failed ? `${failed} document${failed > 1 ? 's' : ''} failed reconciliation` : 'All documents reconciled'}
        </b>
        {' · '}{ready.length}/{documents.length} analysed
        {analysis && (
          <>
            {' · selected: '}{analysis.summary.trust.VERIFIED}/{analysis.summary.line_item_count} figures verified
          </>
        )}
      </span>
      {analysis && analysis.warnings.length > 0 && (
        <span className="status-warning" title={analysis.warnings.join('\n')}>
          <Icon name="info" />{analysis.warnings.length} note{analysis.warnings.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

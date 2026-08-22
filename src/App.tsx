/** App shell, auth gate and routing.
 *
 *  Routing is a switch over a union rather than a router: a handful of views
 *  over an in-memory library, no deep links worth preserving, and a URL that
 *  outlived its session would only promise data the TTL already destroyed.
 *  The auth screens follow the same rule — `authPage` is a two-value switch,
 *  and a signed-in user never sees either one.
 *
 *  Analysis is the hub — the engine's queue over everything finance inserted —
 *  and it is where a login lands. Every other view is a lens on whichever
 *  document is selected there.
 */

import { useCallback, useEffect, useState } from 'react'
import Analysis from './pages/Analysis'
import Benchmark from './pages/Benchmark'
import History from './pages/History'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Metering from './pages/Metering'
import Overview from './pages/Overview'
import Privacy from './pages/Privacy'
import Risk from './pages/Risk'
import SayDo from './pages/SayDo'
import SignUp from './pages/SignUp'
import { Logo } from './components/Logo'
import { Icon } from './components/ui'
import { countdown } from './lib/format'
import { AuthProvider, useAuth } from './lib/auth'
import type { AuthUser } from './lib/auth'
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
    <AuthProvider>
      <Root />
    </AuthProvider>
  )
}

type Theme = 'light' | 'dark'

/** Owned above the auth gate so the choice survives logging in and out. */
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
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

  const toggle = useCallback(
    () => setTheme(current => (current === 'light' ? 'dark' : 'light')),
    [],
  )
  return [theme, toggle]
}

function Root() {
  const { user, ready, clearFeedback } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [authPage, setAuthPage] = useState<'login' | 'signup'>('login')

  // Feedback belongs to the screen that produced it. A failed log-in must not
  // greet the user on the sign-up form as if it were about that form.
  const switchTo = useCallback((next: 'login' | 'signup') => {
    clearFeedback()
    setAuthPage(next)
  }, [clearFeedback])

  // Restoring a session is a network round-trip under Supabase. Showing the
  // login form during it would flash a screen the user has already passed.
  if (!ready) {
    return (
      <div className="boot">
        <div className="spinner large" />
        <span>Restoring your session…</span>
      </div>
    )
  }

  if (!user) {
    return authPage === 'signup'
      ? <SignUp onLogIn={() => switchTo('login')} theme={theme} onTheme={toggleTheme} />
      : <Login onSignUp={() => switchTo('signup')} theme={theme} onTheme={toggleTheme} />
  }

  // Keyed by account: signing out and back in as someone else must not leave
  // the previous analyst's queue on screen.
  return (
    <SessionProvider key={user.id}>
      <Shell theme={theme} onTheme={toggleTheme} user={user} />
    </SessionProvider>
  )
}

function Shell({
  theme, onTheme, user,
}: { theme: Theme; onTheme: () => void; user: AuthUser }) {
  const {
    documents, analysis, active, busy, error, expiresIn,
    purgeAll, addFiles, loadDemo, dismissError,
  } = useSession()
  const [page, setPage] = useState<Page>('analysis')
  const [drawer, setDrawer] = useState(false)

  // A page that needs a selected document should not strand the user on an
  // empty view when the library empties or the selection is purged.
  useEffect(() => {
    if (!analysis && !STANDALONE.has(page)) setPage('analysis')
  }, [analysis, page])

  const go = (next: Page) => { setPage(next); setDrawer(false) }

  const expiring = expiresIn > 0 && expiresIn < 300
  const needsDocument = !STANDALONE.has(page)
  /** First run: the dashboard is still the dashboard, but the hub it frames is
   *  the way in rather than a queue with nothing in it. */
  const firstRun = documents.length === 0

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
          <AccountChip user={user} />
          <button className="btn ghost full" onClick={purgeAll} disabled={firstRun}>
            <Icon name="delete_forever" />Purge all ({documents.length})
          </button>
          <span><Icon name="database_off" />Documents in memory only · never stored</span>
          <span><Icon name="lock" />PII masked before any external call</span>
        </div>
      </aside>

      <main className="main">
        <TopBar
          theme={theme}
          onTheme={onTheme}
          onMenu={() => setDrawer(true)}
          expiresIn={analysis ? expiresIn : undefined}
        />

        <StatusStrip user={user} />

        {page === 'analysis' && (
          firstRun
            ? (
              <Landing
                busy={busy} error={error} onDemo={loadDemo}
                onFiles={addFiles} onDismissError={dismissError}
                greeting={user.name}
              />
            )
            : <Analysis />
        )}
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
          <div className="drawer-foot">
            <AccountChip user={user} />
            <button className="btn ghost full" onClick={() => { purgeAll(); setDrawer(false) }}>
              <Icon name="delete_forever" />Purge all
            </button>
          </div>
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

/** Who is signed in, and the way out. Purging first is deliberate: sessions
 *  live in this tab, so leaving them behind on sign-out would keep documents
 *  in memory that their owner believes they have closed. */
function AccountChip({ user }: { user: AuthUser }) {
  const { logOut, busy } = useAuth()
  const { purgeAll } = useSession()

  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('') || user.email[0]?.toUpperCase() || '?'

  return (
    <div className="account">
      <span className="account-avatar" aria-hidden="true">{initials}</span>
      <span className="account-copy">
        <b title={user.name}>{user.name}</b>
        <small title={user.email}>{user.email}</small>
      </span>
      <button
        className="icon-btn"
        title="Sign out and purge this tab"
        aria-label="Sign out"
        disabled={busy}
        onClick={() => { purgeAll(); void logOut() }}
      >
        <Icon name="logout" />
      </button>
    </div>
  )
}

function TopBar({
  theme, onTheme, onMenu, expiresIn,
}: {
  theme: Theme
  onTheme: () => void
  onMenu: () => void
  expiresIn?: number
}) {
  return (
    <header className="topbar">
      <button className="mobile-menu" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
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
function StatusStrip({ user }: { user: AuthUser }) {
  const { documents, analysis, busy } = useSession()
  const ready = documents.filter(doc => doc.status === 'ready')
  const failed = ready.filter(doc => (doc.analysis?.summary.checks_failed ?? 0) > 0).length

  if (documents.length === 0) {
    return (
      <div className="status-strip good">
        <span className="status-dot" />
        <span>
          <b>Signed in as {user.name}</b>
          {' · nothing in memory · insert a document to start the engine'}
        </span>
      </div>
    )
  }

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

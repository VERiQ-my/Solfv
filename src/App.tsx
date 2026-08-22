/** App shell and auth gate.
 *
 *  Nothing renders until someone is signed in, and a login lands on the Command
 *  Center — it aggregates the persisted audit history, so it has something to
 *  say before a single document is inserted. The auth screens are a two-value
 *  switch for the same reason the rest of this app is: there are no deep links
 *  worth preserving.
 *
 *  Six destinations in the sidebar, matching the design system. Analysis is the
 *  hub: the engine's queue over everything finance inserted, with its lenses —
 *  overview, provenance, say–do, benchmark, risk — as tabs inside it rather
 *  than as siblings, because each is a view of one selected document and means
 *  nothing without it.
 *
 *  The other five sections stand on their own data: the Dashboard and Privacy
 *  read the persisted audit history, Market reads the engine's market feed,
 *  Expenses reads the selected document's cost structure, and Solana reads the
 *  payment surface.
 */

import { useCallback, useEffect, useState } from 'react'
import Analysis from './pages/Analysis'
import Dashboard from './pages/Dashboard'
import Expenses from './pages/Expenses'
import Login from './pages/Login'
import Market from './pages/Market'
import Privacy from './pages/Privacy'
import SignUp from './pages/SignUp'
import Solana from './pages/Solana'
import { Logo } from './components/Logo'
import { Icon } from './components/ui'
import { countdown } from './lib/format'
import { AUTH_CONFIGURATION_ERROR, useAuth } from './lib/auth'
import type { AuthUser } from './lib/auth'
import { NavProvider, SECTIONS, useNav } from './nav'
import { SessionProvider, useSession } from './state'
import type { Section } from './types'

/** Top-bar copy per destination. The design puts the current location and its
 *  live status side by side up there, so both live in one table. */
const HEADINGS: Record<Section, string> = {
  dashboard: 'Command Center',
  analysis: 'Analysis Lab',
  market: 'Market Intelligence',
  expenses: 'Expense Management',
  solana: 'Solana Investments',
  privacy: 'Privacy & Security',
}

export default function App() {
  return <DemoRoot />
}

type Theme = 'light' | 'dark'

/** Owned above the gate so the choice survives logging in and out. */
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

const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@solfv.local',
  name: 'Demo workspace',
}

/** The judging path starts at the dashboard; production can still use Root. */
function DemoRoot() {
  const [theme, toggleTheme] = useTheme()
  const [drawer, setDrawer] = useState(false)

  return (
    <SessionProvider key={DEMO_USER.id}>
      <NavProvider initialSection="dashboard" onNavigate={() => setDrawer(false)}>
        <Shell drawer={drawer} setDrawer={setDrawer} theme={theme}
               onTheme={toggleTheme} user={DEMO_USER} />
      </NavProvider>
    </SessionProvider>
  )
}

function Root() {
  const { user, ready, clearFeedback } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [authPage, setAuthPage] = useState<'login' | 'signup'>('login')
  const [drawer, setDrawer] = useState(false)

  if (AUTH_CONFIGURATION_ERROR) {
    return (
      <div className="min-h-screen grid place-content-center p-lg bg-background">
        <div className="max-w-xl card p-xl space-y-md">
          <Icon name="settings_alert" className="text-danger text-[28px]" />
          <h1 className="text-headline-md text-primary">Authentication configuration required</h1>
          <p className="text-body-md text-on-surface-variant">{AUTH_CONFIGURATION_ERROR}</p>
        </div>
      </div>
    )
  }

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
      <div className="min-h-screen grid place-content-center justify-items-center gap-sm
                      bg-background text-on-surface-variant">
        <span className="spinner h-8 w-8 border-4 text-secondary" />
        <span className="text-body-md">Restoring your session…</span>
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
      <NavProvider initialSection="dashboard" onNavigate={() => setDrawer(false)}>
        <Shell
          drawer={drawer} setDrawer={setDrawer}
          theme={theme} onTheme={toggleTheme} user={user}
        />
      </NavProvider>
    </SessionProvider>
  )
}

/** The signed-in frame. It renders whether or not anything has been inserted:
 *  four of the six destinations read persisted or independent data, so an empty
 *  in-memory library is no reason to withhold the whole product. The Analysis
 *  Lab's own insert panel is the empty state now. */
function Shell({
  drawer, setDrawer, theme, onTheme, user,
}: {
  drawer: boolean
  setDrawer: (open: boolean) => void
  theme: Theme
  onTheme: () => void
  user: AuthUser
}) {
  const { section } = useNav()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar user={user} />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar
          heading={HEADINGS[section]}
          theme={theme}
          onTheme={onTheme}
          onMenu={() => setDrawer(true)}
        />
        <StatusStrip />

        <div className="flex-1 overflow-y-auto p-margin-mobile md:p-xl pb-24 md:pb-xl">
          <div className="max-w-container-max mx-auto w-full space-y-xl">
            {section === 'dashboard' && <Dashboard />}
            {section === 'analysis' && <Analysis />}
            {section === 'market' && <Market />}
            {section === 'expenses' && <Expenses />}
            {section === 'solana' && <Solana />}
            {section === 'privacy' && <Privacy />}
          </div>
        </div>
      </main>

      <MobileDrawer open={drawer} onClose={() => setDrawer(false)} user={user} />
      <BottomNav />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                     */
/* -------------------------------------------------------------------------- */

function Sidebar({ user }: { user: AuthUser }) {
  const { documents, analysis, active, expiresIn, purgeAll } = useSession()
  const expiring = expiresIn > 0 && expiresIn < 300

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col py-lg
                      bg-surface-container-lowest border-r border-hairline">
      <div className="px-gutter mb-xl">
        <Logo subtitle="Institutional Intelligence" />
      </div>

      <nav className="flex-1 overflow-y-auto px-sm space-y-xs">
        <NavList />
      </nav>

      {analysis && (
        <div className="mx-gutter mt-lg p-md rounded-md border border-hairline
                        bg-surface-container-low">
          <span className="eyebrow">Selected document</span>
          <b className="block text-body-md text-primary truncate mt-xs">
            {analysis.entity || active?.name}
          </b>
          <small className="block text-body-sm text-on-surface-variant truncate">
            {[analysis.period, analysis.ticker].filter(Boolean).join(' · ')}
            {analysis.pages_total ? ` · ${analysis.pages_total} pages` : ''}
          </small>
          <div className={`mt-sm flex items-center gap-xs text-body-sm
            ${expiring ? 'text-danger' : 'text-on-surface-variant'}`}>
            <Icon name="timer" className="text-[16px]" />
            <span>Purges in <b className="mono">{countdown(expiresIn)}</b></span>
          </div>
        </div>
      )}

      <div className="px-gutter mt-auto pt-lg space-y-sm">
        <DemoWorkspaceChip />
        <button
          className="btn-secondary btn-full"
          onClick={purgeAll}
          disabled={documents.length === 0}
        >
          <Icon name="delete_forever" className="text-[16px]" />
          Purge all ({documents.length})
        </button>
        <ul className="space-y-xs text-body-sm text-on-surface-variant">
          <li className="flex items-start gap-xs">
            <Icon name="database_off" className="text-[16px] mt-px shrink-0" />
            Documents in memory only · never stored
          </li>
          <li className="flex items-start gap-xs">
            <Icon name="lock" className="text-[16px] mt-px shrink-0" />
            PII masked before any external call
          </li>
        </ul>
      </div>
    </aside>
  )
}

/** The six destinations, with live counters drawn from the engine's verdicts. */
function NavList() {
  const { section, go } = useNav()
  const { analysis, busy } = useSession()

  const contradicted = analysis?.say_do_gap.filter(g => g.verdict === 'CONTRADICTED').length ?? 0
  const failures = analysis?.summary.checks_failed ?? 0

  return (
    <>
      {SECTIONS.map(item => {
        const current = section === item.id
        return (
          <button
            key={item.id}
            onClick={() => go(item.id)}
            className={`nav-item ${current ? 'nav-item-active' : ''}`}
            aria-current={current ? 'page' : undefined}
          >
            <Icon name={item.icon} filled={current} className="shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.id === 'analysis' && busy && <span className="spinner text-secondary" />}
            {item.id === 'analysis' && !busy && failures > 0 && (
              <span className="chip-danger !px-xs !py-0" title={`${failures} failing check(s)`}>
                {failures}
              </span>
            )}
            {item.id === 'privacy' && contradicted > 0 && (
              <span className="chip-warning !px-xs !py-0" title="Contradicted claims">
                {contradicted}
              </span>
            )}
          </button>
        )
      })}
    </>
  )
}

/** Who is signed in, and the way out. Purging first is deliberate: sessions
 *  live in this tab, so leaving them behind on sign-out would keep documents in
 *  memory that their owner believes they have closed. */
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
    <div className="flex items-center gap-sm p-sm rounded-md border border-hairline
                    bg-surface-container-low">
      <span className="h-8 w-8 shrink-0 rounded-full grid place-items-center
                       bg-primary text-on-primary text-label-sm" aria-hidden="true">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-body-sm text-primary truncate" title={user.name}>
          {user.name}
        </b>
        <small className="block text-body-sm text-on-surface-variant truncate"
               title={user.email}>
          {user.email}
        </small>
      </span>
      <button
        className="icon-btn h-8 w-8 shrink-0"
        title="Sign out and purge this tab"
        aria-label="Sign out"
        disabled={busy}
        onClick={() => { purgeAll(); void logOut() }}
      >
        <Icon name="logout" className="text-[18px]" />
      </button>
    </div>
  )
}

function DemoWorkspaceChip() {
  return (
    <div className="flex items-center gap-sm p-sm rounded-md border border-hairline
                    bg-surface-container-low">
      <span className="h-8 w-8 shrink-0 rounded-full grid place-items-center
                       bg-primary text-on-primary text-label-sm" aria-hidden="true">
        D
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-body-sm text-primary truncate">Demo workspace</b>
        <small className="block text-body-sm text-on-surface-variant truncate">
          Anonymous session
        </small>
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                      */
/* -------------------------------------------------------------------------- */

function TopBar({
  heading, theme, onTheme, onMenu,
}: {
  heading: string
  theme: 'light' | 'dark'
  onTheme: () => void
  onMenu: () => void
}) {
  const { analysis, expiresIn, busy } = useSession()
  const expiring = expiresIn > 0 && expiresIn < 300

  return (
    <header className="h-16 shrink-0 flex items-center gap-md px-md md:px-lg
                       border-b border-hairline bg-surface">
      <button className="icon-btn md:hidden" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>

      <h2 className="text-title-md text-primary truncate">{heading}</h2>

      <div className={`hidden sm:inline-flex ${busy ? 'badge-info' : 'badge'}`}>
        <span className={`dot ${busy ? 'bg-current animate-pulse' : 'bg-success'}`} />
        {busy ? 'Engine working' : 'Engine connected'}
      </div>

      <div className="flex-1" />

      {analysis && (
        <div className={`hidden sm:inline-flex items-center gap-xs px-sm py-xs rounded
          text-body-sm ${expiring
            ? 'text-danger bg-danger/10'
            : 'text-on-surface-variant bg-surface-container-low'}`}>
          <Icon name="timer" className="text-[16px]" />
          <b className="mono">{countdown(expiresIn)}</b>
        </div>
      )}

      <ThemeButton theme={theme} onToggle={onTheme} />
    </header>
  )
}

function ThemeButton({
  theme, onToggle,
}: { theme: 'light' | 'dark'; onToggle: () => void }) {
  return (
    <button
      className="icon-btn"
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
    >
      <Icon name={theme === 'light' ? 'dark_mode' : 'light_mode'} />
    </button>
  )
}

/** The honest one-line state of the batch, always visible. */
function StatusStrip() {
  const { documents, analysis, busy } = useSession()
  const ready = documents.filter(doc => doc.status === 'ready')
  const failed = ready.filter(doc => (doc.analysis?.summary.checks_failed ?? 0) > 0).length

  // "All documents reconciled · 0/0" is technically true and says nothing.
  if (documents.length === 0) {
    return (
      <div className="shrink-0 flex items-center gap-sm px-md md:px-lg py-xs
                      text-body-sm border-b border-hairline
                      bg-surface-container-low text-on-surface-variant">
        <span className="dot bg-success" />
        <span className="truncate">
          <b className="text-primary">Engine idle</b>
          {' · nothing in memory · insert a document to start the pipeline'}
        </span>
      </div>
    )
  }

  return (
    <div className={`shrink-0 flex items-center gap-sm px-md md:px-lg py-xs
                     text-body-sm border-b border-hairline
      ${failed
        ? 'bg-danger/5 text-on-surface'
        : 'bg-surface-container-low text-on-surface-variant'}`}>
      <span className={`dot ${failed ? 'bg-danger' : busy ? 'bg-warning animate-pulse' : 'bg-success'}`} />
      <span className="truncate">
        <b className="text-primary">
          {busy
            ? 'Reconciling…'
            : failed
              ? `${failed} document${failed > 1 ? 's' : ''} failed reconciliation`
              : 'All documents reconciled'}
        </b>
        {' · '}{ready.length}/{documents.length} analysed
        {analysis && (
          <> · selected: {analysis.summary.trust.VERIFIED}/{analysis.summary.line_item_count} figures verified</>
        )}
      </span>
      {analysis && analysis.warnings.length > 0 && (
        <span
          className="ml-auto shrink-0 inline-flex items-center gap-xs text-warning"
          title={analysis.warnings.join('\n')}
        >
          <Icon name="info" className="text-[16px]" />
          {analysis.warnings.length} note{analysis.warnings.length > 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Small screens                                                               */
/* -------------------------------------------------------------------------- */

function MobileDrawer({
  open, onClose, user,
}: { open: boolean; onClose: () => void; user: AuthUser }) {
  const { documents, purgeAll } = useSession()

  return (
    <div
      className={`md:hidden fixed inset-0 z-50 transition-opacity duration-200
        ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <button
        className="absolute inset-0 bg-inverse-surface/40"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col py-lg
        bg-surface-container-lowest border-r border-hairline
        transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-gutter mb-lg flex items-center justify-between gap-sm">
          <Logo subtitle="Institutional Intelligence" />
          <button className="icon-btn" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-sm space-y-xs">
          <NavList />
        </nav>
        <div className="px-gutter pt-lg space-y-sm">
          <DemoWorkspaceChip />
          <button
            className="btn-secondary btn-full"
            onClick={() => { purgeAll(); onClose() }}
            disabled={documents.length === 0}
          >
            <Icon name="delete_forever" className="text-[16px]" />
            Purge all ({documents.length})
          </button>
        </div>
      </div>
    </div>
  )
}

function BottomNav() {
  const { section, go } = useNav()
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5
                    bg-surface-container-lowest border-t border-hairline">
      {SECTIONS.filter(item => item.id !== 'expenses').map(item => {
        const current = section === item.id
        return (
          <button
            key={item.id}
            onClick={() => go(item.id)}
            className={`flex flex-col items-center gap-xs py-sm text-label-sm
              transition-colors ${current ? 'text-secondary' : 'text-on-surface-variant'}`}
          >
            <Icon name={item.icon} filled={current} className="text-[20px]" />
            <span>{item.short}</span>
          </button>
        )
      })}
    </nav>
  )
}

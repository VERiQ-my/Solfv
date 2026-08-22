/** The frame both auth screens share.
 *
 *  Two panels: the product's claim on the left, the form on the right. The
 *  claim panel is not decoration — it is the only place the pitch lives now
 *  that the app itself is behind a login, and it is the same four guarantees
 *  the dashboard then has to keep.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { Icon } from './ui'
import { AUTH_MODE } from '../lib/auth'

const POINTS: { icon: string; title: string; body: string }[] = [
  {
    icon: 'rule',
    title: 'Reconciliation before display',
    body: 'Three accounting identities, deterministic, no model in the loop.',
  },
  {
    icon: 'my_location',
    title: 'Cell-level provenance',
    body: 'Every figure carries the page and coordinates it was read from.',
  },
  {
    icon: 'balance',
    title: 'Narrative tested against numbers',
    body: "Management's claims checked against the figures that would prove them.",
  },
  {
    icon: 'shield_lock',
    title: 'No database',
    body: 'Processed in memory, purged on a timer you can watch count down.',
  },
]

export function AuthLayout({
  title, lede, theme, onTheme, children, footer,
}: {
  title: string
  lede: string
  theme: 'light' | 'dark'
  onTheme: () => void
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-aside-brand">
          <Logo subtitle="Institutional Intelligence" />
        </div>

        <div className="auth-aside-copy">
          <span className="eyebrow">SOLFV · FINANCIAL REPORT INTELLIGENCE</span>
          <h1>The model extracts.<br />The arithmetic decides.</h1>
          <p>
            Every figure in an annual report is reconciled against accounting
            identities before it reaches your dashboard. A number that fails is
            quarantined, not displayed with a caveat.
          </p>
        </div>

        <ul className="auth-points">
          {POINTS.map(point => (
            <li key={point.title}>
              <Icon name={point.icon} />
              <div>
                <b>{point.title}</b>
                <p>{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main className="auth-main">
        <header className="auth-topbar">
          <div className="auth-topbar-brand"><Logo /></div>
          <button className="icon-btn" onClick={onTheme} aria-label="Toggle colour theme">
            <Icon name={theme === 'light' ? 'dark_mode' : 'light_mode'} />
          </button>
        </header>

        <div className="auth-panel">
          <header className="auth-panel-head">
            <h2>{title}</h2>
            <p>{lede}</p>
          </header>

          {children}

          <footer className="auth-switch">{footer}</footer>

          <p className="auth-mode">
            <Icon name={AUTH_MODE === 'supabase' ? 'cloud_done' : 'devices'} />
            {AUTH_MODE === 'supabase'
              ? 'Accounts are held by Supabase Auth. Documents are still never stored.'
              : 'Supabase is not configured, so this account lives in this browser only. Passwords are salted and hashed; neither is sent anywhere.'}
          </p>
        </div>
      </main>
    </div>
  )
}

/** A labelled input that owns its own error slot, so a message can never end
 *  up next to the wrong field. */
export function Field({
  label, type = 'text', value, onChange, error, hint, autoComplete,
  placeholder, disabled, autoFocus,
}: {
  label: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  autoComplete?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'

  return (
    <div className={`field ${error ? 'field-bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="field-input">
        <input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          spellCheck={false}
        />
        {isPassword && (
          <button
            type="button"
            className="field-reveal"
            onClick={() => setRevealed(current => !current)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            <Icon name={revealed ? 'visibility_off' : 'visibility'} />
          </button>
        )}
      </div>
      {error
        ? <small id={`${id}-note`} className="field-error"><Icon name="error" />{error}</small>
        : hint && <small id={`${id}-note`} className="field-hint">{hint}</small>}
    </div>
  )
}

/** The frame both auth screens share.
 *
 *  Two panels: the product's claim on the left, the form on the right. The
 *  claim panel is not decoration — it is the only place the pitch lives now
 *  that the app itself is behind a login, and it is the same four guarantees
 *  the Command Center then has to keep.
 *
 *  It borrows the design system's inverted "spotlight" surface, which the brief
 *  reserves for the one thing the eye should land on first. Signed out, that is
 *  the claim. Its palette is stated inline for the same reason `.panel-spotlight`
 *  states its own: this surface stays dark in both themes, so it cannot inherit
 *  the token ramp.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Logo, LogoMark } from './Logo'
import { Icon } from './ui'
import { AUTH_MODE } from '../lib/auth'

/** The same four guarantees the product makes on every screen. */
const POINTS: [string, string, string][] = [
  ['rule', 'Reconciliation before display',
    'Three accounting identities, deterministic, no model in the loop.'],
  ['my_location', 'Cell-level provenance',
    'Every figure carries the page and coordinates it was read from.'],
  ['balance', 'Narrative tested against numbers',
    "Management's claims checked against the figures that would prove them."],
  ['shield_lock', 'No database',
    'Processed in memory, purged on a timer you can watch count down.'],
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
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-background">
      {/* The claim. Dropped below lg rather than stacked — a signed-out user on
          a narrow screen wants the two fields, not the pitch to scroll past. */}
      <aside className="hidden lg:flex flex-col gap-xl p-xl
                        bg-[rgb(11_22_40)] dark:bg-[rgb(22_31_49)]
                        text-[rgb(234_241_255)]">
        <div className="flex items-center gap-sm">
          {/* The mark's tile is `fill-primary`, which is this panel's own ink.
              Lift it so the glyph reads as a tile, not a floating check. */}
          <span className="[&_rect:first-of-type]:fill-white/10">
            <LogoMark size={34} />
          </span>
          <div>
            <b className="block text-title-md leading-tight">SOLFV</b>
            <span className="text-body-sm text-[rgb(190_198_224)]">
              Institutional Intelligence
            </span>
          </div>
        </div>

        <div className="mt-auto">
          <span className="eyebrow !text-[rgb(139_167_235)]">
            SOLFV · Financial report intelligence
          </span>
          <h1 className="text-display-lg text-[rgb(234_241_255)] mt-sm">
            The model extracts.<br />The arithmetic decides.
          </h1>
          <p className="text-body-lg text-[rgb(190_198_224)] mt-md max-w-[46ch]">
            Every figure in an annual report is reconciled against accounting
            identities before it reaches your dashboard. A number that fails is
            quarantined, not displayed with a caveat.
          </p>
        </div>

        <ul className="mb-auto grid sm:grid-cols-2 gap-lg pt-lg border-t border-white/10">
          {POINTS.map(([icon, heading, body]) => (
            <li key={heading} className="flex items-start gap-sm">
              <Icon name={icon} className="text-tertiary-fixed shrink-0 text-[20px]" />
              <div className="min-w-0">
                <b className="block text-body-md text-[rgb(234_241_255)]">{heading}</b>
                <p className="text-body-sm text-[rgb(190_198_224)] mt-px">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex flex-col min-w-0">
        <header className="h-16 shrink-0 flex items-center gap-md px-margin-mobile md:px-lg">
          <div className="lg:hidden"><Logo /></div>
          <div className="flex-1" />
          <button
            className="icon-btn"
            onClick={onTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            <Icon name={theme === 'light' ? 'dark_mode' : 'light_mode'} />
          </button>
        </header>

        <div className="flex-1 flex items-center justify-center px-margin-mobile md:px-lg pb-xl">
          <div className="w-full max-w-[26rem] space-y-lg animate-fade-up">
            <header>
              <h2 className="text-headline-lg text-primary">{title}</h2>
              <p className="text-body-md text-on-surface-variant mt-xs">{lede}</p>
            </header>

            {children}

            <footer className="pt-md border-t border-hairline text-center
                               text-body-md text-on-surface-variant">
              {footer}
            </footer>

            <p className="flex items-start gap-sm p-md rounded-md border border-hairline
                          bg-surface-container-low text-body-sm text-on-surface-variant">
              <Icon
                name={AUTH_MODE === 'supabase' ? 'cloud_done' : 'devices'}
                className="text-[16px] text-secondary shrink-0 mt-px"
              />
              {AUTH_MODE === 'supabase'
                ? 'Accounts are held by Supabase Auth. Documents are still never stored.'
                : 'Supabase is not configured, so this account lives in this browser only. Passwords are salted and hashed; neither is sent anywhere.'}
            </p>
          </div>
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
    <div>
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="relative">
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
          className={`input disabled:opacity-60 disabled:cursor-not-allowed
            ${isPassword ? 'pr-12' : ''}
            ${error ? 'border-danger focus:border-danger focus:ring-danger/10' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed(current => !current)}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            className="icon-btn absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
          >
            <Icon name={revealed ? 'visibility_off' : 'visibility'} className="text-[18px]" />
          </button>
        )}
      </div>
      {error ? (
        <small id={`${id}-note`}
               className="flex items-center gap-xs mt-xs text-body-sm text-danger">
          <Icon name="error" className="text-[14px]" />{error}
        </small>
      ) : hint && (
        <small id={`${id}-note`} className="block mt-xs text-body-sm text-on-surface-variant">
          {hint}
        </small>
      )}
    </div>
  )
}

/** The two feedback shapes both screens use, matching the design's inline
 *  alert: a tinted hairline panel, never a modal. */
export function Alert({
  tone, icon, title, children,
}: {
  tone: 'danger' | 'info'
  icon: string
  title?: string
  children: ReactNode
}) {
  const skin = tone === 'danger'
    ? 'border-danger/30 bg-danger/5'
    : 'border-secondary/30 bg-secondary/5'
  return (
    <div className={`flex items-start gap-md p-md rounded-lg border ${skin}`}>
      <Icon
        name={icon}
        className={`shrink-0 text-[20px] ${tone === 'danger' ? 'text-danger' : 'text-secondary'}`}
      />
      <div className="min-w-0 flex-1">
        {title && <b className="block text-body-md text-primary">{title}</b>}
        <div className="text-body-sm text-on-surface-variant mt-xs break-words">
          {children}
        </div>
      </div>
    </div>
  )
}

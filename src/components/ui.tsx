/** Shared primitives. Every one of these is deliberately small — the design
 *  system lives in styles.css and these just name the parts. */

import type { ReactNode } from 'react'
import { TRUST_COPY } from '../lib/format'
import type { BenchVerdict, CheckStatus, Trust, Verdict, Zone } from '../types'

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
      {name}
    </span>
  )
}

export function Card({
  title, subtitle, action, icon, children, className = '', tone,
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  icon?: string
  children: ReactNode
  className?: string
  tone?: 'plain' | 'dark'
}) {
  return (
    <section className={`card ${tone === 'dark' ? 'card-dark' : ''} ${className}`}>
      {title && (
        <header className="card-head">
          <div className="card-head-copy">
            <h3>{icon && <Icon name={icon} />}{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageIntro({
  eyebrow, title, lede, children,
}: { eyebrow?: string; title: string; lede: string; children?: ReactNode }) {
  return (
    <header className="page-intro">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        <p>{lede}</p>
      </div>
      {children && <div className="page-intro-actions">{children}</div>}
    </header>
  )
}

/** The trust badge. Its tooltip carries the honest detail behind the colour. */
export function TrustBadge({ trust, checkedBy }: { trust: Trust; checkedBy?: string[] }) {
  const copy = TRUST_COPY[trust]
  const detail = checkedBy?.length
    ? `Cleared by: ${checkedBy.join(', ')}.`
    : trust === 'VERIFIED'
      ? 'Traced to source, not cross-checked by an identity.'
      : ''
  return (
    <span className={`badge trust-${trust.toLowerCase()}`} title={`${copy.hint} ${detail}`}>
      <i />{copy.label}
    </span>
  )
}

export function StatusPill({ status }: { status: CheckStatus | Verdict | BenchVerdict }) {
  return (
    <span className={`pill pill-${status.toLowerCase()}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

export function ZoneTag({ zone }: { zone: Zone | null }) {
  if (!zone) return <span className="pill pill-unverifiable">WITHHELD</span>
  return <span className={`pill zone-${zone.toLowerCase()}`}>{zone}</span>
}

/** A figure that can be traced back to the document. Renders as a button only
 *  when there is somewhere to go — a dead link would undercut the whole claim. */
export function SourceLink({
  page, onClick, children, className = '',
}: { page: number | null; onClick?: () => void; children: ReactNode; className?: string }) {
  if (page == null || !onClick) {
    return <span className={`figure ${className}`}>{children}</span>
  }
  return (
    <button type="button" className={`figure figure-link ${className}`} onClick={onClick}
            title={`Show this figure on page ${page}`}>
      {children}<Icon name="my_location" />
    </button>
  )
}

export function Meter({
  value, tone = 'blue', label,
}: { value: number; tone?: string; label?: string }) {
  const width = `${Math.max(0, Math.min(100, value * 100))}%`
  return (
    <div className="meter" role="img" aria-label={label}>
      <i className={`meter-${tone}`} style={{ width }} />
    </div>
  )
}

export function Empty({
  icon, title, body, action,
}: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <b>{title}</b>
      <p>{body}</p>
      {action}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner-block">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function Stat({
  label, value, hint, tone, children,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'good' | 'bad' | 'warn' | 'muted'
  children?: ReactNode
}) {
  return (
    <article className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <p className="stat-label">{label}</p>
      <strong className="stat-value mono">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
      {children}
    </article>
  )
}

export function Delta({ change, improved }: { change: number; improved: boolean }) {
  return (
    <span className={`delta ${improved ? 'up' : 'down'}`}>
      <Icon name={change >= 0 ? 'trending_up' : 'trending_down'} />
      {change >= 0 ? '+' : ''}{(change * 100).toFixed(1)}%
    </span>
  )
}

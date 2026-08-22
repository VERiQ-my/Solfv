/** Shared primitives.
 *
 *  These name the parts of the Vanguard Intelligence design system; the tokens
 *  themselves live in `tailwind.config.js` and `styles.css`. Each primitive is
 *  deliberately thin — it exists so a card looks like a card on all eleven
 *  screens, not to hide layout decisions that belong to the page.
 */

import type { ReactNode } from 'react'
import { TRUST_COPY } from '../lib/format'
import type { BenchVerdict, CheckStatus, Trust, Verdict, Zone } from '../types'

export function Icon({
  name, className = '', filled = false,
}: { name: string; className?: string; filled?: boolean }) {
  return (
    <span
      className={`material-symbols-outlined ${filled ? 'filled' : ''} ${className}`}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({
  title, subtitle, action, icon, children, className = '', bodyClassName = 'card-body',
}: {
  title?: ReactNode
  subtitle?: string
  action?: ReactNode
  icon?: string
  children: ReactNode
  className?: string
  /** Pass '' to let the child own its padding — tables and source panes do. */
  bodyClassName?: string
}) {
  return (
    <section className={`card card-hover flex flex-col ${className}`}>
      {title && (
        <header className="card-header">
          <div className="flex items-center gap-sm min-w-0">
            {icon && <Icon name={icon} className="text-on-surface-variant shrink-0" />}
            <div className="min-w-0">
              <h3 className="card-title truncate">{title}</h3>
              {subtitle && (
                <p className="text-body-sm text-on-surface-variant mt-px">{subtitle}</p>
              )}
            </div>
          </div>
          {action && <div className="flex items-center gap-sm shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** The inverted panel the brief reserves for model output. */
export function Spotlight({
  title, icon = 'smart_toy', children, footer, className = '',
}: {
  title: string
  icon?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <section className={`panel-spotlight flex flex-col ${className}`}>
      <div className="flex items-center gap-sm mb-lg">
        <Icon name={icon} className="text-tertiary-fixed" />
        <h3 className="text-title-md text-[rgb(234_241_255)]">{title}</h3>
      </div>
      <div className="flex-1 space-y-md">{children}</div>
      {footer && <div className="mt-lg">{footer}</div>}
    </section>
  )
}

export function SpotlightNote({
  title, icon, tone = 'good', children,
}: {
  title: string
  icon: string
  tone?: 'good' | 'bad' | 'neutral'
  children: ReactNode
}) {
  const accent = tone === 'bad'
    ? 'text-[rgb(255_180_171)]'
    : tone === 'neutral' ? 'text-[rgb(190_198_224)]' : 'text-tertiary-fixed'
  return (
    <div className="panel-spotlight-inset">
      <h4 className={`flex items-center gap-xs text-label-md ${accent} mb-xs`}>
        <Icon name={icon} className="text-[16px]" />{title}
      </h4>
      <div className="text-body-sm text-[rgb(190_198_224)]">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Page furniture                                                              */
/* -------------------------------------------------------------------------- */

export function PageIntro({
  eyebrow, title, lede, children,
}: { eyebrow?: string; title: string; lede: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col md:flex-row md:items-end justify-between gap-md">
      <div className="min-w-0">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2 className="text-headline-lg md:text-display-lg text-primary mt-xs">{title}</h2>
        <p className="text-body-lg text-on-surface-variant mt-xs">{lede}</p>
      </div>
      {children && <div className="flex items-center gap-sm shrink-0">{children}</div>}
    </header>
  )
}

/** The design's pill-group control. */
export function Segmented<T extends string>({
  options, value, onChange, className = '',
}: {
  options: { id: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`inline-flex items-center gap-xs p-xs rounded-md border
                     border-hairline bg-surface-container-lowest ${className}`}>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
          className={`px-md py-xs rounded text-label-md transition-colors duration-200
            disabled:opacity-40 disabled:cursor-not-allowed
            ${value === option.id
              ? 'bg-surface-container-low text-primary'
              : 'text-on-surface-variant hover:text-primary'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Verdicts                                                                    */
/* -------------------------------------------------------------------------- */

const TRUST_TONE: Record<Trust, string> = {
  VERIFIED: 'chip-success',
  DERIVED: 'chip-info',
  UNVERIFIED: 'chip-warning',
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
    <span className={TRUST_TONE[trust]} title={`${copy.hint} ${detail}`}>
      <span className="dot bg-current" />{copy.label}
    </span>
  )
}

const STATUS_TONE: Record<string, string> = {
  PASS: 'chip-success', FAIL: 'chip-danger', UNVERIFIABLE: 'chip',
  SUPPORTED: 'chip-success', CONTRADICTED: 'chip-danger',
  BETTER: 'chip-success', IN_LINE: 'chip-info', WORSE: 'chip-danger',
}

export function StatusPill({ status }: { status: CheckStatus | Verdict | BenchVerdict }) {
  return (
    <span className={STATUS_TONE[status] ?? 'chip'}>{status.replace('_', ' ')}</span>
  )
}

const ZONE_TONE: Record<Zone, string> = {
  SAFE: 'chip-success', GREY: 'chip-warning', DISTRESS: 'chip-danger',
}

export function ZoneTag({ zone }: { zone: Zone | null }) {
  if (!zone) return <span className="chip">WITHHELD</span>
  return <span className={ZONE_TONE[zone]}>{zone}</span>
}

/** A figure that can be traced back to the document. Renders as a button only
 *  when there is somewhere to go — a dead link would undercut the whole claim. */
export function SourceLink({
  page, onClick, children, className = '',
}: { page: number | null; onClick?: () => void; children: ReactNode; className?: string }) {
  if (page == null || !onClick) {
    return <span className={`mono ${className}`}>{children}</span>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show this figure on page ${page}`}
      className={`mono inline-flex items-center gap-xs rounded px-xs -mx-xs
        text-secondary hover:bg-secondary/10 transition-colors duration-200
        group ${className}`}
    >
      {children}
      <Icon name="my_location" className="text-[14px] opacity-0 group-hover:opacity-100
                                          transition-opacity" />
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* Data display                                                                */
/* -------------------------------------------------------------------------- */

const METER_TONE: Record<string, string> = {
  blue: 'bg-secondary', navy: 'bg-primary', good: 'bg-success',
  bad: 'bg-danger', warn: 'bg-warning', muted: 'bg-outline',
}

export function Meter({
  value, tone = 'blue', label, className = '',
}: { value: number; tone?: string; label?: string; className?: string }) {
  const width = `${Math.max(0, Math.min(100, value * 100))}%`
  return (
    <div
      role="img"
      aria-label={label}
      className={`w-full h-1.5 rounded-full bg-surface-container-high overflow-hidden ${className}`}
    >
      <div className={`h-full rounded-full transition-[width] duration-500
                       ${METER_TONE[tone] ?? METER_TONE.blue}`} style={{ width }} />
    </div>
  )
}

const STAT_TONE: Record<string, string> = {
  good: 'text-success', bad: 'text-danger',
  warn: 'text-warning', muted: 'text-on-surface-variant',
}

/** A KPI tile. Matches the design's summary row: label, mono figure, sub-line. */
export function Stat({
  label, value, hint, tone, icon, children,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'good' | 'bad' | 'warn' | 'muted'
  icon?: string
  children?: ReactNode
}) {
  return (
    <article className="card card-hover flex flex-col">
      <header className="card-header">
        <h3 className="eyebrow">{label}</h3>
        {icon && <Icon name={icon} className="text-on-surface-variant" />}
      </header>
      <div className="card-body flex flex-col gap-sm flex-1">
        <strong className={`mono text-headline-lg font-semibold leading-none
                            ${tone ? STAT_TONE[tone] : 'text-primary'}`}>
          {value}
        </strong>
        {hint && (
          <span className="text-body-sm text-on-surface-variant flex items-center gap-sm">
            {hint}
          </span>
        )}
        {children}
      </div>
    </article>
  )
}

export function Delta({ change, improved }: { change: number; improved: boolean }) {
  return (
    <span className={`inline-flex items-center gap-xs mono text-body-sm px-xs py-px rounded
      ${improved ? 'text-success bg-success/10' : 'text-danger bg-danger/10'}`}>
      <Icon name={change >= 0 ? 'arrow_upward' : 'arrow_downward'} className="text-[14px]" />
      {change >= 0 ? '+' : ''}{(change * 100).toFixed(1)}%
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                      */
/* -------------------------------------------------------------------------- */

export function Empty({
  icon, title, body, action,
}: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-sm
                    py-xl px-lg rounded-lg border border-dashed border-outline-variant
                    bg-surface-container-low/50">
      <Icon name={icon} className="text-[32px] text-on-surface-variant" />
      <b className="text-title-md text-primary">{title}</b>
      <p className="text-body-md text-on-surface-variant max-w-prose">{body}</p>
      {action && <div className="mt-sm">{action}</div>}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-sm py-xl text-on-surface-variant">
      <span className="spinner text-secondary" />
      <span className="text-body-md">{label}</span>
    </div>
  )
}

/** A panel that says why something is missing and what would fix it. Used
 *  wherever a screen depends on configuration the deployment may not have. */
export function NotConfigured({
  title, body, requirement, icon = 'link_off',
}: { title: string; body: string; requirement?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-sm
                    py-xl px-lg rounded-lg border border-dashed border-outline-variant
                    bg-surface-container-low/50">
      <Icon name={icon} className="text-[32px] text-warning" />
      <b className="text-title-md text-primary">{title}</b>
      <p className="text-body-md text-on-surface-variant max-w-prose">{body}</p>
      {requirement && (
        <div className="mt-sm w-full max-w-prose text-left rounded-md border border-hairline
                        bg-surface-container-lowest p-md">
          <span className="eyebrow">Required to enable</span>
          <div className="mt-xs text-body-sm text-on-surface-variant">{requirement}</div>
        </div>
      )}
    </div>
  )
}

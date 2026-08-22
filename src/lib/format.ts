/** Presentation helpers.
 *
 *  One rule governs this file: a missing value is never rendered as zero. The
 *  engine returns `null` when it refuses to stand behind a number, and every
 *  formatter here preserves that refusal instead of flattening it.
 */

import type { Ratios, Trust, Verdict } from '../types'

const PERCENT_RATIOS = new Set(['gross_margin', 'net_margin', 'roe'])

export const RATIO_LABELS: Record<string, string> = {
  current_ratio: 'Current ratio',
  gearing: 'Gearing',
  interest_cover: 'Interest cover',
  gross_margin: 'Gross margin',
  net_margin: 'Net margin',
  roe: 'Return on equity',
}

export const RATIO_ORDER = [
  'current_ratio', 'gearing', 'interest_cover',
  'gross_margin', 'net_margin', 'roe',
]

/** Ratios where a higher reading is the better outcome. */
export const HIGHER_IS_BETTER: Record<string, boolean> = {
  current_ratio: true, gearing: false, interest_cover: true,
  gross_margin: true, net_margin: true, roe: true,
}

export const WITHHELD = '—'

export function money(
  value: number | null | undefined,
  currency = 'MYR',
  unit?: string | null,
): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  const scaled = unit === 'thousands' ? value * 1000 : value
  const abs = Math.abs(scaled)
  const sign = scaled < 0 ? '-' : ''

  // Published statements run to hundreds of millions; compacting keeps the
  // table scannable while the exact figure stays available on the row.
  if (abs >= 1e9) return `${sign}${currency} ${(abs / 1e9).toFixed(2)}b`
  if (abs >= 1e6) return `${sign}${currency} ${(abs / 1e6).toFixed(2)}m`
  if (abs >= 1e3) return `${sign}${currency} ${(abs / 1e3).toFixed(1)}k`
  return `${sign}${currency} ${abs.toFixed(0)}`
}

export function exact(value: number | null | undefined, unit?: string | null): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  const scaled = unit === 'thousands' ? value * 1000 : value
  return new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 }).format(scaled)
}

export function ratio(key: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  if (PERCENT_RATIOS.has(key)) return `${(value * 100).toFixed(2)}%`
  if (key === 'interest_cover') return `${value.toFixed(2)}x`
  return value.toFixed(2)
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  return `${(value * 100).toFixed(digits)}%`
}

export function signedPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

export function signed(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return WITHHELD
  return new Intl.NumberFormat('en-MY', {
    maximumFractionDigits: 0, signDisplay: 'always',
  }).format(value)
}

/** Year-on-year move of one ratio, and whether it went the right way. */
export function yoy(key: string, now: Ratios, prior: Ratios) {
  const current = now?.[key]
  const before = prior?.[key]
  if (current == null || before == null || before === 0) return null
  const change = (current - before) / Math.abs(before)
  const better = HIGHER_IS_BETTER[key] ?? true
  return { change, improved: better ? change > 0 : change < 0 }
}

export function countdown(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export const TRUST_COPY: Record<Trust, { label: string; hint: string }> = {
  VERIFIED: {
    label: 'Verified',
    hint: 'Traced to a source cell and cleared by every check that covers it.',
  },
  DERIVED: {
    label: 'Derived',
    hint: 'Computed from other figures, not printed in the document.',
  },
  UNVERIFIED: {
    label: 'Unverified',
    hint: 'Implicated in a failing check, or no source cell could be found.',
  },
}

export const VERDICT_COPY: Record<Verdict, string> = {
  SUPPORTED: 'The numbers back the claim.',
  CONTRADICTED: 'The numbers contradict the claim.',
  UNVERIFIABLE: 'No verified figure can test this claim.',
}

export function keyLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

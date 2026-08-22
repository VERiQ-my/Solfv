/** The SOLFV mark.
 *
 *  Reads as an equals sign at a glance — the balance that has to hold — and
 *  resolves on closer look into a stated figure above and a check mark below.
 *  That is the product in one glyph: the number is asserted, then verified, and
 *  only the verified half is green.
 *
 *  Drawn on a 48-unit grid with 4.5-unit strokes so it stays legible at 24px in
 *  a sidebar and at 16px in a browser tab.
 */

export function LogoMark({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 48 48"
      className={`shrink-0 ${className}`} role="img" aria-label="SOLFV"
    >
      <rect width="48" height="48" rx="11" className="fill-primary" />
      {/* The asserted figure. */}
      <rect x="12" y="15" width="24" height="4.5" rx="2.25" className="fill-on-primary" />
      {/* The verification. */}
      <path
        d="M13.5 29.5 L19.5 35.5 L34.5 20.5"
        fill="none" strokeWidth="4.5"
        strokeLinecap="round" strokeLinejoin="round"
        className="stroke-tertiary-fixed-dim"
      />
    </svg>
  )
}

export function Logo({ subtitle }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-sm min-w-0">
      <LogoMark />
      <div className="min-w-0">
        <h1 className="text-title-md text-primary leading-tight">SOLFV</h1>
        {subtitle && (
          <p className="text-body-sm text-on-surface-variant truncate">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

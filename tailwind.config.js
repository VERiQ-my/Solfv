/** Tailwind configuration — the Vanguard Intelligence design system.
 *
 *  Tokens come from the design brief verbatim, but every colour resolves through
 *  a CSS variable rather than a literal hex. That indirection is what lets the
 *  dark theme exist: `[data-theme="dark"]` reassigns the variables in
 *  `styles.css` and every utility in the app follows, with no `dark:` prefix
 *  sprayed across the markup.
 *
 *  Variables hold bare RGB channels ("15 23 42") rather than `rgb(...)` strings
 *  so Tailwind's `<alpha-value>` slot keeps working — the design leans on
 *  opacity modifiers like `bg-success/10`, and those break against a hex.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: token([
        'background', 'on-background',
        'surface', 'surface-dim', 'surface-bright',
        'surface-container-lowest', 'surface-container-low', 'surface-container',
        'surface-container-high', 'surface-container-highest',
        'surface-variant', 'surface-tint',
        'on-surface', 'on-surface-variant',
        'inverse-surface', 'inverse-on-surface',
        'outline', 'outline-variant',
        'primary', 'on-primary', 'primary-container', 'on-primary-container',
        'inverse-primary',
        'primary-fixed', 'primary-fixed-dim',
        'on-primary-fixed', 'on-primary-fixed-variant',
        'secondary', 'on-secondary', 'secondary-container', 'on-secondary-container',
        'secondary-fixed', 'secondary-fixed-dim',
        'on-secondary-fixed', 'on-secondary-fixed-variant',
        'tertiary', 'on-tertiary', 'tertiary-container', 'on-tertiary-container',
        'tertiary-fixed', 'tertiary-fixed-dim',
        'on-tertiary-fixed', 'on-tertiary-fixed-variant',
        'error', 'on-error', 'error-container', 'on-error-container',
        // Semantic roles the brief names in prose but the token table omits.
        // Financial UI needs these to mean one thing everywhere.
        'success', 'on-success', 'success-container',
        'warning', 'on-warning', 'warning-container',
        'danger', 'on-danger', 'danger-container',
        'hairline',
      ]),
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        base: '4px',
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '40px',
        gutter: '24px',
        'margin-mobile': '16px',
        'container-max': '1440px',
      },
      maxWidth: {
        'container-max': '1440px',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-lg': ['48px', { lineHeight: '56px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '32px', fontWeight: '600' }],
        'title-md': ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' }],
        'label-sm': ['10px', { lineHeight: '14px', letterSpacing: '0.05em', fontWeight: '600' }],
        'mono-data': ['13px', { lineHeight: '18px', fontWeight: '500' }],
      },
      boxShadow: {
        // The brief is explicit: depth is architectural, never decorative.
        raise: '0px 4px 12px rgba(15, 23, 42, 0.05)',
        panel: '0px 1px 2px rgba(15, 23, 42, 0.04)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.2s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}

/** Map token names onto `rgb(var(--c-name) / <alpha-value>)`. */
function token(names) {
  return Object.fromEntries(
    names.map(name => [name, `rgb(var(--c-${name}) / <alpha-value>)`]),
  )
}

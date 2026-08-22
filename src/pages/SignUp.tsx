/** Sign up.
 *
 *  The confirm field is checked here rather than in `auth.tsx`, because it is
 *  the only rule that belongs to the form and not to the account — nothing
 *  downstream has two passwords to compare.
 *
 *  On success the user lands on the dashboard, except where Supabase is set to
 *  require email confirmation: then there is no session to land with, and the
 *  honest move is to say so and send them to the log-in screen.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { AuthLayout, Field } from '../components/AuthLayout'
import { Icon, Meter } from '../components/ui'
import { AuthError, MIN_PASSWORD, useAuth } from '../lib/auth'
import type { FieldErrors } from '../lib/auth'

/** Length first, then variety. Advisory only — the single hard rule is the
 *  minimum length, and the meter never blocks a submit. */
function strength(password: string): { score: number; label: string; tone: string } {
  if (!password) return { score: 0, label: '', tone: 'muted' }
  const variety =
    Number(/[a-z]/.test(password)) + Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) + Number(/[^A-Za-z0-9]/.test(password))
  const score = Math.min(1, (Math.min(password.length, 16) / 16) * 0.65 + (variety / 4) * 0.35)

  if (password.length < MIN_PASSWORD) return { score, label: 'Too short', tone: 'bad' }
  if (score < 0.55) return { score, label: 'Weak', tone: 'bad' }
  if (score < 0.78) return { score, label: 'Fair', tone: 'warn' }
  return { score, label: 'Strong', tone: 'good' }
}

export default function SignUp({
  onLogIn, theme, onTheme,
}: {
  onLogIn: () => void
  theme: 'light' | 'dark'
  onTheme: () => void
}) {
  const { signUp, busy, error, notice } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [field, setField] = useState<FieldErrors>({})

  const meter = strength(password)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setField({})

    if (confirm !== password) {
      setField({ confirm: 'The two passwords do not match.' })
      return
    }

    try {
      await signUp({ name, email, password })
    } catch (caught) {
      if (caught instanceof AuthError && caught.field) {
        setField({ [caught.field]: caught.message } as FieldErrors)
      }
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      lede="One account per analyst. Documents are never stored against it — they are processed in memory and purged on a timer."
      theme={theme}
      onTheme={onTheme}
      footer={
        <>
          Already have an account?{' '}
          <button type="button" className="btn text" onClick={onLogIn}>Log in</button>
        </>
      }
    >
      {notice && (
        <div className="alert alert-note">
          <Icon name="mark_email_read" />
          <div>
            <p>{notice}</p>
            <button type="button" className="btn text" onClick={onLogIn}>Go to log in</button>
          </div>
        </div>
      )}

      {error && !Object.keys(field).length && (
        <div className="alert alert-fail">
          <Icon name="error" />
          <div><b>Could not create that account.</b><p>{error}</p></div>
        </div>
      )}

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Full name"
          value={name}
          onChange={setName}
          error={field.name}
          autoComplete="name"
          placeholder="Nur Hakim"
          disabled={busy}
          autoFocus
        />
        <Field
          label="Work email"
          type="email"
          value={email}
          onChange={setEmail}
          error={field.email}
          autoComplete="email"
          placeholder="analyst@bank.com.my"
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={field.password}
          hint={`At least ${MIN_PASSWORD} characters.`}
          autoComplete="new-password"
          placeholder="••••••••"
          disabled={busy}
        />

        {password && (
          <div className="pw-strength">
            <Meter value={meter.score} tone={meter.tone} label={`Password strength: ${meter.label}`} />
            <small className={meter.tone === 'good' ? 'good' : meter.tone === 'bad' ? 'bad' : 'muted'}>
              {meter.label}
            </small>
          </div>
        )}

        <Field
          label="Confirm password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          error={field.confirm}
          autoComplete="new-password"
          placeholder="••••••••"
          disabled={busy}
        />

        <button className="btn primary full auth-submit" type="submit" disabled={busy}>
          {busy
            ? <><span className="spinner small" />Creating…</>
            : <><Icon name="person_add" />Create account</>}
        </button>
      </form>
    </AuthLayout>
  )
}

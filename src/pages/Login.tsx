/** Log in.
 *
 *  On success the user lands on the dashboard — App swaps the whole tree the
 *  moment `user` is set, so there is no redirect to get wrong.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { AuthLayout, Field } from '../components/AuthLayout'
import { Icon } from '../components/ui'
import { AuthError, useAuth } from '../lib/auth'
import type { FieldErrors } from '../lib/auth'

export default function Login({
  onSignUp, theme, onTheme,
}: {
  onSignUp: () => void
  theme: 'light' | 'dark'
  onTheme: () => void
}) {
  const { logIn, busy, error } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [field, setField] = useState<FieldErrors>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setField({})
    try {
      await logIn({ email, password })
    } catch (caught) {
      if (caught instanceof AuthError && caught.field) {
        setField({ [caught.field]: caught.message } as FieldErrors)
      }
    }
  }

  return (
    <AuthLayout
      title="Log in"
      lede="Pick up the queue where you left it. Sessions purge on their own timer, so anything mid-review may have already gone."
      theme={theme}
      onTheme={onTheme}
      footer={
        <>
          New here?{' '}
          <button type="button" className="btn text" onClick={onSignUp}>
            Create an account
          </button>
        </>
      }
    >
      {error && !field.password && !field.email && (
        <div className="alert alert-fail">
          <Icon name="error" />
          <div><b>Could not log you in.</b><p>{error}</p></div>
        </div>
      )}

      <form className="auth-form" onSubmit={submit} noValidate>
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          error={field.email}
          autoComplete="email"
          placeholder="analyst@bank.com.my"
          disabled={busy}
          autoFocus
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          error={field.password}
          autoComplete="current-password"
          placeholder="••••••••"
          disabled={busy}
        />

        <button className="btn primary full auth-submit" type="submit" disabled={busy}>
          {busy ? <><span className="spinner small" />Checking…</> : <><Icon name="login" />Log in</>}
        </button>
      </form>
    </AuthLayout>
  )
}

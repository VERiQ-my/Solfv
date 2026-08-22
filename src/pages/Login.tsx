/** Log in.
 *
 *  On success the user lands on the Command Center — App swaps the whole tree
 *  the moment `user` is set, so there is no redirect to get wrong.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Alert, AuthLayout, Field } from '../components/AuthLayout'
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
          <button type="button" className="btn-ghost !px-xs !py-0" onClick={onSignUp}>
            Create an account
          </button>
        </>
      }
    >
      {/* A message already sitting under a field is not repeated up here. */}
      {error && !field.password && !field.email && (
        <Alert tone="danger" icon="error" title="Could not log you in.">{error}</Alert>
      )}

      <form className="space-y-md" onSubmit={submit} noValidate>
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

        <button className="btn-primary btn-full !py-sm" type="submit" disabled={busy}>
          {busy
            ? <><span className="spinner" />Checking…</>
            : <><Icon name="login" className="text-[16px]" />Log in</>}
        </button>
      </form>
    </AuthLayout>
  )
}

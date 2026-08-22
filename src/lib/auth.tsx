/** Authentication.
 *
 *  Two backends behind one interface, chosen at boot by what is configured:
 *
 *    supabase — `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set, so
 *               accounts are real, shared across devices, and the session is
 *               a JWT Supabase refreshes for us.
 *    local    — nothing is configured, so accounts live in this browser only.
 *               Passwords are stored as a PBKDF2-SHA256 digest with a random
 *               per-account salt, never as the password.
 *
 *  The local mode exists for the same reason the demo document does: the whole
 *  system has to be runnable with no keys. It is honestly labelled as
 *  browser-only in the UI rather than dressed up as an account system.
 *
 *  Nothing here talks to the engine. The engine has no auth (see the note at
 *  the top of `backend/main.py`) — this gate is the frontend's, and calling it
 *  anything more than that would be a lie.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { ReactNode } from 'react'

export interface AuthUser {
  id: string
  email: string
  name: string
}

export type AuthMode = 'supabase' | 'local'

export interface Credentials {
  email: string
  password: string
}

export interface SignUpInput extends Credentials {
  name: string
}

interface AuthState {
  user: AuthUser | null
  /** The initial session probe has finished. Nothing renders before this. */
  ready: boolean
  busy: boolean
  error: string | null
  /** Non-error feedback — "confirm your email", mostly. */
  notice: string | null
  mode: AuthMode
  signUp: (input: SignUpInput) => Promise<void>
  logIn: (input: Credentials) => Promise<void>
  logOut: () => Promise<void>
  clearFeedback: () => void
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const AUTH_MODE: AuthMode =
  SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local'

const Ctx = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

/* --------------------------------------------------------------------------
   Validation — shared by both backends so the messages never diverge.
   -------------------------------------------------------------------------- */

/** Deliberately permissive: the only email that truly validates is one that
 *  receives a message, and a strict regex rejects addresses that work. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const MIN_PASSWORD = 8

export type AuthField = 'name' | 'email' | 'password' | 'confirm'

/** Per-field messages the forms render under the input they belong to. */
export type FieldErrors = Partial<Record<AuthField, string>>

export class AuthError extends Error {
  constructor(message: string, readonly field?: AuthField) {
    super(message)
    this.name = 'AuthError'
  }
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

function assertCredentials({ email, password }: Credentials) {
  if (!email.trim()) throw new AuthError('Enter your email address.', 'email')
  if (!EMAIL.test(email.trim())) throw new AuthError('That does not look like an email address.', 'email')
  if (!password) throw new AuthError('Enter your password.', 'password')
}

/* --------------------------------------------------------------------------
   Local backend — browser-only accounts
   -------------------------------------------------------------------------- */

const USERS_KEY = 'solfv-users'
const SESSION_KEY = 'solfv-session'

interface LocalAccount {
  id: string
  email: string
  name: string
  salt: string
  hash: string
  createdAt: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback // private mode, blocked storage, or a corrupt value
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    throw new AuthError(
      'This browser is blocking local storage, so an account cannot be kept here. ' +
      'Configure Supabase, or allow site data for this origin.',
    )
  }
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return hex(value.buffer)
}

/** PBKDF2-SHA256. Not a substitute for a server, but it does mean a glance at
 *  localStorage does not hand over the password. */
async function derive(password: string, salt: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new AuthError(
      'Password hashing needs a secure context (https or localhost). ' +
      'Open the app over localhost, or configure Supabase.',
    )
  }
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120_000, hash: 'SHA-256' },
    key, 256,
  )
  return hex(bits)
}

const localBackend = {
  current(): AuthUser | null {
    const session = readJson<{ userId?: string } | null>(SESSION_KEY, null)
    if (!session?.userId) return null
    const accounts = readJson<Record<string, LocalAccount>>(USERS_KEY, {})
    const account = Object.values(accounts).find(entry => entry.id === session.userId)
    return account ? { id: account.id, email: account.email, name: account.name } : null
  },

  async signUp({ name, email, password }: SignUpInput): Promise<AuthUser> {
    const address = normaliseEmail(email)
    const accounts = readJson<Record<string, LocalAccount>>(USERS_KEY, {})
    if (accounts[address]) {
      throw new AuthError('An account already exists for that email on this browser.', 'email')
    }

    const salt = randomHex(16)
    const account: LocalAccount = {
      id: `user-${randomHex(8)}`,
      email: address,
      name: name.trim(),
      salt,
      hash: await derive(password, salt),
      createdAt: Date.now(),
    }
    writeJson(USERS_KEY, { ...accounts, [address]: account })
    writeJson(SESSION_KEY, { userId: account.id, at: Date.now() })
    return { id: account.id, email: account.email, name: account.name }
  },

  async logIn({ email, password }: Credentials): Promise<AuthUser> {
    const address = normaliseEmail(email)
    const accounts = readJson<Record<string, LocalAccount>>(USERS_KEY, {})
    const account = accounts[address]
    // One message for both halves: naming which half was wrong tells an
    // attacker which addresses have accounts.
    const rejected = new AuthError('Email or password is incorrect.', 'password')
    if (!account) throw rejected
    if (await derive(password, account.salt) !== account.hash) throw rejected

    writeJson(SESSION_KEY, { userId: account.id, at: Date.now() })
    return { id: account.id, email: account.email, name: account.name }
  },

  async logOut(): Promise<void> {
    try { localStorage.removeItem(SESSION_KEY) } catch { /* nothing to clear */ }
  },
}

/* --------------------------------------------------------------------------
   Supabase backend
   -------------------------------------------------------------------------- */

/** Shaped by hand rather than imported, so this module carries no type
 *  dependency on a client it may never construct. */
interface SupabaseAuthUser {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null; name?: string | null } | null
}

interface SupabaseSession { user: SupabaseAuthUser }

interface SupabaseAuth {
  getSession(): Promise<{ data: { session: SupabaseSession | null }; error: { message: string } | null }>
  onAuthStateChange(
    callback: (event: string, session: SupabaseSession | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } }
  signUp(input: {
    email: string
    password: string
    options?: { data?: Record<string, unknown> }
  }): Promise<{ data: { session: SupabaseSession | null; user: SupabaseAuthUser | null }; error: { message: string } | null }>
  signInWithPassword(input: Credentials): Promise<{
    data: { session: SupabaseSession | null; user: SupabaseAuthUser | null }
    error: { message: string } | null
  }>
  signOut(): Promise<{ error: { message: string } | null }>
}

let clientPromise: Promise<SupabaseAuth> | null = null

/** Loaded on demand: an unconfigured install should not pay for the SDK. */
function supabaseAuth(): Promise<SupabaseAuth> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        const client = createClient(SUPABASE_URL as string, SUPABASE_KEY as string, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
        return client.auth as unknown as SupabaseAuth
      })
      .catch(() => {
        clientPromise = null // let a later attempt retry rather than cache the failure
        throw new AuthError('Could not load the Supabase client. Check your network and reload.')
      })
  }
  return clientPromise
}

function toUser(user: SupabaseAuthUser | null | undefined): AuthUser | null {
  if (!user) return null
  const email = user.email ?? ''
  const metadata = user.user_metadata ?? {}
  return {
    id: user.id,
    email,
    name: (metadata.full_name || metadata.name || email.split('@')[0] || 'Analyst').trim(),
  }
}

/* --------------------------------------------------------------------------
   Provider
   -------------------------------------------------------------------------- */

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const live = useRef(true)

  // Restore whatever session already exists before anything renders, so a
  // reload never flashes the login screen at a signed-in user.
  useEffect(() => {
    live.current = true
    let unsubscribe: (() => void) | undefined

    void (async () => {
      if (AUTH_MODE === 'local') {
        if (live.current) { setUser(localBackend.current()); setReady(true) }
        return
      }
      try {
        const auth = await supabaseAuth()
        const { data } = await auth.getSession()
        if (live.current) setUser(toUser(data.session?.user))
        // Supabase refreshes tokens on its own clock; follow it rather than
        // holding a copy that can go stale.
        const listener = auth.onAuthStateChange((_event, session) => {
          if (live.current) setUser(toUser(session?.user))
        })
        unsubscribe = () => listener.data.subscription.unsubscribe()
      } catch (caught) {
        if (live.current) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (live.current) setReady(true)
      }
    })()

    return () => { live.current = false; unsubscribe?.() }
  }, [])

  /** Every mutation runs through here so busy, error and notice can never
   *  disagree with each other. */
  const run = useCallback(async (action: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const message = await action()
      if (live.current && message) setNotice(message)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      if (live.current) setError(message)
      throw caught instanceof AuthError ? caught : new AuthError(message)
    } finally {
      if (live.current) setBusy(false)
    }
  }, [])

  const signUp = useCallback(async (input: SignUpInput) => {
    await run(async () => {
      if (!input.name.trim()) throw new AuthError('Enter your name.', 'name')
      assertCredentials(input)
      if (input.password.length < MIN_PASSWORD) {
        throw new AuthError(`Use at least ${MIN_PASSWORD} characters.`, 'password')
      }

      if (AUTH_MODE === 'local') {
        setUser(await localBackend.signUp(input))
        return null
      }

      const auth = await supabaseAuth()
      const { data, error: failure } = await auth.signUp({
        email: normaliseEmail(input.email),
        password: input.password,
        options: { data: { full_name: input.name.trim() } },
      })
      if (failure) throw new AuthError(failure.message)

      // With email confirmation on, sign-up returns a user but no session.
      // Say so plainly instead of dropping them on a screen that will not load.
      if (!data.session) {
        return 'Account created. Confirm the link we emailed you, then log in.'
      }
      setUser(toUser(data.session.user))
      return null
    })
  }, [run])

  const logIn = useCallback(async (input: Credentials) => {
    await run(async () => {
      assertCredentials(input)

      if (AUTH_MODE === 'local') {
        setUser(await localBackend.logIn(input))
        return null
      }

      const auth = await supabaseAuth()
      const { data, error: failure } = await auth.signInWithPassword({
        email: normaliseEmail(input.email),
        password: input.password,
      })
      if (failure) throw new AuthError(failure.message, 'password')
      setUser(toUser(data.session?.user))
      return null
    })
  }, [run])

  const logOut = useCallback(async () => {
    setBusy(true)
    try {
      if (AUTH_MODE === 'local') await localBackend.logOut()
      else await (await supabaseAuth()).signOut()
    } catch {
      // A failed sign-out must still clear the screen — leaving a signed-out
      // user looking at someone's dashboard is the worse failure.
    } finally {
      if (live.current) {
        setUser(null)
        setError(null)
        setNotice(null)
        setBusy(false)
      }
    }
  }, [])

  const clearFeedback = useCallback(() => { setError(null); setNotice(null) }, [])

  const value = useMemo<AuthState>(() => ({
    user, ready, busy, error, notice,
    mode: AUTH_MODE,
    signUp, logIn, logOut, clearFeedback,
  }), [user, ready, busy, error, notice, signUp, logIn, logOut, clearFeedback])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

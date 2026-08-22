/// <reference types="vite/client" />

/** Only the variables this app actually reads. `VITE_SUPABASE_*` are optional:
 *  production uses a private browser guest session unless Supabase is selected. */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** `guest` is the production default; `local` is only for development. */
  readonly VITE_AUTH_MODE?: 'guest' | 'local'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/// <reference types="vite/client" />

/** Only the variables this app actually reads. `VITE_SUPABASE_*` are optional:
 *  without them, auth falls back to browser-local accounts (see `lib/auth.tsx`). */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

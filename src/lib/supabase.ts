import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Keep the UI runnable before Supabase credentials are provisioned.
export const supabase = url && key ? createClient(url, key) : null

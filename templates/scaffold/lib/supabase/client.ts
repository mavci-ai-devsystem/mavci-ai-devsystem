import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/** A factory, for the same reason as the server client. */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

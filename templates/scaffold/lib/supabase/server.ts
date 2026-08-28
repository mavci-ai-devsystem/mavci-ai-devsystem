import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * A FACTORY, never a module-scope client. Enforced by
 * next.supabase_client_in_function.
 *
 * A module-scope client captures the auth context from whenever the module was
 * first evaluated and then serves it to every later request in the process. In a
 * multi-tenant app that is a cross-tenant leak, and it appears only under
 * concurrency - so it passes local testing and fails in production.
 */
export function createClient() {
  const cookieStore = cookies()
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
          catch { /* called from a Server Component; middleware refreshes the session */ }
        },
      },
    },
  )
}

/**
 * Bypasses RLS. Server-only, and never returned or passed outward.
 * next.no_service_role_client confines SUPABASE_SERVICE_ROLE_KEY to this file
 * and to app/api routes.
 */
export function createAdminClient() {
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } },
  )
}

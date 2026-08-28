import { createServerClient } from "@supabase/ssr"
export function createClient() {
  return createServerClient(u, k, {})
}

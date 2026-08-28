import { env } from "@/lib/env"
export function admin() { return env.SUPABASE_SERVICE_ROLE_KEY }

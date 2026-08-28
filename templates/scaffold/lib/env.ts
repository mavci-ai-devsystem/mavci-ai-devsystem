import { z } from 'zod'

/**
 * The only file in this project that reads process.env.
 * Enforced by next.env_centralised.
 *
 * Validating here means a missing variable fails at boot, naming itself, rather
 * than becoming `undefined` deep inside a request hours after deploy.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
})

export const env = schema.parse(process.env)

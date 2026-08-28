import Stripe from 'stripe'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/server'

// Required on every API route. Enforced by next.route_force_dynamic.
export const dynamic = 'force-dynamic'

const stripe = new Stripe(env.STRIPE_SECRET_KEY)

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('missing signature', { status: 400 })

  let event: Stripe.Event
  try {
    // Verify BEFORE trusting anything in the payload. Enforced by
    // stripe.webhook_signature. Without this, anyone who learns the URL can post
    // a fake checkout.session.completed and grant themselves a paid plan.
    event = stripe.webhooks.constructEvent(
      await request.text(), signature, env.STRIPE_WEBHOOK_SECRET,
    )
  } catch {
    return new Response('invalid signature', { status: 400 })
  }

  // Stripe retries. Record the event id first and ignore one already seen,
  // or a retried checkout.session.completed grants the plan twice.
  const db = createAdminClient()
  const { error } = await db.from('stripe_events').insert({ id: event.id, type: event.type })
  if (error) return Response.json({ received: true, duplicate: true })

  switch (event.type) {
    case 'checkout.session.completed':
      break
    default:
      break
  }

  return Response.json({ received: true })
}

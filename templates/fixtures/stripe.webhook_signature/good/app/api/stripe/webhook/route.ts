export const dynamic = 'force-dynamic'
import Stripe from 'stripe'
export async function POST(r) {
  const sig = r.headers.get('stripe-signature')
  const event = stripe.webhooks.constructEvent(await r.text(), sig, secret)
  return Response.json({ received: true })
}

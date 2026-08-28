export const dynamic = 'force-dynamic'
import Stripe from 'stripe'
export async function POST(r) { const body = await r.json(); return Response.json(body) }

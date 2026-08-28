/** @type {import('next').NextConfig} */
// Never set output: 'export' - it drops API routes, middleware and server actions,
// which on this stack means auth, Stripe webhooks and tenant resolution stop existing.
// Enforced by next.no_static_export.
export default {
  reactStrictMode: true,
}

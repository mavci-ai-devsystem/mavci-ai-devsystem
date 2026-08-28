#!/usr/bin/env node
/**
 * One-shot authoring helper: writes templates/fixtures/<check_id>/{bad,good}/.
 * Committed so the fixture set is reproducible and reviewable in one place.
 * Re-run after adding a rule; it never overwrites an existing file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FX = path.join(ROOT, 'plugins/mavci-core/templates', 'fixtures');

const KVKK_GOOD = `export default function Kvkk() {
  return (
    <main>
      <h1>KVKK Aydinlatma Metni</h1>
      <h2>Veri sorumlusunun kimligi</h2>
      <p>Ornek Yazilim A.S., Ornek Mah. Ornek Cad. No:1 Istanbul. MERSIS 0000000000000000.</p>
      <h2>Isleme amaclari</h2>
      <p>Hesap olusturma, abonelik yonetimi, faturalama ve destek talepleri.</p>
      <h2>Hukuki sebep</h2>
      <p>KVKK m.5/2-c sozlesmenin ifasi ve m.5/2-f mesru menfaat.</p>
      <h2>Aktarim</h2>
      <p>Barindirma Vercel, veritabani Supabase, odeme Stripe, e-posta Resend.</p>
      <h2>Saklama suresi</h2>
      <p>Uyelik suresince ve sona ermesinden itibaren 10 yil.</p>
      <h2>Ilgili kisinin haklari</h2>
      <p>KVKK m.11 kapsamindaki haklariniz: bilgi talep etme, duzeltme, silme.</p>
      <h2>Basvuru yontemi</h2>
      <p>KEP ornek@hs01.kep.tr veya kvkk@ornek.com adresine yazili basvuru.</p>
    </main>
  )
}
`;

const FIXTURES = {
  'secrets.no_committed_secrets': {
    bad: { 'lib/billing.ts': 'export const key = "sk_live_51AbCdEfGhIjKlMnOpQrStUv"\n' },
    good: { 'lib/billing.ts': 'import { env } from "@/lib/env"\nexport const key = env.STRIPE_SECRET_KEY\n' },
  },
  'next.supabase_client_in_function': {
    bad: { 'lib/supabase/x.ts': 'import { createServerClient } from "@supabase/ssr"\nexport const supabase = createServerClient(u, k, {})\n' },
    good: { 'lib/supabase/x.ts': 'import { createServerClient } from "@supabase/ssr"\nexport function createClient() {\n  return createServerClient(u, k, {})\n}\n' },
  },
  'next.route_force_dynamic': {
    bad: { 'app/api/thing/route.ts': 'export async function GET() { return Response.json({}) }\n' },
    good: { 'app/api/thing/route.ts': "export const dynamic = 'force-dynamic'\nexport async function GET() { return Response.json({}) }\n" },
  },
  'next.no_static_export': {
    bad: { 'next.config.mjs': "export default { output: 'export' }\n" },
    good: { 'next.config.mjs': 'export default { reactStrictMode: true }\n' },
  },
  'next.regex_no_template_literal': {
    bad: { 'lib/route-match.ts': 'const slug = "a"\nexport const re = new RegExp(`^/${slug}/(.*)$`)\n' },
    good: { 'lib/route-match.ts': 'const slug = "a"\nconst ESC = /[.*+?^${}()|[\\]\\\\]/g\nexport const re = new RegExp("^/" + slug.replace(ESC, "\\\\$&") + "/(.*)$")\n' },
  },
  'next.no_service_role_client': {
    bad: { 'components/Widget.tsx': 'const k = SUPABASE_SERVICE_ROLE_KEY\nexport default function W() { return null }\n' },
    good: { 'lib/supabase/server.ts': 'import { env } from "@/lib/env"\nexport function admin() { return env.SUPABASE_SERVICE_ROLE_KEY }\n' },
  },
  'next.env_centralised': {
    bad: { 'components/Widget.tsx': 'const url = process.env.NEXT_PUBLIC_SUPABASE_URL\nexport default function W() { return null }\n' },
    good: { 'components/Widget.tsx': 'import { env } from "@/lib/env"\nconst url = env.NEXT_PUBLIC_SUPABASE_URL\nexport default function W() { return null }\n' },
  },
  'stripe.webhook_signature': {
    bad: { 'app/api/stripe/webhook/route.ts': "export const dynamic = 'force-dynamic'\nimport Stripe from 'stripe'\nexport async function POST(r) { const body = await r.json(); return Response.json(body) }\n" },
    good: { 'app/api/stripe/webhook/route.ts': "export const dynamic = 'force-dynamic'\nimport Stripe from 'stripe'\nexport async function POST(r) {\n  const sig = r.headers.get('stripe-signature')\n  const event = stripe.webhooks.constructEvent(await r.text(), sig, secret)\n  return Response.json({ received: true })\n}\n" },
  },
  'supabase.rls_enabled': {
    bad: { 'supabase/migrations/0001_x.sql': 'create table widgets (id uuid primary key, org_id uuid not null);\n' },
    good: { 'supabase/migrations/0001_x.sql': 'create table widgets (id uuid primary key, org_id uuid not null);\nalter table widgets enable row level security;\ncreate policy widgets_tenant on widgets for all using (org_id = auth.uid());\n' },
  },
  'legal.pages_present': {
    bad: { 'app/(legal)/kvkk/page.tsx': 'export default function K() { return <p>TODO</p> }\n' },
    good: { 'app/(legal)/kvkk/page.tsx': KVKK_GOOD },
  },
  'legal.kvkk_structure': {
    bad: { 'app/(legal)/kvkk/page.tsx': `export default function K() {
  return (
    <main>
      <h1>KVKK Aydinlatma Metni</h1>
      <h2>Veri sorumlusunun kimligi</h2>
      <p>Ornek Yazilim A.S., Ornek Mah. Ornek Cad. No:1 Istanbul, MERSIS 0000000000000000.</p>
      <p>Bu metin yalnizca veri sorumlusunu tanitmaktadir ve diger zorunlu bolumleri icermemektedir.
      Amaclar, hukuki sebep, aktarim, saklama suresi, haklar ve basvuru yontemi bilerek eksik birakilmistir
      ki yapisal kontrol bu durumu yakalayabilsin. Bu paragraf dosyanin dort yuz karakterlik alt sinirini
      asmasi icin yeterince uzun tutulmustur, boylece legal.pages_present kontrolu gecerken
      legal.kvkk_structure kontrolu basarisiz olur ve fixture tam olarak tek bir kurali test eder.</p>
    </main>
  )
}
` },
    good: { 'app/(legal)/kvkk/page.tsx': KVKK_GOOD },
  },
  'state.schema_valid': {
    bad: {}, good: {},   // exercised directly by check-fixtures via a corrupted control file
  },
};

let created = 0;
for (const [checkId, variants] of Object.entries(FIXTURES)) {
  for (const variant of ['bad', 'good']) {
    const dir = path.join(FX, checkId, variant);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(variants[variant])) {
      const dest = path.join(dir, rel);
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf8');
      created++;
    }
  }
}
console.log(`fixtures: ${created} file(s) created across ${Object.keys(FIXTURES).length} checks`);

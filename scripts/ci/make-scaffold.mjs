#!/usr/bin/env node
/**
 * One-shot authoring helper for templates/scaffold/.
 * The scaffold is the Layer-3 answer (ARCHITECTURE 6.8): a new project starts
 * green, so the first red is always a real regression. selftest.yml asserts the
 * scaffold passes its own checker - a scaffold that cannot is a build failure.
 *
 * Never overwrites an existing file, so hand-edits to the scaffold survive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'plugins/mavci-core/templates', 'scaffold');

const legalPage = (title, body) => `export const metadata = { title: '${title}' }

export default function Page() {
  return (
    <main className="prose mx-auto p-8">
      <h1>${title}</h1>
      {/* REVIEW REQUIRED - draft text. A lawyer must review this before launch.
          This marker is a warning during development and a blocker at /mavci-core:release. */}
${body}
    </main>
  )
}
`;

const FILES = {
  'package.json': JSON.stringify({
    name: '__PROJECT_ID__', version: '0.1.0', private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint', typecheck: 'tsc --noEmit' },
    dependencies: { next: '^14.2.0', react: '^18.3.1', 'react-dom': '^18.3.1', '@supabase/ssr': '^0.5.0', '@supabase/supabase-js': '^2.45.0', stripe: '^16.0.0', resend: '^4.0.0', zod: '^3.23.0' },
    devDependencies: { typescript: '^5.5.0', '@types/node': '^20.14.0', '@types/react': '^18.3.0' },
  }, null, 2) + '\n',

  'next.config.mjs': `/** @type {import('next').NextConfig} */
// Never set output: 'export' - it drops API routes, middleware and server actions,
// which on this stack means auth, Stripe webhooks and tenant resolution stop existing.
// Enforced by next.no_static_export.
export default {
  reactStrictMode: true,
}
`,

  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2022', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true,
      skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true,
      module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true,
      isolatedModules: true, jsx: 'preserve', incremental: true,
      plugins: [{ name: 'next' }], paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2) + '\n',

  '.gitignore': 'node_modules/\n.next/\nout/\n.env*\n!.env.example\n.vercel\n*.log\n.DS_Store\n',
  '.gitattributes': '* text=auto eol=lf\n',
  '.env.example': `# Copy to .env.local. Never commit a real value - secrets.no_committed_secrets is critical.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
RESEND_API_KEY=
ANTHROPIC_API_KEY=
`,

  // The ONLY file that reads process.env. Enforced by next.env_centralised.
  'lib/env.ts': `import { z } from 'zod'

/**
 * The only file in this project that reads process.env.
 * Enforced by next.env_centralised.
 *
 * Validating here means a missing variable fails at boot, naming itself, rather
 * than becoming \`undefined\` deep inside a request hours after deploy.
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
`,

  'lib/supabase/server.ts': `import { createServerClient } from '@supabase/ssr'
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
`,

  'lib/supabase/client.ts': `import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'

/** A factory, for the same reason as the server client. */
export function createClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
`,

  'app/api/stripe/webhook/route.ts': `import Stripe from 'stripe'
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
`,

  'app/api/health/route.ts': `export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ ok: true })
}
`,

  'middleware.ts': `import { NextResponse, type NextRequest } from 'next/server'

/**
 * Tenant resolution and session refresh.
 *
 * Note the absence of a RegExp built from a template literal: an interpolated
 * slug containing a dot becomes a wildcard, and one tenant's rule starts
 * matching another tenant's paths. Enforced by next.regex_no_template_literal.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/api/')) return NextResponse.next()
  return NextResponse.next({ request })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
`,

  'app/layout.tsx': `export const metadata = {
  title: '__DISPLAY_NAME__',
  description: '__DISPLAY_NAME__',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        {children}
        <footer>
          <a href="/privacy">Gizlilik</a>{' | '}
          <a href="/terms">Kullanim Sartlari</a>{' | '}
          <a href="/kvkk">KVKK</a>{' | '}
          <a href="/cookies">Cerezler</a>{' | '}
          <a href="/contact">Iletisim</a>
        </footer>
      </body>
    </html>
  )
}
`,

  'app/page.tsx': `export const metadata = { title: '__DISPLAY_NAME__' }

export default function Home() {
  return <main><h1>__DISPLAY_NAME__</h1></main>
}
`,

  'app/sitemap.ts': `import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = '__SITE_URL__'
  const routes = ['', '/privacy', '/terms', '/kvkk', '/cookies', '/contact']
  return routes.map((r) => ({ url: base + r, lastModified: new Date() }))
}
`,

  'app/robots.ts': `import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: '__SITE_URL__/sitemap.xml',
  }
}
`,

  'supabase/migrations/00000000000000_init.sql': `-- Every table enables RLS in the SAME migration that creates it.
-- A follow-up migration is a window, and windows get shipped.
-- Enforced by supabase.rls_enabled.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table orgs enable row level security;

create table members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  unique (org_id, user_id)
);
alter table members enable row level security;

create policy members_self on members
  for select using (user_id = auth.uid());

create policy orgs_tenant_isolation on orgs
  for all using (
    id in (select org_id from members where user_id = auth.uid())
  );

-- Webhook idempotency: Stripe retries, and a retried
-- checkout.session.completed must not grant the plan twice.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
`,
};

const LEGAL = {
  'app/(legal)/privacy/page.tsx': legalPage('Gizlilik Politikasi', `      <h2>Topladigimiz veriler</h2>
      <p>Hesap bilgileri (ad, e-posta), abonelik ve fatura kayitlari, uygulama
      kullanim kayitlari ve destek yazismalari. Odeme karti bilgileri tarafimizca
      saklanmaz; odeme islemleri Stripe uzerinden yurutulur.</p>
      <h2>Kullanim amaci</h2>
      <p>Hizmetin sunulmasi, abonelik yonetimi, guvenlik ve kotuye kullanimin
      onlenmesi, yasal yukumluluklerin yerine getirilmesi.</p>
      <h2>Ucuncu taraflar</h2>
      <p>Barindirma icin Vercel, veritabani ve kimlik dogrulama icin Supabase,
      odeme icin Stripe, e-posta icin Resend hizmetlerinden yararlanilmaktadir.</p>
      <h2>Haklariniz</h2>
      <p>KVKK ve GDPR kapsaminda verilerinize erisme, duzeltme, silme ve isleme
      faaliyetine itiraz etme hakkina sahipsiniz. Talepleriniz icin iletisim
      sayfamizdaki adresleri kullanabilirsiniz.</p>`),

  'app/(legal)/terms/page.tsx': legalPage('Kullanim Sartlari', `      <h2>Hizmetin kapsami</h2>
      <p>Bu sozlesme, __DISPLAY_NAME__ hizmetinin kullanimina iliskin sartlari
      duzenler. Hizmeti kullanarak bu sartlari kabul etmis sayilirsiniz.</p>
      <h2>Hesap ve sorumluluk</h2>
      <p>Hesap guvenliginden kullanici sorumludur. Hesap bilgilerinin ucuncu
      kisilerle paylasilmasi durumunda dogacak zararlardan kullanici sorumludur.</p>
      <h2>Abonelik ve odeme</h2>
      <p>Abonelikler donemsel olarak yenilenir. Iptal, mevcut donem sonunda
      gecerli olur. Cayma hakki ve iade kosullari yurulukteki mevzuata tabidir.</p>
      <h2>Fesih</h2>
      <p>Sartlarin ihlali halinde hesap askiya alinabilir veya kapatilabilir.
      Kullanici diledigi zaman hesabini kapatabilir.</p>
      <h2>Uygulanacak hukuk</h2>
      <p>Bu sozlesmeye Turkiye Cumhuriyeti hukuku uygulanir.</p>`),

  'app/(legal)/cookies/page.tsx': legalPage('Cerez Politikasi', `      <h2>Cerez nedir</h2>
      <p>Cerezler, ziyaret ettiginiz siteler tarafindan cihaziniza kaydedilen
      kucuk metin dosyalaridir.</p>
      <h2>Kullandigimiz cerezler</h2>
      <p>Zorunlu cerezler: oturum yonetimi ve guvenlik icin gereklidir, devre
      disi birakilamaz. Analitik ve pazarlama cerezleri yalnizca acik rizaniz
      ile calistirilir.</p>
      <h2>Yonetimi</h2>
      <p>Tarayici ayarlarinizdan cerezleri silebilir veya engelleyebilirsiniz.
      Zorunlu cerezlerin engellenmesi hizmetin calismasini etkileyebilir.</p>
      <h2>Ucuncu taraf cerezleri</h2>
      <p>Reklam veya analitik saglayicilar kendi cerezlerini kullanabilir. Bu
      cerezler yalnizca riza verildikten sonra yuklenir.</p>`),

  // All seven KVKK sections. Enforced by legal.kvkk_structure.
  'app/(legal)/kvkk/page.tsx': legalPage('KVKK Aydinlatma Metni', `      <h2>Veri sorumlusunun kimligi</h2>
      <p>__LEGAL_NAME__, __ADDRESS__. MERSIS: __MERSIS__.</p>
      <h2>Isleme amaclari</h2>
      <p>Hesap olusturma ve yonetimi, abonelik ve faturalama, destek taleplerinin
      karsilanmasi, guvenlik ve kotuye kullanimin onlenmesi, yasal
      yukumluluklerin yerine getirilmesi.</p>
      <h2>Hukuki sebep</h2>
      <p>KVKK m.5/2-c uyarinca sozlesmenin kurulmasi ve ifasi, m.5/2-c uyarinca
      hukuki yukumlulugun yerine getirilmesi ve m.5/2-f uyarinca mesru menfaat.</p>
      <h2>Aktarim</h2>
      <p>Kisisel verileriniz, hizmetin sunulabilmesi amaciyla yurt disinda yerlesik
      su hizmet saglayicilara aktarilmaktadir: barindirma icin Vercel, veritabani
      ve kimlik dogrulama icin Supabase, odeme icin Stripe, e-posta gonderimi icin
      Resend.</p>
      <h2>Saklama suresi</h2>
      <p>Veriler, uyelik suresince ve uyeligin sona ermesinden itibaren ilgili
      mevzuatta ongorulen zamanasimi sureleri boyunca saklanir.</p>
      <h2>Ilgili kisinin haklari</h2>
      <p>KVKK m.11 uyarinca: verilerinizin islenip islenmedigini ogrenme, bilgi
      talep etme, isleme amacini ogrenme, duzeltilmesini veya silinmesini isteme,
      aktarildigi ucuncu kisileri bilme ve zararin giderilmesini talep etme
      haklarina sahipsiniz.</p>
      <h2>Basvuru yontemi</h2>
      <p>Taleplerinizi __KEP__ adresine KEP uzerinden veya __EMAIL__ adresine
      e-posta ile iletebilirsiniz. Basvurunuz en gec otuz gun icinde
      sonuclandirilir.</p>`),

  'app/contact/page.tsx': `export const metadata = { title: 'Iletisim' }

export default function Contact() {
  return (
    <main className="prose mx-auto p-8">
      <h1>Iletisim</h1>
      <h2>Sirket bilgileri</h2>
      <p>Unvan: __LEGAL_NAME__</p>
      <p>Adres: __ADDRESS__</p>
      <p>E-posta: __EMAIL__</p>
      <p>MERSIS: __MERSIS__</p>
      <p>KEP: __KEP__</p>
      <h2>Destek</h2>
      <p>Destek talepleriniz icin yukaridaki e-posta adresini kullanabilirsiniz.
      Talepler mesai gunlerinde en gec iki is gunu icinde yanitlanir. KVKK
      kapsamindaki basvurular icin KVKK sayfamizda belirtilen yontemleri
      kullaniniz.</p>
    </main>
  )
}
`,
};

let created = 0;
for (const [rel, content] of Object.entries({ ...FILES, ...LEGAL })) {
  const dest = path.join(OUT, rel);
  if (fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
  created++;
}
console.log(`scaffold: ${created} file(s) written to templates/scaffold/`);

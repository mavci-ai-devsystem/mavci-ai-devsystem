/**
 * Mavci Core - the Phase 1 rule set. 12 checks.
 *
 * Every rule is a plain object with a `run(ctx)` returning findings. Adding a
 * rule is one entry plus a fixture pair; nothing else changes. That is the
 * property that makes the self-improvement loop cheap (ARCHITECTURE section 10).
 *
 * Each rule declares `packs`, and only runs when the project's manifest lists
 * one of them - except `always: true` rules, which run everywhere.
 *
 * Finding shape: { check_id, severity, path, line, evidence, remedy }
 * `path` null means the finding is about the repository as a whole.
 */

import path from 'node:path';
import { blankSource, blankComments, depthMap, matchAll } from '../lib/jsscan.mjs';
import { lineOf } from '../lib/fsx.mjs';

const isCode = (p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
const under = (p, dir) => p === dir || p.startsWith(dir + '/');
const inAny = (p, dirs) => dirs.some((d) => under(p, d));

/** app/api/**\/route.ts - the App Router handler convention. */
const isApiRoute = (p) => /^app\/api\/.*\/route\.(ts|tsx|js|jsx)$/.test(p);

/* ==================================================================== 1 */

const noCommittedSecrets = {
  id: 'secrets.no_committed_secrets',
  severity: 'critical',
  always: true,
  description: 'No API key, token or secret value may be committed to the repository.',
  remedy: 'Remove the value, rotate the key at the provider, and read it through lib/env.ts instead.',
  run(ctx) {
    const out = [];

    // .env* files are expected to hold secrets. What matters is that git ignores them.
    const envFiles = ctx.files.filter((p) => path.basename(p) === '.env' || path.basename(p).startsWith('.env.'));
    if (envFiles.length) {
      const gitignore = ctx.readOrNull('.gitignore') ?? '';
      const covered = /^\s*\.env\*?/m.test(gitignore) || /^\s*\*\.env/m.test(gitignore);
      if (!covered) {
        out.push({
          check_id: this.id, severity: 'critical', path: '.gitignore', line: null,
          evidence: `${envFiles.length} env file(s) present (${envFiles.slice(0, 3).join(', ')}) but .gitignore does not ignore .env*`,
          remedy: 'Add `.env*` to .gitignore, then confirm the files are untracked with `git rm --cached`.',
        });
      }
    }

    for (const rel of ctx.files) {
      const base = path.basename(rel);
      if (base === '.env' || base.startsWith('.env.')) continue;      // ignored above
      if (base === 'package-lock.json' || base === 'pnpm-lock.yaml') continue;
      if (under(rel, 'templates/fixtures')) continue;                  // fixtures carry fake keys on purpose
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      // scanRepoText omits the entropy class: lockfile digests and data URIs
      // are high-entropy and are not secrets.
      for (const f of ctx.redactor.scanRepoText(text)) {
        out.push({
          check_id: this.id, severity: 'critical', path: rel, line: null,
          evidence: `a ${f.class === 'env_value' ? `value of ${f.label}` : `${f.label} token`} appears in this file`,
          remedy: this.remedy,
        });
        break; // one finding per file is enough; do not enumerate occurrences of a secret
      }
    }
    return out;
  },
};

/* ==================================================================== 2 */

const supabaseClientInFunction = {
  id: 'next.supabase_client_in_function',
  severity: 'blocker',
  packs: ['nextjs-app-router', 'supabase-multitenant-rls'],
  description: 'A Supabase client must be created inside a function, never at module scope.',
  remedy: 'Wrap the call in an exported factory: `export function createClient() { return createServerClient(...) }`. '
    + 'A module-scope client is shared across requests, so one tenant\'s session can serve another tenant\'s data.',
  run(ctx) {
    const out = [];
    const CREATORS = /\b(createServerClient|createBrowserClient|createClient|createRouteHandlerClient|createServerComponentClient)\s*\(/;
    for (const rel of ctx.files) {
      if (!isCode(rel)) continue;
      if (!inAny(rel, ['app', 'lib', 'components', 'src'])) continue;
      const text = ctx.readOrNull(rel);
      if (!text || !/supabase/i.test(text)) continue;
      const blanked = blankSource(text);
      const depths = depthMap(blanked);
      for (const m of matchAll(blanked, CREATORS)) {
        if (depths[m.index] !== 0) continue;             // inside a function: correct
        const before = blanked.slice(Math.max(0, m.index - 120), m.index);
        // A DECLARATION named createClient sits at depth 0 and is not a call at all.
        // `export function createClient() { ... }` is the correct factory pattern and
        // was the first false positive the fixture harness caught.
        if (/\b(?:async\s+)?function\s+$/.test(before)) continue;
        if (/\b(?:const|let|var)\s+\w*\s*$/.test(before) && /^\w+\s*\(\s*\)/.test(blanked.slice(m.index))) continue;
        // `const createClient = () => createServerClient(...)` is a factory too.
        if (/=>\s*$/.test(before) || /\breturn\s*$/.test(before)) continue;
        out.push({
          check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, m.index),
          evidence: `${m.match.replace(/\s*\($/, '')} called at module scope`,
          remedy: this.remedy,
        });
      }
    }
    return out;
  },
};

/* ==================================================================== 3 */

const routeForceDynamic = {
  id: 'next.route_force_dynamic',
  severity: 'blocker',
  packs: ['nextjs-app-router'],
  description: 'Every App Router API route must export `const dynamic = "force-dynamic"`.',
  remedy: 'Add `export const dynamic = \'force-dynamic\'` at the top of the route file. '
    + 'Without it Next.js may statically evaluate the handler at build time, which silently '
    + 'serves stale or cross-tenant data.',
  run(ctx) {
    const out = [];
    for (const rel of ctx.files) {
      if (!isApiRoute(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      const blanked = blankSource(text);
      if (/export\s+const\s+dynamic\s*=/.test(blanked)) {
        // Present, but is it the right value? The string body is blanked, so read the original.
        if (!/export\s+const\s+dynamic\s*=\s*['"`]force-dynamic['"`]/.test(text)) {
          const idx = text.search(/export\s+const\s+dynamic\s*=/);
          out.push({
            check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, Math.max(0, idx)),
            evidence: '`dynamic` is exported but is not "force-dynamic"',
            remedy: this.remedy,
          });
        }
        continue;
      }
      out.push({
        check_id: this.id, severity: this.severity, path: rel, line: 1,
        evidence: 'no `export const dynamic` found in this API route',
        remedy: this.remedy,
      });
    }
    return out;
  },
};

/* ==================================================================== 4 */

const noStaticExport = {
  id: 'next.no_static_export',
  severity: 'blocker',
  packs: ['nextjs-app-router'],
  description: 'next.config must not set `output: "export"`.',
  remedy: 'Remove `output: "export"`. A static export drops API routes, middleware and server '
    + 'actions, so auth and Stripe webhooks stop working at deploy time rather than at build time.',
  run(ctx) {
    const out = [];
    for (const rel of ctx.files) {
      if (!/^next\.config\.(js|mjs|ts|cjs)$/.test(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      // blankComments, NOT blankSource. A comment reading "never set
      // output: 'export'" is documentation, not configuration - the scaffold's
      // own next.config.mjs carries exactly that comment. But this rule has to
      // read the string literal's contents, and blankSource would blank those
      // too, silently switching the rule off. The fixture harness caught both
      // directions, one after the other.
      const idx = blankComments(text).search(/output\s*:\s*['"`]export['"`]/);
      if (idx !== -1) {
        out.push({
          check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, idx),
          evidence: 'next.config sets output: "export"',
          remedy: this.remedy,
        });
      }
    }
    return out;
  },
};

/* ==================================================================== 5 */

const regexNoTemplateLiteral = {
  id: 'next.regex_no_template_literal',
  severity: 'blocker',
  packs: ['nextjs-app-router'],
  description: 'A regular expression must not be assembled from a template literal.',
  remedy: 'Build the pattern from a plain string constant, or escape the interpolated value. '
    + 'A template literal in a RegExp lets an interpolated value inject pattern syntax, and it '
    + 'silently changes meaning when the value contains a dot, slash or brace.',
  run(ctx) {
    const out = [];
    for (const rel of ctx.files) {
      if (!isCode(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null || !text.includes('RegExp')) continue;
      // Read the ORIGINAL here: the thing we are looking for is a backtick, which
      // blankSource would have stripped.
      for (const m of matchAll(text, /new\s+RegExp\s*\(\s*`/)) {
        const tail = text.slice(m.index, m.index + 400);
        if (!tail.includes('${')) continue;            // a backtick with no interpolation is harmless
        out.push({
          check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, m.index),
          evidence: 'new RegExp() built from an interpolated template literal',
          remedy: this.remedy,
        });
      }
    }
    return out;
  },
};

/* ==================================================================== 6 */

const noServiceRoleClient = {
  id: 'next.no_service_role_client',
  severity: 'blocker',
  packs: ['supabase-multitenant-rls'],
  description: 'The Supabase service-role key may only be referenced in server-only modules.',
  remedy: 'Move the reference into lib/supabase/server.ts or an app/api route. The service-role '
    + 'key bypasses RLS entirely; reaching a client bundle it exposes every tenant\'s data.',
  run(ctx) {
    const out = [];
    const ALLOWED = (p) => /^lib\/supabase\/server/.test(p) || /^src\/lib\/supabase\/server/.test(p)
      || isApiRoute(p) || /^lib\/env\.ts$/.test(p) || /^supabase\//.test(p);
    for (const rel of ctx.files) {
      if (!isCode(rel) || ALLOWED(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      const idx = text.indexOf('SUPABASE_SERVICE_ROLE_KEY');
      if (idx === -1) continue;
      out.push({
        check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, idx),
        evidence: 'SUPABASE_SERVICE_ROLE_KEY referenced outside a server-only module',
        remedy: this.remedy,
      });
    }
    return out;
  },
};

/* ==================================================================== 7 */

const envCentralised = {
  id: 'next.env_centralised',
  severity: 'blocker',
  packs: ['nextjs-app-router'],
  description: 'process.env is read in lib/env.ts only.',
  remedy: 'Export a validated value from lib/env.ts and import it. Scattered process.env reads '
    + 'mean a missing variable surfaces as undefined at runtime instead of failing at boot.',
  run(ctx) {
    const out = [];
    const ALLOWED = (p) => /^(src\/)?lib\/env\.ts$/.test(p)
      || /^next\.config\./.test(p) || /\.config\.(js|mjs|ts|cjs)$/.test(p)
      || /^scripts\//.test(p) || /^middleware\.ts$/.test(p);
    for (const rel of ctx.files) {
      if (!isCode(rel) || ALLOWED(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      const blanked = blankSource(text);
      const m = matchAll(blanked, /\bprocess\.env\b/)[0];
      if (!m) continue;
      out.push({
        check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, m.index),
        evidence: 'process.env read outside lib/env.ts',
        remedy: this.remedy,
      });
    }
    return out;
  },
};

/* ==================================================================== 8 */

const stripeWebhookSignature = {
  id: 'stripe.webhook_signature',
  severity: 'blocker',
  packs: ['nextjs-app-router', 'stripe-billing'],
  description: 'A Stripe webhook route must verify the signature before trusting the payload.',
  remedy: 'Call `stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET)`. '
    + 'Without it anyone who learns the URL can post a fake `checkout.session.completed` '
    + 'and grant themselves a paid plan.',
  run(ctx) {
    const out = [];
    for (const rel of ctx.files) {
      if (!isApiRoute(rel)) continue;
      if (!/stripe/i.test(rel) && !/webhook/i.test(rel)) continue;
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      if (!/stripe/i.test(text)) continue;
      if (/constructEvent\s*\(/.test(blankSource(text))) continue;
      out.push({
        check_id: this.id, severity: this.severity, path: rel, line: 1,
        evidence: 'Stripe webhook route does not call constructEvent()',
        remedy: this.remedy,
      });
    }
    return out;
  },
};

/* ==================================================================== 9 */

const rlsEnabled = {
  id: 'supabase.rls_enabled',
  severity: 'blocker',
  packs: ['supabase-multitenant-rls'],
  description: 'Every table created in a migration must have row level security enabled.',
  remedy: 'Add `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` in the same migration. '
    + 'Without RLS every authenticated user can read every tenant\'s rows.',
  run(ctx) {
    const migrations = ctx.files.filter((p) => /^supabase\/migrations\/.*\.sql$/.test(p));
    if (!migrations.length) return [];

    // RLS may be enabled in a later migration than the CREATE, so collect across all of them.
    const enabled = new Set();
    const created = [];
    for (const rel of migrations) {
      const text = ctx.readOrNull(rel);
      if (text === null) continue;
      const sql = text.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      for (const m of matchAll(sql, /\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i)) {
        const before = sql.slice(Math.max(0, m.index - 200), m.index);
        const t = before.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?(?:public\.)?["']?(\w+)["']?[\s\S]*$/i);
        if (t) enabled.add(t[1].toLowerCase());
      }
      for (const m of matchAll(sql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(?:public\.)?["']?(\w+)/i)) {
        created.push({ name: m.groups[0].toLowerCase(), path: rel, line: lineOf(text, m.index) });
      }
    }

    const seen = new Set();
    return created
      .filter((c) => !enabled.has(c.name))
      .filter((c) => (seen.has(c.name) ? false : seen.add(c.name)))
      .map((c) => ({
        check_id: this.id, severity: this.severity, path: c.path, line: c.line,
        evidence: `table "${c.name}" is created but never has ROW LEVEL SECURITY enabled`,
        remedy: this.remedy,
      }));
  },
};

/* =================================================================== 10 */

const PLACEHOLDER_RE = /\b(lorem ipsum|TODO|FIXME|PLACEHOLDER|XXXX|BURAYA YAZ{1,2}IN|DOLDURUN)\b/i;
const REVIEW_MARKER = /REVIEW REQUIRED/i;

/** Locate `app/**\/<slug>/page.tsx`, tolerating route groups like app/(legal)/privacy. */
function findPage(files, slug) {
  const re = new RegExp(`^(?:src/)?app/(?:\\([^/]+\\)/)*${slug}/page\\.(tsx|ts|jsx|js|mdx)$`);
  return files.find((p) => re.test(p)) ?? null;
}

const legalPagesPresent = {
  id: 'legal.pages_present',
  severity: 'blocker',
  packs: ['legal-tr-kvkk'],
  description: 'Every page named in compliance.required_pages exists and carries real content.',
  remedy: 'Create the page under app/(legal)/<slug>/page.tsx with the actual text. '
    + 'An empty or placeholder legal page is worse than none: it is a public claim that is untrue.',
  run(ctx) {
    const out = [];
    const required = ctx.manifest?.compliance?.required_pages ?? [];
    for (const slug of required) {
      const rel = findPage(ctx.files, slug);
      if (!rel) {
        out.push({
          check_id: this.id, severity: this.severity, path: `app/(legal)/${slug}/page.tsx`, line: null,
          evidence: `required page "${slug}" does not exist`,
          remedy: this.remedy,
        });
        continue;
      }
      const text = ctx.readOrNull(rel) ?? '';
      if (text.length < 400) {
        out.push({
          check_id: this.id, severity: this.severity, path: rel, line: 1,
          evidence: `"${slug}" page is only ${text.length} characters - too short to be real content`,
          remedy: this.remedy,
        });
        continue;
      }
      const ph = text.match(PLACEHOLDER_RE);
      if (ph) {
        out.push({
          check_id: this.id, severity: this.severity, path: rel, line: lineOf(text, text.search(PLACEHOLDER_RE)),
          evidence: `"${slug}" page still contains placeholder text ("${ph[0]}")`,
          remedy: this.remedy,
        });
        continue;
      }
      // A scaffolded draft awaiting legal review.
      //
      // This is a WARNING at standard tier, not a blocker, and the reasoning is
      // worth stating: blocking every build turn on "a lawyer has not read this
      // yet" is the wrong gate in the wrong place. The scaffold ships real draft
      // text, so a new project is green from commit one and the first red is a
      // real regression. Unreviewed legal text is a RELEASE gate - /mavci-core:release
      // treats this warning as a blocker - and `regulated` projects promote it
      // here too, because there the review must precede the work, not the ship.
      if (REVIEW_MARKER.test(text)) {
        const regulated = ctx.manifest?.risk_tier === 'regulated';
        out.push({
          check_id: this.id, severity: regulated ? 'blocker' : 'warning', path: rel,
          line: lineOf(text, text.search(REVIEW_MARKER)),
          evidence: `"${slug}" page is still marked REVIEW REQUIRED - no lawyer has reviewed this text`,
          remedy: 'Have the text reviewed, then delete the REVIEW REQUIRED marker. '
            + 'This blocks /mavci-core:release until it is done.',
        });
      }
    }
    return out;
  },
};

/* =================================================================== 11 */

/**
 * Structural only, and named so. This verifies that the seven disclosure
 * sections KVKK Art. 10 expects are present. It CANNOT and DOES NOT verify
 * legal sufficiency - that needs a lawyer, and a green tick here is not advice.
 */
const KVKK_SECTIONS = [
  { key: 'veri_sorumlusu', tr: /veri sorumlusu/i, en: /data controller/i, label: 'data controller identity' },
  { key: 'amac', tr: /ama[çc]/i, en: /purpose/i, label: 'purposes of processing' },
  { key: 'hukuki_sebep', tr: /hukuki sebep/i, en: /legal basis/i, label: 'legal basis' },
  { key: 'aktarim', tr: /aktar[ıi]/i, en: /transfer/i, label: 'transfers to third parties' },
  { key: 'saklama', tr: /saklama|muhafaza/i, en: /retention/i, label: 'retention period' },
  { key: 'haklar', tr: /haklar|11\. madde|madde 11/i, en: /your rights|data subject rights/i, label: 'data subject rights' },
  { key: 'iletisim', tr: /ileti[şs]im|ba[şs]vuru/i, en: /contact|how to apply/i, label: 'contact and application route' },
];

const kvkkStructure = {
  id: 'legal.kvkk_structure',
  severity: 'blocker',
  packs: ['legal-tr-kvkk'],
  description: 'The KVKK page contains all seven required disclosure sections. '
    + 'STRUCTURAL CHECK ONLY - it does not and cannot assess legal sufficiency.',
  remedy: 'Add the missing section to the KVKK aydinlatma metni. This check verifies presence, '
    + 'not adequacy: have the final text reviewed by a lawyer.',
  run(ctx) {
    const required = ctx.manifest?.compliance?.required_pages ?? [];
    if (!required.includes('kvkk')) return [];
    const rel = findPage(ctx.files, 'kvkk');
    if (!rel) return [];                       // legal.pages_present already reports the absence
    const text = ctx.readOrNull(rel) ?? '';
    const missing = KVKK_SECTIONS.filter((s) => !s.tr.test(text) && !s.en.test(text));
    if (!missing.length) return [];
    return [{
      check_id: this.id, severity: this.severity, path: rel, line: 1,
      evidence: `KVKK page is missing ${missing.length} of 7 required sections: ${missing.map((m) => m.label).join(', ')}`,
      remedy: this.remedy,
    }];
  },
};

/* =================================================================== 12 */

const stateSchemaValid = {
  id: 'state.schema_valid',
  severity: 'blocker',
  always: true,
  description: 'Every .mavci state file matches its schema and the control-plane seal is intact.',
  remedy: 'Run `state.mjs --validate` for the full list. If you edited a control file by hand '
    + 'on purpose, run `state.mjs --reseal`.',
  run(ctx) {
    const errors = ctx.validateState();
    return errors.map((e) => ({
      check_id: this.id, severity: this.severity,
      path: e.path ?? '.mavci/control', line: null,
      evidence: e.message ?? String(e),
      remedy: this.remedy,
    }));
  },
};

/* ------------------------------------------------------------------ export */

export const RULES = [
  noCommittedSecrets,
  supabaseClientInFunction,
  routeForceDynamic,
  noStaticExport,
  regexNoTemplateLiteral,
  noServiceRoleClient,
  envCentralised,
  stripeWebhookSignature,
  rlsEnabled,
  legalPagesPresent,
  kvkkStructure,
  stateSchemaValid,
];

export function rulesFor(manifest) {
  const packs = new Set(manifest?.standards?.packs ?? []);
  return RULES.filter((r) => r.always || (r.packs ?? []).some((p) => packs.has(p)));
}

export function ruleById(id) {
  return RULES.find((r) => r.id === id) ?? null;
}

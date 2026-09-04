/**
 * Mavci Core - the Phase 1 rule set. 15 checks.
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
import { scanProject } from '../lib/sitescan.mjs';
import { lineOf } from '../lib/fsx.mjs';
import { MARKETPLACE_NAME, PLUGIN_ID, SYSTEM_REPO } from '../config.mjs';

/* ------------------------------------------------------- remedy authority
 *
 * A REMEDY IS AN INSTRUCTION TO WHOEVER CAN CARRY IT OUT. When that is not the
 * agent reading it, the remedy has to say so, in the remedy, and name who.
 *
 * Gate 4c, declined path 4, is the case that forced this. Four
 * `legal.pages_present` findings carried the remedy "Have the text reviewed,
 * then delete the REVIEW REQUIRED marker." An agent can delete a marker. It
 * cannot have a lawyer review the text. Deleting it would have made the page
 * assert a review that never happened, on the one surface where that assertion
 * is load-bearing, and turned a visible finding into an invisible one - and the
 * cheap path was SANCTIONED BY THE CHECK'S OWN REMEDY TEXT. The agent declined
 * it, which is the only reason this is a design note rather than an incident.
 *
 * A remedy that only the operator or an outside party can perform, written as
 * if the reader could perform it, is not advice - it is an instruction to
 * fabricate. So:
 *
 *   agent      the reader can do the whole thing. No note.
 *   operator   needs a human in the main session: a privileged `state.mjs`
 *              flag, a settings edit, a key rotation, a deploy.
 *   external   needs someone outside the system entirely: a lawyer, a
 *              provider's console.
 *
 * `check-evidence-caps.mjs` (PART 2) asserts that every rule and every finding whose
 * authority is not `agent` carries the note, and that the note names an actor.
 * The rule and its note are written in one place so they cannot drift, which is
 * the 0.1.5 lesson: a value spelled once, derived everywhere.
 */
export const AUTHORITY_LEVELS = ['agent', 'operator', 'external'];

/**
 * The note itself. `who` completes "it needs <who>".
 *
 * Deliberately terse. `remedy` caps at 300 characters and the note is added to
 * remedies that already run to 200, so a long note would push the ACTUAL FIX out
 * of the field - trading one unusable remedy for another. What the reader needs
 * is the actor and the instruction to stop; the reason lives in the surrounding
 * remedy text, where it is specific and worth its length.
 *
 * `AUTHORITY:` is a literal marker, not prose, because check-evidence-caps.mjs
 * greps for it. A rule that declares an authority and phrases the note its own
 * way would pass a human read and fail the check, which is the right way round.
 */
export function authorityNote(who) {
  return `AUTHORITY: not yours to complete - it needs ${who}. Report it and stop.`;
}

const isCode = (p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);
const under = (p, dir) => p === dir || p.startsWith(dir + '/');
const inAny = (p, dirs) => dirs.some((d) => under(p, d));

/* ------------------------------------------------------- fixture class
 *
 * A FIXTURE CARRIES THE DEFECT ON PURPOSE. That is what makes it a fixture, and
 * a checker that cannot express it forces a choice between two wrong things:
 * delete the defect the fixture exists to detect, or baseline it and record
 * deliberate content as permanent project debt.
 *
 * The concept already existed for the SYSTEM repo - `noCommittedSecrets` skips
 * `plugins/mavci-core/templates/fixtures` with the comment "fixtures carry fake
 * keys on purpose" - and that was the whole defect: the exemption only ever
 * matched a path inside this repository, so no downstream project could reach
 * it. gate4c hit the deadlock it produces. Its guardian acceptance corpus lives
 * in `corpus-run/`, every corpus file references `SUPABASE_SERVICE_ROLE_KEY`
 * deliberately, so `next.no_service_role_client` blocked EVERY subagent stop in
 * the repository - while `doctor` FAILed at SessionStart for having no corpus
 * result. Neither state could produce one.
 *
 * FOUR CONSTRAINTS, and each one is load-bearing:
 *
 * 1. DECLARED IN THE MANIFEST, never inferred from a directory name. A path
 *    called `fixtures/` or `corpus/` earning an exemption means the checker is
 *    silenced by choosing a filename, which is not a control at all.
 *
 * 2. AN ALLOW-LIST OF RULES, not a blanket skip. `FIXTURE_EXEMPT_RULES` is the
 *    whole list and it is checked inside the helper rather than at each call
 *    site, so a rule cannot opt itself in by calling it.
 *
 * 3. `secrets.no_committed_secrets` CAN NEVER BE EXEMPTED. It is the one check
 *    that is neither baselineable nor waivable, and a real key in a directory
 *    someone declared as fixtures is still a real key. A fixture holds a
 *    placeholder; if it holds a live value the finding is correct.
 *
 * 4. THE DECLARATION IS ITSELF CHECKED, by `config.fixture_scope` below. Without
 *    it, `"fixtures": ["."]` turns the manifest into an off switch - which is
 *    what `checks.exclude_paths` silently still was, and why that rule polices
 *    both fields.
 *
 * 5. ONE ROOT IS EXEMPT WITHOUT BEING DECLARED, and it is the exception that
 *    constraint 1 has to bend for. `corpus-run/` is where `corpus-stage.mjs`
 *    writes a guardian acceptance case, and every case carries a direct
 *    `SUPABASE_SERVICE_ROLE_KEY` read on purpose - so without an exemption the
 *    corpus cannot run at all. It used to be declared: gate4c's manifest carried
 *    `checks.fixtures: ["corpus-run"]`. That declaration was itself a leak. The
 *    corpus measures guardian's judgement and measures nothing if guardian can
 *    tell a corpus run from a real one, and the shared agent contract ordered
 *    every agent to read `.mavci/project.json` before anything else - so guardian
 *    was instructed to open the file that named the corpus directory. Relocating
 *    the expectations did not touch this; the manifest still said where to look.
 *
 *    So the plugin knows its own staging directory and the project no longer
 *    states it. THE COST IS REAL AND IS NOT SMOOTHED OVER: this is exactly the
 *    name-derived exemption constraint 1 forbids, and a project that puts
 *    shipping code in a directory called `corpus-run/` gets it. Three things bound
 *    it, and none of them makes it free:
 *      - it exempts `FIXTURE_EXEMPT_RULES` only, and `secrets.no_committed_secrets`
 *        still fires there as it does everywhere - enforced not by that allow-list
 *        but by `noCommittedSecrets` never calling this helper, so no change here
 *        can reach it;
 *      - the name is fixed by the plugin, so a project cannot choose a new one to
 *        widen its own exemption - it can only occupy the one that exists;
 *      - `config.fixture_scope` warns on covered files here exactly as it does for
 *        a declared root, so the exemption is visible in the report rather than
 *        silent, which is the property that made the declared version tolerable.
 *    The exemption is what a blind corpus costs. It is recorded so the next reader
 *    weighs it rather than discovers it.
 */

/**
 * The staging directory `corpus-stage.mjs` writes into, owned by the plugin and
 * never declared by a project. Defined HERE rather than there so the dependency
 * runs from the corpus tooling to the checker and not the other way round: the
 * checker must know this name without importing anything about the corpus.
 */
export const CORPUS_STAGE_DIR = 'corpus-run';

/** The complete set of rules a project-declared fixture root may exempt. */
export const FIXTURE_EXEMPT_RULES = new Set([
  'next.no_service_role_client',
  'next.env_centralised',
]);

/** Source roots a fixture root may never be, contain, or live inside. */
const PROTECTED_ROOTS = ['app', 'src', 'lib', 'components', 'supabase', '.mavci', '.github', '.claude'];

/** Why `dir` is unusable as a declared fixture root, or null when it is fine. */
export function fixtureRootIssue(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return 'is empty';
  if (dir !== dir.trim()) return 'has leading or trailing whitespace';
  if (dir === '.' || dir === './' || dir === '/') return 'is the repository root, which would exempt everything';
  if (dir.startsWith('/') || /^[A-Za-z]:/.test(dir)) return 'is an absolute path';
  if (dir.includes('\\')) return 'uses backslashes - declare repo-relative POSIX paths';
  if (dir.split('/').includes('..')) return 'escapes the project with ".."';
  if (/[*?[\]]/.test(dir)) return 'is a glob - declare a directory, not a pattern';
  const clean = dir.replace(/\/+$/, '');
  const hit = PROTECTED_ROOTS.find((r) => under(clean, r) || under(r, clean));
  if (hit) return `overlaps the source root "${hit}"`;
  return null;
}

/**
 * Declared fixture roots that passed validation.
 *
 * An UNSAFE entry is ignored here and reported by `config.fixture_scope`. It must
 * never take effect while its own finding is still being computed: a manifest
 * declaring `fixtures: ["."]` would otherwise exempt the very rule that objects
 * to it, and the off switch would switch off the check that catches the off
 * switch.
 */
export function fixtureRoots(manifest) {
  const raw = manifest?.checks?.fixtures;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d) => fixtureRootIssue(d) === null).map((d) => d.replace(/\/+$/, ''));
}

/**
 * Is `rel` exempt from `checkId` because the manifest declares it a fixture?
 *
 * Returns false for any rule outside `FIXTURE_EXEMPT_RULES` whatever the caller
 * passes - constraints 2 and 3 are enforced here, once, not at each call site.
 */
export function isDeclaredFixture(ctx, rel, checkId) {
  if (!FIXTURE_EXEMPT_RULES.has(checkId)) return false;
  if (under(rel, CORPUS_STAGE_DIR)) return true;      // constraint 5
  return inAny(rel, fixtureRoots(ctx.manifest));
}

/** app/api/**\/route.ts - the App Router handler convention. */
const isApiRoute = (p) => /^app\/api\/.*\/route\.(ts|tsx|js|jsx)$/.test(p);

/* ==================================================================== 1 */

const noCommittedSecrets = {
  id: 'secrets.no_committed_secrets',
  severity: 'critical',
  always: true,
  description: 'No API key, token or secret value may be committed to the repository.',
  // `external`: removing the value from the file is the easy half and the half
  // that does not matter. The key is compromised the moment it is committed, and
  // only the provider can rotate it. An agent that deleted the line and reported
  // this fixed would have made a live key invisible instead of dead.
  authority: 'external',
  remedy: 'Remove the value and read it through lib/env.ts instead. The key is compromised and must be '
    + `rotated at the provider. ${authorityNote("the operator, at the provider's console")}`,
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
      if (under(rel, 'plugins/mavci-core/templates/fixtures')) continue; // fixtures carry fake keys on purpose
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
      if (isDeclaredFixture(ctx, rel, this.id)) continue; // fixtures carry the defect on purpose
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
      if (isDeclaredFixture(ctx, rel, this.id)) continue; // fixtures carry the defect on purpose
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
  description: 'Every table CREATED IN A MIGRATION has row level security enabled. '
    + 'This rule can only see tables it watched being created: a schema built in the Supabase '
    + 'dashboard or with psql is invisible to it, and it reports not_checked rather than pass '
    + 'when it finds no table definitions. It runs only when tenancy.isolation is "rls".',
  // Named once, used by all three not_checked paths, so the "what settles it" answer
  // cannot drift between them (0.1.13: one definition, not two matching ones).
  notCheckedRemedy: 'WHAT SETTLES IT: run `select relname, relrowsecurity from pg_class '
    + "where relnamespace = 'public'::regnamespace;` against the project, or read the table "
    + 'editor. This rule reads files and cannot reach the database. AUTHORITY: not yours to '
    + 'complete - it needs the operator, with database access. Report it and stop.',
  remedy: 'Add `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` in the same migration. '
    + 'Without RLS every authenticated user can read every tenant\'s rows.',
  run(ctx) {
    const isolation = ctx.manifest?.tenancy?.isolation ?? null;

    // ISOLATION IS NOT `rls`: this rule is the wrong question, and saying so is the
    // point. It must NOT silently skip - `application-filters` declares there is no
    // database backstop, which is a reason for MORE checking, not less (finding 17).
    // A manifest field that quietly switches a rule off is a switch that turns the
    // checker down, and the projects that most need checking are the ones that set it.
    if (isolation && isolation !== 'rls') {
      return [{
        check_id: this.id, severity: 'warning', not_checked: true,
        path: null, line: null,
        evidence: `tenancy.isolation is "${isolation}", so row level security is not what `
          + 'separates tenants here and this rule cannot answer the question that matters.',
        remedy: 'WHAT SETTLES IT: supabase.service_role_query_scoped, which is enabled by this '
          + 'same declaration and reports whether every service-role query carries a tenant '
          + 'predicate - and, where tenant tables are reachable by a browser-held key, the '
          + 'table-level GRANTs for the anon and authenticated roles, which are not visible '
          + 'from this repository. Neither is checked by this rule.',
      }];
    }

    const migrations = ctx.files.filter((p) => /^supabase\/migrations\/.*\.sql$/.test(p));

    // NO MIGRATIONS AT ALL, or none that create a table: an empty input set. The old
    // code returned [] here and scored a PASS - finding 5, measured green on a live
    // multi-tenant SaaS whose schema was built in a dashboard. A declaration of
    // `isolation: rls` makes this MORE misleading, not less: the manifest asserts RLS
    // is the mechanism and the repository contains no evidence either way.
    if (!migrations.length) {
      return [{
        check_id: this.id, severity: 'warning', not_checked: true,
        path: null, line: null,
        evidence: 'no supabase/migrations/*.sql, so no table definitions were inspected. '
          + 'tenancy.isolation declares "rls" and nothing here confirms or denies it.',
        remedy: this.notCheckedRemedy,
      }];
    }

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

    // Migrations exist but none CREATES a table - the chatbot's actual condition: two
    // files, both ALTER TABLE only. `created` is empty, the filter below runs over
    // nothing, and the rule used to return [] and score a pass.
    if (!created.length) {
      return [{
        check_id: this.id, severity: 'warning', not_checked: true,
        path: null, line: null,
        evidence: `${migrations.length} migration file(s) present, but none contains a CREATE TABLE, `
          + 'so no table was inspected. Tables created through the Supabase dashboard or psql '
          + 'never appear here and are invisible to this rule.',
        remedy: this.notCheckedRemedy,
      }];
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
      // real regression. Unreviewed legal text is a SHIP gate, not a build gate -
      // and `regulated` projects promote it here too, because there the review
      // must precede the work, not the ship.
      //
      // THE REMEDY IS THE ONE GATE 4c CAUGHT POINTING THE WRONG WAY. It used to
      // read "Have the text reviewed, then delete the REVIEW REQUIRED marker",
      // addressed to a reader who can do exactly one of those two things. See
      // `authorityNote` at the top of this file: the deletion is the operator's,
      // after the review is the lawyer's, and the remedy now says both.
      if (REVIEW_MARKER.test(text)) {
        const regulated = ctx.manifest?.risk_tier === 'regulated';
        out.push({
          check_id: this.id, severity: regulated ? 'blocker' : 'warning', path: rel,
          authority: 'external',
          line: lineOf(text, text.search(REVIEW_MARKER)),
          evidence: `"${slug}" page is still marked REVIEW REQUIRED - no lawyer has reviewed this text`,
          remedy: 'A lawyer reviews the text; the operator then deletes the REVIEW REQUIRED marker. '
            + 'Deleting it yourself would make this page claim a review that never happened. '
            + `${authorityNote('a lawyer, then the operator')}`,
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
  // `external`, even though writing the missing section IS the agent's to do.
  // The authority note is about what CLEARS the finding, not about what starts
  // it: a page with all seven headings and no review passes this check and is
  // still not compliant. Marking it `agent` would let a green tick here read as
  // "the KVKK page is done", which is the exact claim the description refuses.
  authority: 'external',
  remedy: 'Add the missing section to the KVKK aydinlatma metni. This check verifies presence, not '
    + `adequacy. ${authorityNote('a lawyer, to judge whether the text is sufficient')}`,
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
  // `operator`: `--reseal` is in risk-guard's PRIVILEGED table and is denied to
  // an agent by caller, because re-sealing launders whatever tampering preceded
  // it. A remedy naming a command the reader is structurally forbidden to run,
  // without saying so, sends them into a deny they will read as a malfunction.
  authority: 'operator',
  // THE CONSERVATIVE DEFAULT, not a placeholder. Every finding overrides it via
  // remedyFor, but this is what a reader gets if that is ever bypassed, so it
  // states the operator-authority case rather than the agent-actionable one.
  // Satisfying Part 2's authority assertion with a string no finding emits would
  // be passing a check with text nobody reads.
  remedy: 'Run `state.mjs --validate` for the full list. If the SEAL is what failed, a control '
    + `file changed on purpose needs \`state.mjs --reseal\`. ${authorityNote('the operator')}`,
  run(ctx) {
    const errors = ctx.validateState();
    return errors.map((e) => ({
      check_id: this.id, severity: this.severity,
      path: e.path ?? '.mavci/control', line: null,
      evidence: e.message ?? String(e),
      remedy: remedyFor(e, ctx.versions),
    }));
  },
};

/**
 * FINDING 24. THE REMEDY MUST FIT THE FAILURE BEING REPORTED.
 *
 * What happened: 0.1.20's `--record-corpus` - the only sanctioned writer - wrote
 * `guardian-corpus.json` with a field 0.1.20's schema had added. The hooks
 * registered in that session were 0.1.19's, whose schema sets
 * `additionalProperties: false`, so the field was not merely unknown to it, it
 * was a violation. The gate blocked, and printed: "If a control file was edited by
 * hand on purpose, it needs state.mjs --reseal."
 *
 * Every clause of that was wrong for the situation. The file was not edited by
 * hand - it was written minutes earlier by the sanctioned writer. And resealing
 * recomputes a hash; it has no bearing on schema validity, so an operator who ran
 * it would have spent a privileged action and arrived back at the same block. A
 * REMEDY THAT CANNOT WORK IS WORSE THAN NO REMEDY: it costs an action and teaches
 * the reader that this message is unreliable.
 *
 * Three failures, three remedies:
 *
 *   SEAL      - the hash disagrees with the files. `--reseal` is the answer, and
 *               the only case where it is.
 *   SKEW      - a schema rejection while the registered hooks are OLDER than the
 *               plugin on disk. The file is fine; the checker reading it is stale.
 *               The fix is a session restart, and nothing in the old message said
 *               so. Not conditional on the version being older in the abstract:
 *               both versions are read off disk, and if they differ the checker
 *               and the writer disagree by construction.
 *   SCHEMA    - a rejection with no skew to explain it. Then the document really
 *               is malformed and `--validate` names it.
 *
 * ASSERT ON THE TEXT. The exit code is identical whichever of these is printed -
 * which is why the version that named `--reseal` for everything passed every
 * check the gate had. Same shape as 0.1.11: the reason arriving is the thing to
 * test.
 */
export function remedyFor(error, versions = null) {
  const onDisk = versions?.onDisk ?? null;
  const registered = versions?.hooksRegistered ?? null;
  const skewed = !!onDisk && !!registered && onDisk !== registered;

  if (error?.kind === 'seal') {
    return 'The SEAL disagrees with the files: a hash mismatch, NOT a schema problem. Review '
      + `\`git diff .mavci/control/\`; a control file changed on purpose needs \`state.mjs --reseal\`, `
      + `the one failure it answers. ${authorityNote('the operator')}`;
  }

  if (skewed) {
    // AUTHORITY, and it is not decoration: an agent cannot restart its own
    // session. Without the marker this remedy is finding 16's shape - an
    // instruction to the one party who cannot carry it out.
    return `RESTART THE SESSION: these hooks are ${registered}, the plugin on disk is ${onDisk}, so `
      + 'this checker is older than the writer. NOT a seal failure - `--reseal` cannot clear a '
      + `schema rejection. ${authorityNote('the operator, who restarts the session')}`;
  }

  // NO authority marker, deliberately: both actions here are the agent's own -
  // run --validate, file a retro. Marking this operator-only would be the
  // opposite error to finding 24's, telling an agent to stop when it can act.
  return 'Run `state.mjs --validate` for the full list. A document does not match its schema. NOT '
    + 'a seal failure: `--reseal` recomputes a hash and cannot clear this. If a Mavci writer '
    + 'produced the file, that writer has a bug - file it with /mavci-core:retro rather than '
    + 'editing the file by hand.';
}

/* =================================================================== 13 */

/**
 * The registration that decides whether ANY of the other twelve rules ever run.
 *
 * .claude/settings.json names the marketplace and enables the plugin. Get the
 * source form wrong and Claude Code cannot resolve the marketplace: the plugin
 * never installs, zero hooks register, and nothing is enforced - reported as a
 * clean start, on a project that looks correctly configured.
 *
 * 0.1.3 and 0.1.4 shipped `{"source":"url"}` in the template AND had doctor
 * demand that exact value, so the checker drove every project into the broken
 * form and then certified it. Nothing could catch that, because
 * .claude/settings.json is opened by nothing else in verify.mjs - `.claude` is
 * in DEFAULT_EXCLUDE_DIRS, so it is not even in ctx.files. This rule reads it
 * directly, which is what makes the defect catchable in CI rather than in an
 * operator's hands.
 *
 * `always: true`: a project that disables enforcement is not a pack opt-in.
 */
const marketplaceForm = {
  id: 'settings.marketplace_form',
  // `critical`, not `blocker`, and it is the second rule to earn that. The other
  // twelve ask whether a standard is met; this one asks whether checking happens
  // at all. Baselining or waiving it would mean recording "nothing is enforced
  // here" as accepted technical debt, which is not a debt - it is the end of the
  // system. `critical` is the set of findings it is never legitimate to suppress.
  severity: 'critical',
  always: true,
  description: 'The marketplace is registered in the one source form that resolves, and the plugin is enabled.',
  // `operator`: .claude/settings.json carries the risk policy, and risk-guard
  // raises a tier-2 confirm on any write to it. This is also `critical`, so it
  // can be neither baselined nor waived - the reader has exactly one route out
  // and it goes through a human. Saying so beats letting them find out at the
  // permission prompt.
  authority: 'operator',
  remedy: `Set extraKnownMarketplaces.${MARKETPLACE_NAME}.source to {"source":"git","url":`
    + `"https://github.com/${SYSTEM_REPO}.git"} and enabledPlugins["${PLUGIN_ID}"] to true, or re-run `
    + `/mavci-core:connect. ${authorityNote('the operator')}`,
  run(ctx) {
    const REL = '.claude/settings.json';
    const raw = ctx.readOrNull(REL);
    // An ABSENT file means "not connected yet", which doctor already reports and
    // which is a legitimate mid-connect state. This rule is about a file that
    // EXISTS and silently switches enforcement off.
    if (raw === null) return [];

    const at = (needle) => {
      const i = raw.indexOf(needle);
      return i < 0 ? null : lineOf(raw, i);
    };
    const finding = (evidence, line = null) => [{
      check_id: this.id, severity: this.severity, path: REL, line, evidence, remedy: this.remedy,
    }];

    let s;
    try {
      s = JSON.parse(raw);
    } catch (err) {
      return finding(`not valid JSON (${err.message}). Claude Code rejects the whole `
        + 'file, so every deny rule and the marketplace registration are absent.', 1);
    }

    const expected = `https://github.com/${SYSTEM_REPO}.git`;
    const mk = s?.extraKnownMarketplaces?.[MARKETPLACE_NAME];
    if (!mk?.source) {
      return finding(`no extraKnownMarketplaces.${MARKETPLACE_NAME}.source. The marketplace is `
        + 'never resolved, so the plugin does not install and no hook registers.',
      at('extraKnownMarketplaces') ?? 1);
    }

    const line = at('extraKnownMarketplaces');
    const src = mk.source;

    if (typeof src.url === 'string' && /__[A-Z0-9_]+__/.test(src.url)) {
      return finding(`marketplace url still carries the template placeholder "${src.url}". `
        + 'The file was copied but never rendered.', line);
    }
    if (src.source === 'github') {
      return finding('uses the "github" source form, which resolves over SSH. On any machine '
        + 'with no SSH key loaded the clone fails and nothing is enforced there, while it '
        + 'keeps working on the machine that wrote it.', line);
    }
    if (src.source === 'url') {
      return finding('uses the "url" source form, which means "fetch a remote marketplace.json '
        + 'over HTTP", not "clone this git remote". Against a .git address it 404s, so the '
        + 'plugin never installs. 0.1.3 and 0.1.4 shipped this.', line);
    }
    if (src.source !== 'git') {
      return finding(`uses the "${src.source}" source form. Only "git" clones over HTTPS `
        + "through the machine's ordinary git credential helper.", line);
    }
    if (src.url !== expected) {
      return finding(`marketplace url is "${src.url}", not ${expected}. A marketplace that does `
        + 'not resolve installs no plugin and registers no hook.', line);
    }
    if (s?.enabledPlugins?.[PLUGIN_ID] !== true) {
      // 583 CHARACTERS, AND IT TOOK THE CHECKER OFFLINE FOR A WHOLE PROJECT.
      //
      // `evidence` caps at 500 in verdict.schema.json. Nothing checked that when
      // this string was written, so the cap fired at writeControl instead -
      // after the run, inside the gate - and `verify.mjs --record` threw on
      // every turn in gate4c. Plain `verify.mjs` stayed healthy throughout: 11
      // pass, 5 fail, 1 blocker. Only RECORDING was broken, and recording is the
      // path enforcement runs on. The checker's most detailed finding is the one
      // that disabled the checker.
      //
      // Rewritten to fit, and now held there by check-evidence-caps.mjs at
      // authoring time. `clampFinding` in verify.mjs is the backstop for the
      // interpolated case a static check cannot see: it truncates with a visible
      // marker rather than throwing, because a finding cut at 500 characters is
      // worth incomparably more than a checker that does not run.
      //
      // The narrowing matters and is kept: this rule reads only
      // .claude/settings.json, so it CANNOT see a user-scope or managed
      // enablement and must not claim nothing is enforced. gate4c ran a whole
      // session with three agents and eight hooks from a user-scope anchor while
      // this key was absent.
      return finding(`the marketplace resolves but this project does not set enabledPlugins["${PLUGIN_ID}"] `
        + 'to true. This rule reads only .claude/settings.json, so it cannot see a user-scope or managed '
        + 'enablement and does not claim nothing is enforced. What it does establish is still serious: '
        + 'enforcement here rests on machine-level config that travels with nobody, so on a fresh clone, a '
        + "teammate's checkout or CI, no hook registers and the failure is silent.",
      at('enabledPlugins') ?? line);
    }
    return [];
  },
};


/* =================================================================== 14 */

/**
 * The first BEHAVIOURAL rule: it asks what a handler does, not what a file
 * contains. Findings 9 and 11 are the argument for it; the live bug in
 * docs/chatbot-widget-connect-plan.md section 0a is its first real input.
 *
 * ONE SCAN, TWO OUTPUTS. `scanProject` enumerates every service-role query site
 * once. This rule projects the sites with NO tenant predicate into findings. The
 * same scan projects the sites WITH one into guardian's worklist (worklistFrom).
 * Two passes would let the count the operator sees differ from the count guardian
 * is graded against.
 */
const serviceRoleQueryScoped = {
  id: 'supabase.service_role_query_scoped',
  severity: 'blocker',
  packs: ['supabase-multitenant-rls'],
  // THE BOUNDARY, IN THE SHIPPED TEXT. It belongs here and not only in a design
  // document, because the person reading it at 2am reads the description. The
  // precedent is legal.kvkk_structure, whose description says "STRUCTURAL CHECK
  // ONLY" for the same reason: the check is real, and a green tick is not the
  // claim a reader would otherwise take from it.
  description: 'Every service-role query against a tenant table carries a tenant filter. '
    + 'CHECKS PRESENCE, NOT PROVENANCE - it verifies that a tenant predicate exists, and '
    + 'CANNOT verify that the value it compares against is trustworthy. A filter built from '
    + 'an unauthenticated request body passes this check and is still a cross-tenant read. '
    + 'That question needs dataflow analysis and is deliberately not attempted here; it is '
    + "that question is mavci-guardian's, via the worklist this scan produces.",
  remedy: 'Add a tenant predicate to this query. The service-role key bypasses row level '
    + "security, so an unfiltered read or write reaches every tenant's rows with nothing "
    + 'behind it.',
  run(ctx) {
    // Runs only where the manifest says filters ARE the mechanism. That declaration
    // turns this rule ON - it is the "more checking, not less" half of finding 17.
    if (ctx.manifest?.tenancy?.isolation !== 'application-filters') return [];

    const scan = scanProject(ctx, { tenantColumn: ctx.manifest?.tenancy?.tenant_column ?? null });
    const out = [];

    // THE ENUMERATION'S OWN CONTROL, and it is not the coverage subtraction.
    // A `.from(` this scanner could neither classify as a site nor name as an
    // exclusion means it does not recognise the shape - and a scanner that quietly
    // enumerates a smaller universe produces a worklist guardian answers completely
    // and a verdict that reads as full coverage of the wrong set. 0.1.14's rule for
    // release.yml, applied here: neither run nor named is a FAILURE, not a skip.
    if (scan.residue !== 0) {
      out.push({
        check_id: this.id, severity: 'blocker', path: null, line: null,
        evidence: `${scan.residue} service-role query site(s) could not be classified or named. `
          + `Scanner saw ${scan.coarse} candidate(s), enumerated ${scan.sites.length}, excluded `
          + `${scan.excluded.length} with a stated reason. The remainder is unrecognised.`,
        remedy: 'This is a gap in the scanner, not in your code, and the worklist it produces '
          + 'would understate coverage. File it with /mavci-core:retro. Do not proceed on the '
          + 'assumption that the enumerated sites are all of them.',
      });
    }

    // WHICH TABLES ARE TENANT TABLES. 0.1.27, and it closes a gap between this
    // rule and its own description, which has always said "against a TENANT
    // table" while the loop below asked only whether a predicate was present.
    //
    // It went unnoticed because the enumeration could not see the scaffold's own
    // factory, so the scaffold's `stripe_events` insert was never a site to begin
    // with. Fixing that (sitescan 0.1.27) made this one observable immediately:
    // `stripe_events` is keyed by Stripe's event id, has no tenant column, and a
    // tenant predicate on it would be meaningless - yet it would have become a
    // blocker in every project built from the scaffold, on the scaffold's own
    // code. A checker whose first act on a new project is to flag the template it
    // just wrote teaches the operator that the checker is wrong.
    //
    // FAILS CLOSED, and that is the whole design of it. A table is treated as
    // NON-tenant only when a migration creates it and that CREATE carries no
    // tenant column. A table nothing creates - a schema built in a dashboard, a
    // migration this parser cannot read - is NOT assumed innocent: it stays a
    // finding, because "no evidence it is tenant-scoped" and "evidence it is not"
    // are different facts and only the second is a reason to stay silent.
    const tenantColumn = (ctx.manifest?.tenancy?.tenant_column ?? '').toLowerCase();
    const nonTenantTables = new Set();
    if (tenantColumn) {
      for (const rel of ctx.files.filter((p) => /^supabase\/migrations\/.*\.sql$/.test(p))) {
        const text = ctx.readOrNull(rel);
        if (text === null) continue;
        const sql = text.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
        for (const m of matchAll(sql, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(?:public\.)?["']?(\w+)/i)) {
          const name = m.groups[0].toLowerCase();
          // The body is the parenthesised column list following the name.
          const open = sql.indexOf('(', m.index);
          if (open === -1) continue;
          let depth = 0; let close = -1;
          for (let i = open; i < sql.length; i += 1) {
            if (sql[i] === '(') depth += 1;
            else if (sql[i] === ')') { depth -= 1; if (depth === 0) { close = i; break; } }
          }
          if (close === -1) continue;
          const body = sql.slice(open + 1, close).toLowerCase();
          if (!new RegExp(`\\b${tenantColumn}\\b`).test(body)) nonTenantTables.add(name);
          else nonTenantTables.delete(name);
        }
      }
    }

    for (const site of scan.sites) {
      if (site.has_tenant_filter) continue;   // -> guardian's worklist, not a finding here
      if (nonTenantTables.has(String(site.table).toLowerCase())) continue;  // not a tenant table
      out.push({
        check_id: this.id, severity: this.severity, path: site.path, line: site.line,
        evidence: `${site.writes ? 'write' : 'read'} on "${site.table}" through the service-role `
          + 'client with no tenant predicate',
        remedy: this.remedy,
      });
    }
    return out;
  },
};

/* =================================================================== 15 */

/**
 * The rule that makes the fixture class a control rather than an off switch.
 *
 * Two manifest fields can remove code from the checker's reach, and until 0.1.16
 * NEITHER was checked:
 *
 *   `checks.fixtures`      exempts declared roots from FIXTURE_EXEMPT_RULES only
 *   `checks.exclude_paths` drops files from the scan ENTIRELY, before any rule
 *                          runs - including `secrets.no_committed_secrets`, the
 *                          one check that can be neither baselined nor waived
 *
 * `exclude_paths` is the older and by far the more dangerous of the two, and it
 * shipped with no description, no constraint and no check on its contents. It is
 * policed here rather than in its own rule because the two fields are one
 * decision - "what does the checker not look at" - and splitting them would let
 * a reader fix the narrow field while the wide one stayed open.
 *
 * Note what this rule does NOT do: it never silences anything itself, so it
 * cannot be turned off by the mechanism it polices. `fixtureRoots` deliberately
 * drops unsafe entries before they take effect, which is what stops
 * `fixtures: ["."]` from exempting this check.
 */
const fixtureScope = {
  id: 'config.fixture_scope',
  severity: 'blocker',
  always: true,
  description: 'Manifest paths that narrow the checker must be scoped, and may never cover source roots.',
  // `operator`: `.mavci/project.json` is `ask` in the canonical risk policy, so an
  // agent cannot edit it unattended. An agent that "fixed" this by editing the
  // manifest would be widening its own exemptions, which is the one edit it must
  // never make silently.
  authority: 'operator',
  remedy: 'Narrow the declaration in .mavci/project.json to a directory that holds only fixtures. '
    + `${authorityNote('the operator - the manifest is `ask` in the risk policy')}`,
  run(ctx) {
    const out = [];
    const declared = ctx.manifest?.checks?.fixtures;

    if (declared !== undefined && !Array.isArray(declared)) {
      out.push({
        check_id: this.id, severity: this.severity, path: '.mavci/project.json', line: null,
        evidence: 'checks.fixtures is present but is not an array',
        remedy: this.remedy,
      });
    }

    for (const dir of Array.isArray(declared) ? declared : []) {
      const issue = fixtureRootIssue(dir);
      if (!issue) continue;
      out.push({
        check_id: this.id, severity: this.severity, path: '.mavci/project.json', line: null,
        evidence: `checks.fixtures entry ${JSON.stringify(dir)} ${issue}`,
        remedy: this.remedy,
      });
    }

    // exclude_paths removes files from the scan entirely. A source root here is
    // strictly worse than a fixture declaration covering the same path, because
    // it takes the secrets check with it.
    for (const pattern of ctx.manifest?.checks?.exclude_paths ?? []) {
      if (typeof pattern !== 'string') continue;
      const head = pattern.split(/[*?[]/)[0].replace(/\/+$/, '');
      if (head === '' || PROTECTED_ROOTS.some((r) => under(head, r) || under(r, head))) {
        out.push({
          check_id: this.id, severity: this.severity, path: '.mavci/project.json', line: null,
          evidence: `checks.exclude_paths entry ${JSON.stringify(pattern)} covers a source root - `
            + 'excluded files are dropped before every rule, including secrets.no_committed_secrets',
          remedy: 'Remove it, or narrow it to build output and vendored code. To keep deliberate '
            + 'fixture defects out of the blockers, use checks.fixtures instead: it exempts named '
            + `rules only and never the secrets check. ${authorityNote('the operator - the manifest is `ask` in the risk policy')}`,
        });
      }
    }

    // Keep the exemption VISIBLE. A warning, not a blocker: the declaration is
    // legitimate, but an exemption nobody can see is how a narrow one becomes a
    // wide one over time. Invisible debt is debt that never gets paid.
    for (const dir of fixtureRoots(ctx.manifest)) {
      const covered = ctx.files.filter((p) => under(p, dir) && isCode(p));
      if (!covered.length) continue;
      out.push({
        check_id: this.id, severity: 'warning', path: dir, line: null,
        evidence: `${covered.length} file(s) under this declared fixture root are exempt from `
          + `${[...FIXTURE_EXEMPT_RULES].join(', ')}`,
        remedy: 'No action needed if this directory holds only fixtures. If it holds shipping code, '
          + 'remove it from checks.fixtures in .mavci/project.json.',
      });
    }

    // The undeclared root gets the SAME warning. It is not in the manifest, so a
    // reader auditing exemptions by reading the manifest would not find it - which
    // is the whole reason it has to appear in the report instead. An exemption
    // nobody can see is how a narrow one becomes a wide one, and that argument does
    // not weaken because the plugin rather than the project chose the path.
    const stagedCode = ctx.files.filter((p) => under(p, CORPUS_STAGE_DIR) && isCode(p));
    if (stagedCode.length) {
      out.push({
        check_id: this.id, severity: 'warning', path: CORPUS_STAGE_DIR, line: null,
        evidence: `${stagedCode.length} file(s) under the guardian corpus staging root are exempt `
          + `from ${[...FIXTURE_EXEMPT_RULES].join(', ')}. This root is not declared in the `
          + 'manifest: the plugin owns the name, deliberately, so that nothing inside the project '
          + 'states where a corpus case is staged',
        remedy: 'No action needed during a corpus run - the staging directory is emptied by '
          + '`corpus-stage.mjs --clear` when it ends. If this project keeps its own code here, '
          + 'move it: the name belongs to the corpus and carries an exemption.',
      });
    }
    return out;
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
  marketplaceForm,
  serviceRoleQueryScoped,
  fixtureScope,
];

export function rulesFor(manifest) {
  const packs = new Set(manifest?.standards?.packs ?? []);
  return RULES.filter((r) => r.always || (r.packs ?? []).some((p) => packs.has(p)));
}

export function ruleById(id) {
  return RULES.find((r) => r.id === id) ?? null;
}

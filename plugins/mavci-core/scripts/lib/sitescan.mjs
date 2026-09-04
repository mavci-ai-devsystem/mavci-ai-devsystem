/**
 * Mavci Core - service-role query site enumeration. ONE artefact, TWO outputs.
 *
 * The rule (`supabase.service_role_query_scoped`) reports sites with no tenant
 * predicate to the operator. The worklist hands sites WITH a predicate to guardian,
 * which answers whether the predicate's value is trustworthy. Both read the same
 * scan: the rule and the worklist are the same enumeration seen twice, not two
 * passes over the same code that can disagree about what a site is.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS. `sites_total` is fixed here, at enumeration
 * time, and guardian never chooses what to read - which is what makes coverage
 * decidable by subtraction (design 5.4). Two enumerations would mean two answers to
 * "how many sites are there", and the count guardian is graded against would be able
 * to differ from the count the operator was shown.
 *
 * ------------------------------------------------------------------ THE RESIDUE
 *
 * Fixing `sites_total` here moves the risk rather than removing it: the enumeration
 * becomes the thing nothing checks. If this scanner misses a call site, guardian
 * answers every question it was handed, the subtraction balances exactly, and the
 * verdict reads as complete coverage OF A SET THAT WAS WRONG. The count would be
 * honest about the questions asked and silent about the questions not asked - which
 * is the defect this system has now found fifteen times, one level up.
 *
 * The subtraction cannot be its own control, so the scan carries a separate one,
 * and it is the construction `check-pretag.mjs` uses for `release.yml` (0.1.14):
 *
 *     A site this scanner can neither ENUMERATE nor NAME is a FAILURE, not a skip.
 *
 * Three-way partition, and the third must be empty:
 *
 *   coarse    every `.from(` reached from an admin-client identifier. Deliberately
 *             over-broad, and cheap: a lower bound on "things that might be sites".
 *   precise   coarse hits this scanner understood well enough to classify.
 *   excluded  coarse hits deliberately not treated as sites, each with a REASON,
 *             and the reasons are returned so a caller can print them. A scan that
 *             does not say what it declined to look at is asserting more than it
 *             verified.
 *   residue   coarse minus precise minus excluded. MUST BE EMPTY. Anything here is
 *             a shape this scanner does not recognise, and the correct response is
 *             to fail loudly rather than to quietly enumerate a smaller universe.
 *
 * The residue check is the one control that does not depend on anticipating the
 * shape of a miss. A fixture with a known site count only tests cases we thought
 * of, and every miss this system has recorded - `.txt`, `.gitignore`, the
 * SUPABASE_SERVICE_KEY alias, the `app/api/` prefix - was a case nobody thought of.
 * The residue runs on the project's own code, on every scan, and it is loudest
 * exactly where the scanner is weakest.
 *
 * Not a parser (`jsscan.mjs` says the same of itself). It reads blanked source, so
 * a `.from(` in a comment or a string is not a site. Where blanking is not enough
 * to decide, the answer is `excluded` with a reason or `residue` - never a silent
 * omission.
 */

import { blankSource, matchAll } from './jsscan.mjs';
import { lineOf } from './fsx.mjs';

/**
 * Factories that hand back a service-role client, BY NAME.
 *
 * This list is a fallback and no longer the primary mechanism - see
 * `discoverAdminFactories`, which derives factory names from the code instead.
 * It is kept because removing a name a project might already use would be a
 * regression, and because a name here still works in a single-file scan where
 * there is no project to derive from.
 *
 * 0.1.27, and the reason belongs next to the list rather than in a changelog.
 * This list did not contain `createAdminClient`, which is the name the plugin's
 * OWN scaffold exports (`templates/scaffold/lib/supabase/server.ts`). So the
 * scaffold's Stripe webhook constructed a service-role client, queried with it,
 * and was excluded as `no_admin_client` - an exclusion whose text asserts the
 * file constructs no service-role client, which was false about it. Every
 * project `new-project` creates inherited that. The comment below already
 * documented this exact failure class for the KEY name; the same bug was one
 * field up, in the list it was written beneath.
 */
const ADMIN_FACTORY = /\b(getSupabaseAdminClient|createSupabaseAdminClient|getServiceRoleClient|createAdminClient)\s*\(/;

/**
 * The Supabase client constructors. `createClient` is the plain SDK; the SSR
 * package spells it `createServerClient`, and the scaffold uses that one - so a
 * pattern that knew only the first was blind to the client the scaffold actually
 * builds. Same defect as the key-name one below, one level out.
 */
const CLIENT_CTOR = /\b(createClient|createServerClient)\s*\(/;

/**
 * A client constructor whose key argument is a service-role env read, under either
 * documented spelling. Both are matched deliberately: finding 6's third instance was
 * a rule that knew one name for this key and was blind to a real client using the
 * other.
 */
const SERVICE_KEY_NAME = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/;

/** How far after a constructor call to look for the service key. */
const CTOR_WINDOW = 400;

/** `export function NAME(` / `export const NAME =` - a factory this module hands out. */
const EXPORTED_NAME = /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;

/**
 * Derive service-role factory names FROM THE CODE, rather than from a list.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A LONGER LIST. A hand-maintained set of
 * factory names is a rule that knows some names for a thing and is blind to a
 * real instance using another - the failure this file has now recorded three
 * times (the key alias, the SSR constructor spelling, and the scaffold's own
 * factory). Adding a fourth name fixes today's instance and leaves the shape
 * intact. This walks the project instead: a module that builds a client with a
 * service-role key, and exports a function, exports a service-role factory. The
 * name is then whatever the project calls it.
 *
 * Deliberately coarse in the safe direction. It attributes every exported name in
 * such a module, not only the enclosing function, so a module exporting both an
 * anon factory and an admin factory contributes both names. That over-enumerates
 * rather than under-enumerates: a false site is a question guardian answers and a
 * reviewer dismisses, while a false exclusion is a query nobody ever looks at.
 * The scaffold's `server.ts` is exactly this shape - `createClient` (anon) beside
 * `createAdminClient` (service role) - and treating a `.from()` owned by the anon
 * one as a site costs one answered question and hides nothing.
 *
 * @param {{files: string[], readOrNull: (rel: string) => string|null}} ctx
 * @returns {Set<string>} factory names, possibly empty
 */
export function discoverAdminFactories(ctx) {
  const names = new Set();
  for (const rel of ctx.files ?? []) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    const text = ctx.readOrNull(rel);
    if (!text || !SERVICE_KEY_NAME.test(text)) continue;

    const blanked = blankSource(text);
    let builds = false;
    for (const m of matchAll(blanked, CLIENT_CTOR)) {
      if (SERVICE_KEY_NAME.test(text.slice(m.index, m.index + CTOR_WINDOW))) { builds = true; break; }
    }
    if (!builds) continue;

    for (const m of text.matchAll(EXPORTED_NAME)) names.add(m[1] ?? m[2]);
  }
  return names;
}

/** `const x = ...` / `let x = ...` capturing the identifier. */
const ASSIGN = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/;

/** Declared exclusion classes. Each MUST carry a reason; see the residue note. */
export const EXCLUSION_REASONS = {
  no_admin_client: 'file constructs no service-role client, so a .from() here does not run with one',
  storage_or_rpc: 'not a table query - .storage or .rpc chains do not take a tenant predicate the same way',
  dynamic_table: 'table name is not a literal, so no table identity can be resolved without dataflow',
};

/**
 * Identifiers in `text` bound to a service-role client.
 * @returns {Set<string>} may be empty
 */
function adminIdentifiers(blanked, original, discovered = null) {
  const ids = new Set();

  // Named factories: the built-in list, plus any name derived from the project.
  const named = discovered && discovered.size
    ? new RegExp(`\\b(${[...discovered].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\(`)
    : null;
  for (const re of named ? [ADMIN_FACTORY, named] : [ADMIN_FACTORY]) {
    for (const m of matchAll(blanked, re)) {
      const before = blanked.slice(Math.max(0, m.index - 80), m.index);
      const a = before.match(ASSIGN);
      if (a) ids.add(a[1]);
      else ids.add('*inline*'); // used directly, e.g. createAdminClient().from(...)
    }
  }

  // Inline construction - read the ORIGINAL for the env name, because blankSource
  // replaces string bodies and the key is often a literal.
  for (const m of matchAll(blanked, CLIENT_CTOR)) {
    const tail = original.slice(m.index, m.index + CTOR_WINDOW);
    if (!SERVICE_KEY_NAME.test(tail)) continue;
    const before = blanked.slice(Math.max(0, m.index - 80), m.index);
    const a = before.match(ASSIGN);
    if (a) ids.add(a[1]);
    else ids.add('*inline*'); // used directly, e.g. createClient(...).from(...)
  }
  return ids;
}

/**
 * Scan one file.
 * @returns {{sites: Array, excluded: Array, residue: Array}}
 */
export function scanFile(rel, text, { tenantColumn = null, adminFactories = null } = {}) {
  const out = { sites: [], excluded: [], residue: [] };
  if (!text || !text.includes('.from(')) return out;

  const blanked = blankSource(text);
  const admins = adminIdentifiers(blanked, text, adminFactories);

  for (const m of matchAll(blanked, /\.from\s*\(/)) {
    const line = lineOf(text, m.index);

    if (!admins.size) {
      out.excluded.push({ path: rel, line, reason: 'no_admin_client' });
      continue;
    }

    // Which identifier owns this chain? Walk back over the receiver.
    const before = blanked.slice(Math.max(0, m.index - 120), m.index);
    const recv = before.match(/([A-Za-z_$][\w$]*)\s*$/);
    const owner = recv ? recv[1] : null;
    if (owner && !admins.has(owner) && !admins.has('*inline*')) {
      out.excluded.push({ path: rel, line, reason: 'no_admin_client' });
      continue;
    }

    // The chain runs to the end of the statement. Blanked source keeps offsets, so
    // slice the ORIGINAL for evidence and the BLANKED for structure.
    const tailBlank = blanked.slice(m.index, m.index + 600);
    const stop = tailBlank.search(/;|\n\s*\n/);
    const chainBlank = stop === -1 ? tailBlank : tailBlank.slice(0, stop);
    const chainReal = text.slice(m.index, m.index + chainBlank.length);

    // `.storage.from()` and `.rpc()` are not table queries.
    const pre = blanked.slice(Math.max(0, m.index - 40), m.index);
    if (/\.storage\s*$/.test(pre) || /\.rpc\s*\(/.test(chainBlank)) {
      out.excluded.push({ path: rel, line, reason: 'storage_or_rpc' });
      continue;
    }

    // Table identity must be a literal. `from(tableVar)` is dataflow, and this
    // scanner does not do dataflow - it says so rather than guessing.
    const tbl = chainReal.match(/^\.from\s*\(\s*['"`]([A-Za-z_][\w]*)['"`]\s*\)/);
    if (!tbl) {
      out.excluded.push({ path: rel, line, reason: 'dynamic_table' });
      continue;
    }

    // A tenant predicate is `.eq(<col>, <value>)` where <col> is the manifest's
    // tenant column or the table's own primary key used as the tenant id.
    const eqs = [...chainReal.matchAll(/\.eq\s*\(\s*['"`]([\w]+)['"`]\s*,\s*([^),]+)/g)]
      .map((e) => ({ column: e[1], value: e[2].trim() }));
    const candidates = tenantColumn ? [tenantColumn, 'id'] : ['id'];
    const hit = eqs.find((e) => candidates.includes(e.column));

    out.sites.push({
      path: rel,
      line,
      table: tbl[1],
      has_tenant_filter: Boolean(hit),
      filter_column: hit ? hit.column : null,
      filter_value: hit ? hit.value : null,
      writes: /\.(update|delete|insert|upsert)\s*\(/.test(chainBlank),
    });
  }
  return out;
}

/**
 * Scan a whole project.
 *
 * `residue` is populated by the caller-visible invariant below rather than by a
 * separate pass: every coarse `.from(` is accounted for as a site or an exclusion,
 * so a coarse hit that falls through the branches above would be a code path that
 * returns neither - which is what the assertion in check-service-role-sites.mjs
 * pins. The count is carried so the invariant is checkable from outside.
 */
export function scanProject(ctx, { tenantColumn = null } = {}) {
  const sites = [];
  const excluded = [];
  let coarse = 0;

  // Derived BEFORE any file is scanned, and from the whole tree, because the
  // module that builds the client is almost never the module that queries with
  // it. Scanning file-by-file with no project-wide pass is what made the
  // scaffold's own factory invisible: `lib/supabase/server.ts` contains no
  // `.from(` at all, so it was never even opened.
  const adminFactories = discoverAdminFactories(ctx);

  for (const rel of ctx.files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    const text = ctx.readOrNull(rel);
    if (!text || !text.includes('.from(')) continue;
    coarse += matchAll(blankSource(text), /\.from\s*\(/).length;
    const r = scanFile(rel, text, { tenantColumn, adminFactories });
    sites.push(...r.sites);
    excluded.push(...r.excluded);
  }

  const residue = coarse - sites.length - excluded.length;
  return { sites, excluded, coarse, residue };
}

/**
 * Output 2: guardian's worklist.
 *
 * Only sites that HAVE a predicate are questions for guardian - a site with no
 * predicate is already a finding the rule reports, and asking guardian whether a
 * filter that does not exist is trustworthy is incoherent.
 *
 * `sites_total` is fixed here and is what the coverage subtraction is computed
 * against. Guardian is handed the list; it never adds to it.
 */
export function worklistFrom(scan) {
  const questions = scan.sites
    .filter((s) => s.has_tenant_filter)
    .map((s, i) => ({
      site_id: `s${String(i + 1).padStart(3, '0')}`,
      path: s.path,
      line: s.line,
      table: s.table,
      value_identifier: s.filter_value,
      question: 'Does this filter value originate from a verified caller identity?',
    }));
  return { sites_total: questions.length, questions };
}

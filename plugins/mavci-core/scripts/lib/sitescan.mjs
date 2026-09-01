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

/** Factories that hand back a service-role client. */
const ADMIN_FACTORY = /\b(getSupabaseAdminClient|createSupabaseAdminClient|getServiceRoleClient)\s*\(/;

/**
 * A `createClient(...)` whose key argument is a service-role env read, under either
 * documented spelling. Both are matched deliberately: finding 6's third instance was
 * a rule that knew one name for this key and was blind to a real client using the
 * other.
 */
const INLINE_ADMIN = /createClient\s*\(([\s\S]{0,400}?)\)/;
const SERVICE_KEY_NAME = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SERVICE_KEY/;

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
function adminIdentifiers(blanked, original) {
  const ids = new Set();
  for (const m of matchAll(blanked, ADMIN_FACTORY)) {
    const before = blanked.slice(Math.max(0, m.index - 80), m.index);
    const a = before.match(ASSIGN);
    if (a) ids.add(a[1]);
  }
  // Inline createClient(url, <service key>) - read the ORIGINAL for the env name,
  // because blankSource replaces string bodies and the key is often a literal.
  for (const m of matchAll(blanked, /createClient\s*\(/)) {
    const tail = original.slice(m.index, m.index + 400);
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
export function scanFile(rel, text, { tenantColumn = null } = {}) {
  const out = { sites: [], excluded: [], residue: [] };
  if (!text || !text.includes('.from(')) return out;

  const blanked = blankSource(text);
  const admins = adminIdentifiers(blanked, text);

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

  for (const rel of ctx.files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    const text = ctx.readOrNull(rel);
    if (!text || !text.includes('.from(')) continue;
    coarse += matchAll(blankSource(text), /\.from\s*\(/).length;
    const r = scanFile(rel, text, { tenantColumn });
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

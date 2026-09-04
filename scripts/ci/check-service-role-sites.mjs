#!/usr/bin/env node
/**
 * Behavioural self-test for the service-role site scan (lib/sitescan.mjs) and the
 * rule + worklist it feeds.
 *
 * WHY THIS EXISTS. `sites_total` is fixed at enumeration time, which is what makes
 * guardian's coverage decidable by subtraction - and which moves the risk onto the
 * enumeration itself. If the scan misses a site, guardian answers every question it
 * was handed, the subtraction balances, and the verdict reads as complete coverage
 * of a set that was wrong. The subtraction cannot be its own control.
 *
 * THE TWO NEGATIVE CONTROLS ARE THE POINT, AND THEY PULL IN OPPOSITE DIRECTIONS.
 *
 *   N1  an exclusion class is REMOVED   -> a coarse hit is classified as nothing
 *                                       -> residue goes non-zero and the scan fails
 *
 *   N2  an exclusion class is WIDENED   -> a real site is swallowed by it
 *                                       -> residue STAYS ZERO. The arithmetic
 *                                          balances perfectly over a shrunken set.
 *                                          Only sites_total moves.
 *
 * N2 is how this control gets defeated in practice. Nobody deletes an exclusion
 * class; someone broadens one to silence a false positive, and coverage drops while
 * every count remains internally consistent. **So the assertion for N2 is on
 * sites_total, not on residue** - the same move as asserting a denial's REASON
 * rather than its verdict: a correct total computed over a shrunken set is
 * indistinguishable from a correct total.
 *
 * N3 is not a negative control but a third section, added at 0.1.27: it scans the
 * SHIPPED SCAFFOLD rather than a fixture written to pass. Of its three assertions
 * exactly one is the control and two are diagnostics; which is which is stated in
 * full above the assertions themselves, and one of the two passes on the broken
 * build. Read that block before trusting the set.
 *
 * Mutations are applied to a COPY of the module in a temp directory and imported
 * from there. Production code carries no test seam: an `exclusions` override
 * parameter would be a hole shaped exactly like the thing being guarded.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCAN = path.join(ROOT, 'plugins/mavci-core/scripts/lib/sitescan.mjs');
const FX = path.join(ROOT, 'plugins/mavci-core/templates/fixtures/supabase.service_role_query_scoped');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

/** Fixture context for one subdirectory. */
function ctxFor(dir) {
  const base = path.join(FX, dir);
  const files = fs.readdirSync(base);
  return {
    manifest: { tenancy: { isolation: 'application-filters', tenant_column: 'company_id' } },
    files,
    readOrNull: (p) => { try { return fs.readFileSync(path.join(base, p), 'utf8'); } catch { return null; } },
  };
}

/** Import sitescan.mjs, optionally with a textual mutation applied. */
async function loadScan(mutate) {
  if (!mutate) return import(pathToFileURL(SCAN).href);
  const src = fs.readFileSync(SCAN, 'utf8');
  const out = mutate(src);
  if (out === src) throw new Error('mutation was a no-op - the anchor did not match, so the control proves nothing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-sitescan-'));
  // jsscan/fsx are imported relatively, so the copy has to sit beside them.
  const dest = path.join(dir, 'sitescan.mjs');
  fs.writeFileSync(dest, out, 'utf8');
  for (const dep of ['jsscan.mjs', 'fsx.mjs', 'schema.mjs']) {
    const p = path.join(ROOT, 'plugins/mavci-core/scripts/lib', dep);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dir, dep));
  }
  fs.copyFileSync(path.join(ROOT, 'plugins/mavci-core/scripts/config.mjs'), path.join(dir, '..', 'config.mjs'));
  return import(pathToFileURL(dest).href + `?t=${Date.now()}`);
}

/* ---------------------------------------------------------------- baseline */

const { scanProject, worklistFrom, EXCLUSION_REASONS } = await loadScan(null);
const rules = await import(pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/rules/index.mjs')).href);
const rule = rules.ruleById('supabase.service_role_query_scoped');

console.log('service-role site scan:');

// 1. KNOWN BY CONSTRUCTION. These counts are properties of the fixture files, not
//    of the scanner. If the scanner changes and these move, one of them is wrong.
const good = scanProject(ctxFor('good'), { tenantColumn: 'company_id' });
check(good.coarse === 3, `good/: coarse candidates = 3 (got ${good.coarse})`);
check(good.sites.length === 2, `good/: enumerated sites = 2 (got ${good.sites.length})`);
check(good.excluded.length === 1, `good/: declared exclusions = 1 (got ${good.excluded.length})`);
check(good.residue === 0, `good/: residue = 0 (got ${good.residue})`);

const badScan = scanProject(ctxFor('bad'), { tenantColumn: 'company_id' });
check(badScan.sites.length === 2, `bad/: enumerated sites = 2 (got ${badScan.sites.length})`);
check(badScan.residue === 0, `bad/: residue = 0 (got ${badScan.residue})`);

// 2. SKIPPED WITH A REASON, not absent. An omitted coarse hit and a named exclusion
//    look identical in the site count; only one of them is honest.
const reasons = good.excluded.map((e) => e.reason);
check(reasons.length > 0 && reasons.every((r) => r in EXCLUSION_REASONS),
  `good/: every exclusion carries a DECLARED reason (${JSON.stringify(reasons)})`);
check(good.excluded.every((e) => e.path && e.line),
  'good/: every exclusion names a path and line, so it can be audited');

// 3. THE TWO OUTPUTS COMPLEMENT, from one scan.
const goodFindings = rule.run(ctxFor('good'));
const badFindings = rule.run(ctxFor('bad'));
const wl = worklistFrom(good);
check(badFindings.length === 2, `bad/: rule reports both unfiltered sites (got ${badFindings.length})`);
check(goodFindings.length === 0, `good/: rule reports nothing (got ${goodFindings.length})`);
check(wl.sites_total === 2, `good/: worklist sites_total = 2 (got ${wl.sites_total})`);
check(wl.sites_total + badFindings.length * 0 + good.sites.filter((s) => !s.has_tenant_filter).length === good.sites.length,
  'good/: findings and worklist partition the sites with no overlap and no gap');

// 4. THE CONTROL TO KEEP CLOSEST: presence, not provenance.
const untrusted = goodFindings.filter((f) => (f.path || '').includes('untrusted'));
check(untrusted.length === 0,
  'the live bug (filter present, value from request body) yields ZERO findings - presence, not provenance');
check(wl.questions.some((q) => q.path.includes('untrusted')),
  'and it IS handed to guardian as a worklist question - seen, then routed, not skipped');

// 5. The boundary is in the shipped text, not only in a design document.
check(/CHECKS PRESENCE, NOT PROVENANCE/.test(rule.description),
  'rule.description states the boundary verbatim');

/* ------------------------------------------------- negative control N1: remove */

{
  const m = await loadScan((s) => s.replace(
    "      out.excluded.push({ path: rel, line, reason: 'no_admin_client' });\n      continue;\n    }\n\n    // Which identifier owns this chain?",
    '      continue;\n    }\n\n    // Which identifier owns this chain?'));
  const r = m.scanProject(ctxFor('good'), { tenantColumn: 'company_id' });
  check(r.residue !== 0,
    `N1 remove an exclusion class -> residue fires (got residue=${r.residue}, sites=${r.sites.length})`);
}

/* ------------------------------------------------ negative control N2: WIDEN */

{
  // Broaden `storage_or_rpc` until it swallows every real site - the shape of a
  // one-line change made to silence a false positive.
  const m = await loadScan((s) => s.replace(
    "    if (/\\.storage\\s*$/.test(pre) || /\\.rpc\\s*\\(/.test(chainBlank)) {",
    '    if (true) {'));
  const r = m.scanProject(ctxFor('good'), { tenantColumn: 'company_id' });
  const w = m.worklistFrom(r);

  // The arithmetic still balances. This is why residue cannot be the only control.
  check(r.residue === 0,
    `N2 widen an exclusion -> residue STAYS ZERO (${r.residue}); the arithmetic is no help here`);
  // The assertion that catches it is on the total, not the residue.
  check(r.sites.length < good.sites.length,
    `N2 widen an exclusion -> sites_total DROPS (${good.sites.length} -> ${r.sites.length}); the known-count assertion is what fails`);
  check(w.sites_total === 0,
    `N2 widen an exclusion -> guardian is handed an empty worklist it would answer completely (${w.sites_total})`);
}

/* ------------------------------- N3: THE SHIPPED SCAFFOLD IS THE FIXTURE ---
 *
 * 0.1.27. Every assertion above runs against fixtures under
 * templates/fixtures/supabase.service_role_query_scoped/, and all of them passed
 * for eleven releases while the scan was blind to the factory the plugin's OWN
 * scaffold exports. They passed BECAUSE the fixtures spell the factory using a
 * name the scanner already knew: they test the rule against inputs written to
 * satisfy it, which is the adjacent assertion, not the one that mattered.
 *
 * Measured on gate6, a project created by /mavci-core:new-project and otherwise
 * unmodified: the scaffold's Stripe webhook constructed a service-role client
 * and queried with it, and the scan excluded that line as `no_admin_client` -
 * an exclusion whose own text asserts the file constructs no service-role
 * client. sites_total was 0 and every check was green. Every project the
 * generator creates inherited it.
 *
 * So the fixture here is the SHIPPED SCAFFOLD, not a file written to pass. If
 * the scaffold ever builds a service-role client this scan cannot see, this
 * fails - whatever the factory ends up being called, and without anyone having
 * to remember to add the name in two places.
 */
{
  const scaffold = path.join(ROOT, 'plugins', 'mavci-core', 'templates', 'scaffold');
  const files = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r); else files.push(r);
    }
  }(scaffold, ''));

  const ctx = {
    files,
    readOrNull: (rel) => { try { return fs.readFileSync(path.join(scaffold, rel), 'utf8'); } catch { return null; } },
  };

  const m = await import(pathToFileURL(path.join(ROOT, 'plugins', 'mavci-core', 'scripts', 'lib', 'sitescan.mjs')).href);
  const r = m.scanProject(ctx, { tenantColumn: 'org_id' });

  /* WHICH ONE OF THESE THREE IS THE CONTROL, AND WHICH TWO ARE DIAGNOSTICS.
   *
   * Read this before trusting the set. Measured against the 0.1.26 build - the
   * derived names not passed into `scanProject`, AND `createAdminClient` removed
   * from the fallback list - exactly one of the three fails for the reason this
   * release exists:
   *
   *   [1] the factory is discovered      PASSES on the broken build   DIAGNOSTIC
   *   [2] the query is ENUMERATED        fails                        THE CONTROL
   *   [3] not excluded no_admin_client   fails                        DIAGNOSTIC
   *
   * [1] IS A UNIT CHECK, NOT THE CONTROL. It calls the derivation directly and
   * never asks whether `scanProject` uses it, so a build that derives the name
   * perfectly and then ignores it satisfies [1] in full - which is precisely the
   * build that shipped for eleven releases. Keeping it is worth it: when [2] goes
   * red, [1] is what says whether the derivation or the plumbing broke. On its own
   * it is coverage of nothing.
   *
   * [3] IS A UNIT CHECK ON THE REASON, NOT THE CONTROL EITHER. Its failure set is
   * a strict subset of [2]'s - any exclusion that swallows this query fails [2],
   * while [3] fails only when that exclusion is spelled `no_admin_client`. A later
   * defect losing the same site as `storage_or_rpc` or `dynamic_table` leaves [3]
   * green. It earns its place by naming WHICH exclusion ate the site.
   *
   * [2] IS THE CONTROL. The site reaching guardian's worklist is the entire claim,
   * and no build that loses it can satisfy this line whatever the reason given.
   *
   * The residue assertion below is a fourth line and is NOT a control here either:
   * it PASSES on the broken build. That is 0.1.27's finding restated - the
   * scaffold's query never fell through to residue, it was confidently classified
   * as `no_admin_client`, and residue counts only what the scan could not classify
   * at all.
   */

  // [1] DIAGNOSTIC - unit check on the derivation, not the control.
  const factories = m.discoverAdminFactories(ctx);
  check(factories.has('createAdminClient'),
    `N3 [1 diagnostic] the scaffold's own service-role factory is discovered from the code (got: ${[...factories].join(', ') || 'none'})`);

  const webhook = 'app/api/stripe/webhook/route.ts';
  const enumerated = r.sites.filter((s) => s.path === webhook);
  const excludedHere = r.excluded.filter((e) => e.path === webhook);

  // [2] THE CONTROL - the one assertion here that no broken build can satisfy.
  check(enumerated.length === 1,
    `N3 [2 THE CONTROL] the scaffold's service-role query is ENUMERATED as a site (got ${enumerated.length} site(s))`);
  // [3] DIAGNOSTIC - unit check on the exclusion REASON, not the control.
  check(!excludedHere.some((e) => e.reason === 'no_admin_client'),
    "N3 [3 diagnostic] the scaffold's service-role query is NOT excluded as `no_admin_client` - that reason asserts "
    + 'the file constructs no service-role client, which is false about this file');
  // Not a control here - see the block above: this PASSES on the broken build.
  check(r.residue === 0,
    `N3 [not a control] scanning the shipped scaffold leaves no residue (got ${r.residue})`);
}

/* ------------------------------------------------------------------ N4
 *
 * ATTRIBUTION IS PER EXPORT. The other half of N3, and it fails in the opposite
 * direction.
 *
 * N3 asserts the scan can SEE the scaffold's service-role query. Fixing that at
 * 0.1.27 was done by deriving factory names from the code, and the derivation
 * attributed every exported name in a module that built a service-role client
 * anywhere in it. `templates/scaffold/lib/supabase/server.ts` exports `createClient`
 * (anon, cookie-bound) beside `createAdminClient` (service role), so BOTH names
 * entered the admin set project-wide.
 *
 * What that cost, measured on gate6 at 0.1.27: an ordinary membership lookup on the
 * SESSION client - `.from('members').eq('user_id', user.id)`, filtered on the user
 * because the tenant is not known yet - was reported as an unscoped service-role
 * read, blocking a task whose approved spec REQUIRED that lookup to be on the
 * session client. Two agents traced it independently and neither could fix it from
 * inside the task, because the misattribution was here.
 *
 * The old code's own comment argued over-enumeration was safe, on the grounds that a
 * false site becomes a question guardian answers and a reviewer dismisses. THAT
 * ARGUMENT HOLDS ONLY FOR A SITE WITH A TENANT PREDICATE. `worklistFrom` filters on
 * `has_tenant_filter` before assigning site ids, so a falsely-attributed site
 * WITHOUT one never reaches guardian at all - it goes straight to the rule as a hard
 * blocker with no review step anywhere.
 *
 * WHICH ASSERTION IS THE CONTROL, in the same terms as N3:
 *
 *   [1] anon factory not discovered    fails on the broken build   DIAGNOSTIC
 *   [2] anon-owned query NOT a site    fails on the broken build   THE CONTROL
 *   [3] admin-owned query IS a site    PASSES on the broken build  THE GUARD
 *
 * [1] is a unit check on the derivation and says nothing about whether `scanProject`
 * uses it - the same argument N3 [1] makes about itself. [2] is the control: the
 * claim is that a query owned by the anon client is not treated as service-role,
 * and no build that treats it as one can satisfy that line whatever names it
 * derived. [3] is the guard against the cheap fix - a build that discovers NOTHING
 * satisfies [1] and [2] completely and is a total regression of N3, so [3] has to
 * fail it here rather than leaving it to N3 alone.
 *
 * The fixture is written rather than shipped, because the shape needs a CONSUMER
 * that queries through the anon factory and the scaffold has none. It is the
 * scaffold's own module shape - two exports, one building with the service key -
 * which is the shape that broke.
 */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-n4-'));
  const write = (rel, body) => {
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), body);
  };

  // The scaffold's shape: an anon factory and an admin factory, one module.
  write('lib/supabase/server.ts', [
    "import { createServerClient } from '@supabase/ssr'",
    "import { env } from '@/lib/env'",
    '',
    'export function createClient() {',
    '  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {',
    '    cookies: { getAll() { return [] }, setAll(list) { void list } },',
    '  })',
    '}',
    '',
    'export function createAdminClient() {',
    '  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {',
    '    cookies: { getAll() { return [] }, setAll() {} },',
    '  })',
    '}',
    '',
  ].join('\n'));

  // A consumer doing the ordinary thing: memberships on the session client keyed on
  // the user, then the tenant read on the service-role client keyed on the org.
  write('app/api/activity/route.ts', [
    "import { createClient, createAdminClient } from '@/lib/supabase/server'",
    '',
    'export async function GET() {',
    '  const supabase = createClient()',
    '  const { data: user } = await supabase.auth.getUser()',
    "  const { data: memberships } = await supabase.from('members').select('org_id').eq('user_id', user.id)",
    '  const orgId = memberships[0].org_id',
    '  const admin = createAdminClient()',
    "  const { data: events } = await admin.from('activity_events').select('*').eq('org_id', orgId)",
    '  return Response.json({ events })',
    '}',
    '',
  ].join('\n'));

  const files = ['lib/supabase/server.ts', 'app/api/activity/route.ts'];
  const ctx = {
    files,
    readOrNull: (rel) => { try { return fs.readFileSync(path.join(tmp, rel), 'utf8'); } catch { return null; } },
  };

  const m = await import(pathToFileURL(path.join(ROOT, 'plugins', 'mavci-core', 'scripts', 'lib', 'sitescan.mjs')).href);
  const factories = m.discoverAdminFactories(ctx);
  const r = m.scanProject(ctx, { tenantColumn: 'org_id' });
  const route = 'app/api/activity/route.ts';
  const siteTables = r.sites.filter((s) => s.path === route).map((s) => s.table);

  // [1] DIAGNOSTIC - the derivation, called directly.
  check(!factories.has('createClient'),
    `N4 [1 diagnostic] the anon factory exported beside an admin factory is NOT discovered as service-role (got: ${[...factories].join(', ') || 'none'})`);

  // [2] THE CONTROL - no build that misattributes the anon client can satisfy this.
  check(!siteTables.includes('members'),
    `N4 [2 THE CONTROL] a query owned by the ANON client is not enumerated as a service-role site (sites on this route: ${siteTables.join(', ') || 'none'})`);

  // [3] THE GUARD against the cheap fix - discovering nothing would satisfy [1] and [2].
  check(siteTables.includes('activity_events'),
    `N4 [3 guard] the query owned by the ADMIN client IS still enumerated (sites on this route: ${siteTables.join(', ') || 'none'})`);

  check(r.residue === 0, `N4 residue = 0 (got ${r.residue})`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ==========================================================================
 * N5 - THE CHAIN SPAN. gate6 finding 20.
 *
 * The span ended at `;` or a blank line. This repository's house style has no
 * semicolons and neither does the scaffold this plugin writes, so the only
 * delimiter left was a blank line - and a blank line is formatting. A read with no
 * predicate, followed by a read that has one, borrowed the second read's `.eq`.
 *
 * IT IS A BLOCKER-LEVEL FALSE NEGATIVE AND BOTH LAYERS CLEARED IT. The rule skips
 * any site already reported filtered, and `worklistFrom` then asked guardian to
 * verify an identifier that does not occur in the query - which guardian would
 * answer correctly about the identifier and meaninglessly about the site.
 *
 * THE FIXTURES ARE SEMICOLON-FREE ON PURPOSE. Every existing fixture in this file
 * terminates statements with semicolons, which is exactly why this survived: all of
 * them are correct under the old span and stay correct under the new one.
 *
 * THE THREE GROUPS ANSWER THREE DIFFERENT QUESTIONS, and the last two are
 * deliberately NOT computed from the scanner's own span. A check that asked the
 * scanner where the chain ended and then verified the predicate against that answer
 * would pass on any self-consistent wrong span - the obliging fake this repository
 * recorded at 0.1.30 and again in check-corpus-score's first S1b. So groups 2 and 3
 * locate the next `.from(` in the SOURCE themselves. That is the one place in this
 * work where the check reconstructing its own input is correct rather than a defect:
 * the invariant is a property of the source, not of the span.
 * ========================================================================== */

/** A service-role factory plus one of three two-read handler shapes. NO SEMICOLONS. */
function shapeCtx(shape) {
  const reads = {
    A: '  const { data: members } = await db.from("members").select("id")\n\n'
     + '  const { data: events } = await db.from("activity_events").select("id")'
     + '.eq("org_id", orgId)\n',
    B: '  const { data: members } = await db.from("members").select("id")\n'
     + '  const { data: events } = await db.from("activity_events").select("id")'
     + '.eq("org_id", orgId)\n',
    C: '  const [members, events] = await Promise.all([\n'
     + '    db.from("members").select("id"),\n'
     + '    db.from("activity_events").select("id").eq("org_id", orgId),\n'
     + '  ])\n',
  }[shape];
  const route = 'import { getServiceRoleClient } from "../../../lib/db"\n\n'
    + 'export const dynamic = "force-dynamic"\n\n'
    + 'export async function GET(req: Request) {\n'
    + '  const orgId = req.headers.get("x-org") ?? ""\n'
    + '  const db = getServiceRoleClient()\n\n'
    + reads
    + '\n  return Response.json({ members, events })\n}\n';
  const db = 'import { createClient } from "@supabase/supabase-js"\n'
    + 'export function getServiceRoleClient() {\n'
    + '  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, '
    + 'process.env.SUPABASE_SERVICE_ROLE_KEY!)\n}\n';
  const files = { 'app/api/activity/route.ts': route, 'lib/db.ts': db };
  return {
    text: route,
    ctx: {
      manifest: { tenancy: { isolation: 'application-filters', tenant_column: 'org_id' } },
      files: Object.keys(files),
      readOrNull: (p) => files[p] ?? null,
    },
  };
}

/**
 * The source region belonging to the chain whose `.from(` is on `line`: from that
 * `.from(` up to the next one, or end of file. Computed HERE, from the source, and
 * never from anything the scanner reported.
 */
function chainRegion(text, line) {
  const idx = [];
  for (const m of text.matchAll(/\.from\s*\(/g)) idx.push(m.index);
  const lineOfIdx = (i) => text.slice(0, i).split('\n').length;
  const own = idx.find((i) => lineOfIdx(i) === line);
  if (own === undefined) return null;
  const next = idx.find((i) => i > own);
  return text.slice(own, next === undefined ? text.length : next);
}

const scanShape = (mod, shape) => {
  const { text, ctx } = shapeCtx(shape);
  return { text, scan: mod.scanProject(ctx, { tenantColumn: 'org_id' }) };
};
const siteFor = (scan, table) => scan.sites.find((s) => s.table === table);

console.log('');
console.log('N5 chain span - two reads, no semicolons (gate6 finding 20):');

/* ---- group 1: the span itself, and it must DISCRIMINATE ------------------- */
for (const shape of ['A', 'B', 'C']) {
  const { scan } = scanShape({ scanProject }, shape);
  const members = siteFor(scan, 'members');
  const events = siteFor(scan, 'activity_events');
  check(members && members.has_tenant_filter === false && members.filter_value === null,
    `N5-${shape} [span] the members read has NO predicate of its own and is reported unfiltered `
    + `(got: has_tenant_filter=${members?.has_tenant_filter}, filter_value=${JSON.stringify(members?.filter_value)})`);
  // The guard: a span fix that swallowed everything would satisfy the line above for
  // all three shapes. Shape A was ALREADY correct before the fix, so it is the
  // discrimination half - the fix must not change it.
  check(events && events.has_tenant_filter === true && events.filter_value === 'orgId',
    `N5-${shape} [guard] the read that DOES carry .eq("org_id", orgId) is still reported filtered `
    + `(got: has_tenant_filter=${events?.has_tenant_filter}, filter_value=${JSON.stringify(events?.filter_value)})`);
  check(scan.residue === 0, `N5-${shape} residue = 0 (got ${scan.residue})`);
}

/* ---- group 1b: BOTH TERMINATORS ARE LOAD-BEARING -------------------------
 * `chainEnd` takes the MINIMUM of two stops, and shapes A-C exercise only one of
 * them: in every one of those, the next `.from(` arrives first, so a build that
 * dropped `;` and the blank line entirely passed all of group 1 and both controls.
 * That mutation went green on its first run and this block is what it produced.
 *
 * These two shapes have ONE admin read, no predicate, followed by an unrelated
 * `.eq("org_id", orgId)` with NO `.from(` between them - so the only thing that can
 * stop the span is the statement delimiter. Shape D uses a semicolon deliberately,
 * against the house style, because the semicolon is the half being asserted. */
{
  const tail = 'export const dynamic = "force-dynamic"\n\n'
    + 'export async function GET(req: Request) {\n'
    + '  const orgId = req.headers.get("x-org") ?? ""\n'
    + '  const db = getServiceRoleClient()\n\n';
  const db = 'import { createClient } from "@supabase/supabase-js"\n'
    + 'export function getServiceRoleClient() {\n'
    + '  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, '
    + 'process.env.SUPABASE_SERVICE_ROLE_KEY!)\n}\n';
  const shapes = {
    D: `${tail}  const { data } = await db.from("members").select("id");\n`
     + '  const scoped = rows.eq("org_id", orgId);\n'
     + '  return Response.json({ data, scoped })\n}\n',
    E: `${tail}  const { data } = await db.from("members").select("id")\n\n`
     + '  const scoped = rows.eq("org_id", orgId)\n'
     + '  return Response.json({ data, scoped })\n}\n',
  };
  for (const [name, route] of Object.entries(shapes)) {
    const files = { 'app/api/activity/route.ts': route, 'lib/db.ts': db };
    const scan = scanProject({
      manifest: { tenancy: { isolation: 'application-filters', tenant_column: 'org_id' } },
      files: Object.keys(files),
      readOrNull: (p) => files[p] ?? null,
    }, { tenantColumn: 'org_id' });
    const members = siteFor(scan, 'members');
    check(members && members.has_tenant_filter === false,
      `N5-${name} [delimiter] a chain ended by ${name === 'D' ? 'a semicolon' : 'a blank line'} does `
      + 'not reach an `.eq` in the NEXT statement when no `.from(` intervenes '
      + `(got: has_tenant_filter=${members?.has_tenant_filter}, filter_value=${JSON.stringify(members?.filter_value)})`);
  }
}

/* ---- group 2: the INVARIANT, independent of how the span is computed ------ */
{
  let violations = [];
  for (const shape of ['A', 'B', 'C']) {
    const { text, scan } = scanShape({ scanProject }, shape);
    for (const s of scan.sites.filter((x) => x.has_tenant_filter)) {
      const region = chainRegion(text, s.line);
      if (region === null || !region.includes(s.filter_value)) {
        violations.push(`${shape}:${s.table}:${s.filter_value}`);
      }
    }
  }
  check(violations.length === 0,
    'N5 [invariant] every site reported filtered names a predicate occurring BEFORE the next '
    + `.from( in the source - the property the span is a means to (violations: ${violations.join(', ') || 'none'})`);
}

/* ---- group 3: what the scanner FEEDS. Its own case, different subject ----- */
{
  let violations = [];
  let questions = 0;
  for (const shape of ['A', 'B', 'C']) {
    const { text, scan } = scanShape({ scanProject }, shape);
    for (const q of worklistFrom(scan).questions) {
      questions += 1;
      const region = chainRegion(text, q.line);
      if (region === null || !region.includes(q.value_identifier)) {
        violations.push(`${shape}:${q.site_id}:${q.value_identifier}`);
      }
    }
  }
  check(questions > 0 && violations.length === 0,
    `N5 [worklist] every guardian question's value_identifier occurs in the chain the question `
    + `is about, across ${questions} question(s) (violations: ${violations.join(', ') || 'none'}). `
    + 'Group 2 is about the site; this is about the question built from it, and a worklist that '
    + 'asked about an identifier absent from the query is what guardian would answer correctly '
    + 'and meaninglessly');
}

/* ---- the negative control: the pre-0.1.32 span, demonstrated failing ------ */
{
  const old = await loadScan((src) => src.replace(
    '    const chainBlank = tailBlank.slice(0, chainEnd(tailBlank));',
    '    const stop = tailBlank.search(/;|\\n\\s*\\n/);\n'
    + '    const chainBlank = stop === -1 ? tailBlank : tailBlank.slice(0, stop);'));

  const borrowed = [];
  const correctA = [];
  for (const shape of ['A', 'B', 'C']) {
    const { text, scan } = scanShape(old, shape);
    const members = siteFor(scan, 'members');
    if (members?.has_tenant_filter) borrowed.push(`${shape} (filter_value=${members.filter_value})`);
    const region = chainRegion(text, members?.line ?? -1);
    if (members?.has_tenant_filter && region && !region.includes(members.filter_value)) {
      correctA.push(shape);
    }
  }
  check(borrowed.length === 2 && !borrowed.some((b) => b.startsWith('A')),
    'N5 CONTROL: against the pre-0.1.32 span exactly shapes B and C borrow the next read\'s '
    + `predicate, and shape A does not - so the fix discriminates rather than merely changing `
    + `the answer (borrowed: ${borrowed.join('; ') || 'none'})`);
  check(correctA.length === 2,
    'N5 CONTROL: and the group-2 invariant catches both of them independently of the span - '
    + `it is not a restatement of the span assertion (caught: ${correctA.join(', ') || 'none'})`);
}

/* ---------------------------------------------------------------- verdict */

console.log('');
if (failures.length) {
  console.log(`service-role site scan check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('service-role site scan: enumeration, both outputs, and both negative controls behave as specified');

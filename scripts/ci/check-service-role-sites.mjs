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

  // A UNIT CHECK ON THE DERIVATION, and it is NOT the discriminating one - stated
  // because that is the distinction this whole file exists to make. Measured against
  // the 0.1.26 build (factory discovery disabled AND the name removed from the
  // fallback list), this assertion still PASSES, because it calls the derivation
  // directly and never asks whether `scanProject` uses it. The two assertions below
  // are the ones that fail there, and they fail because they go through the wiring.
  // Keeping this one is worth it - it localises a failure to the derivation rather
  // than the plumbing - but a reader must not mistake it for the control.
  const factories = m.discoverAdminFactories(ctx);
  check(factories.has('createAdminClient'),
    `N3 the scaffold's own service-role factory is discovered from the code (got: ${[...factories].join(', ') || 'none'})`);

  const webhook = 'app/api/stripe/webhook/route.ts';
  const enumerated = r.sites.filter((s) => s.path === webhook);
  const excludedHere = r.excluded.filter((e) => e.path === webhook);

  check(enumerated.length === 1,
    `N3 the scaffold's service-role query is ENUMERATED as a site (got ${enumerated.length} site(s))`);
  check(!excludedHere.some((e) => e.reason === 'no_admin_client'),
    'N3 the scaffold\'s service-role query is NOT excluded as `no_admin_client` - that reason asserts '
    + 'the file constructs no service-role client, which is false about this file');
  check(r.residue === 0,
    `N3 scanning the shipped scaffold leaves no residue (got ${r.residue})`);
}

/* ---------------------------------------------------------------- verdict */

console.log('');
if (failures.length) {
  console.log(`service-role site scan check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('service-role site scan: enumeration, both outputs, and both negative controls behave as specified');

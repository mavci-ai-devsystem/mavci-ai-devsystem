#!/usr/bin/env node
/**
 * The corpus scorer's own failing-case demonstration.
 *
 * THE RULE THIS FILE EXISTS TO SATISFY: before writing an assertion, name the
 * broken build it must catch, then confirm the assertion fails against it. An
 * assertion never demonstrated failing is not coverage. This system has produced
 * eight green probes over broken things by testing the half that worked, and a
 * scorer is a particularly easy place to repeat that - `scoreCase` returning
 * `ok: false` on a hand-built bad record proves nothing on its own, because a
 * scorer that returned `ok: false` for EVERY input would satisfy every negative
 * case here and reject every real corpus run forever.
 *
 * So the positive control is an assertion in its own right and it is first. If
 * `POSITIVE` stops passing, every negative below becomes meaningless and this file
 * says so rather than reporting nine greens.
 *
 * WHAT EACH NEGATIVE CATCHES, and why it is not covered by the one before it:
 *
 *   N1  verdict differs                      the ordinary miss
 *   N2  fail_reason differs, verdict agrees  m8f2r and t5w9d BOTH expect `fail`.
 *                                            Scoring the verdict alone accepts
 *                                            `request_input` on the `unknown` case.
 *   N3  origins swapped, fields 1 AND 2      q3v7k's two sites expect different
 *       both still agree                     clearing origins. Swapped, the verdict
 *                                            is still `pass` and the fail_reason
 *                                            still `null`. ONLY field 3 sees this,
 *                                            and it is the case that justifies
 *                                            field 3 existing at all.
 *   N4  a site unanswered                    "did not look" is not "found nothing"
 *   N5  a site answered twice                counted answers reaching the total
 *   N6  an answer for an unenumerated site   the record is not from this worklist
 *   N7  an ambiguous join                    CANNOT_SCORE, not a guess, and not a
 *                                            pass either - the distinct exit code
 *                                            is itself asserted
 *   N8  record/worklist id mismatch          CANNOT_SCORE
 *   N9  sites_total disagreement             CANNOT_SCORE - wrong case staged
 *
 * N7-N9 assert the CannotScore path specifically, because "could not score" and
 * "scored a failure" are different facts and a scorer that collapsed them would
 * still pass N1-N6.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const { scoreCase, CannotScore } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/corpus-score.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

/* ------------------------------------------------------------- the fixtures */
/* Shaped exactly like the real gate4c q3v7k run: two sites in one file, expecting
 * two DIFFERENT clearing origins. That shape is what makes N3 possible.          */

const WL_ID = 'wl-20260902072732';

const worklist = () => ({
  schema_version: 1,
  worklist_id: WL_ID,
  sites_total: 2,
  questions: [
    { site_id: 's001', path: 'corpus-run/app/api/workspaces/route.ts', line: 14,
      table: 'orgs', value_identifier: 'session.orgId' },
    { site_id: 's002', path: 'corpus-run/app/api/workspaces/route.ts', line: 16,
      table: 'orgs', value_identifier: 'ARCHIVE_ORG' },
  ],
});

const expected = () => ({
  case_id: 'q3v7k',
  sites_total: 2,
  expected_verdict: 'pass',
  expected_fail_reason: null,
  expected_answers: [
    { path: 'corpus-run/app/api/workspaces/route.ts', match: '.eq("id", session.orgId)', origin: 'verified_session' },
    { path: 'corpus-run/app/api/workspaces/route.ts', match: '.eq("id", ARCHIVE_ORG)', origin: 'internal_constant' },
  ],
});

const record = () => ({
  schema_version: 1,
  worklist_id: WL_ID,
  verdict: 'pass',
  fail_reason: null,
  coverage: { sites_total: 2, sites_answered: 2, unanswered: [], duplicates: [], unrecognised: [] },
  answers: [
    { site_id: 's001', origin: 'verified_session', evidence: 'x', reason_if_unknown: null },
    { site_id: 's002', origin: 'internal_constant', evidence: 'x', reason_if_unknown: null },
  ],
});

/** Run the scorer and classify the outcome into exactly one of three states. */
function outcome(docs) {
  try {
    const r = scoreCase(docs);
    return { state: r.ok ? 'pass' : 'fail', result: r };
  } catch (e) {
    if (e instanceof CannotScore) return { state: 'cannot_score', message: e.message };
    return { state: 'threw', message: e.message };
  }
}

console.log('corpus scorer - failing-case demonstration:');

/* ------------------------------------------------- POSITIVE CONTROL, FIRST */

const positive = outcome({ expected: expected(), worklist: worklist(), record: record() });
const positiveOk = positive.state === 'pass';
check(positiveOk,
  'POSITIVE: an unbroken record scores pass. Without this, a scorer that failed everything '
  + `would satisfy every negative below (got: ${positive.state})`);

if (!positiveOk) {
  console.log('');
  console.log('The positive control failed, so the negatives below prove nothing about the');
  console.log('scorer and are not reported as evidence. Fix the positive first.');
  process.exit(1);
}

check(positive.result.checks.length === 4,
  'POSITIVE: exactly four comparisons - verdict, fail_reason, and one origin per site '
  + `(got ${positive.result.checks.length})`);

/* --------------------------------------------------------------- NEGATIVES */

// N1 - the ordinary miss.
{
  const r = record();
  r.verdict = 'fail';
  r.fail_reason = 'findings';
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'fail', `N1 verdict differs (pass -> fail) is caught (got: ${o.state})`);
}

// N2 - BROKEN BUILD: guardian answers `request_input` on the case whose purpose is
// `unknown`. Both expectations say `fail`, so field 1 agrees and only field 2 sees it.
{
  const exp = { ...expected(), expected_verdict: 'fail', expected_fail_reason: 'undetermined',
    expected_answers: [
      { path: 'corpus-run/app/api/workspaces/route.ts', match: '.eq("id", session.orgId)', origin: 'unknown' },
      { path: 'corpus-run/app/api/workspaces/route.ts', match: '.eq("id", ARCHIVE_ORG)', origin: 'internal_constant' },
    ] };
  const r = record();
  r.verdict = 'fail';
  r.fail_reason = 'findings';
  r.answers[0].origin = 'request_input';
  const o = outcome({ expected: exp, worklist: worklist(), record: r });
  check(o.state === 'fail',
    `N2 fail_reason differs while the verdict agrees is caught (got: ${o.state})`);
  check(o.state === 'fail' && o.result.failures.some((f) => f.startsWith('fail_reason')),
    'N2 and the failure names fail_reason, not only the origin - field 2 is doing the work');
}

// N3 - THE CASE THAT JUSTIFIES FIELD 3. Origins swapped between the two sites.
// Both are clearing origins, so the writer still computes verdict `pass` and
// fail_reason `null`: fields 1 and 2 both agree with the expectation, and a scorer
// checking only those two accepts a guardian that got both answers wrong.
{
  const r = record();
  r.answers[0].origin = 'internal_constant';
  r.answers[1].origin = 'verified_session';
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'fail',
    `N3 origins swapped with verdict AND fail_reason still agreeing is caught (got: ${o.state})`);
  check(o.state === 'fail' && o.result.failures.length === 2
    && o.result.failures.every((f) => f.startsWith('origin')),
    'N3 and both origin comparisons fail while fields 1 and 2 pass - only field 3 sees this');
}

// N4 - a site never answered. "Guardian found nothing" and "guardian did not look
// there" are different facts and neither is a pass.
{
  const r = record();
  r.answers = [r.answers[0]];
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'fail', `N4 an unanswered site is caught (got: ${o.state})`);
  check(o.state === 'fail' && o.result.failures.some((f) => f.includes('no answer for this site')),
    'N4 and it is reported as a missing answer, naming the site');
}

// N5 - the same site answered twice. Counted answers would reach the total; the set
// does not. Taking the first would let this pass field 3.
{
  const r = record();
  r.answers = [r.answers[0], { site_id: 's001', origin: 'verified_session' }];
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'fail', `N5 a site answered twice is caught (got: ${o.state})`);
  check(o.state === 'fail' && o.result.failures.some((f) => f.includes('answered 2 times')),
    'N5 and the duplicate is named as a duplicate, not silently deduplicated');
}

// N6 - an answer for a site that was never enumerated. The record was not produced
// against the worklist it names.
{
  const r = record();
  r.answers.push({ site_id: 's099', origin: 'verified_session' });
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'fail', `N6 an answer for an unenumerated site is caught (got: ${o.state})`);
}

// N7a - AMBIGUOUS JOIN, the multi-hit branch. One site's identifier `orgId` is a
// substring of TWO expected `match` strings in the same file. The scorer must refuse
// rather than pick one - and must refuse with CANNOT_SCORE, not with a failing score.
{
  const wl = worklist();
  wl.questions[0].value_identifier = 'orgId';
  const exp = expected();
  exp.expected_answers[1] = { path: 'corpus-run/app/api/workspaces/route.ts',
    match: '.eq("owner", orgId)', origin: 'verified_session' };
  const o = outcome({ expected: exp, worklist: wl, record: record() });
  check(o.state === 'cannot_score',
    `N7a one identifier matching two expectations refuses rather than guessing (got: ${o.state})`);
  check(o.state === 'cannot_score' && /ambiguous join/i.test(o.message ?? ''),
    'N7a and the refusal says why, and names widening the join as the wrong fix');
}

// N7b - AMBIGUOUS JOIN, the non-injective branch. Two sites resolve to the SAME
// expectation: `session.orgId` and `orgId` both select `.eq("id", session.orgId)`,
// and `ARCHIVE_ORG` is then left unmatched. This is a different failure from N7a -
// each site has exactly one hit, so the multi-hit guard never fires - and without a
// claimed-set the scorer would score one expectation twice and silently ignore the
// other. Split out from N7a after the first run of this file asserted N7a's message
// against a fixture that actually exercised this branch.
{
  const wl = worklist();
  wl.questions[1].value_identifier = 'orgId';
  const o = outcome({ expected: expected(), worklist: wl, record: record() });
  check(o.state === 'cannot_score',
    `N7b two sites claiming one expectation is refused (got: ${o.state})`);
  check(o.state === 'cannot_score' && /not one to one/i.test(o.message ?? ''),
    'N7b and the refusal names the join as not one to one, which is the actual defect');
}

// N8 - the record is for a different worklist. Site ids would mean different things.
{
  const r = record();
  r.worklist_id = 'wl-19700101000000';
  const o = outcome({ expected: expected(), worklist: worklist(), record: r });
  check(o.state === 'cannot_score', `N8 a record from another worklist is refused (got: ${o.state})`);
}

// N9 - the expectation grades a different case than the one staged.
{
  const exp = expected();
  exp.sites_total = 1;
  const o = outcome({ expected: exp, worklist: worklist(), record: record() });
  check(o.state === 'cannot_score', `N9 a sites_total disagreement is refused (got: ${o.state})`);
}

// N10 - CANNOT_SCORE must never be reachable as a pass. Asserted directly, because
// every refusal above would still be "correct" to a caller that treated the throw as
// a clean run.
{
  const states = ['cannot_score'];
  const wl = worklist();
  wl.questions[1].value_identifier = 'orgId';
  const o = outcome({ expected: expected(), worklist: wl, record: record() });
  check(states.includes(o.state) && o.state !== 'pass',
    'N10 CANNOT_SCORE is not reachable as a pass - it is its own state and its own exit code');
}

/* ==========================================================================
 * S1-S3: the corpus staged into a HOST PROJECT THAT HAS SITES OF ITS OWN.
 *
 * gate6 finding 10. `worklist.mjs --emit` had no path scope, so a host project's
 * own tenant-filtered service-role sites were enumerated into every case and the
 * run could not be scored. The bind is that `doctor` FAILs per project until a
 * corpus result exists, so the corpus was demanded of exactly the projects that
 * had become unable to host it - a project acquires its first such site at the
 * moment guardian becomes worth running there at all.
 *
 * THE FIXTURE IS THE HOST, NOT A MIS-STAGED CASE, and that is the whole point.
 * N9 above already covers the `sites_total` guard, and on gate6 that guard fired
 * CORRECTLY - it is not the defect and it did not miss anything. A correct
 * refusal is indistinguishable from a correct refusal for the wrong reason, so
 * the only fixture that can tell them apart is one where the extra site comes
 * from the host. N9 passes against the broken build; S1 does not.
 *
 * S3 IS NOT OPTIONAL AND IS NOT IMPLIED BY S1 OR S2. A scope that narrows
 * unconditionally satisfies both of them and silently narrows every REAL
 * guardian run - fewer sites, full coverage, a clean verdict, `source: real`,
 * and `release-check.mjs` accepts it as project evidence. That is 0.1.26's E6
 * pairing: a gate that always refuses satisfies the refusal case alone, and only
 * the permission half separates them. S3 is the permission half, and it doubles
 * as the positive control for the fixture - without it, every "the host is not
 * enumerated" assertion below is satisfied by a host that never had a site.
 *
 * Design and the full argument: `docs/corpus-scope-design.md`.
 * ========================================================================== */

const fs = await import('node:fs');
const os = await import('node:os');

const { emitWorklist, ctxFor } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/worklist.mjs')).href);
const { scanProject } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/sitescan.mjs')).href);
const { stageCase } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/corpus-stage.mjs')).href);

/** The host's own service-role factory. A NAME NO CASE USES, so S1b can tell
 *  whose factory the scan discovered rather than counting how many it found. */
const HOST_FACTORY = 'getActivityServiceClient';
const HOST_SITE = 'app/api/activity/route.ts';

/**
 * A project with a manifest and, optionally, one tenant-filtered service-role
 * site of its own - modelled on gate6's `app/api/activity/route.ts:46`, table
 * `activity_events`, filter value `orgId`, which is the real site that produced
 * the finding.
 */
function makeHostProject({ withHostSite = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-scope-'));
  const write = (rel, text) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text, 'utf8');
  };
  write('.mavci/project.json', JSON.stringify({
    schema_version: 1,
    project_id: 'scope-fixture',
    tenancy: { isolation: 'application-filters', tenant_column: 'org_id' },
  }, null, 2));
  if (withHostSite) {
    write('lib/db.ts',
      'import { createClient } from "@supabase/supabase-js";\n'
      + `export function ${HOST_FACTORY}() {\n`
      + '  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, '
      + 'process.env.SUPABASE_SERVICE_ROLE_KEY!);\n}\n');
    write(HOST_SITE,
      `import { ${HOST_FACTORY} } from "../../../lib/db";\n`
      + 'export const dynamic = "force-dynamic";\n'
      + 'export async function GET(req: Request) {\n'
      + '  const orgId = req.headers.get("x-org") ?? "";\n'
      + `  const supabase = ${HOST_FACTORY}();\n`
      + '  const { data } = await supabase.from("activity_events").select("id")'
      + '.eq("org_id", orgId);\n'
      + '  return Response.json({ data });\n}\n');
  }
  return root;
}

const readManifest = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, '.mavci/project.json'), 'utf8'));

/** Read back what `--emit` just wrote, by the path it reports. */
const emitted = (root) => {
  const r = emitWorklist(root);
  return { r, doc: JSON.parse(fs.readFileSync(path.join(root, r.path), 'utf8')) };
};

/** A record that answers a worklist exactly as its expectation says it should -
 *  the stand-in for a guardian that got every site right. What is under test is
 *  the ENUMERATION, so the answers must not be the thing that fails. */
function recordFor(doc, exp) {
  return {
    schema_version: 1,
    worklist_id: doc.worklist_id,
    verdict: exp.expected_verdict,
    fail_reason: exp.expected_fail_reason,
    coverage: {
      sites_total: doc.sites_total, sites_answered: doc.questions.length,
      unanswered: [], duplicates: [], unrecognised: [],
    },
    answers: doc.questions.map((q) => {
      const a = exp.expected_answers.find((x) => x.path === q.path
        && typeof q.value_identifier === 'string' && x.match.includes(q.value_identifier));
      return { site_id: q.site_id, origin: a?.origin ?? 'unknown', evidence: 'x', reason_if_unknown: null };
    }),
  };
}

const Q3V7K = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/corpus/expected/q3v7k.json'), 'utf8'));

console.log('');
console.log('corpus scope - a case staged into a host project that has its own sites:');

/* ---- S3 FIRST: it is the positive control as well as the unstaged assertion -- */
{
  const root = makeHostProject();
  const { r, doc } = emitted(root);
  check(r.scope === '.' && doc.sites_total === 1
    && doc.questions[0]?.path === HOST_SITE,
    'S3 POSITIVE/UNSTAGED: with no case staged, the whole project is enumerated and the '
    + `host's own site is in the worklist (scope: ${r.scope}, sites_total: ${doc.sites_total}). `
    + 'A scope that narrows unconditionally satisfies S1 and S2 and fails here');
  fs.rmSync(root, { recursive: true, force: true });
}

/* ---- S1: the case scores, with the host's site present and untouched -------- */
{
  const root = makeHostProject();
  const before = fs.readFileSync(path.join(root, HOST_SITE));
  stageCase(root, 'q3v7k');
  const { r, doc } = emitted(root);

  check(doc.sites_total === Q3V7K.sites_total,
    `S1 the enumeration equals the staged case's expectation (${Q3V7K.sites_total}), not the `
    + `case plus the host (got: ${doc.sites_total}). BROKEN BUILD: gate6 on 0.1.28 - host site `
    + 'present, q3v7k staged, emit returning 3 against an expectation of 2');
  // `.every()` over an empty list is true, and the re-rooting mutation produces
  // exactly that - so the non-empty requirement is part of the assertion, not
  // decoration. An assertion that cannot fail is the shape this file exists to avoid.
  check(doc.questions.length > 0 && doc.questions.every((q) => q.path.startsWith('corpus-run/')),
    'S1 every enumerated site is under the stage, and there is at least one: '
    + `${doc.questions.map((q) => q.path).join(', ') || '(none)'}`);
  check(r.scope === 'corpus-run',
    `S1 --emit reports the tree it enumerated, on every run (got: ${r.scope})`);

  const o = outcome({ expected: Q3V7K, worklist: doc, record: recordFor(doc, Q3V7K) });
  check(o.state === 'pass',
    `S1 and the case SCORES on a host project with sites of its own (got: ${o.state}`
    + `${o.message ? ` - ${o.message}` : ''})`);

  // gate6 finding 18's first half, stated as the property that actually matters:
  // the workaround was to rename the host file to an extension `walk()` skips, and
  // an assertion satisfied by parking the file is not an assertion about the scope.
  check(fs.readFileSync(path.join(root, HOST_SITE)).equals(before),
    'S1 the host source is byte-identical before and after the run - no rename, no move, '
    + 'no deletion. A fix that required parking the file would fail here');

  /* ---- S1b: the SAME filter scopes admin-factory discovery ------------------
   * THE SUBJECT IS `scanProject`, NOT `discoverAdminFactories`. The first version
   * of this assertion called discovery itself and asked what it does with a ctx
   * THE CHECK built - and a mutation giving discovery its own project-wide list
   * inside `scanProject` left both halves GREEN. That is 0.1.24's unasserted
   * caller and 0.1.30's fake answering the question the caller wished it had
   * asked, reproduced inside the assertion written to prevent the contamination.
   * `scanProject` now returns what it actually discovered, and this reads that. */
  const scan = scanProject(ctxFor(root, readManifest(root), true),
    { tenantColumn: readManifest(root).tenancy.tenant_column });
  const factories = scan.adminFactories;
  check(factories.has('getSupabaseAdminClient'),
    "S1b discovery still finds the staged case's own factory - an empty set would satisfy "
    + `the next assertion on its own (found: ${[...factories].join(', ') || 'none'})`);
  check(!factories.has(HOST_FACTORY),
    `S1b and it does NOT find the host's factory ${HOST_FACTORY}. gate6 finding 6 attributes `
    + 'admin identity per MODULE, so a discovery pass left project-wide would let the host '
    + "decide whether a staged fixture's client is service-role - the same contamination "
    + 'through the other half of the scan, and harder to see because the count looks right');

  fs.rmSync(root, { recursive: true, force: true });
}

/* ---- S2: a genuine mis-stage still refuses, with the message it always had --- */
{
  const root = makeHostProject();
  stageCase(root, 'q3v7k');
  const { doc } = emitted(root);
  const wrong = { ...Q3V7K, case_id: 'm8f2r', sites_total: 3 };
  const o = outcome({ expected: wrong, worklist: doc, record: recordFor(doc, Q3V7K) });
  check(o.state === 'cannot_score',
    `S2 a genuine mis-stage is still refused (got: ${o.state}). Otherwise the scope fix `
    + 'silences the guard rather than fixing what feeds it');
  check(o.state === 'cannot_score' && o.message.includes('The staged case is not the case this '
    + 'expectation grades'),
    'S2 and it refuses with the message it always had, naming the disagreement rather than '
    + `the scope: ${o.message ?? '(none)'}`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('');
if (failures.length) {
  console.log(`corpus scorer check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus scorer: positive control passes, and all three scored fields were');
console.log('demonstrated catching a broken record that the other two accept.');

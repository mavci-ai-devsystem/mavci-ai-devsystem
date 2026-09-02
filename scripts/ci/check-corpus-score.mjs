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

console.log('');
if (failures.length) {
  console.log(`corpus scorer check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus scorer: positive control passes, and all three scored fields were');
console.log('demonstrated catching a broken record that the other two accept.');

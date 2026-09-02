#!/usr/bin/env node
/**
 * Mavci Core - the corpus scorer. Deterministic, and that is the whole point.
 *
 * WHY THIS EXISTS. Every other verdict in this system is routed away from the
 * party being judged. Guardian emits per-site answers and `guardian-record.mjs`
 * computes the verdict from them; the release gate then recomputes that verdict
 * from the coverage numbers rather than trusting the record. Then the corpus -
 * the acceptance test for guardian's judgement, and the only evidence that
 * guardian answers correctly at all - was scored by a model reading two JSON
 * files and asserting they agreed.
 *
 * That was the least-scrutinised step in the run that produced the corpus result,
 * and nothing would have caught it scoring wrong. A model that mis-scores here
 * does not fail loudly: it produces a green corpus, `doctor` clears its FAIL, and
 * every guardian verdict afterwards rests on it. This module is the subtraction
 * for that step. No model reads anything. Three fields.
 *
 * ------------------------------------------------------ THE THREE SCORED FIELDS
 *
 *   1  record.verdict      ==  expected.expected_verdict
 *   2  record.fail_reason  ==  expected.expected_fail_reason
 *   3  each site's origin  ==  the expected origin for that site
 *
 * NONE OF THE THREE IS REDUNDANT, and the corpus is built so that each one catches
 * a broken record the other two accept:
 *
 *   - m8f2r and t5w9d BOTH expect `fail`. They differ only in `fail_reason`
 *     (`findings` vs `undetermined`). A scorer checking the verdict alone accepts
 *     guardian answering `request_input` on the case whose entire purpose is to
 *     exercise `unknown` - the guess the design named as the thing to refuse.
 *   - q3v7k's two sites expect DIFFERENT clearing origins (`verified_session` and
 *     `internal_constant`). Swap them and the verdict is still `pass` and the
 *     fail_reason still `null`. Only field 3 sees it.
 *   - and a record that never answered a site at all is caught by field 3 naming
 *     that site, not merely by the writer's `coverage_incomplete`.
 *
 * Each of those is demonstrated FAILING in scripts/ci/check-corpus-score.mjs.
 * That file exists because an assertion never shown failing is not coverage.
 *
 * -------------------------------------------------------------------- THE JOIN
 *
 * The three documents key sites three different ways and none of them shares a key
 * with another:
 *
 *   expected/<case>.json   { path, match, origin }        - authored by hand
 *   <worklist-id>.json     { site_id, path, line, value_identifier }
 *   records/<id>.json      { site_id, origin }
 *
 * The record joins to the worklist on `site_id` directly. The worklist joins to the
 * expectations on `path` plus `match` containing `value_identifier` - the scanner
 * names the identifier it enumerated, and the hand-written expectation quotes the
 * whole predicate around it.
 *
 * THAT JOIN MUST BE ONE-TO-ONE OR THE RUN IS NOT SCORED. A substring join can be
 * ambiguous (two sites in one file whose identifiers nest, say `orgId` and
 * `session.orgId`), and an ambiguous join resolved by picking one is a scorer
 * guessing - which is the exact failure this module was written to remove. On any
 * ambiguity it exits CANNOT_SCORE and names both candidates. Widening the join is
 * not the fix; making the expectation quote a longer `match` is.
 *
 * ------------------------------------------------- CANNOT_SCORE IS NOT A VERDICT
 *
 * Exit 1 means the case scored FAIL. Exit 2 means the scorer could not decide.
 * Both are non-zero and neither is a pass, for the same reason `no_report` is a
 * failure in coverage.mjs: "the case failed" and "I could not tell" are different
 * facts, and conflating either with success is how a green tick stops meaning
 * anything. They are separated so the operator knows which one they have.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EXPECTATIONS } from './corpus-stage.mjs';

export const EXIT = { PASS: 0, FAIL: 1, CANNOT_SCORE: 2 };

/** The scored fields, named once so the report and the checks cannot drift apart. */
export const SCORED_FIELDS = ['verdict', 'fail_reason', 'origin'];

export class CannotScore extends Error {}
const cannot = (msg) => { throw new CannotScore(msg); };

/**
 * Join worklist sites to expected answers, one to one, or refuse.
 * @returns {Array<{site_id: string, path: string, value_identifier: string, expected_origin: string}>}
 */
function joinSites(worklist, expected) {
  const questions = worklist?.questions ?? [];
  const answers = expected?.expected_answers ?? [];

  if (!questions.length) cannot('the worklist enumerates no sites, so there is nothing to score');
  if (questions.length !== answers.length) {
    cannot(`the worklist has ${questions.length} site(s) and the expectation has ${answers.length} `
      + 'answer(s). These must correspond exactly; a mismatch means the staged case and the '
      + 'worklist are not from the same run.');
  }

  const claimed = new Map();   // expected index -> site_id
  const joined = [];

  for (const q of questions) {
    const hits = answers
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.path === q.path && typeof a.match === 'string'
        && typeof q.value_identifier === 'string' && a.match.includes(q.value_identifier));

    if (hits.length === 0) {
      cannot(`site ${q.site_id} (${q.path}, identifier "${q.value_identifier}") matches no expected `
        + 'answer. Either the expectation names a site the scan does not produce, or its `match` '
        + 'no longer quotes the identifier the scanner enumerated.');
    }
    if (hits.length > 1) {
      cannot(`site ${q.site_id} (${q.path}, identifier "${q.value_identifier}") matches `
        + `${hits.length} expected answers: ${hits.map((h) => `"${h.a.match}"`).join(', ')}. `
        + 'An ambiguous join resolved by picking one is the scorer guessing. Make the expected '
        + '`match` strings long enough to be distinct; do not widen the join.');
    }
    const { a, i } = hits[0];
    if (claimed.has(i)) {
      cannot(`expected answer "${a.match}" in ${a.path} is claimed by both site ${claimed.get(i)} `
        + `and site ${q.site_id}. The join is not one to one.`);
    }
    claimed.set(i, q.site_id);
    joined.push({
      site_id: q.site_id,
      path: q.path,
      value_identifier: q.value_identifier,
      expected_origin: a.origin ?? null,
    });
  }
  return joined;
}

/**
 * Score one recorded run against one expectation. Pure: no I/O, no clock, no model.
 *
 * @param {{expected: object, worklist: object, record: object}} docs
 * @returns {{ok: boolean, case_id: string|null, checks: Array, failures: Array<string>}}
 */
export function scoreCase({ expected, worklist, record }) {
  if (!expected || typeof expected !== 'object') cannot('no expectation document');
  if (!worklist || typeof worklist !== 'object') cannot('no worklist document');
  if (!record || typeof record !== 'object') {
    cannot('no record document - guardian may have run without producing one, which leaves the '
      + 'ticket open and is not a scoreable result');
  }

  if (record.worklist_id !== worklist.worklist_id) {
    cannot(`the record is for worklist ${record.worklist_id} and the worklist given is `
      + `${worklist.worklist_id}. Scoring a record against a worklist it was not assessed on `
      + 'would compare site ids that mean different things.');
  }
  const expTotal = expected.sites_total;
  if (typeof expTotal === 'number' && expTotal !== worklist.sites_total) {
    cannot(`the expectation declares ${expTotal} site(s) and the worklist enumerated `
      + `${worklist.sites_total}. The staged case is not the case this expectation grades.`);
  }

  const joined = joinSites(worklist, expected);
  const checks = [];
  const failures = [];
  const compare = (field, subject, want, got) => {
    const ok = want === got;
    checks.push({ field, subject, expected: want, actual: got, ok });
    if (!ok) {
      failures.push(`${field}${subject ? ` [${subject}]` : ''}: expected ${JSON.stringify(want)}, `
        + `got ${JSON.stringify(got)}`);
    }
    return ok;
  };

  // ---- field 1 ------------------------------------------------------------
  compare('verdict', null, expected.expected_verdict ?? null, record.verdict ?? null);

  // ---- field 2 ------------------------------------------------------------
  compare('fail_reason', null, expected.expected_fail_reason ?? null, record.fail_reason ?? null);

  // ---- field 3, per site --------------------------------------------------
  // Built as a multimap on purpose. A site answered twice is not the same fact as a
  // site answered once, and taking the first would let a duplicate pass field 3 while
  // the writer was flagging `duplicate_answers` on field 2 - the two fields would then
  // disagree about the same record with no way to tell which one was right.
  const byId = new Map();
  for (const a of record.answers ?? []) {
    const id = a?.site_id ?? '(missing site_id)';
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(a);
  }

  for (const site of joined) {
    const got = byId.get(site.site_id) ?? [];
    const where = `${site.site_id} ${site.path} "${site.value_identifier}"`;

    if (got.length === 0) {
      checks.push({ field: 'origin', subject: site.site_id, expected: site.expected_origin, actual: null, ok: false });
      failures.push(`origin [${where}]: expected ${JSON.stringify(site.expected_origin)}, but the `
        + 'record carries no answer for this site');
      continue;
    }
    if (got.length > 1) {
      checks.push({ field: 'origin', subject: site.site_id, expected: site.expected_origin,
        actual: got.map((a) => a.origin ?? null), ok: false });
      failures.push(`origin [${site.site_id}]: answered ${got.length} times `
        + `(${got.map((a) => JSON.stringify(a.origin ?? null)).join(', ')}); one answer per site`);
      continue;
    }
    compare('origin', where, site.expected_origin, got[0].origin ?? null);
  }

  // Answers for sites that are not on the worklist are reported here as well as by the
  // writer's `unknown_sites`, because a record carrying them was not produced against
  // the worklist it claims - which makes every other comparison in it suspect.
  const known = new Set(joined.map((s) => s.site_id));
  const stray = [...byId.keys()].filter((id) => !known.has(id));
  if (stray.length) {
    checks.push({ field: 'origin', subject: '(unenumerated)', expected: '(no such site)', actual: stray, ok: false });
    failures.push(`origin: the record answers ${stray.length} site(s) that are not in the worklist: `
      + `${stray.join(', ')}`);
  }

  return { ok: failures.length === 0, case_id: expected.case_id ?? null, checks, failures };
}

/* -------------------------------------------------------------------- CLI */

function readJson(p) {
  if (!fs.existsSync(p)) cannot(`no file at ${p}`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return cannot(`${p} is not readable JSON: ${e.message}`); }
}

function usage() {
  console.error('usage: corpus-score.mjs --case <case-id> --worklist <worklist-id> [--project <root>] [--json]');
  console.error('');
  console.error('  Scores .mavci/control/guardian/records/<worklist-id>.json against');
  console.error('  the plugin-side expectation for <case-id>, joined through');
  console.error('  .mavci/control/guardian/<worklist-id>.json.');
  console.error('');
  console.error('  exit 0 = case passed   exit 1 = case FAILED   exit 2 = could not score');
  process.exit(EXIT.CANNOT_SCORE);
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

function main() {
  const argv = process.argv.slice(2);
  const caseId = arg(argv, '--case');
  const worklistId = arg(argv, '--worklist');
  if (!caseId || !worklistId) usage();

  const root = arg(argv, '--project') || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const asJson = argv.includes('--json');

  // The expectation is read from the PLUGIN, never from the project. It is the
  // only one of the three documents that carries the answer, and leaving it in the
  // project put it one grep away from the agent being graded - which is not a
  // hypothetical: it happened on 0.1.17, case t5w9d. `--expected` exists for the
  // demonstration in scripts/ci/, not for scoring a real run.
  const expectedPath = arg(argv, '--expected')
    || path.join(EXPECTATIONS, `${caseId}.json`);
  const worklistPath = path.join(root, '.mavci', 'control', 'guardian', `${worklistId}.json`);
  const recordPath = path.join(root, '.mavci', 'control', 'guardian', 'records', `${worklistId}.json`);

  try {
    const result = scoreCase({
      expected: readJson(expectedPath),
      worklist: readJson(worklistPath),
      record: readJson(recordPath),
    });

    if (asJson) {
      console.log(JSON.stringify({
        ...result,
        case_id: caseId,
        worklist_id: worklistId,
        sources: { expected: expectedPath, worklist: worklistPath, record: recordPath },
      }, null, 2));
    } else {
      console.log(`corpus case ${caseId} vs record ${worklistId}`);
      for (const c of result.checks) {
        console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.field}${c.subject ? ` ${c.subject}` : ''}`
          + `: expected ${JSON.stringify(c.expected)}, got ${JSON.stringify(c.actual)}`);
      }
      console.log('');
      console.log(result.ok
        ? `PASS - all three scored fields agree (${result.checks.length} comparison(s))`
        : `FAIL (${result.failures.length}):\n  - ${result.failures.join('\n  - ')}`);
    }
    process.exit(result.ok ? EXIT.PASS : EXIT.FAIL);
  } catch (err) {
    if (err instanceof CannotScore) {
      console.error(`::cannot-score:: ${err.message}`);
      console.error('This is not a failing case and it is not a passing one. Nothing was scored.');
      process.exit(EXIT.CANNOT_SCORE);
    }
    throw err;
  }
}

if (path.basename(process.argv[1] ?? '') === 'corpus-score.mjs') main();

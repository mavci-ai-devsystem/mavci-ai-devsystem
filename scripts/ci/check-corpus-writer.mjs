#!/usr/bin/env node
/**
 * The corpus writer's failing-case demonstration.
 *
 * THE RULE THIS FILE EXISTS TO SATISFY: name the broken build an assertion must
 * catch, then confirm the assertion fails against it. An assertion never shown
 * failing is not coverage.
 *
 * `state.mjs --record-corpus` is the last thing between a passing corpus and a
 * recorded one, and it sits exactly where this system has failed before: for three
 * releases the corpus was scored by a model reading two JSON files, which is why
 * `corpus-score.mjs` exists at all. A writer that accepted `--result pass` would put
 * that back one layer out - the model would no longer be scoring the run, it would
 * be asserting the score - and nothing downstream could tell, because `doctor` reads
 * only `recorded_for` and `result`.
 *
 * POSITIVE CONTROLS COME FIRST AND ARE ASSERTIONS IN THEIR OWN RIGHT. A writer that
 * threw on every input would satisfy every negative below and refuse every real
 * corpus forever. P1 and P2 are what make the negatives mean anything.
 *
 * WHAT EACH CASE CATCHES, and the broken build it is written against:
 *
 *   P1  a complete correct run records `pass`     a writer that never writes
 *   P2  a run with one wrong answer records       a writer that refuses outcomes it
 *       `fail` and does not refuse                dislikes, which would make a
 *                                                 failing corpus unrecordable - the
 *                                                 0.1.17 result could not exist
 *   N1  `recorded_for` cannot be supplied         a writer reading it from argv.
 *                                                 doctor compares it for EQUALITY,
 *                                                 so one flag would let a result
 *                                                 from any tree satisfy any release
 *   N2  a partial case set is refused             a writer recording the subset it
 *                                                 is given - drop the failing case
 *                                                 and the rest all pass
 *   N3  unknown and duplicate case ids refused    a result naming a case that does
 *                                                 not exist has graded nothing
 *   N4  CANNOT_SCORE is refused, not recorded     a writer collapsing "could not
 *                                                 tell" into either outcome
 *   N5  a missing document is refused             a writer that scores what it can
 *                                                 find and calls that the corpus
 *   N6  the SCHEMA catches a malformed record     a corpus file validated only by
 *       the writer never produced                 the writer that produced it
 *   N7  the risk guard refuses it to an agent     `--record-corpus` inheriting agent
 *                                                 permission by omission
 *
 * N7a IS A BLINDNESS CONTROL AND IT RUNS BEFORE N7 IS BELIEVED. `risk-guard.mjs`
 * renders EVERY decision the same way - one `permissionDecision` object on stdout -
 * and `decide()` ends in `process.exit(0)` on all three paths. It never writes
 * stderr and never exits non-zero. So a probe that asserts on the exit code does not
 * merely miss some refusals: IT CAN NEVER SEE ONE AT ALL, and reports ALLOW for a
 * guard that is denying everything put to it.
 *
 * That is not hypothetical, and it is not a hypothesis about someone else. While the
 * 0.1.18 corpus was being run, two probes written to establish this very guard came
 * back green while proving nothing - the first because its payload paths had been
 * mangled so every read landed outside the project, the second because it read the
 * exit code. The second was then reported to the operator with the mechanism stated
 * WRONGLY, as "denies Bash via stderr and exit 2", because the stderr text seen at
 * the time was the installed hook refusing the probe's own command line, not the
 * subprocess under test. A wrong account of why a probe was blind is the next
 * probe's blind spot.
 *
 * TWO OF THESE ASSERTIONS DO NOT DISCRIMINATE, AND THE DEMONSTRATION IS WHAT SHOWED
 * IT. Running each negative against its named broken build - `--record-corpus`
 * deleted from PRIVILEGED for N7, the missing-case refusal disabled for N2 - both
 * broken builds STILL REFUSED, so `d === 'deny'` and `threw !== null` both stayed
 * green. The guard falls through to its fail-closed arm for an unclassified flag,
 * and the writer trips over a worklist path built from an undefined id. Each refuses
 * for a reason that has nothing to do with the property being asserted. Only the
 * assertions on the REASON TEXT failed - which is `CLAUDE.md`'s rule arriving as a
 * measurement rather than as advice: the assertion that earns its place is the one
 * on the reason arriving. The refusal halves are kept because a regression to
 * ALLOWING would be worse, but they are not what makes N2 and N7 coverage.
 *
 * So N7a asserts both halves: that the reader SEES a refusal already known to be
 * there, with its reason, AND that the same refusal carries exit status 0 - which is
 * the demonstration, kept in the file, that the exit code is not a channel. If N7a
 * fails, N7 proves nothing and this file says so instead of reporting a green.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');
const STATE = path.join(PLUGIN, 'scripts', 'state.mjs');
const GUARD = path.join(PLUGIN, 'scripts', 'risk-guard.mjs');

const state = await import(pathToFileURL(STATE).href);
const { listCases, EXPECTATIONS } = await import(
  pathToFileURL(path.join(PLUGIN, 'scripts', 'corpus-stage.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const BASE = JSON.parse(fs.readFileSync(
  path.join(PLUGIN, 'templates', 'fixtures', 'selftest-project.json'), 'utf8'));

const CASES = listCases();
const expectationFor = (id) => JSON.parse(
  fs.readFileSync(path.join(EXPECTATIONS, `${id}.json`), 'utf8'));

const CORPUS_REL = '.mavci/control/guardian-corpus.json';
const corpusPath = (t) => path.join(t, '.mavci', 'control', 'guardian-corpus.json');
const recorded = (t) => (fs.existsSync(corpusPath(t))
  ? JSON.parse(fs.readFileSync(corpusPath(t), 'utf8')) : null);

/**
 * A connected project carrying one worklist and one record per corpus case.
 *
 * The worklist and record are SYNTHESISED FROM THE EXPECTATION rather than
 * hardcoded, so this check does not need editing when a case changes, and cannot
 * drift into asserting against a corpus that no longer exists. The expectation's own
 * `match` string is used as the worklist's `value_identifier`, which joins one to
 * one by construction: `joinSites` requires `match.includes(value_identifier)`.
 */
function project({ breakCase = null, unscorable = null, dropRecord = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-cw-'));
  fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian', 'records'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(BASE, null, 2));
  state.init(tmp, BASE);
  fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian', 'records'), { recursive: true });

  const ids = {};
  for (const id of CASES) {
    const exp = expectationFor(id);
    const wlId = `wl-${id}`;
    ids[id] = wlId;

    const questions = exp.expected_answers.map((a, i) => ({
      site_id: `s${String(i + 1).padStart(3, '0')}`,
      path: a.path,
      line: 10 + i,
      table: 'orgs',
      value_identifier: a.match,
    }));
    fs.writeFileSync(
      path.join(tmp, '.mavci', 'control', 'guardian', `${wlId}.json`),
      JSON.stringify({
        schema_version: 1, worklist_id: wlId, sites_total: exp.sites_total, questions,
      }));

    if (dropRecord === id) continue;

    const answers = exp.expected_answers.map((a, i) => ({
      site_id: `s${String(i + 1).padStart(3, '0')}`,
      origin: (breakCase === id && i === 0) ? 'request_input' : a.origin,
    }));
    fs.writeFileSync(
      path.join(tmp, '.mavci', 'control', 'guardian', 'records', `${wlId}.json`),
      JSON.stringify({
        schema_version: 1,
        // An id mismatch is what `scoreCase` refuses as CANNOT_SCORE: a record scored
        // against a worklist it was not assessed on compares site ids that mean
        // different things.
        worklist_id: unscorable === id ? 'wl-somethingelse' : wlId,
        verdict: exp.expected_verdict,
        fail_reason: exp.expected_fail_reason,
        answers,
      }));
  }
  return { tmp, ids };
}

const allRuns = (ids) => CASES.map((id) => ({ caseId: id, worklistId: ids[id] }));
const runFlags = (ids) => allRuns(ids).flatMap((r) => ['--run', `${r.caseId}=${r.worklistId}`]);

console.log('corpus writer:');
console.log(`  library: ${CASES.join(', ')}`);

/* ------------------------------------------------------- positive controls */

let P1ok = false;
{
  const { tmp, ids } = project();
  const rec = await state.recordCorpus(tmp, allRuns(ids));
  P1ok = rec.result === 'pass';
  check(P1ok, `P1 a complete correct run records result=pass (got ${rec.result})`);
  check(rec.cases_total === CASES.length,
    `P1 cases_total equals the library size (${rec.cases_total} vs ${CASES.length})`);
  check(fs.existsSync(corpusPath(tmp)), `P1 the record reaches ${CORPUS_REL}`);
  check(rec.scored_by === 'scripts/corpus-score.mjs',
    'P1 the record names the scorer that produced it');
}

{
  const broken = CASES[0];
  const { tmp, ids } = project({ breakCase: broken });
  const rec = await state.recordCorpus(tmp, allRuns(ids));
  check(rec.result === 'fail',
    `P2 one wrong answer makes the recorded result fail (got ${rec.result})`);
  const c = rec.cases.find((x) => x.case_id === broken);
  check(c && c.ok === false && c.failures.length > 0,
    'P2 the failing case is named in the record, with the scorer reasons');
  check(rec.cases.filter((x) => x.ok).length === CASES.length - 1,
    'P2 the other cases still record as passing - a fail is recorded, not refused');
}

if (!P1ok) {
  console.log('');
  console.log('  P1 did not pass, so every refusal below is indistinguishable from a writer');
  console.log('  that refuses everything. Fix P1 before reading the negatives.');
}

/* -------------------------------------------------------------- negatives */

// N1 - broken build: a writer that reads recorded_for from an argument.
{
  const { tmp, ids } = project();
  const r = spawnSync(process.execPath,
    [STATE, '--record-corpus', ...runFlags(ids), '--recorded-for', '9.9.9'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  check(r.status !== 0, `N1 --recorded-for is refused outright (exit ${r.status})`);
  check(/does not accept/.test(r.stderr ?? ''),
    'N1 the refusal SAYS the version is computed, rather than ignoring the flag silently');
  check(recorded(tmp) === null, 'N1 nothing was written on the refused invocation');

  const { tmp: t2, ids: i2 } = project();
  const rec = await state.recordCorpus(t2, allRuns(i2));
  check(rec.recorded_for === state.pluginVersion(),
    `N1 recorded_for is stamped from the running plugin (${rec.recorded_for} vs ${state.pluginVersion()})`);
}

// N1b - the same defect through the other spelling.
{
  const { tmp, ids } = project();
  const r = spawnSync(process.execPath,
    [STATE, '--record-corpus', ...runFlags(ids), '--result', 'pass'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  check(r.status !== 0 && recorded(tmp) === null,
    'N1b --result is refused and writes nothing - the outcome is never the caller to assert');
}

// N2 - broken build: a writer that records the subset it is given.
{
  const { tmp, ids } = project();
  const partial = allRuns(ids).slice(0, CASES.length - 1);
  let threw = null;
  try { await state.recordCorpus(tmp, partial); } catch (e) { threw = e; }
  check(threw !== null, 'N2 a partial case set is refused');
  check(threw !== null && /not scored/.test(threw.message),
    'N2 the refusal names the cases that were not scored');
  check(recorded(tmp) === null, 'N2 nothing was written');
}

// N3 - broken build: a writer accepting a case id outside the library, or the same
// case twice.
{
  const { tmp, ids } = project();
  let threwUnknown = null;
  try {
    await state.recordCorpus(tmp, [...allRuns(ids), { caseId: 'nosuchcase', worklistId: 'wl-x' }]);
  } catch (e) { threwUnknown = e; }
  check(threwUnknown !== null && /not a case in the library/.test(threwUnknown.message),
    'N3 an unknown case id is refused');

  let threwDup = null;
  try {
    await state.recordCorpus(tmp, [...allRuns(ids), { caseId: CASES[0], worklistId: 'wl-other' }]);
  } catch (e) { threwDup = e; }
  check(threwDup !== null && /twice/.test(threwDup.message),
    'N3 the same case given twice is refused rather than resolved by picking one');
  check(recorded(tmp) === null, 'N3 nothing was written');
}

// N4 - broken build: a writer that treats CANNOT_SCORE as an outcome. "the case
// failed" and "I could not tell" are different facts, and recording either in place
// of the other invents one.
{
  const target = CASES[CASES.length - 1];
  const { tmp, ids } = project({ unscorable: target });
  let threw = null;
  try { await state.recordCorpus(tmp, allRuns(ids)); } catch (e) { threw = e; }
  check(threw !== null && /COULD NOT BE SCORED/.test(threw.message),
    'N4 an unscorable case is refused, and the refusal says so in those words');
  check(recorded(tmp) === null, 'N4 nothing was written - not a pass, and not a fail either');
}

// N5 - broken build: a writer that scores the documents it happens to find.
{
  const target = CASES[0];
  const { tmp, ids } = project({ dropRecord: target });
  let threw = null;
  try { await state.recordCorpus(tmp, allRuns(ids)); } catch (e) { threw = e; }
  check(threw !== null && /no record at/.test(threw.message),
    'N5 a missing record is refused and the missing path is named');
  check(recorded(tmp) === null, 'N5 nothing was written');
}

// N6 - broken build: a corpus file validated only by the writer that produced it.
// The malformed file here is written BY HAND, past the writer, which is the point:
// `state.schema_valid` is the check that is not the writer.
{
  const { tmp } = project();
  fs.writeFileSync(corpusPath(tmp), JSON.stringify({
    schema_version: 1,
    recorded_for: 'latest',
    result: 'pass',
    cases_total: 3,
    run_at: '2026-09-02T00:00:00Z',
    scored_by: 'a model that read two JSON files',
    cases: [],
  }, null, 2));
  const mine = state.validateAll(tmp).filter((e) => e.includes('guardian-corpus.json'));
  check(mine.length > 0, 'N6 the sweep reports a malformed corpus record it did not write');
  check(mine.some((e) => /recorded_for/.test(e)),
    'N6 a recorded_for that is not a version is rejected');
  check(mine.some((e) => /scored_by/.test(e)),
    'N6 a scored_by naming anything but corpus-score.mjs is rejected');
  check(mine.some((e) => /cases/.test(e)),
    'N6 an empty cases array is rejected - a result that graded nothing');
}

/* ------------------------------------------------- the guard, and its control */

/**
 * The guard's decision, read from the ONLY channel it has: a `permissionDecision`
 * object on stdout. `status` is returned alongside so N7a can assert that it carries
 * no information - it is 0 on a deny exactly as it is on an allow.
 */
function decision(payload) {
  const r = spawnSync(process.execPath, [GUARD],
    { input: JSON.stringify(payload), encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  if (out) {
    try {
      const o = JSON.parse(out).hookSpecificOutput ?? {};
      if (o.permissionDecision) {
        return {
          d: String(o.permissionDecision).toLowerCase(),
          why: o.permissionDecisionReason ?? '',
          status: r.status,
        };
      }
    } catch { /* an unparseable body is not a decision */ }
  }
  return { d: 'allow', why: '', status: r.status };
}

const cmdFor = (flag) => `node ${path.join(PLUGIN, 'scripts', 'state.mjs')} ${flag}`;

// N7a - THE BLINDNESS CONTROL. `--set-phase` for an agent is already known to be
// denied. If this reads ALLOW, the reader is broken and N7 below is worthless.
let seeing = false;
{
  const { tmp } = project();
  const { d, why, status } = decision({
    tool_name: 'Bash',
    agent_type: 'mavci-core:mavci-builder',
    cwd: tmp,
    tool_input: { command: cmdFor('--set-phase release') },
  });
  seeing = d === 'deny';
  check(seeing, `N7a the reader can SEE a refusal already known to be there (got ${d})`);
  check(seeing && why.length > 0,
    'N7a and the reason arrives with it - a refusal with no reason tells the agent nothing');
  check(status === 0,
    `N7a THE EXIT CODE IS NOT A CHANNEL: this refusal exits ${status}, so a probe reading `
    + 'the status would call it ALLOW. Every assertion here reads stdout for that reason.');
}

// N7 - broken build: --record-corpus absent from PRIVILEGED, inheriting agent
// permission by omission.
{
  const { tmp } = project();
  const { d, why } = decision({
    tool_name: 'Bash',
    agent_type: 'mavci-core:mavci-verifier',
    cwd: tmp,
    tool_input: { command: cmdFor('--record-corpus --run a=b') },
  });
  check(d === 'deny', `N7 an agent may not run --record-corpus (got ${d})`);
  check(/record the guardian acceptance corpus result/.test(why),
    'N7 the refusal states what the command would do, not merely that it is refused');
  if (!seeing) bad('N7 cannot be trusted: the blindness control N7a failed');
}

// N7b - the operator is not an agent. Privileged means confirmed, not forbidden; a
// guard that denied here would close the only door this feature exists to open.
{
  const { tmp } = project();
  const { d } = decision({
    tool_name: 'Bash',
    agent_type: null,
    cwd: tmp,
    tool_input: { command: cmdFor('--record-corpus --run a=b') },
  });
  check(d !== 'deny',
    `N7b the operator is not denied - privileged means confirmed, not forbidden (got ${d})`);
}

console.log('');
if (failures.length) {
  console.log(`corpus writer check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus writer: positive controls pass, the result and the version were');
console.log('demonstrated uncomputable by the caller, and the guard refusal was read');
console.log('through a channel proven capable of seeing one.');

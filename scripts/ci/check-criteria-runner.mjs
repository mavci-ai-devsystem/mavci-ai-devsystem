#!/usr/bin/env node
/**
 * The acceptance criteria are EXECUTED by a program and RECORDED from what it
 * observed. Nobody hands the answer in.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * cartoonify finding 6 closed half way. 0.1.33 gave the verdict a `criteria[]`,
 * made `not_run` force `incomplete`, and made the router fail closed on a verdict
 * that carries no criteria at all. What it did not give the system was anything
 * that PRODUCES that field. The named exits from the `incomplete` arm were
 * re-verify with a criteria file, file a retro, or the operator's
 * `--task-status <id> --status done`; nothing writes a criteria file, so the
 * first was unreachable, the second changes nothing, and the third is the only
 * one that moves.
 *
 * A fail-closed gate whose only working exit is the override is a gate that has
 * been turned off while still reporting that it is on. It was already in that
 * state on disk: cartoonify's task 0002 carries `verdict: "pass"` with no
 * `criteria`, and a control task reading `status: "done"` - and `--task-status`
 * takes no `--reason`, so the closure records nothing about why.
 *
 * ----------------------------------------------- WHY NOT "LET SOMEONE WRITE IT"
 *
 * Finding 6's fix 3 asks for the verifier to be able to record its judgement,
 * and taken literally that is a criteria file written by an agent from its own
 * prose - an unverified claim promoted to an artefact that reads as
 * verification. The architecture already refused this question once, in the
 * component whose output the release gate reads: `state.mjs`'s `--record-corpus`
 * denies `--result`, `--version` and `--fingerprint` by name because "a writer
 * that accepted any of the three would put the model back in the chair
 * corpus-score.mjs was written to take it out of." Guardian emits and
 * `corpus-score.mjs` decides what becomes a record. `criteria[]` is that problem
 * one component over, and it gets the same answer: the agent interprets, the
 * program records.
 *
 * The measurement that settles it. Across the 47 acceptance criteria written on
 * two real projects - cartoonify task 0001's 32 and task 0002's 15 - the number
 * requiring an agent's JUDGEMENT is zero. What varies is CAPABILITY: shell,
 * server, browser, network, live-key, write-outside-tree. That is finding 4's
 * vocabulary, written down at 0.1.32 and unbuilt, and it is the fix rather than
 * a companion to it.
 *
 * ------------------------------------------------------ THE FOUR HELD DECISIONS
 *
 * 1. THE BLOCK LIVES IN THE HASHED `.md`, never in `.mavci/tasks/<id>.json`.
 *    The sidecar is inside the architect's write scope and OUTSIDE
 *    `spec_approved.spec_sha256`, so criteria placed there could be rewritten
 *    after approval - and the approval hash is the entire authority under which
 *    a program is entitled to execute those bytes.
 * 2. SUPPLIED ANSWERS ARE REFUSED BY NAME, in --record-corpus's idiom.
 * 3. `not_run`, NEVER `skipped`, for anything whose `needs` are not satisfied.
 *    `skipped` is a decision recorded before the run; an unmet precondition is
 *    not a decision.
 * 4. `mode: "inspected"` IS REFUSED on a criterion the block declares as needing
 *    only `shell`, because the runner could have run it. That is finding 17's
 *    inversion made mechanical - a declaration of weaker enforcement is a
 *    request for more scrutiny, not a smaller ruleset - and it is what stops
 *    `needs` from becoming the escape hatch that `inspected` would otherwise be.
 *
 * ------------------------------------------------------- THE NEGATIVE CONTROL
 *
 * Finding 15: verifying one direction of a dependency is not verifying the
 * dependency. A runner demonstrated only on passing criteria establishes that it
 * can say yes. Task 0002 hands us the other direction at authoring time - two of
 * its criteria say outright "fails against the current build" - so section C
 * asserts a known-red criterion comes back `fail` and a known-green one comes
 * back `pass`, IN THE SAME RUN. Each is the other's control: a runner hardcoding
 * either verdict passes one of them and fails the other.
 *
 * ----------------------------------------------------------- WHAT IT CANNOT SEE
 *
 * It proves the runner computes a result from an exit code. It does not prove
 * that any particular spec's criteria are the right criteria, and it cannot: that
 * is what the operator's approval is for. It also says nothing about a spec with
 * no criteria block, where `--criteria <path>` keeps 0.1.33's agent-attested
 * behaviour unchanged - the enforcement in section E arrives with the
 * declaration, and a block-less spec is exactly the state the `incomplete` arm
 * already describes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const VERIFY = path.join(SCRIPTS, 'verify.mjs');
const CRITERIA_LIB = path.join(SCRIPTS, 'lib', 'criteria.mjs');
const INVOCATION_CHECK = path.join(ROOT, 'scripts', 'ci', 'check-command-invocation.mjs');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/* The library is imported defensively. A missing module must produce a named
 * failure per assertion, not one import crash that reports nothing about any of
 * them - 0.1.29's P11: a crash reports nothing about which arm broke. */
let lib = null;
let libError = null;
try {
  lib = await import(pathToFileURL(CRITERIA_LIB).href);
} catch (err) {
  libError = err.message;
}

const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

/** Run a plugin script against a project. Never throws. */
function run(cwd, script, args, extraEnv = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 300_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '',
        ...extraEnv,
      },
    });
    return { out: stdout, err: '', status: 0 };
  } catch (err) {
    return {
      out: err.stdout?.toString() ?? '',
      err: err.stderr?.toString() ?? '',
      status: err.status ?? -1,
    };
  }
}
const all = (r) => `${r.out}\n${r.err}`;

/** A fence, built rather than typed, so this source never carries three adjacent backticks. */
const F = '`'.repeat(3);
function block(entries) {
  return [`${F}mavci-criteria`, JSON.stringify(entries, null, 2), F].join('\n');
}

function spec(body) {
  return ['# Task', '', '## Acceptance criteria', '', body, ''].join('\n');
}

/** A connected project with one task, a spec, and (unless told not to) an approval. */
function makeProject(specText, { approve = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-criteria-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  run(tmp, STATE, ['--begin-plan', 'criteria runner fixture']);
  fs.writeFileSync(path.join(tmp, PATHS.tasks, '0001.md'), specText);
  /* The SURFACE task carries the spec pointer, and `--begin-plan` leaves it at the
   * `pending.md` stub - which it does not create (carried-forward item 6). So the
   * fixture points it at a spec that exists, exactly as the architect would. */
  const surface = path.join(tmp, PATHS.tasks, '0001.json');
  const s = JSON.parse(fs.readFileSync(surface, 'utf8'));
  s.spec = `${PATHS.tasks}/0001.md`;
  fs.writeFileSync(surface, JSON.stringify(s, null, 2));
  if (approve) run(tmp, STATE, ['--approve-spec', '0001']);
  run(tmp, STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  return tmp;
}

const verdictOf = (root) => {
  const dir = path.join(root, PATHS.verdicts);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('0001-attempt-'));
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files.sort().at(-1)), 'utf8'));
};
const byId = (v, id) => (v?.criteria ?? []).find((c) => c.id === id) ?? null;
/* A timed-out child can still hold a handle under the fixture for a moment on
 * Windows, and a cleanup failure must never be reported as an assertion failure -
 * the run has already produced its verdicts by the time this is called. */
const rm = (p) => {
  try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* leave it to the OS */ }
};

/* Commands chosen so they hold on every platform the runner can reach and depend
 * on nothing in the project: node is already running this check. */
const PASSES = 'node -e "process.exit(0)"';
const FAILS = 'node -e "process.exit(3)"';

/* ================================================================= A. PARSING */

console.log('\nA. the block is parsed from the spec, and a malformed one is refused:');

if (!lib || typeof lib.parseCriteriaBlock !== 'function') {
  const why = lib
    ? 'lib/criteria.mjs exports no parseCriteriaBlock'
    : `lib/criteria.mjs does not import: ${libError}`;
  for (const a of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
    bad(`${a} - ${why}. There is nothing that reads a criteria block out of an approved spec.`);
  }
} else {
  const p = lib.parseCriteriaBlock;

  {
    const r = p(spec(block([{ id: '1', needs: ['shell'], run: PASSES }])));
    if (!r.ok) bad(`A1 a well-formed block was refused: ${r.error}`);
    else if (!Array.isArray(r.criteria) || r.criteria.length !== 1 || r.criteria[0].id !== '1') {
      bad(`A1 a well-formed block parsed to ${JSON.stringify(r.criteria)}`);
    } else ok('A1 a well-formed block yields its entries');
  }

  {
    const two = spec([block([{ id: '1', run: PASSES }]), '', block([{ id: '2', run: PASSES }])].join('\n'));
    const r = p(two);
    if (r.ok) {
      bad('A2 two criteria blocks in one spec were accepted. A second block is a second list, and '
        + 'whichever one loses is invisible to the operator who approved both.');
    } else ok('A2 two blocks in one spec are refused');
  }

  {
    const r = p(spec(block([{ id: '1', run: PASSES }, { id: '1', run: FAILS }])));
    if (r.ok) bad('A3 duplicate criterion ids were accepted; one result silently replaces the other');
    else ok('A3 a duplicate criterion id is refused');
  }

  {
    const r = p(spec(block([{ id: '1', needs: ['shell'] }])));
    if (r.ok) bad('A4 an entry with no `run` was accepted; there is nothing to execute');
    else ok('A4 an entry with no `run` is refused');
  }

  {
    const r = p(spec(block([{ id: '1', needs: ['telepathy'], run: PASSES }])));
    if (r.ok) {
      bad('A5 an unrecognised `needs` value was accepted. The vocabulary is closed: an unknown '
        + 'capability is indistinguishable from a satisfied one to every reader downstream.');
    } else ok('A5 an unrecognised `needs` value is refused');
  }

  {
    const r = p(spec('1. the thing works.'));
    if (!r.ok) bad(`A6 a spec with no block was reported as an error: ${r.error}`);
    else if (r.criteria !== null) bad(`A6 a spec with no block yielded ${JSON.stringify(r.criteria)}, expected null`);
    else ok('A6 a spec with no block is absence, not an error');
  }
}

/* ====================================================== B. THE AUTHORITY TO RUN */

console.log('\nB. it executes only bytes the operator approved:');

/* THE DECISION AND THE REASON ARE TWO FACTS, AND ONLY THE REASON DISCRIMINATES.
 * 0.1.23's M5: deleting three verbs from risk-guard's privilege table changed
 * nothing observable, because the guard ALSO fails closed on an unrecognised
 * flag - so the verb was denied by the wrong arm, with the wrong message. Every
 * assertion here is against a build in which `--run-criteria` does not exist,
 * where `verify.mjs` exits non-zero for that reason alone. An assertion on the
 * exit status is green against that build and proves nothing. */
{
  const p = makeProject(spec(block([{ id: '1', run: PASSES }])), { approve: false });
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  const said = /approv/i.test(all(r));
  if (r.status === 0) {
    bad('B1 --run-criteria ran against a spec with NO recorded approval. The approval hash is the '
      + 'only thing that makes executing an agent-authored document legitimate.');
  } else if (!said) {
    bad('B1 the run was refused and never mentioned the approval, so it was refused by some other '
      + `arm. Output: ${all(r).trim().slice(0, 200)}`);
  } else ok('B1 an unapproved spec is refused, and the refusal names the approval');
  if (!said) bad('B3 could not be established: the run above was refused for the wrong reason.');
  else if (verdictOf(p)) bad('B3 a refused run still wrote a verdict');
  else ok('B3 a refused run writes no verdict');
  rm(p);
}

{
  const p = makeProject(spec(block([{ id: '1', run: PASSES }])));
  fs.appendFileSync(path.join(p, PATHS.tasks, '0001.md'), '\nedited after approval\n');
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  if (r.status === 0) {
    bad('B2 --run-criteria ran against a spec that CHANGED after approval. It would execute bytes '
      + 'nobody approved, which is the whole guarantee.');
  } else if (!/chang|stale|hash/i.test(all(r))) {
    bad('B2 the run was refused without saying the spec changed after approval, so it was refused '
      + `by some other arm. Output: ${all(r).trim().slice(0, 200)}`);
  } else ok('B2 a spec changed after approval is refused, and the refusal says so');
  rm(p);
}

/* =========================================== C. THE RESULT IS COMPUTED, BOTH WAYS */

console.log('\nC. the result comes from the exit code - and it comes from it in both directions:');

{
  const p = makeProject(spec(block([
    { id: '1', needs: ['shell'], run: PASSES },
    { id: '2', needs: ['shell'], run: FAILS },
  ])));
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  const v = verdictOf(p);

  if (!v) {
    bad(`C - --run-criteria recorded no verdict at all (exit ${r.status}). ${all(r).trim().slice(0, 300)}`);
    bad('C1 THE NEGATIVE CONTROL could not run: no verdict was recorded.');
  } else {
    const c1 = byId(v, '1');
    const c2 = byId(v, '2');

    if (!c2 || c2.status !== 'fail') {
      bad('C1 THE NEGATIVE CONTROL: a criterion whose command exits non-zero came back '
        + `${JSON.stringify(c2)}, expected status "fail". A runner that only ever says yes has `
        + 'established one direction of the dependency and neither half of the question.');
    } else if (c2.mode !== 'executed') {
      bad(`C1 the failing criterion was recorded mode ${JSON.stringify(c2.mode)}, expected "executed"`);
    } else ok('C1 a known-red criterion comes back fail, executed');

    if (!c1 || c1.status !== 'pass') {
      bad(`C2 a criterion whose command exits 0 came back ${JSON.stringify(c1)}, expected "pass". `
        + "C1 and C2 are each other's control: a runner hardcoding either verdict passes one.");
    } else if (c1.mode !== 'executed') {
      bad(`C2 the passing criterion was recorded mode ${JSON.stringify(c1.mode)}, expected "executed"`);
    } else ok('C2 a known-green criterion comes back pass, executed');

    if (v.verdict !== 'fail') {
      bad(`C4 the verdict is ${JSON.stringify(v.verdict)} with a failing criterion in it, expected "fail"`);
    } else ok('C4 one failing criterion makes the verdict fail');

    if (c2 && typeof c2.evidence === 'string' && c2.evidence.length > 0) {
      ok('C5 a failing criterion carries evidence');
    } else {
      bad('C5 a failing criterion carries no evidence. The builder is sent back with the criterion '
        + 'number and nothing else, and re-deriving it spends the attempt that is left.');
    }
  }
  rm(p);
}

/* ============================================= D. `needs` DECIDES RUN vs NOT_RUN */

console.log('\nD. an unmet precondition is not_run, and a met one is executed:');

{
  const p = makeProject(spec(block([
    { id: '1', needs: ['shell'], run: PASSES },
    { id: '2', needs: ['browser'], run: PASSES },
  ])));
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  const v = verdictOf(p);
  const c2 = byId(v, '2');

  if (!c2) {
    bad(`D1 no result at all for the browser criterion (exit ${r.status}). A criterion the runner `
      + 'omits is a criterion nothing will ever ask about again.');
  } else if (c2.status === 'skipped') {
    bad('D1 an unmet precondition was recorded `skipped`. `skipped` is a DECISION recorded before '
      + 'the run; nobody decided this, and the difference is the whole reason the two values exist.');
  } else if (c2.status !== 'not_run') {
    bad(`D1 an unmet precondition was recorded ${JSON.stringify(c2.status)}, expected "not_run"`);
  } else ok('D1 an undeclared capability yields not_run, never skipped');

  if (!v) bad('D3 no verdict was recorded, so the incomplete arm could not be reached');
  else if (v.verdict !== 'incomplete') {
    bad(`D3 a verdict holding a not_run reads ${JSON.stringify(v.verdict)}, expected "incomplete"`);
  } else ok('D3 one not_run makes the verdict incomplete');
  rm(p);
}

{
  const p = makeProject(spec(block([{ id: '2', needs: ['browser'], run: PASSES }])));
  run(p, VERIFY, ['--run-criteria', '0001', '--have', 'browser', '--record', '--task', '0001']);
  const c2 = byId(verdictOf(p), '2');
  if (!c2 || c2.status !== 'pass' || c2.mode !== 'executed') {
    bad(`D2 with the capability declared the criterion came back ${JSON.stringify(c2)}, expected `
      + 'pass/executed. D1 and D2 are a pair: a runner that never runs anything satisfies D1 alone.');
  } else ok('D2 a declared capability lets the criterion execute');
  rm(p);
}

/* ==================================================== E. THE REFUSALS, BY NAME */

console.log('\nE. nobody hands the answer in:');

/* A PROJECT PER FLAG. Verdicts are write-once, so five --record runs against one
 * attempt means the second and later are refused by THAT guard - which is
 * indistinguishable from being refused by the arm under test. Baseline-green
 * either way; only a mutation shows the difference, which is exactly the class of
 * fixture fault this file's own section B is written to catch one layer down. */
for (const f of ['--status', '--mode', '--evidence', '--result', '--pass']) {
  const p = makeProject(spec(block([{ id: '1', run: PASSES }])));
  const r = run(p, VERIFY, ['--run-criteria', '0001', f, 'pass', '--record', '--task', '0001']);
  if (r.status === 0) bad(`E1 --run-criteria accepted ${f}, which supplies the answer it exists to compute`);
  else if (!all(r).includes(f)) {
    bad(`E1 --run-criteria refused ${f} without naming it, so it was refused by some other arm. `
      + `Output: ${all(r).trim().slice(0, 160)}`);
  } else ok(`E1 --run-criteria refuses ${f} by name`);
  rm(p);
}

/* E2 and E3 get a project each. Verdicts are write-once, so a second --record
 * against one attempt is refused by THAT guard - which would make E3 green for a
 * reason with nothing to do with inspection. */
const INSPECT_SPEC = spec(block([
  { id: '1', needs: ['shell'], run: PASSES },
  { id: '2', needs: ['browser'], run: PASSES },
]));

{
  const p = makeProject(INSPECT_SPEC);
  const cf = path.join(p, 'crit.json');

  fs.writeFileSync(cf, JSON.stringify([{ id: '1', status: 'pass', mode: 'inspected', evidence: 'read it' }]));
  const r1 = run(p, VERIFY, ['--record', '--task', '0001', '--criteria', cf]);
  if (r1.status === 0) {
    bad('E2 `mode: "inspected"` was accepted for a criterion the block declares as needing only '
      + '`shell`. The runner could have run it, so reading it instead is a substitution - which is '
      + 'exactly what finding 4 says a spec that cannot state its preconditions invites.');
  } else if (!all(r1).includes('shell')) {
    bad('E2 the refusal does not say that the criterion declares only shell, which is the reason');
  } else ok('E2 inspected is refused on a shell-only criterion, and the reason is named');
  rm(p);
}

{
  const p = makeProject(INSPECT_SPEC);
  const cf = path.join(p, 'crit.json');
  fs.writeFileSync(cf, JSON.stringify([{ id: '2', status: 'pass', mode: 'inspected', evidence: 'read it' }]));
  const r2 = run(p, VERIFY, ['--record', '--task', '0001', '--criteria', cf]);
  if (r2.status !== 0) {
    bad('E3 `mode: "inspected"` was refused for a criterion declaring `browser`, which the runner '
      + "genuinely cannot execute. E2 and E3 are each other's control: a build that refuses every "
      + `inspection satisfies E2 alone. Output: ${all(r2).trim().slice(0, 200)}`);
  } else ok('E3 inspected is accepted where the capability is genuinely out of reach');
  rm(p);
}

/* =================================================== F. THE INTERPRETER IS NAMED */

console.log('\nF. the interpreter is resolved, named, and proven before anything is scored:');

{
  const p = makeProject(spec(block([{ id: '1', run: PASSES }])));
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  if (!/interpreter/i.test(all(r))) {
    bad('F1 the run does not name the interpreter it resolved. 0.1.22: the same tree gave two '
      + 'different verdicts depending on which shell launched the check, and the one fact that '
      + 'would have shortened the diagnosis was the one nothing printed.');
  } else ok('F1 the interpreter is named on every run');
  rm(p);
}

{
  const p = makeProject(spec(block([{ id: '1', run: PASSES }])));
  const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001'],
    { MAVCI_BASH: path.join(p, 'no-such-shell') });
  const named = /interpreter|shell|no-such-shell/i.test(all(r));
  if (r.status === 0) {
    bad('F2 with an interpreter that cannot execute, --run-criteria still exited 0. Invariant 5: a '
      + 'failed probe is never reported as a pass, and here the probe is the shell itself.');
  } else if (!named) {
    bad('F2 the run was refused and never mentioned the interpreter, so it was refused by some '
      + `other arm - which is 0.1.22's whole finding restated. Output: ${all(r).trim().slice(0, 200)}`);
  } else ok('F2 an interpreter that cannot execute refuses the run, and the refusal names it');
  const v = verdictOf(p);
  if (!named) bad('F2b could not be established: the run above was refused for the wrong reason.');
  else if (v && Array.isArray(v.criteria) && v.criteria.some((c) => c.status === 'pass')) {
    bad('F2b a criterion was scored `pass` by an interpreter that never ran. That is 0.1.22 exactly: '
      + '18 blocks scored ok while executing nothing.');
  } else ok('F2b nothing is scored when the interpreter could not be proven');
  rm(p);
}

{
  const src = fs.existsSync(INVOCATION_CHECK) ? fs.readFileSync(INVOCATION_CHECK, 'utf8') : '';
  const definesOwn = /function\s+resolveBash\s*\(/.test(src);
  const importsShared = /from\s+['"][^'"]*lib\/shell\.mjs['"]/.test(src);
  if (definesOwn || !importsShared) {
    bad('F3 check-command-invocation.mjs still defines its own resolveBash. Two answers to "which '
      + "shell\" is the shape that had check-pretag running 13 of release.yml's 17 - and this one "
      + 'decides whether a verification run means anything on Windows.');
  } else ok('F3 there is one resolveBash, shared by the runner and the invocation check');
}

/* ============================================= G. A PROBE THAT DID NOT FINISH */

console.log('\nG. a criterion that did not finish is not a criterion that passed:');

{
  const p = makeProject(spec(block([
    { id: '1', needs: ['shell'], run: 'node -e "setTimeout(function(){}, 60000)"', timeout_ms: 1500 },
  ])));
  run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
  const c1 = byId(verdictOf(p), '1');
  if (!c1 || c1.status === 'pass') {
    bad(`G1 a criterion that timed out came back ${JSON.stringify(c1)}. A probe that never answered `
      + 'reported as a pass is invariant 5 broken inside the thing that enforces it.');
  } else if (c1.status !== 'not_run') {
    bad(`G1 a criterion that timed out came back ${JSON.stringify(c1.status)}, expected "not_run" - `
      + 'a timeout is an absence of an answer, not an answer of fail.');
  } else if (!/timed out|timeout/i.test(c1.evidence ?? '')) {
    bad('G1 the timed-out criterion does not say so in its evidence');
  } else ok('G1 a criterion that timed out is not_run, and says so');
  rm(p);
}

/* ================================= H. ANOTHER PROCESS MUST NOT WRITE THE BUILD
 *
 * cartoonify finding 62, 2026-09-30. Task 0015 attempt 1: criterion 3 built
 * .next, and mid-run a forgotten `next dev` in the same repository wrote its
 * development output over it - .next/BUILD_ID gone. Criterion 50 then measured
 * an unstyled page and the attempt was recorded as a failure of the code; the
 * same code passed 51 of 51 once the dev server was stopped. Nothing checked
 * for the server before the run, or for the build changing under it. */

console.log('\nH. a running next server refuses the run, and a build that changes mid-run fails it:');

{
  const p = makeProject(spec(block([{ id: '1', needs: ['shell'], run: PASSES }])));
  const bin = path.join(p, 'node_modules', 'next', 'dist', 'bin', 'next');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, 'setInterval(() => {}, 1000);\n');
  const server = spawn(process.execPath, [bin, 'dev'], { cwd: p, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const attemptsBefore = JSON.parse(fs.readFileSync(path.join(p, PATHS.controlTasks, '0001.json'), 'utf8')).attempts_total;
    const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
    const attemptsAfter = JSON.parse(fs.readFileSync(path.join(p, PATHS.controlTasks, '0001.json'), 'utf8')).attempts_total;
    if (r.status === 0) {
      bad(`H1 --run-criteria RAN and recorded while \`next dev\` (pid ${server.pid}) was alive in the `
        + 'project - finding 62 reproduced: an outside process can write .next under the criteria.');
    } else if (!/next dev/i.test(all(r)) || !all(r).includes(String(server.pid))) {
      bad(`H1 the run was refused without naming the next dev process (pid ${server.pid}), so it `
        + `was refused by another arm: ${all(r).trim().slice(0, 240)}`);
    } else ok(`H1 a live \`next dev\` in the project refuses the run, naming it (pid ${server.pid})`);
    if (verdictOf(p)) bad('H2 the refused run still recorded a verdict');
    else if (attemptsAfter !== attemptsBefore) bad(`H2 the refused run moved attempts_total ${attemptsBefore} -> ${attemptsAfter}`);
    else ok('H2 and records no verdict and consumes no attempt');
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 300));
    rm(p);
  }
}

/* The other half, and the operator's rule: once the build criterion has run,
 * .next/BUILD_ID must not change for the rest of verify. A criterion that
 * changes it (here, standing in for the outside writer) is the criterion whose
 * result cannot be trusted, and the verdict is FAIL. H4 is the control: the
 * same shape with nothing touching the build must still pass, or H3 is green
 * for a runner that fails everything after a build. */
{
  const BUILD = 'node -e "require(\'fs\').mkdirSync(\'.next\',{recursive:true});require(\'fs\').writeFileSync(\'.next/BUILD_ID\',\'aaa\')"';
  const CLOBBER = 'node -e "require(\'fs\').rmSync(\'.next/BUILD_ID\')"';
  for (const [label, second] of [['H3', CLOBBER], ['H4', PASSES]]) {
    const p = makeProject(spec(block([
      { id: '1', needs: ['shell'], run: BUILD },
      { id: '2', needs: ['shell'], run: second },
      { id: '3', needs: ['shell'], run: PASSES },
    ])));
    const r = run(p, VERIFY, ['--run-criteria', '0001', '--record', '--task', '0001']);
    const v = verdictOf(p);
    const c2 = byId(v, '2');
    if (label === 'H3') {
      if (!v) bad(`H3 no verdict was recorded: ${all(r).trim().slice(0, 200)}`);
      else if (v.verdict !== 'fail' || c2?.status !== 'fail') {
        bad(`H3 .next/BUILD_ID disappeared after the build criterion and the verdict is `
          + `"${v.verdict}" (criterion 2: ${c2?.status}) - the run never noticed the build changed under it`);
      } else if (!/BUILD_ID/.test(c2.evidence ?? '')) {
        bad(`H3 criterion 2 failed without saying the build changed: ${c2.evidence}`);
      } else ok('H3 a BUILD_ID changed after the build criterion fails the verdict, and says why');
    } else if (!v || v.verdict !== 'pass') {
      bad(`H4 the same run with nothing touching .next did not pass (${v?.verdict}): the BUILD_ID `
        + 'check fails runs it should not');
    } else ok('H4 control: a build left alone passes');
    rm(p);
  }
}

if (failures.length) {
  console.error('\ncriteria runner check FAILED:');
  for (const x of failures) console.error('  - ' + x);
  process.exit(2);
}
console.log('\nthe criteria are executed by a program, recorded from what it observed, and nobody hands the answer in');

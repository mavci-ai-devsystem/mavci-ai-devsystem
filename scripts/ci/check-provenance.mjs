#!/usr/bin/env node
/**
 * A verdict names the task attempt that produced it, and the task lifecycle can
 * actually move.
 *
 * -------------------------------------------------------------- WHY THIS EXISTS
 *
 * Two defects that concealed each other, found on the first real project.
 *
 * ONE. `recordVerdict` (state.mjs) has always done the right thing: given a
 * `task_id` it writes `<id>-attempt-NN.json` and appends the path to the control
 * task's `verdicts[]`. Nothing ever gave it one. `evaluate` and `buildVerdict`
 * accepted `task_id` and `attempt`, defaulted both to null, and no caller passed
 * either; `verify.mjs` had no flag to pass. So the branch existed, was correct,
 * and had never once been taken. `AI-Chatbot-Widget-SaaS` holds 24 verdicts, all
 * `adhoc-<epoch>.json`, and `control/tasks/0001.verdicts[]` is empty.
 *
 * TWO. `incrementAttempt` and `blockTask` were exported from state.mjs and called
 * from NOWHERE in the plugin. `status` never left `pending`, `owner_agent` was
 * never set, `attempts` was always 0. ARCHITECTURE section 9 describes a retry
 * policy of three attempts governed by that counter; the counter had no writer.
 *
 * Each hid the other. With no attempt counter moving there is no attempt number
 * for a verdict to name, so attribution had nothing to attribute to; with no
 * attribution nobody read `verdicts[]` and noticed it was always empty. Together
 * they are a complete audit trail that records nothing about anything - written
 * correctly, validated by schema, sealed by the integrity hash, and inert.
 *
 * ------------------------------------------------------------- THE ASSERTIONS
 *
 * The discriminating one is A4, and it is why this file is not three lines long.
 * A build that "supports --task" by accepting the flag and quietly writing an
 * adhoc verdict when the task is unknown passes A1, A2 and A3 - those only ever
 * exercise the happy path. Refusing is the property that separates attribution
 * from the appearance of it, and it is invariant 5 (a failed probe is never
 * reported as a pass) applied to provenance.
 *
 * B7 is its twin on the lifecycle side: the ceiling is the only thing standing
 * between a failing task and an unbounded rework loop, and a ceiling that cannot
 * be reached is the same shape as an assertion that cannot fail - finding 26, and
 * the `prompt_id` counter before it.
 *
 * ------------------------------------------------------- WHAT THIS CANNOT SEE
 *
 * It proves a verdict CAN be attributed and that the verbs move the record. It
 * says nothing about whether the orchestrator actually calls them on every path -
 * that is check-route.mjs's question, and it is a different one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const VERIFY = path.join(SCRIPTS, 'verify.mjs');
const GUARD = path.join(SCRIPTS, 'risk-guard.mjs');

const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-prov-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  return tmp;
}

function run(cwd, script, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
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

const verdictFiles = (p) => {
  const d = path.join(p, PATHS.verdicts);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort() : [];
};
const controlTask = (p, id) =>
  JSON.parse(fs.readFileSync(path.join(p, PATHS.controlTasks, `${id}.json`), 'utf8'));

/* ================================================= A. VERDICT ATTRIBUTION */

console.log('\nA. a verdict names the attempt that produced it:');
{
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'provenance probe']);

  // Control probe. Attribution is impossible before an attempt exists, and the
  // refusal for a MISSING TASK below must be about the task, not about this.
  const before = run(p, VERIFY, ['--record', '--task', '0001']);
  check(before.status === 2 && /attempts is 0/.test(before.err),
    'A0 --task on a task with no attempt refuses, naming the attempt counter'
    + (before.status === 2 ? '' : ` - got exit ${before.status}: ${(before.err || before.out).trim().slice(0, 160)}`));

  /* THE ATTRIBUTION ASSERTIONS RUN AT ATTEMPT 2, NOT ATTEMPT 1, AND THAT IS THE
   * WHOLE POINT OF THEM.
   *
   * Operator, this turn: "a counter test at attempt 1 cannot distinguish correct
   * from off-by-one, so the assertion has to be at attempt 2 or it is decoration."
   *
   * At attempt 1 every candidate implementation agrees. `attempts` is 1,
   * `attempts_total` is 1, and a build that wrote `attempts`, or `attempts_total`,
   * or a hardcoded 1, or `verdicts.length + 1`, all produce
   * `0001-attempt-01.json` with `attempt: 1`. The assertion passes against all
   * four and discriminates between none of them. Two attempts is the smallest
   * number at which the answers separate: 02 is correct, 01 is off-by-one low or
   * a hardcoded 1, 03 is off-by-one high.
   *
   * This is the third read-then-write-then-read-stale instance in this codebase
   * and the second time a counter assertion in this very file has been written at
   * the one value where it cannot fail - B7's ceiling probe was the first, and it
   * only discriminated because it walks to max_attempts + 1. */
  run(p, STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  run(p, STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  run(p, STATE, ['--set-phase', 'verify']);

  const preTask = controlTask(p, '0001');
  check(preTask.attempts === 2 && preTask.attempts_total === 2,
    `A0b control: two attempts consumed, so the counters are past the value where an off-by-one `
    + `is invisible - attempts=${preTask.attempts} attempts_total=${preTask.attempts_total}`);

  const r = run(p, VERIFY, ['--record', '--task', '0001', '--format=human']);
  const files = verdictFiles(p);
  const attributed = files.filter((f) => f.startsWith('0001-attempt-'));
  const adhoc = files.filter((f) => f.startsWith('adhoc-'));

  check(attributed.length === 1 && adhoc.length === 0,
    'A1 --record --task 0001 writes exactly one attributed verdict and no adhoc one'
    + ` - got [${files.join(', ')}]`
    + (files.length ? '' : ` (verify said: ${(r.err || r.out).trim().slice(0, 200)})`));

  check(attributed[0] === '0001-attempt-02.json',
    `A2 the verdict is numbered from the control record and is NOT off by one - expected `
    + `0001-attempt-02.json at two attempts, got ${attributed[0] ?? '(none)'}`);

  const t = controlTask(p, '0001');
  const expected = `${PATHS.verdicts}/0001-attempt-02.json`;
  check(t.verdicts.includes(expected),
    `A3 the control task links the verdict - verdicts[] = ${JSON.stringify(t.verdicts)}`);

  const doc = attributed.length
    ? JSON.parse(fs.readFileSync(path.join(p, PATHS.verdicts, attributed[0]), 'utf8')) : {};
  check(doc.task_id === '0001' && doc.attempt === 2,
    'A3b and the verdict document itself carries the attribution - '
    + `task_id=${JSON.stringify(doc.task_id)} attempt=${JSON.stringify(doc.attempt)}`);

  // THE DISCRIMINATING ONE. A build that accepts --task and falls back to adhoc
  // when it cannot attribute passes everything above, and is not attribution.
  const missing = run(p, VERIFY, ['--record', '--task', '0009']);
  const after = verdictFiles(p);
  check(missing.status === 2 && after.length === files.length && !after.some((f) => f.startsWith('adhoc-')),
    'A4 --task naming a task with no control record REFUSES and writes nothing'
    + ` - exit ${missing.status}, verdicts now [${after.join(', ')}]`);

  check(/no control record|--task expects/.test(missing.err),
    `A4b and it says which of the two problems it is - stderr: ${missing.err.trim().slice(0, 160) || '(empty)'}`);

  /* A6-A6c: WRITE-ONCE. ARCHITECTURE 4.3 calls verdicts the audit trail and says
   * they are never deleted; 4.9 says each attempt writes its own immutable
   * verdict. Neither was enforced - `writeControl` wrote atomically over whatever
   * was there, so re-verifying the same attempt replaced the earlier verdict with
   * no trace, and `verdicts[]` dedupes by path so the control task could not show
   * it either.
   *
   * This is the rework loop's evidence problem. A second verdict on attempt N
   * means either the code changed without an attempt being consumed - the counter
   * that bounds the loop stepped around, the history claiming fewer tries than it
   * took - or it did not change, and a dated record was destroyed to say the same
   * thing. The refusal is what keeps the attempt counter load-bearing: a verdict
   * cannot be had without one. */
  /* THE TREE IS CHANGED BETWEEN THE TWO RUNS, and that is not decoration.
   *
   * The first version of A6b re-verified an unchanged tree and asserted the file
   * was byte-identical afterwards. It passed against the OVERWRITING build,
   * because both runs landed in the same second and `run_at` is second-resolution
   * - so the rewrite produced identical bytes and the assertion could not see it.
   * An assertion about an audit trail that goes green while the trail is being
   * overwritten is the shape this repository keeps finding.
   *
   * Introducing a real violation first makes the two verdicts necessarily differ:
   * pass becomes fail. It also models the case that actually matters, rather than
   * a harmless one - iterating the code and re-verifying WITHOUT consuming an
   * attempt is exactly how the counter that bounds the rework loop gets stepped
   * around, and how the history comes to claim fewer tries than it took. */
  fs.mkdirSync(path.join(p, 'app', 'api', 'leak'), { recursive: true });
  fs.writeFileSync(path.join(p, 'app', 'api', 'leak', 'route.ts'),
    "import { createClient } from '@supabase/supabase-js';\n"
    + "export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);\n"
    + 'export async function GET() { return Response.json({ ok: true }); }\n');
  const beforeDoc = JSON.parse(fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-02.json'), 'utf8'));
  const beforeBytes = fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-02.json'));
  const again = run(p, VERIFY, ['--record', '--task', '0001']);
  const afterBytes = fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-02.json'));
  const afterDoc = JSON.parse(fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-02.json'), 'utf8'));
  // Control: the change must genuinely alter the verdict, or A6b proves nothing.
  const wouldDiffer = beforeDoc.verdict === 'pass';
  check(wouldDiffer,
    `A6-control the first verdict is "pass" and the tree now has a blocker, so an overwrite `
    + `WOULD be visible - first verdict was "${beforeDoc.verdict}"`);
  /* A6 KEYS ON THE REASON, NOT THE EXIT CODE, and the first version did not.
   * Once the tree carries a blocker, `verify.mjs` exits 2 for a perfectly ordinary
   * failing verdict - so "exit != 0" is satisfied by the overwriting build too,
   * and A6 went green under the mutation while A6b and A6c caught it. The
   * ambiguity was introduced by the same edit that made A6b discriminate: exit
   * status now has two meanings on this path and only one of them is a refusal. */
  check(/write-once/.test(again.err + again.out),
    `A6 re-verifying the SAME attempt REFUSES rather than overwriting, identified by the `
    + `refusal itself and not by exit ${again.status} (which a blocking verdict also returns)`);
  check(Buffer.compare(beforeBytes, afterBytes) === 0 && afterDoc.verdict === 'pass',
    `A6b and the existing verdict is byte-identical afterwards, still "${afterDoc.verdict}" - `
    + 'the audit trail is intact even though the tree now says otherwise');
  const againText = (again.err + again.out).replace(/\s+/g, ' ');
  check(/write-once/.test(againText) && /--attempt 0001/.test(againText),
    `A6c and it names consuming an attempt as the move that earns a second verdict - `
    + `${againText.trim().slice(0, 200)}`);
  // A REFUSAL MUST NOT BE WORDED AS A FAULT. The guard throws, and verify.mjs's
  // top-level catch printed "verify.mjs crashed" over it - finding 24's shape,
  // sending the reader to file a checker bug instead of consuming an attempt. It
  // also matters to gate.mjs, whose interpretRunError reads a crash as a checker
  // fault, blocks, and writes the UNVERIFIED marker.
  check(!/crashed/.test(againText),
    `A6e and it is not reported as a crash - a refusal worded as a fault sends the reader `
    + `to the wrong remedy. Got: ${againText.trim().slice(0, 120)}`);

  // ...and the refusal must be RELEASED by consuming an attempt, or it is not a
  // gate on the counter, it is a gate on verifying twice ever.
  run(p, STATE, ['--attempt', '0001']);
  const second = run(p, VERIFY, ['--record', '--task', '0001']);
  check(second.status !== -1 && fs.existsSync(path.join(p, PATHS.verdicts, '0001-attempt-03.json')),
    `A6d and consuming an attempt earns the next verdict - 0001-attempt-03.json `
    + `${fs.existsSync(path.join(p, PATHS.verdicts, '0001-attempt-03.json')) ? 'written' : 'MISSING'}`);

  // The unattributed path must NOT change: gate.mjs runs `--record` with no task
  // on every dirty turn, and those are turn receipts, not attempt verdicts.
  const plain = run(p, VERIFY, ['--record']);
  check(verdictFiles(p).some((f) => f.startsWith('adhoc-')),
    'A5 --record with no --task still writes an adhoc verdict - the per-turn gate path is unchanged'
    + ` (exit ${plain.status})`);

  fs.rmSync(p, { recursive: true, force: true });
}

/* ============================== A7. THE RESET MUST NOT REUSE A VERDICT NAME */

console.log('\nA7. --reset-attempts does not send the verdict numbering back over history:');
{
  /* ONE COUNTER CANNOT BE BOTH A RETRY CEILING AND AN IDENTITY.
   *
   * `--reset-attempts` zeroes the ceiling counter, so the next try was "attempt 1"
   * again and its verdict path was the path of a historical file. Under the old
   * writer that silently overwrote it - destroying the record of exactly the
   * failures the operator had just reset past, which is the one thing anyone
   * reading the task later needs.
   *
   * It was invisible until write-once was enforced: before that the collision was
   * a successful write. Enforcing write-once turned it into a refusal, and the
   * refusal is what made it findable at all. That is the same sequence as every
   * other finding here - the guard that fires is what reveals the defect the
   * silence was hiding.
   *
   * So `attempts_total` is the identity and `attempts` is the policy. This
   * asserts they diverge exactly where they should, and that the divergence is
   * what the verdict name follows. */
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'reset probe']);
  // Verify after EACH attempt, so the numbering sequence itself is exercised
  // rather than only its last value. Three tries, three verdicts, 01 02 03.
  for (let i = 0; i < 3; i += 1) {
    run(p, STATE, ['--attempt', '0001']);
    run(p, VERIFY, ['--record', '--task', '0001']);
  }
  const historical = verdictFiles(p).filter((f) => f.startsWith('0001-'));
  check(historical.join(',') === '0001-attempt-01.json,0001-attempt-02.json,0001-attempt-03.json',
    `A7-control three verified attempts produced 01, 02, 03 in order - got [${historical.join(', ')}]`);
  const histBytes = fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-03.json'));

  const reset = run(p, STATE, ['--reset-attempts', '0001']);
  const afterReset = controlTask(p, '0001');
  check(afterReset.attempts === 0 && afterReset.attempts_total === 3,
    `A7 the reset zeroes the CEILING counter and leaves the IDENTITY counter alone - `
    + `attempts=${afterReset.attempts} attempts_total=${afterReset.attempts_total}`);
  check(/numbered 04/.test(reset.out),
    `A7b and it says which number the next verdict will carry, so nobody expects 01 - `
    + `${reset.out.replace(/\s+/g, ' ').trim().slice(0, 180)}`);

  run(p, STATE, ['--attempt', '0001']);
  const post = controlTask(p, '0001');
  check(post.attempts === 1 && post.attempts_total === 4,
    `A7c the next attempt is 1 against the ceiling and 4 overall - `
    + `attempts=${post.attempts} attempts_total=${post.attempts_total}`);

  const v = run(p, VERIFY, ['--record', '--task', '0001']);
  const now = verdictFiles(p).filter((f) => f.startsWith('0001-'));
  check(now.includes('0001-attempt-04.json'),
    `A7d and its verdict is 0001-attempt-04.json, not a second 01 - got [${now.join(', ')}]`
    + (now.includes('0001-attempt-04.json') ? '' : ` (verify said: ${(v.err || v.out).replace(/\s+/g, ' ').trim().slice(0, 160)})`));
  check(Buffer.compare(histBytes, fs.readFileSync(path.join(p, PATHS.verdicts, '0001-attempt-03.json'))) === 0,
    'A7e and every verdict from before the reset is byte-identical - the reset kept the history '
    + 'it was resetting past');
  check(now.length === 4,
    `A7f four verdicts for four tries, none overwritten - got ${now.length}: [${now.join(', ')}]`);

  fs.rmSync(p, { recursive: true, force: true });
}

/* =================================================== B. THE TASK LIFECYCLE */

console.log('\nB. the task lifecycle can move, and stops where it must:');
{
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'lifecycle probe']);

  const r1 = run(p, STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  const t1 = controlTask(p, '0001');
  check(r1.status === 0 && t1.attempts === 1,
    `B1 --attempt increments the counter - attempts=${t1.attempts}, exit ${r1.status}`
    + (r1.status === 0 ? '' : `: ${(r1.err || r1.out).trim().slice(0, 200)}`));
  check(t1.status === 'in_progress',
    `B2 and moves status off pending - status=${t1.status}`);
  check(t1.owner_agent === 'mavci-builder',
    `B3 and records who owns the attempt - owner_agent=${JSON.stringify(t1.owner_agent)}`);

  const r2 = run(p, STATE, ['--task-status', '0001', '--status', 'done']);
  check(r2.status === 0 && controlTask(p, '0001').status === 'done',
    `B4 --task-status sets a status from the closed enum - exit ${r2.status}`);

  const r3 = run(p, STATE, ['--task-status', '0001', '--status', 'finished']);
  check(r3.status !== 0 && controlTask(p, '0001').status === 'done',
    `B5 and refuses one outside it, without writing - exit ${r3.status}, status still ${controlTask(p, '0001').status}`);

  const r4 = run(p, STATE, ['--block', '0001', '--reason', 'legal.pages_present']);
  const t4 = controlTask(p, '0001');
  const s4 = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8'));
  check(r4.status === 0 && t4.status === 'blocked' && t4.blocked_by === 'legal.pages_present'
    && t4.phase === 'plan' && s4.phase === 'plan',
    `B6 --block records the reason and returns the project to plan - status=${t4.status} `
    + `blocked_by=${JSON.stringify(t4.blocked_by)} task.phase=${t4.phase} state.phase=${s4.phase}`);

  const r4b = run(p, STATE, ['--block', '0001']);
  check(r4b.status !== 0, `B6b and refuses to block with no reason - exit ${r4b.status}`);

  fs.rmSync(p, { recursive: true, force: true });
}

/* A POINTER THAT IS ONLY EVER SET READS AS CURRENT FOREVER.
 *
 * `state.json.active_task` gained a writer in 0.1.22 and no clearer. Observed on
 * gate5: a task that had been built, verified, documented and closed was still
 * the project's `active_task`. The next reader cannot tell that from a live one -
 * and `mavci-builder` has cited this field as evidence about what was being
 * built. Terminal statuses release it; non-terminal ones must not, or the field
 * is cleared out from under the task that is genuinely running. */
console.log('\nB9. a closed task stops being the active one:');
for (const [status, shouldClear] of [['done', true], ['failed', true], ['blocked', true], ['in_progress', false]]) {
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'pointer probe']);
  const before = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8')).active_task;
  const r = status === 'blocked'
    ? run(p, STATE, ['--block', '0001', '--reason', 'x'])
    : run(p, STATE, ['--task-status', '0001', '--status', status]);
  const after = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8')).active_task;
  check(before === '0001' && (shouldClear ? after === null : after === '0001'),
    `B9 --status ${status}: active_task ${before} -> ${JSON.stringify(after)}`
    + ` (${shouldClear ? 'terminal, must clear' : 'not terminal, must NOT clear'})`
    + (r.status === 0 ? '' : ` [command exit ${r.status}]`));
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('\nB7. the ceiling is reachable, which is the whole of the retry policy:');
{
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'ceiling probe']);
  const max = controlTask(p, '0001').max_attempts;
  const results = [];
  for (let i = 0; i < max + 1; i += 1) results.push(run(p, STATE, ['--attempt', '0001']).status);
  const t = controlTask(p, '0001');
  check(results.slice(0, max).every((s) => s === 0) && results[max] !== 0,
    `B7 --attempt succeeds ${max} times and REFUSES the ${max + 1}th - statuses=${results.join(',')}`);
  check(t.attempts === max,
    `B7b and the refusal did not consume an attempt - attempts=${t.attempts}, max=${max}`);

  const r = run(p, STATE, ['--reset-attempts', '0001']);
  check(r.status === 0 && controlTask(p, '0001').attempts === 0,
    'B7c and --reset-attempts is the operator move that reopens it');
  fs.rmSync(p, { recursive: true, force: true });
}

console.log('\nB8. at most one task in progress:');
{
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'first']);
  run(p, STATE, ['--new-task', 'second']);
  run(p, STATE, ['--attempt', '0001']);
  const r = run(p, STATE, ['--attempt', '0002']);
  check(r.status !== 0 && /already in_progress/.test(r.err + r.out),
    `B8 a second concurrent in_progress task is refused - exit ${r.status}: ${(r.err || r.out).trim().slice(0, 200)}`);
  check(controlTask(p, '0002').attempts === 0,
    `B8b and the refused attempt was not counted - task 0002 attempts=${controlTask(p, '0002').attempts}`);
  fs.rmSync(p, { recursive: true, force: true });
}

/* ============== D. THE ORCHESTRATOR EXECUTES A DECISION, IT DOES NOT MAKE ONE */

console.log('\nD. --advance-phase carries a recorded approval; it is not a grant over the phase:');
{
  /* Operator, this turn: "I said the operator's approval is recorded in the task
   * record, and there was no field to record it in. The instruction was correct in
   * intent and unimplementable as written, and only the first real use would have
   * shown it - advance-phase would have refused every time and looked like a
   * working gate."
   *
   * Which is the reason D1 and D3 must BOTH be here. D1 alone is satisfied by a
   * command that refuses unconditionally, and that is precisely the failure mode
   * described: a gate that always says no is indistinguishable from a gate that
   * works, until someone has a legitimate transition to make.
   *
   * D6 is the one that stops the approval being a permanent unlock. Approval is of
   * a SPECIFIC document: without the hash, the architect could rewrite the spec
   * after approval and every later transition would still pass - a stale exemption
   * in the shape 0.1.14 established is indistinguishable from a control that was
   * never there. */
  const p = makeProject();
  run(p, STATE, ['--begin-plan', 'authority probe']);

  const noApproval = run(p, STATE, ['--advance-phase', '0001', '--from', 'plan', '--to', 'build']);
  check(noApproval.status !== 0 && /no recorded spec approval/.test(noApproval.err + noApproval.out),
    `D1 with no recorded approval it REFUSES and names --approve-spec - `
    + `${(noApproval.err || noApproval.out).replace(/\s+/g, ' ').trim().slice(0, 150)}`);

  const noSpec = run(p, STATE, ['--approve-spec', '0001']);
  check(noSpec.status !== 0,
    `D2 --approve-spec refuses while the spec pointer is the shared stub or missing - exit ${noSpec.status}`);

  // The architect's part: a real spec, and the surface half repointed at it.
  fs.mkdirSync(path.join(p, '.mavci', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(p, '.mavci', 'tasks', '0001.md'), '# 0001\n\nAcceptance: it returns 200.\n');
  const sf = path.join(p, PATHS.tasks, '0001.json');
  const surface = JSON.parse(fs.readFileSync(sf, 'utf8'));
  surface.spec = '.mavci/tasks/0001.md';
  fs.writeFileSync(sf, JSON.stringify(surface, null, 2) + '\n');

  const approve = run(p, STATE, ['--approve-spec', '0001']);
  const approved = controlTask(p, '0001').spec_approved;
  check(approve.status === 0 && approved && approved.by === 'operator'
    && /^[0-9a-f]{64}$/.test(approved.spec_sha256 ?? ''),
    `D3 --approve-spec records the decision with the spec's hash - `
    + `${JSON.stringify(approved)?.slice(0, 120)}`);

  const good = run(p, STATE, ['--advance-phase', '0001', '--from', 'plan', '--to', 'build']);
  const t1 = controlTask(p, '0001');
  const s1 = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8'));
  check(good.status === 0 && t1.phase === 'build' && s1.phase === 'build',
    `D3b and THEN the transition succeeds, moving both halves - task=${t1.phase} state=${s1.phase}`
    + (good.status === 0 ? '' : `: ${(good.err || good.out).replace(/\s+/g, ' ').trim().slice(0, 150)}`));

  const skip = run(p, STATE, ['--advance-phase', '0001', '--from', 'build', '--to', 'release']);
  check(skip.status !== 0 && /not a step/.test(skip.err + skip.out),
    `D4 build -> release is refused: skipping verify is how a task reaches release unverified - `
    + `exit ${skip.status}`);

  const stale = run(p, STATE, ['--advance-phase', '0001', '--from', 'plan', '--to', 'build']);
  check(stale.status !== 0 && /is in phase "build", not "plan"/.test(stale.err + stale.out),
    `D5 a caller working from stale state is refused rather than obeyed - exit ${stale.status}`);

  // THE HASH. Rewrite the approved spec and the approval no longer applies.
  fs.writeFileSync(path.join(p, '.mavci', 'tasks', '0001.md'),
    '# 0001\n\nAcceptance: it returns 200, AND deletes the audit log.\n');
  const changed = run(p, STATE, ['--advance-phase', '0001', '--from', 'build', '--to', 'verify']);
  check(changed.status !== 0 && /spec has changed since it was approved/.test(changed.err + changed.out),
    `D6 rewriting the spec after approval REVOKES it - the decision was about a specific `
    + `document, not about the task - exit ${changed.status}`);

  const reapprove = run(p, STATE, ['--approve-spec', '0001']);
  const after = run(p, STATE, ['--advance-phase', '0001', '--from', 'build', '--to', 'verify']);
  check(reapprove.status === 0 && after.status === 0 && controlTask(p, '0001').phase === 'verify',
    `D7 and re-approving the changed spec unlocks it again - so D6 is a revocation, not a `
    + `dead end - exit ${after.status}`);

  const rework = run(p, STATE, ['--advance-phase', '0001', '--from', 'verify', '--to', 'build']);
  check(rework.status === 0 && controlTask(p, '0001').phase === 'build',
    `D8 verify -> build is legal: the rework redispatch goes through the SAME gate as every `
    + `other move, not through a free set - exit ${rework.status}`);

  /* D9: THE PROJECT PHASE IS SHARED, AND THE IN-PROGRESS TASK OWNS IT.
   *
   * Found by running the chain on gate5, not by any assertion: advancing task
   * 0002 succeeded while 0001 was still `in_progress`, moving the project phase
   * out from under a task that was mid-flight. 0002's own halves stayed
   * consistent and 0001's phase simply stopped matching the project's - the exact
   * divergence this release closed, arriving through the command built to prevent
   * it. The invariant was enforced at `--attempt` and `--task-status` and not
   * here: a rule with a door. */
  run(p, STATE, ['--attempt', '0001']);
  run(p, STATE, ['--new-task', 'a second task']);
  fs.writeFileSync(path.join(p, '.mavci', 'tasks', '0002.md'), '# 0002\n\nAcceptance: it exists.\n');
  const sf2 = path.join(p, PATHS.tasks, '0002.json');
  const s2 = JSON.parse(fs.readFileSync(sf2, 'utf8'));
  s2.spec = '.mavci/tasks/0002.md';
  fs.writeFileSync(sf2, JSON.stringify(s2, null, 2) + '\n');
  run(p, STATE, ['--approve-spec', '0002']);
  const phaseBefore = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8')).phase;
  const hijack = run(p, STATE, ['--advance-phase', '0002', '--from', 'plan', '--to', 'build']);
  const phaseAfter = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8')).phase;
  check(hijack.status !== 0 && /already in_progress/.test(hijack.err + hijack.out),
    `D9 advancing one task is REFUSED while another is in_progress - exit ${hijack.status}: `
    + `${(hijack.err || hijack.out).replace(/\s+/g, ' ').trim().slice(0, 130)}`);
  check(phaseBefore === phaseAfter,
    `D9b and the project phase did not move - was ${phaseBefore}, now ${phaseAfter}`);

  fs.rmSync(p, { recursive: true, force: true });
}

/* ================================ C. THE VERBS ARE STILL AGENT-DENIED ===== */

console.log('\nC. the lifecycle verbs are privileged, in both directions:');
{
  const p = makeProject();
  const ask = (agent, cmd) => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      cwd: p,
      tool_name: 'Bash',
      tool_input: { command: cmd },
      ...(agent ? { agent_type: agent } : {}),
    });
    try {
      return execFileSync(process.execPath, [GUARD], {
        cwd: p, input, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: p },
      });
    } catch (err) {
      return (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    }
  };
  /**
   * C1 ASSERTS THE REASON, NOT THE DECISION, AND THE FIRST VERSION DID NOT.
   *
   * Deleting all three verbs from `PRIVILEGED` left this whole section GREEN.
   * The guard also fails closed on any flag it does not recognise, so an
   * unclassified verb is denied to an agent too - by the wrong arm, with the
   * wrong message ("may only run state.mjs with --show, --validate, ..."
   * instead of naming what the command would do), and, decisively, with NO
   * confirm and no classification on the main-session side either. Decision
   * and reason are two facts; only one of them discriminates.
   *
   * That is the eighth time in this repository an assertion has been adjacent
   * to the property it was written for, and it was caught the same way as the
   * other seven: by running the mutation rather than assuming it.
   */
  for (const verb of ['--attempt 0001', '--task-status 0001 --status done', '--block 0001 --reason x']) {
    const name = verb.split(' ')[0];
    const denied = ask('mavci-builder', `node scripts/state.mjs ${verb}`);
    const classified = /may not run/.test(denied) && !/may only run state\.mjs with/.test(denied);
    check(/"permissionDecision"\s*:\s*"deny"/.test(denied) && classified,
      `C1 a subagent running \`state.mjs ${name}\` is denied BY CLASSIFICATION, not by the`
      + ' unrecognised-flag arm - the deny names what the command would do'
      + (classified ? '' : ` - got ${denied.replace(/\s+/g, ' ').trim().slice(0, 220)}`));
    const mainSession = ask(null, `node scripts/state.mjs ${verb}`);
    check(!/"permissionDecision"\s*:\s*"(deny|ask|defer|deferToUser)"/.test(mainSession),
      `C2 and the main session runs \`${name}\` without a confirm`
      + ` - ${mainSession.trim().slice(0, 160) || '(no decision emitted, which is the pass)'}`);
  }

  // Negative control: the classification is by FLAG, not by the string
  // "state.mjs". A privileged flag the guard does not know must still be denied
  // to an agent, or the table above is decorative.
  const unknown = ask('mavci-builder', 'node scripts/state.mjs --demolish 0001');
  check(/"permissionDecision"\s*:\s*"deny"/.test(unknown),
    'C3 negative control: an UNCLASSIFIED state.mjs flag is still denied to an agent'
    + ' - the guard fails closed on anything it was not told about');

  /* C4-C6: THE PHASE AUTHORITY SPLIT.
   *
   * The operator's shape: "Free --set-phase stays operator-only, and the
   * risk-guard entry says which is which and why."
   *
   * `--advance-phase` is exempt from the confirm because it is not a grant over
   * the phase - it names the phase it moves from, refuses an illegal step, refuses
   * an unapproved task and refuses a spec that changed since approval. What it
   * authorises is carrying forward a decision already on disk.
   *
   * `--set-phase` is free - any phase, any time, no precondition - so it leaves
   * the exempt set. This is the only line in that table that got STRICTER in this
   * release, and it has to, or `--advance-phase`'s four refusals are decorative:
   * an orchestrator that can reach the free command has no phase gate at all.
   *
   * WHAT THIS ASSERTS AND WHAT IT DOES NOT. It asserts the guard COMPUTES a tier-2
   * decision for `--set-phase` and none for `--advance-phase`. It does NOT assert
   * that the operator is actually prompted: `confirm()` emits
   * `permissionDecision: "deferToUser"`, which carried-forward item 7 records as a
   * value Claude Code's validator REJECTS - so the payload is discarded and the
   * call falls through to the normal permission flow. The classification is right
   * and its delivery is a known-broken channel. Saying so here is the alternative
   * to asserting a control that does not fire, which is the overclaim this file
   * exists to refuse. */
  const advMain = ask(null, 'node scripts/state.mjs --advance-phase 0001 --from plan --to build');
  check(!/"permissionDecision"/.test(advMain),
    `C4 the main session runs --advance-phase with no decision emitted - `
    + `${advMain.replace(/\s+/g, ' ').trim().slice(0, 140) || '(nothing, which is the pass)'}`);

  const setMain = ask(null, 'node scripts/state.mjs --set-phase build');
  check(/"permissionDecision"/.test(setMain) && /deferToUser|ask/.test(setMain),
    `C5 and free --set-phase is NO LONGER exempt - the guard computes a tier-2 decision for it - `
    + `${setMain.replace(/\s+/g, ' ').trim().slice(0, 160) || '(nothing emitted - it is still exempt)'}`);

  for (const verb of ['--approve-spec 0001', '--advance-phase 0001 --from plan --to build']) {
    const name = verb.split(' ')[0];
    const denied = ask('mavci-builder', `node scripts/state.mjs ${verb}`);
    const classified = /may not run/.test(denied) && !/may only run state\.mjs with/.test(denied);
    check(/"permissionDecision"\s*:\s*"deny"/.test(denied) && classified,
      `C6 a subagent running \`state.mjs ${name}\` is denied BY CLASSIFICATION`
      + (classified ? '' : ` - got ${denied.replace(/\s+/g, ' ').trim().slice(0, 200)}`));
  }

  fs.rmSync(p, { recursive: true, force: true });
}

console.log('');
if (failures.length) {
  console.error(`provenance check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('provenance: a verdict names its task attempt, the lifecycle moves, the ceiling is reachable,');
console.log('            and the verbs that move it remain closed to the agents they govern');

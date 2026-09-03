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

  run(p, STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  run(p, STATE, ['--set-phase', 'verify']);

  const r = run(p, VERIFY, ['--record', '--task', '0001', '--format=human']);
  const files = verdictFiles(p);
  const attributed = files.filter((f) => f.startsWith('0001-attempt-'));
  const adhoc = files.filter((f) => f.startsWith('adhoc-'));

  check(attributed.length === 1 && adhoc.length === 0,
    'A1 --record --task 0001 writes exactly one attributed verdict and no adhoc one'
    + ` - got [${files.join(', ')}]`
    + (files.length ? '' : ` (verify said: ${(r.err || r.out).trim().slice(0, 200)})`));

  check(attributed[0] === '0001-attempt-01.json',
    `A2 the attempt number comes from the control record, not from a flag - got ${attributed[0] ?? '(none)'}`);

  const t = controlTask(p, '0001');
  const expected = `${PATHS.verdicts}/0001-attempt-01.json`;
  check(t.verdicts.includes(expected),
    `A3 the control task links the verdict - verdicts[] = ${JSON.stringify(t.verdicts)}`);

  const doc = attributed.length
    ? JSON.parse(fs.readFileSync(path.join(p, PATHS.verdicts, attributed[0]), 'utf8')) : {};
  check(doc.task_id === '0001' && doc.attempt === 1,
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

  // The unattributed path must NOT change: gate.mjs runs `--record` with no task
  // on every dirty turn, and those are turn receipts, not attempt verdicts.
  const plain = run(p, VERIFY, ['--record']);
  check(verdictFiles(p).some((f) => f.startsWith('adhoc-')),
    'A5 --record with no --task still writes an adhoc verdict - the per-turn gate path is unchanged'
    + ` (exit ${plain.status})`);

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

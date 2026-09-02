#!/usr/bin/env node
/**
 * The plan transition must be ONE write, and state.json's version fields must
 * mean what their readers read.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * gate4c, 2026-09-02, two consecutive Bash calls in one session:
 *
 *     14:06:17Z  state.mjs --set-phase plan   -> "phase = plan", EXIT=0
 *     14:06:29Z  state.mjs --new-task "..."   -> denied by the harness classifier
 *
 * mavci classifies `--new-task` AGENT_OK and `--set-phase` PRIVILEGED - the
 * latter described in its own guard as "the gate deciding whether app code is
 * writable at all". Two external gates ordered that risk backwards: the
 * privileged write went through unconfirmed, the agent-safe one was blocked.
 *
 * We do not own those gates and cannot make them agree with us. What we own is
 * that the plan transition was TWO writes to the same file with an interruptible
 * middle, so an external decision landed between them and left the phase
 * advanced with no task allocated - and because risk-guard freezes application
 * code whenever `phase !== 'build'`, that is the one ordering where the
 * interruption costs.
 *
 * IT WAS ALSO UNDETECTABLE. `active_task` had no writer anywhere in the plugin:
 * stamped `null` by `--init` and never set again. So `{phase: "plan",
 * active_task: null}` was the seeded state, the halted state and the state after
 * a fully successful `--new-task`, all three at once. Nothing in the control
 * plane could tell them apart.
 *
 * ------------------------------------------------------------ AND THE VERSION
 *
 * The same file's `plugin_version` had one name and three readers: `--init`
 * stamps it (created-by), `mavci-verify.yml` clones the tag it names (the pin),
 * `doctor` compares it against the installed version (the skew signal) - and in
 * gate4c the live value was set by none of them, but by `doctor --sync`
 * (last-synced-by). `setState` never restamped it, so plugin 0.1.21 wrote a
 * state.json at 14:06:27Z that says "0.1.20".
 *
 * That is finding 24's class in a single field, and it bites exactly when 24's
 * own remedy is built: 24 requires a schema rejection to be reported as version
 * skew, and for a control document that means knowing WHICH VERSION WROTE THIS
 * DOCUMENT. `plugin_version` looks like that field and is not it.
 *
 * ------------------------------------------------------------------- THE RULE
 *
 * Assertions here are on the state AFTER A FAILED SECOND HALF, on the CLASS of
 * the writer, and on WHICH KEY each reader reads. The adjacent assertions that
 * pass and prove nothing - "--set-phase sets the phase", "--new-task creates a
 * task", "--init stamps the running version" - are all true today, all green,
 * and none of them can see any of this: each tests one half of a pair whose
 * failure lives in the gap between them, or one version agreeing with itself.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const DOCTOR = path.join(SCRIPTS, 'doctor.mjs');
const RISK_GUARD = path.join(SCRIPTS, 'risk-guard.mjs');
const PLAN_SKILL = path.join(ROOT, 'plugins/mavci-core/skills/plan/SKILL.md');
const CI_TEMPLATE = path.join(ROOT, 'plugins/mavci-core/templates/mavci-verify.yml');

const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-transition-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  return tmp;
}

/** Run state.mjs against a project. Never throws; returns output and status. */
function run(cwd, args, script = STATE) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
    });
    return { out: stdout, status: 0 };
  } catch (err) {
    return { out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''), status: err.status ?? -1 };
  }
}

const statePath = (root) => path.join(root, PATHS.state);
const readStateRaw = (root) => fs.readFileSync(statePath(root), 'utf8');
const readStateDoc = (root) => JSON.parse(readStateRaw(root));

const stateSrc = fs.readFileSync(STATE, 'utf8');
const doctorSrc = fs.readFileSync(DOCTOR, 'utf8');
const guardSrc = fs.readFileSync(RISK_GUARD, 'utf8');
const planSrc = fs.readFileSync(PLAN_SKILL, 'utf8');
const ciSrc = fs.existsSync(CI_TEMPLATE) ? fs.readFileSync(CI_TEMPLATE, 'utf8') : '';

/* ============================================================== A. ATOMICITY */

console.log('\nA. the plan transition is one write:');

let beginPlanExists = false;
{
  const p = makeProject();
  const r = run(p, ['--begin-plan', 'a first task']);
  beginPlanExists = r.status === 0;
  if (r.status !== 0) {
    bad('`--begin-plan "<title>"` does not exist or failed. The plan transition is still two '
      + `separate writes, so an interruption between them is still reachable. Output: ${r.out.trim().slice(0, 200)}`);
  } else {
    const s = readStateDoc(p);
    if (s.phase !== 'plan') bad(`--begin-plan left phase = ${s.phase}, expected plan`);
    else ok('--begin-plan sets phase = plan');
    if (s.active_task !== '0001') bad(`--begin-plan left active_task = ${JSON.stringify(s.active_task)}, expected "0001"`);
    else ok('--begin-plan records the allocated task on the state');
    if (s.next_task_id !== 2) bad(`--begin-plan left next_task_id = ${s.next_task_id}, expected 2`);
    else ok('--begin-plan advances next_task_id');
    const surface = path.join(p, PATHS.tasks, '0001.json');
    const control = path.join(p, PATHS.controlTasks, '0001.json');
    if (!fs.existsSync(surface) || !fs.existsSync(control)) {
      bad('--begin-plan did not write both task halves');
    } else ok('--begin-plan writes both task halves');
  }
  fs.rmSync(p, { recursive: true, force: true });
}

/** A regular file where the tasks directory must be: the task write throws ENOTDIR. */
function blockTaskWrites(p) {
  const tasksDir = path.join(p, PATHS.tasks);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.writeFileSync(tasksDir, 'not a directory');
}

// THE CONTROL PROBE. Before asserting that the atomic transition holds state
// steady, prove the fixture can move it at all. Without this the assertion below
// is green whenever `--begin-plan` is missing, unreachable or a no-op - which is
// EXACTLY what happened on this check's first run against 0.1.21: the command did
// not exist, the run failed, state.json was untouched, and the atomicity
// assertion printed `ok`. A probe that passes because its subject is absent is
// the failure mode this repository keeps recording, and it was reproduced here.
let fixtureBites = false;
{
  const p = makeProject();
  blockTaskWrites(p);
  const before = readStateRaw(p);
  run(p, ['--set-phase', 'plan']);
  run(p, ['--new-task', 'the interrupted sequence']);
  const after = readStateRaw(p);
  fixtureBites = before !== after;
  if (!fixtureBites) {
    bad('CONTROL PROBE INERT: the legacy two-step sequence did not change state.json under a '
      + 'blocked task write, so the fixture cannot see a half-commit and every atomicity '
      + 'assertion below would pass for the wrong reason.');
  } else {
    ok('control probe bites: the legacy --set-phase/--new-task sequence half-commits under a blocked task write');
  }
  fs.rmSync(p, { recursive: true, force: true });
}

// THE ASSERTION THAT MATTERS. Not "each half works" - both halves work today.
// The state after a FAILED second half is the only thing that can see the defect.
{
  const p = makeProject();
  run(p, ['--set-phase', 'verify']);
  blockTaskWrites(p);

  const before = readStateRaw(p);
  const r = run(p, ['--begin-plan', 'this must not half-commit']);
  const after = readStateRaw(p);

  if (r.status === 0) {
    bad('--begin-plan reported success while the task write could not happen. A transition that '
      + 'cannot write its task must fail, not report a phase it did not earn.');
  } else if (!beginPlanExists) {
    bad('atomicity NOT TESTED: --begin-plan does not exist, so the run below failed before it '
      + 'could write anything. This is not a pass - it is the assertion having no subject.');
  } else ok('--begin-plan fails when the task cannot be written');

  if (before !== after) {
    const b = JSON.parse(before); const a = JSON.parse(after);
    bad('THE HALF-COMMIT IS STILL REACHABLE: the task write failed and state.json changed anyway '
      + `(phase ${b.phase} -> ${a.phase}, next_task_id ${b.next_task_id} -> ${a.next_task_id}). `
      + 'The phase advanced with nothing to plan against, which is the gate4c halt exactly.');
  } else if (beginPlanExists && fixtureBites) {
    ok('a failed --begin-plan leaves state.json byte-identical');
  }
  fs.rmSync(p, { recursive: true, force: true });
}

// The two-step sequence must not survive in the skill, or the atomic command is
// a door nobody walks through.
// Scoped to the INVOCATION, not the words: the skill names the old sequence in
// prose to warn against falling back to it, and an assertion that cannot tell a
// command from a warning about that command forces the warning to be deleted.
if (/state\.mjs["'`]?\s+--set-phase\s+plan/.test(planSrc)) {
  bad('skills/plan/SKILL.md still INVOKES `state.mjs --set-phase plan`. The atomic transition '
    + 'exists and the procedure still uses the interruptible one.');
} else ok('the plan skill no longer invokes --set-phase plan');
if (!/--begin-plan/.test(planSrc)) {
  bad('skills/plan/SKILL.md does not mention --begin-plan');
} else ok('the plan skill uses --begin-plan');

/* ========================================================= B. CLASSIFICATION */

console.log('\nB. every phase writer is classified privileged:');

/** CLI subcommands whose case body reaches a phase write. */
function phaseWritingSubcommands(src) {
  const out = [];
  const parts = src.split(/case '(--[a-z-]+)':/);
  for (let i = 1; i < parts.length; i += 2) {
    const flag = parts[i];
    const body = parts[i + 1] ?? '';
    if (/setPhase\s*\(|beginPlan\s*\(|phase:\s*['"]/.test(body)) out.push(flag);
  }
  return [...new Set(out)];
}

const privileged = [...guardSrc.matchAll(/^\s*'(--[a-z-]+)':\s*'/gm)].map((m) => m[1]);
const agentOkLine = guardSrc.match(/const AGENT_OK = \[([^\]]*)\]/);
const agentOk = agentOkLine ? [...agentOkLine[1].matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]) : [];
const phaseWriters = phaseWritingSubcommands(stateSrc);

if (!phaseWriters.length) {
  bad('no phase-writing subcommand found in state.mjs - the extractor matched nothing, so this '
    + 'section would report green over an empty set.');
} else ok(`phase writers found: ${phaseWriters.join(', ')}`);

for (const f of phaseWriters) {
  if (!privileged.includes(f)) {
    bad(`state.mjs \`${f}\` writes the phase and is NOT in risk-guard's PRIVILEGED map. A new `
      + 'subcommand inherits no classification, so the app-code gate becomes reachable by omission.');
  } else ok(`${f} is classified privileged`);
  if (agentOk.includes(f)) {
    bad(`state.mjs \`${f}\` writes the phase and is in AGENT_OK. That hands the gate deciding `
      + 'whether app code is writable to an unattended subagent.');
  }
}
if (!agentOk.includes('--new-task')) {
  bad('--new-task is no longer AGENT_OK. connect allocates one task per baselined check and must '
    + 'keep reaching it; if it gained a phase write, that is the escalation this check exists to stop.');
} else ok('--new-task stays agent-safe');
if (phaseWriters.includes('--new-task')) {
  bad('--new-task now writes the phase. It is AGENT_OK, so this is a privilege escalation.');
}

/* ========================================================= C. OBSERVABILITY */

console.log('\nC. seeded, halted and planned are three distinguishable states:');

{
  const seeded = makeProject();
  const planned = makeProject();
  run(planned, ['--begin-plan', 'a task']);

  const showOf = (p) => { const r = run(p, ['--show']); return r.status === 0 ? r.out : null; };
  const a = showOf(seeded);
  const b = showOf(planned);

  if (a === null || b === null) bad('--show failed on a fixture project');
  else if (a === b) {
    bad('--show reports the seeded project and the planned project IDENTICALLY. The halt at '
      + 'gate4c was invisible for exactly this reason: nothing in the control plane could tell a '
      + 'fresh project from one whose transition half-completed.');
  } else ok('--show distinguishes a seeded project from a planned one');

  if (a !== null && !/active_task/.test(a)) {
    bad('--show does not report active_task, so the field an operator would use to see whether a '
      + 'transition completed is not in the report at all.');
  } else if (a !== null) ok('--show reports active_task');

  if (JSON.parse(readStateRaw(seeded)).active_task !== null) bad('a seeded project has a non-null active_task');
  else ok('seeded is active_task: null');

  fs.rmSync(seeded, { recursive: true, force: true });
  fs.rmSync(planned, { recursive: true, force: true });
}

/* ======================================================= D. VERSION FIELDS */

console.log('\nD. one fact per field:');

{
  const p = makeProject();
  const seeded = readStateDoc(p);

  if ('plugin_version' in seeded) {
    bad('--init still writes `plugin_version`. One name, three readers: --init means created-by, '
      + 'mavci-verify.yml clones it as the pin, doctor compares it as the skew signal. Split it.');
  } else ok('--init no longer writes the ambiguous `plugin_version`');
  if (!('ci_pinned_plugin_version' in seeded)) {
    bad('--init does not write `ci_pinned_plugin_version` - the field CI actually clones.');
  } else ok('--init writes ci_pinned_plugin_version');
  if (!('written_by_plugin_version' in seeded)) {
    bad('--init does not write `written_by_plugin_version`.');
  } else ok('--init writes written_by_plugin_version');

  // THE ASSERTION THAT MATTERS. A version writing its own fresh state agrees
  // with itself - that is the adjacent green one. This one runs a write over an
  // EXISTING document that names a different version.
  const doc = readStateDoc(p);
  doc.written_by_plugin_version = '0.0.1';
  doc.ci_pinned_plugin_version = '0.0.1';
  delete doc.plugin_version;
  fs.writeFileSync(statePath(p), JSON.stringify(doc, null, 2) + '\n');
  state.seal(p);

  const r = run(p, ['--new-task', 'an ordinary write']);
  if (r.status !== 0) {
    bad(`--new-task failed on a project carrying the new fields: ${r.out.trim().slice(0, 200)}`);
  } else {
    const after = readStateDoc(p);
    if (after.written_by_plugin_version !== state.pluginVersion()) {
      bad('setState did not stamp `written_by_plugin_version`. It spreads the previous document '
        + `and never restamps, so the file still says ${JSON.stringify(after.written_by_plugin_version)} `
        + `after ${state.pluginVersion()} wrote it - which is the gate4c observation exactly, and the `
        + "fact finding 24's remedy has to read.");
    } else ok('setState stamps written_by_plugin_version on an ordinary write');

    // THE NAIVE-FIX GUARD. Restamping everything satisfies the assertion above
    // and silently repins CI from any machine with a newer plugin installed.
    if (after.ci_pinned_plugin_version !== '0.0.1') {
      bad('an ordinary `--new-task` moved `ci_pinned_plugin_version`. The pin is a deliberate '
        + 'operator act (doctor --sync, then commit); a side effect that repins CI removes the '
        + 'decision the workflow header exists to protect.');
    } else ok('an ordinary write leaves the CI pin untouched');
  }
  fs.rmSync(p, { recursive: true, force: true });
}

// The two questions must read two keys.
if (/state\.plugin_version|\.plugin_version\b/.test(doctorSrc.split('checkVersionSkew')[1]?.slice(0, 1200) ?? '')) {
  bad("doctor's skew check still reads `plugin_version`. It must read the pin by its own name.");
} else ok('doctor reads the pin by name');
if (ciSrc && !/ci_pinned_plugin_version/.test(ciSrc)) {
  bad('templates/ci/mavci-verify.yml does not read `ci_pinned_plugin_version`; CI is still '
    + 'cloning the tag named by a field whose meaning is set elsewhere.');
} else if (ciSrc) ok('the CI template clones the tag named by ci_pinned_plugin_version');
if (/written_by_plugin_version/.test(ciSrc)) {
  bad('the CI template reads `written_by_plugin_version`. That field follows the local install, '
    + 'so CI would clone whatever version last wrote the file.');
}

// The rider: the one write that sets the pin must go through the sanctioned writer.
{
  const sync = doctorSrc.split('function checkVersionSkew')[1]?.split('\nfunction ')[0] ?? '';
  if (/fs\.writeFileSync\(/.test(sync)) {
    bad('doctor --sync still writes state.json with a bare fs.writeFileSync and then reseals, so '
      + 'the seal certifies a document no validator saw. CLAUDE.md says the control plane is '
      + 'written only by state.mjs; for this field that is false.');
  } else ok('doctor --sync writes the pin through the sanctioned writer');
}

// Back-compat: a project on the old format must still be readable and must migrate.
{
  const p = makeProject();
  const doc = readStateDoc(p);
  delete doc.ci_pinned_plugin_version;
  delete doc.written_by_plugin_version;
  doc.plugin_version = '0.1.20';
  fs.writeFileSync(statePath(p), JSON.stringify(doc, null, 2) + '\n');
  state.seal(p);

  const v = run(p, ['--validate']);
  if (v.status !== 0) {
    bad('a state.json in the PREVIOUS format no longer validates. Every connected project is in '
      + "that format, and finding 24 is what an invalid control document costs: the gate blocks "
      + 'with a remedy that cannot clear it. The legacy key must stay readable.');
  } else ok('a previous-format state.json still validates');

  const w = run(p, ['--new-task', 'a write over a legacy document']);
  if (w.status !== 0) {
    bad(`an ordinary write failed against a previous-format state.json: ${w.out.trim().slice(0, 200)}`);
  } else {
    const after = readStateDoc(p);
    if (after.ci_pinned_plugin_version !== '0.1.20') {
      bad('the legacy `plugin_version` was not carried into `ci_pinned_plugin_version`. CI would '
        + 'silently lose its pin and clone whatever the fallback resolves to.');
    } else ok('the legacy pin is migrated, not dropped');
  }
  fs.rmSync(p, { recursive: true, force: true });
}

if (failures.length) {
  console.error('\nstate transition check FAILED:');
  for (const x of failures) console.error('  - ' + x);
  process.exit(2);
}
console.log('\nthe plan transition is atomic, classified, observable, and each version field has one reader');

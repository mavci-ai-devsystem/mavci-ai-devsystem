#!/usr/bin/env node
/**
 * Regression tests for gate.mjs. Every case here corresponds to a bug that was
 * SILENT when it existed: the gate kept running and reported nothing wrong.
 *
 * A silent failure in the enforcement layer is indistinguishable from a clean
 * run, so none of these can be left to manual testing. In particular:
 *
 *   - readStdin swallowing a JSON parse error was a fail-OPEN: the gate lost
 *     cwd and prompt_id, scanned the wrong directory and reset its own loop
 *     counter every turn, while appearing to work.
 *   - A crashed checker exits non-zero, which Claude Code treats as
 *     non-blocking (4.18). Without the wrapper the turn just passed.
 *   - A cancelled hook renders no decision at all (4.17). Nothing inside the
 *     hook can prevent that, so the only defence is the completion sentinel,
 *     and an unasserted sentinel is a comment.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const GATE = path.join(SCRIPTS, 'gate.mjs');
const GUARD = path.join(SCRIPTS, 'risk-guard.mjs');
const RULES = path.join(SCRIPTS, 'rules', 'index.mjs');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { readJsonOrNull } = await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'fsx.mjs')).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));
const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/**
 * Run gate.mjs with a payload; never throws.
 * spawnSync, not execFileSync, because stderr is half the contract: on exit 2
 * "the blocking message is the reason from your JSON's blocking decision when
 * it makes one, and your stderr text otherwise". A runner that discards stderr
 * cannot see which half arrived, or whether either did.
 */
function runGate(cwd, payload, { raw = null, args = [] } = {}) {
  const input = raw !== null ? raw : JSON.stringify({ ...payload, cwd });
  const r = spawnSync(process.execPath, [GATE, ...args],
    { input, encoding: 'utf8', timeout: 60_000, cwd });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status === null ? -1 : r.status,
  };
}

/**
 * Classify the emitted payload by shape. `block` is the top-level decision the
 * Stop decision-control table defines; `message` is `systemMessage`, which is a
 * user-facing note and renders no decision. These are SHAPE assertions - the
 * delivery assertions below are the load-bearing ones, and this reader exists to
 * say which shape produced them, not to stand in for them.
 */
function decision(stdout) {
  if (!stdout.trim()) return { kind: 'silent' };
  let o;
  try { o = JSON.parse(stdout); }
  catch { return { kind: 'unparseable', stdout }; }
  if (o.decision === 'block') return { kind: 'block', reason: o.reason ?? '' };
  if (o.hookSpecificOutput?.systemMessage) return { kind: 'message', reason: o.hookSpecificOutput.systemMessage };
  return { kind: 'other', o };
}

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-gate-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  // a page so legal.pages_present does not dominate every result
  const kv = path.join(tmp, 'app', '(legal)', 'kvkk');
  fs.mkdirSync(kv, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, 'plugins/mavci-core/templates/fixtures/legal.kvkk_structure/good/app/(legal)/kvkk/page.tsx'),
    path.join(kv, 'page.tsx'));
  fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n.env*\n');
  state.init(tmp, MANIFEST);
  return tmp;
}

const cleanup = [];
try {

/* --- 1. malformed payload must fail closed ---------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const r = runGate(tmp, null, { raw: 'this is not json' });
  const d = decision(r.stdout);
  if (d.kind === 'block' && /ENFORCEMENT DID NOT RUN/.test(d.reason) && r.status === 2) {
    ok('malformed hook payload fails closed (decision:block + exit 2)');
  } else {
    bad(`malformed payload: expected fail-closed, got kind=${d.kind} status=${r.status}`);
  }
}

/* --- 2. crashed checker must fail closed ------------------------------ */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const backup = fs.readFileSync(RULES, 'utf8');
  fs.writeFileSync(RULES, 'this is not valid javascript {{{\n');
  try {
    runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'c1', session_id: 's' }, { args: ['--mark-dirty'] });
    const r = runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'c1', session_id: 's' });
    const d = decision(r.stdout);
    if (d.kind === 'block' && /ENFORCEMENT DID NOT RUN/.test(d.reason) && r.status === 2) {
      ok('crashed checker fails closed');
    } else {
      bad(`crashed checker: expected fail-closed, got kind=${d.kind} status=${r.status}`);
    }
    const run = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.gateRun), 'utf8'));
    if (run.completed && run.outcome === 'crashed') ok('crash is recorded in the completion sentinel');
    else bad(`crash sentinel: completed=${run.completed} outcome=${run.outcome}`);
  } finally {
    fs.writeFileSync(RULES, backup);
  }
}

/* --- 3. fast path: a turn that wrote nothing must not run the checker -- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const t0 = Date.now();
  const r = runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'q1', session_id: 's' });
  const ms = Date.now() - t0;
  const d = decision(r.stdout);
  if (d.kind === 'silent' && r.status === 0) ok(`question turn is a no-op (${ms}ms, no checker run)`);
  else bad(`question turn: expected silence, got kind=${d.kind}`);
  if (fs.existsSync(path.join(tmp, PATHS.gateRun))) {
    bad('fast path wrote a gate-run sentinel; it should not have started a run at all');
  } else ok('fast path writes no sentinel');
}

/* --- 4. a violation must refuse to let the turn end ------------------- */
/*
 * WHAT THIS CAN AND CANNOT ASSERT - read before weakening it.
 *
 * CI cannot observe a turn actually being blocked. That needs a live Claude
 * Code session choosing to honour the hook, and nothing here drives one. What
 * CI can assert is the MECHANISM the docs guarantee: exit code 2. Exit-code-2
 * table, verbatim: "`Stop` | Yes | Prevents Claude from stopping, continues
 * the conversation" (code.claude.com/docs/en/hooks, CC 2.1.250).
 *
 * Until 0.1.10 this block asserted the PAYLOAD SHAPE ONLY. It passed on every
 * release from 0.1.2 to 0.1.9 while the gate exited 0 and blocked nothing -
 * the exact assertion that let one Gate 4 session record eight failing
 * verdicts and never stop a turn. Shape is not effect. The status assertion
 * below is the load-bearing one; do not drop it to make a refactor pass.
 *
 * STILL REQUIRED BY HAND, every release: plant a real violation in a real
 * project, end a real turn, confirm the turn does not end. NATIVE-CAPABILITIES 4.5.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.mkdirSync(path.join(tmp, 'app', 'api', 'x'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'api', 'x', 'route.ts'),
    'export async function GET(){return Response.json({})}\n');

  const p = { hook_event_name: 'Stop', prompt_id: 'b1', session_id: 's' };
  runGate(tmp, p, { args: ['--mark-dirty'] });
  const r = runGate(tmp, p);
  const d = decision(r.stdout);
  if (r.status === 2) {
    ok('a violation exits 2 - the documented mechanism that refuses the stop');
  } else {
    bad(`violation: expected exit 2, got status=${r.status}. The turn would NOT be blocked.`);
  }
  if (d.kind === 'block' && /next\.route_force_dynamic/.test(d.reason)) {
    ok('the payload names the failing check');
  } else {
    bad(`violation: expected payload naming the check, got kind=${d.kind}`);
  }
  const run = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.gateRun), 'utf8'));
  if (run.completed && run.outcome === 'fail') ok('failing gate closes its sentinel');
  else bad('failing gate left its sentinel open');

  /* --- 5. loop ceiling ------------------------------------------------ */
  const kinds = [];
  for (let i = 0; i < 3; i++) {
    runGate(tmp, p, { args: ['--mark-dirty'] });
    kinds.push(decision(runGate(tmp, p).stdout).kind);
  }
  // first gate above was block #1, so these are #2, #3, #4
  if (kinds[0] === 'block' && kinds[1] === 'message' && kinds[2] === 'message') {
    ok('loop ceiling: stops asking after 3 gates and hands the failure to the operator');
  } else {
    bad(`loop ceiling: expected block,message,message got ${kinds.join(',')}`);
  }
}

/* --- 4b. the blocking reason must REACH THE AGENT ---------------------
 *
 * The load-bearing assertion of 0.1.11, and the one every earlier version of
 * this file was missing. Case 4 asserts exit 2, which is the REFUSAL. This
 * asserts the EXPLANATION, and exit 2 with an empty explanation is exactly what
 * 0.1.10 ships. Gate 4's Stop feedback, in full:
 *
 *     [node .../0.1.10/scripts/gate.mjs]: No stderr output
 *
 * while `detail` - check id, path, line, evidence and remedy - sat in a payload
 * field nothing reads. An agent refused without being told why cannot fix the
 * violation, so it stops again identically until GATE_MAX_CONTINUES is spent
 * and the gate gives up: the loop guard becomes the exit path for every real
 * violation.
 *
 * `deliveredBlockingMessage` is NOT our convention. It transcribes the
 * documented resolution order from the hooks reference
 * (code.claude.com/docs/en/hooks, fetched 2026-08-29):
 *
 *   Exit code 2: "The blocking message is the reason from your JSON's blocking
 *   decision when it makes one, and your stderr text otherwise."
 *
 *   Stop decision control: "`decision` | `"block"` prevents Claude from
 *   stopping. Omit to allow Claude to stop" and "`reason` | Required when
 *   `decision` is `"block"`. Tells Claude why it should continue" - both
 *   TOP-LEVEL. Plus: "A hook that blocks by exiting 2 routes the same way as
 *   `reason`: Claude receives the stderr message as the explanation for why it
 *   should continue."
 *
 *   Decision-control table, Stop's row: pattern "Top-level `decision`", key
 *   fields `decision: "block"`, `reason`. The only `hookSpecificOutput` field
 *   Stop honours is `additionalContext`; a `stopReason` nested inside
 *   `hookSpecificOutput` is not a field of any documented shape and renders no
 *   decision at all.
 *
 * So the resolution is exact rather than a guess: no top-level blocking
 * decision means the message is stderr, and empty stderr means the agent is
 * told nothing. This is CLAUDE.md's rule applied to the checker itself - the
 * assertion compares against the contract OUTSIDE this repo, not against what
 * our own code happens to emit. "gate.mjs emits what gate.mjs emits" is the
 * shape of assertion that let seven releases ship a dead gate.
 */
function deliveredBlockingMessage({ stdout, stderr }) {
  const t = (stdout ?? '').trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    let o = null;
    try { o = JSON.parse(t); } catch { /* unparseable: resolution falls to stderr */ }
    if (o && o.decision === 'block' && typeof o.reason === 'string' && o.reason.trim()) {
      return { via: 'decision.reason', text: o.reason };
    }
  }
  return (stderr ?? '').trim() ? { via: 'stderr', text: stderr } : { via: 'NOTHING', text: '' };
}

/**
 * Assert that a blocking run actually delivered `want` to the agent, on BOTH
 * documented carriers independently.
 *
 * Asserting only the resolved message is not enough. The JSON decision wins
 * whenever it is present, so a test that checks the resolution alone would go
 * green with stderr empty and never notice - and stderr is the carrier that
 * survives the one failure the reference singles out:
 *
 *   "A hook that exits 2 while printing JSON that fails JSON output schema
 *    validation still blocks: Claude Code uses stderr as the blocking reason
 *    and records the validation failure in the debug log."
 *
 * That is the entire point of writing both. If a future Claude Code tightens
 * the Stop schema and rejects our object, the gate must still speak. So the
 * fallback is exercised deliberately, by resolving a second time with stdout
 * removed: not a simulation of a bug we invented, but of the documented path.
 * Depending on which carrier happens to win is how belt-and-braces decays into
 * one belt and a decorative brace - which is what 0.1.10 shipped.
 */
function assertDelivered(label, r, want) {
  if (r.status !== 2) {
    bad(`${label}: precondition failed - expected exit 2, got status=${r.status}`);
    return;
  }

  const carriers = [
    ['as sent', deliveredBlockingMessage(r)],
    // stdout removed: what the agent gets if the JSON object is ever rejected.
    ['with the JSON decision rejected', deliveredBlockingMessage({ stdout: '', stderr: r.stderr })],
  ];

  const vias = [];
  for (const [when, got] of carriers) {
    if (got.via === 'NOTHING') {
      bad(`${label}, ${when}: NOTHING reached the agent. No top-level decision:"block" with a `
        + `reason on stdout, and no stderr. The turn is refused with an empty explanation. `
        + `stdout was ${JSON.stringify((r.stdout ?? '').slice(0, 160))}`);
      return;
    }
    const missing = want.filter((re) => !re.test(got.text));
    if (missing.length) {
      bad(`${label}, ${when}: delivered via ${got.via}, but the text does not contain `
        + `${missing.map(String).join(', ')} - got ${JSON.stringify(got.text.slice(0, 200))}`);
      return;
    }
    vias.push(got.via);
  }

  if (vias[0] !== 'decision.reason' || vias[1] !== 'stderr') {
    bad(`${label}: expected the JSON decision to win as sent and stderr to carry it alone, `
      + `got ${vias.join(' then ')}`);
    return;
  }
  ok(`${label}: delivered via ${vias[0]}, and independently via ${vias[1]}`);
}

{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.mkdirSync(path.join(tmp, 'app', 'api', 'y'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'api', 'y', 'route.ts'),
    'export async function GET(){return Response.json({})}\n');

  const p = { hook_event_name: 'Stop', prompt_id: 'd1', session_id: 's' };
  runGate(tmp, p, { args: ['--mark-dirty'] });
  assertDelivered('a violation tells the agent what to fix',
    runGate(tmp, p),
    [/next\.route_force_dynamic/, /app[\/]api[\/]y[\/]route\.ts/]);
}

{
  // failClosed is the other half. A gate that broke must say so to the agent
  // too: "ENFORCEMENT DID NOT RUN" delivered nowhere is a turn refused for no
  // stated reason, which reads to an agent as a malfunction it cannot act on.
  const tmp = makeProject(); cleanup.push(tmp);
  assertDelivered('a fail-closed gate tells the agent enforcement did not run',
    runGate(tmp, null, { raw: 'this is not json' }),
    [/ENFORCEMENT DID NOT RUN/, /doctor/]);
}

/* --- 6. the completion sentinel is what a TIMEOUT leaves behind -------
 * A cancelled hook cannot report itself, so the next turn's PreToolUse guard
 * has to. Simulated by leaving a run open, which is exactly the on-disk state
 * a killed gate produces.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(path.join(tmp, PATHS.gateRun), JSON.stringify({
    schema_version: 1, prompt_id: 'killed', session_id: 's',
    started: new Date(Date.now() - 45_000).toISOString().replace(/[.]\d{3}Z$/, 'Z'),
    completed: null, outcome: null, budget_ms: 25000, plugin_version: '0.1.0',
  }, null, 2));

  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm run build' }, cwd: tmp, prompt_id: 'next' }),
      encoding: 'utf8', timeout: 15000,
    });
  } catch (err) { stdout = err.stdout?.toString() ?? ''; }

  let msg = '';
  try { msg = JSON.parse(stdout).hookSpecificOutput?.systemMessage ?? ''; } catch { /* handled below */ }
  if (/never finished/.test(msg) && /NOT verified/.test(msg)) {
    ok('an unfinished gate from the previous turn is reported on the next turn');
  } else {
    bad(`timeout sentinel: next turn did not report it (got ${JSON.stringify(stdout).slice(0, 120)})`);
  }

  // and the notice must not corrupt a decision that happens in the same call
  let denyOut = '';
  try {
    denyOut = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, cwd: tmp, prompt_id: 'next' }),
      encoding: 'utf8', timeout: 15000,
    });
  } catch (err) { denyOut = err.stdout?.toString() ?? ''; }
  try {
    const o = JSON.parse(denyOut).hookSpecificOutput;
    if (o.permissionDecision === 'deny' && /never finished/.test(o.systemMessage ?? '')) {
      ok('the notice rides along with a deny instead of emitting a second JSON object');
    } else {
      bad('notice + deny did not combine into one decision');
    }
  } catch {
    bad('notice + deny produced unparseable output - two JSON objects would fail open');
  }
}

/* --- a command can arm the gate for a turn it writes nothing in -------- */
{
  // /mavci-core:verify runs the checker but writes no files and is not in the
  // build phase, so case 3's fast path would skip its Stop turn entirely - which
  // left the skill's own inline probe as the only recorder, and an inline probe
  // has three documented ways of not running (NATIVE-CAPABILITIES 2.11). The
  // command therefore marks its own turn through the dirty path that already
  // exists, rather than through an exemption, which would be a second way for
  // the gate to skip.
  const tmp = makeProject(); cleanup.push(tmp);
  const sid = 'sess-armed';

  const armed = runGate(tmp, {}, { args: ['--mark-dirty', `--session=${sid}`] });
  if (/gate armed/.test(armed.stdout) && armed.status === 0) {
    ok('--mark-dirty --session announces itself (silence would be indistinguishable from not running)');
  } else {
    bad(`--mark-dirty --session: expected "gate armed", got status=${armed.status} stdout=${JSON.stringify(armed.stdout)}`);
  }

  // The armed turn must NOT take the fast path, even though it wrote nothing.
  runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'v1', session_id: sid });
  if (fs.existsSync(path.join(tmp, PATHS.gateRun))) {
    ok('an armed session runs the checker on a turn that wrote no files');
  } else {
    bad('armed session still took the fast path - the verify turn would go unrecorded');
  }

  // And it is consumed: the NEXT turn in the same session is cheap again, so
  // arming costs one gate run rather than making the whole session dirty.
  fs.rmSync(path.join(tmp, PATHS.gateRun), { force: true });
  const after = runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'v2', session_id: sid });
  if (!fs.existsSync(path.join(tmp, PATHS.gateRun)) && decision(after.stdout).kind === 'silent') {
    ok('the session marker is consumed once - a later turn is a no-op again');
  } else {
    bad('session marker was not consumed: every later turn in this session would run the checker');
  }
}

/* --- 7. A CHECKER FAULT MUST NOT TRAP THE AGENT FOREVER ----------------
 *
 * Gate 4c, finding 3. `failClosed` blocked on every crash with no ceiling, so a
 * broken checker produced an unsatisfiable gate: the fault is IN THE CHECKER,
 * which the agent is forbidden to edit, and the gate's own message says so -
 * "This is a bug in the checker, not in your code" - and then refuses to let the
 * turn end anyway. Three consecutive turns in gate4c ended in the identical
 * crash. The fourth escaped only because an unrelated in-project fix happened to
 * remove the offending string. That was luck, and luck must not be the exit.
 *
 * Note which arm had the ceiling and which did not: `readContinues` /
 * GATE_MAX_CONTINUES capped the VIOLATION path, which the agent can satisfy by
 * fixing its code, and left the CRASH path - the one arm it provably cannot
 * satisfy - uncapped. That is inverted, and this case is the assertion that it
 * stays the right way round.
 *
 * WHAT THE ASSERTION HAS TO BE, AND THE WRONG ONE IT REPLACES
 * "The gate blocks on a crash" passes against the broken build: the gate blocks
 * perfectly, forever. That is the adjacent-but-wrong signal again. The assertion
 * that separates a working build from the broken one is that the agent REACHES A
 * TURN END within N turns, AND that the session is marked unverified when it
 * does - because ending the turn without the marker is just fail-open with extra
 * steps.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const backup = fs.readFileSync(RULES, 'utf8');
  fs.writeFileSync(RULES, 'this is not valid javascript {{{\n');
  try {
    const kinds = [];
    const statuses = [];
    // Each turn is a NEW prompt id, which is the case the old ceiling could not
    // see: `readContinues` keys on prompt_id, so a fault that recurs across
    // turns reset the counter every time. A fault ceiling has to key on the
    // FAULT, not on the turn.
    for (let i = 0; i < 4; i++) {
      runGate(tmp, { hook_event_name: 'Stop', prompt_id: `fault${i}`, session_id: 's' }, { args: ['--mark-dirty'] });
      const r = runGate(tmp, { hook_event_name: 'Stop', prompt_id: `fault${i}`, session_id: 's' });
      kinds.push(decision(r.stdout).kind);
      statuses.push(r.status);
    }

    if (statuses[0] === 2) ok('a checker fault blocks the first time (the agent gets its chance to diagnose)');
    else bad(`checker fault: expected the first turn to block with exit 2, got status=${statuses[0]}`);

    const ended = statuses.slice(1).findIndex((s) => s === 0);
    if (ended !== -1) {
      ok(`a repeated checker fault stops blocking: the turn ends on attempt ${ended + 2}`);
    } else {
      bad('a repeated checker fault NEVER lets the turn end - the agent is trapped in a fault it is '
        + `forbidden to fix. statuses=${statuses.join(',')} kinds=${kinds.join(',')}`);
    }

    // Ending the turn is only half. Ending it silently is fail-open.
    const marker = readJsonOrNull(path.join(tmp, PATHS.unverified));
    if (!marker) {
      bad('the turn ended with NO unverified marker in the control plane: nothing records that '
        + 'these turns were never verified, so the next session cannot tell them from clean ones');
    } else if (marker.fault === 'crash' && marker.consecutive >= 2) {
      ok(`the session is marked unverified (fault=${marker.fault}, consecutive=${marker.consecutive})`);
    } else {
      bad(`unverified marker is present but wrong: ${JSON.stringify(marker)}`);
    }

    // And the detail has to survive into it, or the escalation the agent is
    // finally permitted to make is one it cannot write.
    if (marker && /schema|javascript|SyntaxError|Unexpected/i.test(marker.detail ?? '')) {
      ok('the marker carries the checker\'s own error text, so the escalation can quote it');
    } else if (marker) {
      bad(`the marker records no usable detail: ${JSON.stringify(marker.detail ?? null)}`);
    }
  } finally {
    fs.writeFileSync(RULES, backup);
  }
}

/* --- 7a. THE REASON MUST ARRIVE WITH ITS CONTENTS ---------------------
 *
 * Gate 4c, finding 1. `interpretRunError` ended `.trim().split('\n')[0]`.
 * `assertValid` is documented "Throw with every error at once" and puts every
 * error on lines 2..N, so line 1 is the label and a colon and NOTHING ELSE. The
 * gate delivered this, four times, verbatim:
 *
 *     The standards checker crashed: verify.mjs crashed: Error:
 *     .mavci/control/verdicts/adhoc-1788254362466.json failed schema validation:.
 *
 * WHY THE ASSERTION IS `\n  - ` AND NOT "a reason exists".
 * A reason existed the whole time. It was 90 characters of label ending in a
 * colon, and it passed every test in this file, because every test asked whether
 * something arrived rather than whether it said anything. `\n  - ` is
 * `assertValid`'s own separator, so this assertion is written against the format
 * the validator produces, not against what the gate happens to emit - the same
 * discipline as `deliveredBlockingMessage` above, one layer down.
 *
 * Confirmed failing against 0.1.11 before the fix was written.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const backup = fs.readFileSync(RULES, 'utf8');
  // The multi-error message is PRODUCED BY THE REAL `assertValid`, not imitated.
  // Writing the expected string by hand would make this a test of our own
  // spelling of the format - and if `assertValid` ever changed its separator,
  // the hand-written fixture would keep passing while the gate went back to
  // delivering nothing. That is the adjacent-but-wrong assertion, one more time.
  //
  // The inputs are the real gate4c case: an evidence string over 500 and a
  // remedy over 300, which is exactly what took recording offline there.
  //
  // The module must LINK before it can throw. verify.mjs statically imports
  // `rulesFor` and `ruleById`, so a stub without them fails at link time with
  // "does not provide an export named", which is a DIFFERENT fault and would
  // have tested nothing. Case 2 above uses unparseable JS on purpose; this one
  // needs a module that loads correctly and then dies the way the real one did.
  fs.writeFileSync(RULES, [
    "import { assertValid } from '../lib/schema.mjs';",
    'export const RULES = [];',
    'export function rulesFor() { return []; }',
    'export function ruleById() { return null; }',
    "assertValid({ evidence: 'x'.repeat(600), remedy: 'y'.repeat(400) }, {",
    '  type: "object",',
    '  properties: {',
    '    evidence: { type: "string", maxLength: 500 },',
    '    remedy: { type: "string", maxLength: 300 },',
    '  },',
    "}, '.mavci/control/verdicts/adhoc-1788254362466.json');",
    '',
  ].join('\n'));
  try {
    const p = { hook_event_name: 'Stop', prompt_id: 'trunc', session_id: 's' };
    runGate(tmp, p, { args: ['--mark-dirty'] });
    assertDelivered('a crashed checker delivers EVERY validation error, not just the label',
      runGate(tmp, p),
      [/failed schema validation/, /\n {2}- /, /maxLength 500/, /maxLength 300/]);
  } finally {
    fs.writeFileSync(RULES, backup);
  }
}

/* --- 7b. the marker clears only on a clean run ------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  // Plant a marker as a crashed gate would have left it.
  fs.writeFileSync(path.join(tmp, PATHS.unverified), JSON.stringify({
    schema_version: 1,
    project_id: MANIFEST.project_id,
    fault: 'crash', signature: 'x', consecutive: 2,
    since: new Date(Date.now() - 60_000).toISOString().replace(/[.]\d{3}Z$/, 'Z'),
    last_at: new Date(Date.now() - 60_000).toISOString().replace(/[.]\d{3}Z$/, 'Z'),
    detail: 'planted', prompt_id: 'old', plugin_version: '0.0.0',
  }, null, 2) + '\n');

  // A FAILING run must NOT clear it. A fail verdict means the checker ran, but
  // the operator has still never seen this project verified clean since the
  // fault, and the marker is what tells them so. Clearing on a fail would let a
  // project that has never once passed look identical to one that just did.
  fs.mkdirSync(path.join(tmp, 'app', 'api', 'z'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'api', 'z', 'route.ts'),
    'export async function GET(){return Response.json({})}\n');
  runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'u1', session_id: 's' }, { args: ['--mark-dirty'] });
  runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'u1', session_id: 's' });
  if (fs.existsSync(path.join(tmp, PATHS.unverified))) {
    ok('a FAILING gate run does not clear the unverified marker');
  } else {
    bad('a failing run cleared the unverified marker - "enforcement never ran" and "enforcement '
      + 'ran and found problems" would be indistinguishable afterwards');
  }

  // A clean run does.
  fs.rmSync(path.join(tmp, 'app', 'api', 'z'), { recursive: true, force: true });
  runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'u2', session_id: 's' }, { args: ['--mark-dirty'] });
  const r = runGate(tmp, { hook_event_name: 'Stop', prompt_id: 'u2', session_id: 's' });
  if (!fs.existsSync(path.join(tmp, PATHS.unverified)) && r.status === 0) {
    ok('a clean gate run clears the unverified marker');
  } else {
    bad(`a clean run left the marker in place (status=${r.status}) - it would never clear, and a `
      + 'permanent FAIL is a FAIL nobody reads');
  }
}

/* --- abandoned turn markers are swept, live ones are not --------------- */
{
  // A marker is consumed by the next Stop, so a surviving one means the session
  // was interrupted between marking and Stop. It fails safe - one extra checker
  // run - but it never expired on its own, so an interrupted session left litter
  // in the OS temp directory permanently. Both directions are asserted: a sweep
  // that deleted live markers would be far worse than the litter it replaces.
  const tmpdir = os.tmpdir();
  const stale = path.join(tmpdir, 'mavci-dirty-session-ci_sweep_stale');
  const fresh = path.join(tmpdir, 'mavci-dirty-session-ci_sweep_fresh');
  const oldTurn = path.join(tmpdir, 'mavci-dirty-ci_sweep_old-p1');
  try {
    fs.writeFileSync(stale, '1');
    fs.writeFileSync(oldTurn, '1');
    fs.writeFileSync(fresh, '1');
    // Backdate two of them past the 24h TTL.
    const old = new Date(Date.now() - 36 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(oldTurn, old, old);

    const r = execFileSync(process.execPath, [GATE, '--sweep-markers'],
      { encoding: 'utf8', timeout: 30_000 });

    const goneStale = !fs.existsSync(stale);
    const goneTurn = !fs.existsSync(oldTurn);
    const keptFresh = fs.existsSync(fresh);

    if (goneStale && goneTurn) ok('stale markers of both kinds are swept');
    else bad(`sweep left litter: session=${goneStale ? 'gone' : 'PRESENT'} turn=${goneTurn ? 'gone' : 'PRESENT'}`);

    if (keptFresh) ok('a live marker is NOT swept (a sweep that ate live markers would disable the gate)');
    else bad('sweep deleted a fresh marker - the turn that armed it would go unchecked');

    if (/swept \d+ stale turn marker/.test(r)) ok('--sweep-markers reports what it did');
    else bad(`--sweep-markers said: ${JSON.stringify(r)}`);
  } finally {
    for (const f of [stale, fresh, oldTurn]) { try { fs.rmSync(f, { force: true }); } catch { /* best effort */ } }
  }
}

} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\ngate check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ngate: fail-closed paths, fast path, ceiling and timeout sentinel all behave as specified');

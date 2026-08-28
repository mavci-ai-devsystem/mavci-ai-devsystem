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
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const GATE = path.join(SCRIPTS, 'gate.mjs');
const GUARD = path.join(SCRIPTS, 'risk-guard.mjs');
const RULES = path.join(SCRIPTS, 'rules', 'index.mjs');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));
const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/** Run gate.mjs with a payload; never throws. */
function runGate(cwd, payload, { raw = null, args = [] } = {}) {
  const input = raw !== null ? raw : JSON.stringify({ ...payload, cwd });
  try {
    const stdout = execFileSync(process.execPath, [GATE, ...args],
      { input, encoding: 'utf8', timeout: 60_000, cwd });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout?.toString() ?? '', status: err.status ?? -1 };
  }
}

function decision(stdout) {
  if (!stdout.trim()) return { kind: 'silent' };
  let o;
  try { o = JSON.parse(stdout).hookSpecificOutput; }
  catch { return { kind: 'unparseable', stdout }; }
  if (o.continue) return { kind: 'continue', reason: o.stopReason ?? '' };
  if (o.systemMessage) return { kind: 'message', reason: o.systemMessage };
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
  if (d.kind === 'continue' && /ENFORCEMENT DID NOT RUN/.test(d.reason) && r.status === 2) {
    ok('malformed hook payload fails closed (continue + exit 2)');
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
    if (d.kind === 'continue' && /ENFORCEMENT DID NOT RUN/.test(d.reason) && r.status === 2) {
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
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.mkdirSync(path.join(tmp, 'app', 'api', 'x'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'api', 'x', 'route.ts'),
    'export async function GET(){return Response.json({})}\n');

  const p = { hook_event_name: 'Stop', prompt_id: 'b1', session_id: 's' };
  runGate(tmp, p, { args: ['--mark-dirty'] });
  const d = decision(runGate(tmp, p).stdout);
  if (d.kind === 'continue' && /next\.route_force_dynamic/.test(d.reason)) {
    ok('a violation refuses to end the turn, naming the check');
  } else {
    bad(`violation: expected continue naming the check, got kind=${d.kind}`);
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
  // first gate above was continue #1, so these are #2, #3, #4
  if (kinds[0] === 'continue' && kinds[1] === 'message' && kinds[2] === 'message') {
    ok('loop ceiling: stops asking after 3 gates and hands the failure to the operator');
  } else {
    bad(`loop ceiling: expected continue,message,message got ${kinds.join(',')}`);
  }
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

} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\ngate check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ngate: fail-closed paths, fast path, ceiling and timeout sentinel all behave as specified');

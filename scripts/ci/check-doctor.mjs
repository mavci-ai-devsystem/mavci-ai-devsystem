#!/usr/bin/env node
/**
 * Regression tests for doctor's HOOK REGISTRATION probe.
 *
 * The bug this exists for: v0.1.2 installed cleanly, Claude Code rejected all
 * eight entries in hooks.json on a schema error, the plugin registered ZERO
 * hooks - and doctor reported "hook self-test passed (5 cases)". That test
 * spawns the guard scripts itself, so it was proving the scripts work, which
 * was never in doubt, while the thing that calls them did not exist. Doctor
 * certified an enforcement layer that was entirely absent.
 *
 * Every case below asserts a FAIL. A probe that cannot fail is not a probe, and
 * that is exactly the class of defect being fixed here - so the assertions are
 * on the failures, not on the happy path alone.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const DOCTOR = path.join(SCRIPTS, 'doctor.mjs');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/fixtures/selftest-project.json'), 'utf8'));
const PLUGIN_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json'), 'utf8')).version;

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-doctor-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  return tmp;
}

/** Run doctor against a project. Never throws; returns stdout plus exit status. */
function runDoctor(cwd, { args = [], env = {}, input = '' } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DOCTOR, ...args], {
      cwd, input, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', ...env },
    });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout?.toString() ?? '', status: err.status ?? -1 };
  }
}

const cleanup = [];
try {

/* --- 1. no receipt at all: the Gate 3 case ---------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const r = runDoctor(tmp);
  if (r.status === 1 && /NO PLUGIN HOOK HAS EVER RUN/.test(r.stdout)) {
    ok('a project where no hook ever ran FAILS doctor');
  } else {
    bad(`no-receipt: expected exit 1 and "NO PLUGIN HOOK HAS EVER RUN", got status=${r.status}`);
  }
  if (/NOTHING CALLS THEM/.test(r.stdout)) {
    ok('the hook self-test refuses to report a pass when nothing is registered');
  } else {
    bad('no-receipt: the hook self-test still reported a pass. This is the exact v0.1.2 defect: '
      + 'the scripts behave, nothing calls them, and doctor certifies the enforcement layer anyway.');
  }
}

/* --- 2. --preflight stamps a receipt, and it is believed --------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const pre = runDoctor(tmp, {
    args: ['--preflight'],
    env: { CLAUDE_CODE_SESSION_ID: 'session-A' },
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session-A', cwd: tmp }),
  });
  if (pre.status !== 0) bad(`--preflight exited ${pre.status}; a SessionStart hook must never fail the session`);
  else ok('--preflight exits 0');

  const receiptPath = path.join(tmp, PATHS.hookRun);
  if (!fs.existsSync(receiptPath)) {
    bad('--preflight did not write control/hook-run.json, so registration can never be proven');
  } else {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.session_id === 'session-A' && receipt.plugin_version === PLUGIN_VERSION) {
      ok('--preflight records the session id from hook stdin and the plugin version');
    } else {
      bad(`receipt is wrong: ${JSON.stringify(receipt)}`);
    }

    // Locked format rules, ROADMAP "Data-format constraints": schema_version,
    // project_id, ISO-8601 UTC, closed enums.
    if (receipt.schema_version === 1 && receipt.project_id === MANIFEST.project_id
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d+)?Z$/.test(receipt.at ?? '')) {
      ok('the receipt carries schema_version, project_id and an ISO-8601 UTC timestamp');
    } else {
      bad(`receipt violates the locked state-file format: ${JSON.stringify(receipt)}`);
    }

    // The receipt is covered by state.schema_valid, so a malformed one is a
    // blocker rather than something the gate walks past.
    const errs = state.validateAll(tmp);
    if (errs.length === 0) ok('a stamped receipt passes state.schema_valid');
    else bad(`a freshly stamped receipt fails validateAll: ${JSON.stringify(errs)}`);

    const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-A' } });
    if (/\[ok  \] plugin hooks are registered/.test(r.stdout)) {
      ok('a receipt from this session proves registration');
    } else {
      bad('a fresh matching receipt was not accepted as proof of registration');
    }
  }
}

/* --- 3. a receipt from another plugin version is not proof ------------ */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify({
    schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: new Date().toISOString(),
    plugin_version: '0.0.1-old', session_id: 'session-B', env_session_id: null, parent_pid: null,
  }, null, 2));
  const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-B' } });
  if (r.status === 1 && /are from plugin 0\.0\.1-old/.test(r.stdout)) {
    ok('a receipt from a different plugin version FAILS');
  } else {
    bad(`version skew: expected exit 1 and a version-skew line, got status=${r.status}`);
  }
}

/* --- 4. a stale receipt is not proof ---------------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const old = new Date(Date.now() - 72 * 3_600_000).toISOString();
  fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify({
    schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: old,
    plugin_version: PLUGIN_VERSION, session_id: 'long-gone', env_session_id: null, parent_pid: null,
  }, null, 2));
  const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-C' } });
  if (r.status === 1 && /no plugin hook has run for \d+h/.test(r.stdout)) {
    ok('a receipt older than the freshness window FAILS');
  } else {
    bad(`stale receipt: expected exit 1 and a staleness line, got status=${r.status}`);
  }
}

/* --- 5. the receipt cannot be written outside control/ ---------------- */
// stampHookRun is deliberately best-effort: it must return null rather than
// throw when there is nowhere to write, or a SessionStart hook in a
// non-project directory would take the session down with it.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-doctor-bare-'));
  cleanup.push(tmp);
  let threw = null;
  let result = 'not-called';
  try { result = state.stampHookRun(tmp, { event: 'SessionStart', session_id: 'x' }); }
  catch (err) { threw = err; }
  if (!threw && result === null) ok('stampHookRun returns null, not a throw, outside a project');
  else bad(`stampHookRun outside a project: threw=${threw?.message ?? 'no'} result=${JSON.stringify(result)}`);

  const r = runDoctor(tmp, { args: ['--preflight'], input: '' });
  if (r.status === 0) ok('--preflight in a non-project directory still exits 0');
  else bad(`--preflight outside a project exited ${r.status}`);
}

/* --- 6. state.schema_valid really covers the receipt ------------------ */
// "It has a schema" is worth exactly as much as the schema being enforced.
// Without this, hook-run.schema.json could sit unreferenced in templates/schemas/
// and every claim about it would still read as true.
{
  const tmp = makeProject(); cleanup.push(tmp);
  const cases = [
    [{ schema_version: 1, event: 'SessionStart', at: new Date().toISOString(), plugin_version: '1.0.0' },
      'project_id', 'a receipt with no project_id'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'Whenever', at: new Date().toISOString(), plugin_version: '1.0.0' },
      'event', 'an event outside the closed enum'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: '28/08/2026', plugin_version: '1.0.0' },
      'at', 'a timestamp that is not ISO-8601'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: new Date().toISOString(), plugin_version: '1.0.0', rogue: true },
      'rogue', 'an undeclared property'],
  ];
  for (const [doc, needle, label] of cases) {
    fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify(doc, null, 2));
    const errs = state.validateAll(tmp);
    if (errs.some((e) => String(e).includes(PATHS.hookRun) && String(e).includes(needle))) {
      ok(`state.schema_valid rejects ${label}`);
    } else {
      bad(`state.schema_valid ACCEPTED ${label}. The receipt's schema is not enforced: ${JSON.stringify(errs)}`);
    }
  }

  // stampHookRun must refuse to write a receipt it knows is invalid, rather than
  // leaving one behind that blocks the next gate.
  fs.rmSync(path.join(tmp, PATHS.hookRun), { force: true });
  const written = state.stampHookRun(tmp, { event: 'NotAnEvent', session_id: 'x' });
  if (written === null && !fs.existsSync(path.join(tmp, PATHS.hookRun))) {
    ok('stampHookRun refuses to write a receipt that would fail its own schema');
  } else {
    bad('stampHookRun wrote an invalid receipt, which would fail state.schema_valid on the next gate');
  }
}

} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\ndoctor check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ndoctor check passed: hook registration is proven, not assumed.');

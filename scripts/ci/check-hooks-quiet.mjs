#!/usr/bin/env node
/**
 * EVERY HOOK IS SILENT IN A REPOSITORY THAT IS NOT A MAVCI PROJECT.
 *
 * The per-machine bootstrap installs mavci-core at USER scope (ARCHITECTURE
 * section 2), which is what makes a project's committed settings.json
 * sufficient everywhere afterwards. It also means the plugin resolves in every
 * repository on the machine - a scratch clone, someone else's library, a repo
 * that has never heard of Mavci - and EVERY hook entry in hooks.json runs
 * there, on every tool call, every turn, every session start. The count is not
 * written here on purpose: it was "eight" until 0.1.15 added guardian-record's
 * SubagentStop, and a number in prose beside a number this file computes is the
 * two-lists defect that 0.1.14 removed from check-pretag. `HOOKS.length` is
 * asserted against hooks.json below, which is the only place the count belongs.
 *
 * So the blast radius of user scope is exactly this file. A standards plugin
 * that fires enforcement, or even prints a health warning, in an unrelated
 * repository is a standards plugin that gets uninstalled, and uninstalling it
 * removes enforcement from the projects that DO want it. The gate for all of
 * them is the same fact: no `.mavci/project.json`, nothing to say.
 *
 * Seven of the eight were already gated when this test was written. The eighth,
 * `doctor.mjs --preflight` on SessionStart, was not: it reported "not a Mavci
 * project" - and, if the marketplace clone was missing or stale, the toolchain
 * warnings too - into the context of every unrelated repository on the machine.
 *
 * Both directions are asserted. A hook that is silent because it never runs is
 * not fixed, it is broken, so the positive controls prove the same scripts still
 * speak and still block inside a connected project.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

const cleanup = [];
function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(d);
  return d;
}

/**
 * Run one hook entry point exactly as hooks.json declares it: node, the script,
 * its args, the payload on stdin, CLAUDE_PROJECT_DIR set.
 */
function runHook(script, args, cwd, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', ...env },
  });
  return {
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
    status: r.status,
  };
}

/** Every entry in plugins/mavci-core/hooks/hooks.json, in file order. */
const HOOKS = [
  ['PreToolUse  risk-guard (Bash)', 'risk-guard.mjs', [],
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }],
  ['PreToolUse  risk-guard (MCP)', 'risk-guard.mjs', [],
    { hook_event_name: 'PreToolUse', tool_name: 'mcp__claude_ai_Supabase__execute_sql', tool_input: { query: 'DROP TABLE users' } }],
  ['PostToolUse gate.mjs --mark-dirty', 'gate.mjs', ['--mark-dirty'],
    { hook_event_name: 'PostToolUse', session_id: 'quiet-s', prompt_id: 'quiet-p', tool_name: 'Write' }],
  ['PostToolUse verify.mjs --changed --advisory', 'verify.mjs', ['--changed', '--advisory'],
    { hook_event_name: 'PostToolUse', session_id: 'quiet-s', prompt_id: 'quiet-p' }],
  ['PostToolUse redact.mjs --sweep', 'redact.mjs', ['--sweep'],
    { hook_event_name: 'PostToolUse', session_id: 'quiet-s', prompt_id: 'quiet-p' }],
  ['Stop        gate.mjs', 'gate.mjs', [],
    { hook_event_name: 'Stop', session_id: 'quiet-s', prompt_id: 'quiet-p' }],
  ['SubagentStop gate.mjs', 'gate.mjs', [],
    { hook_event_name: 'SubagentStop', session_id: 'quiet-s', prompt_id: 'quiet-p' }],
  ['SessionStart doctor.mjs --preflight', 'doctor.mjs', ['--preflight'],
    { hook_event_name: 'SessionStart', session_id: 'quiet-s' }],
  // The highest-volume hook in the system: SubagentStop fires for every subagent in
  // every repository on the machine, and almost none of them are guardian. The
  // payload here is a NON-guardian stop, which is the overwhelmingly common case and
  // the one that must cost nothing - guardian-record.mjs decides it from agent_type
  // before touching the filesystem at all.
  ['SubagentStop guardian-record.mjs', 'guardian-record.mjs', [],
    { hook_event_name: 'SubagentStop', session_id: 'quiet-s', agent_type: 'Explore',
      last_assistant_message: 'done' }],
];

/**
 * hooks.json is the authority on how many entries exist. If someone adds a
 * ninth hook, this test must fail until it is listed above - an unlisted hook
 * is an ungated hook, and ungated is how this whole class of fault returns.
 */
{
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/hooks/hooks.json'), 'utf8'));
  const declared = Object.values(hooks.hooks ?? {})
    .flat()
    .reduce((n, m) => n + (m.hooks?.length ?? 0), 0);
  if (declared === HOOKS.length) {
    ok(`hooks.json declares ${declared} hook entries and all ${declared} are covered here`);
  } else {
    bad(`hooks.json declares ${declared} hook entries, this test covers ${HOOKS.length}. `
      + 'Add the new one to HOOKS - an uncovered hook is an ungated hook.');
  }
}

try {

/* --- 1. every hook, in a repository that is not a Mavci project -------- */
for (const [label, script, args, input] of HOOKS) {
  const repo = tmpdir('mavci-quiet-repo-');
  const r = runHook(script, args, repo, input);

  if (r.stdout === '' && r.stderr === '' && r.status === 0) {
    ok(`${label} is silent outside a Mavci project`);
  } else {
    bad(`${label}: expected silence and exit 0, got status=${r.status}`
      + (r.stdout ? ` stdout=${JSON.stringify(r.stdout.slice(0, 300))}` : '')
      + (r.stderr ? ` stderr=${JSON.stringify(r.stderr.slice(0, 300))}` : ''));
  }

  // Nor may a hook leave anything behind. A file appearing in an unrelated
  // repository's `git status` is the same intrusion as a message in its context.
  const residue = fs.readdirSync(repo);
  if (residue.length === 0) {
    ok(`${label} writes nothing into the repository`);
  } else {
    bad(`${label}: left ${residue.join(', ')} in a repository that is not ours`);
  }
}

/* --- 2. the toolchain warnings must not leak either --------------------
 * `checkDistribution` runs whether or not the project is connected, by design:
 * a stale plugin is most dangerous in the directory about to be scaffolded. But
 * a missing marketplace clone is not an unrelated repository's business, and
 * before the fix it was reported into one. An empty CLAUDE_CONFIG_DIR is a
 * machine with no clone at all, which is the loudest that check ever gets.
 */
{
  const repo = tmpdir('mavci-quiet-noclone-');
  const cfg = tmpdir('mavci-quiet-cfg-');
  const r = runHook('doctor.mjs', ['--preflight'], repo,
    { hook_event_name: 'SessionStart', session_id: 'quiet-s' }, { CLAUDE_CONFIG_DIR: cfg });
  if (r.stdout === '' && r.stderr === '') {
    ok('SessionStart doctor.mjs --preflight stays silent even with no marketplace clone and no registry');
  } else {
    bad(`preflight leaked toolchain state into a non-Mavci repo: ${JSON.stringify(r.stdout.slice(0, 300))}`);
  }
}

/* --- 3. positive control: the preflight still speaks where it should ---
 * Silence achieved by disabling the hook is not a fix. This project is
 * connected and has no .claude/settings.json, so the tier-3 deny rules are
 * missing - exactly the kind of thing SessionStart exists to report.
 */
{
  const repo = tmpdir('mavci-quiet-connected-');
  fs.mkdirSync(path.join(repo, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(repo, MANIFEST);

  const r = runHook('doctor.mjs', ['--preflight'], repo,
    { hook_event_name: 'SessionStart', session_id: 'quiet-s' });
  if (r.stdout.includes('Mavci health check')) {
    ok('SessionStart doctor.mjs --preflight still reports inside a connected project');
  } else {
    bad('preflight went silent inside a CONNECTED project: the gate is on the manifest, '
      + `not on the hook. status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 300))}`);
  }

  // And the operator-invoked report is unchanged: it still says "not a Mavci
  // project" when asked directly. Only the hook is quiet.
  const empty = tmpdir('mavci-quiet-full-');
  const full = runHook('doctor.mjs', [], empty, '');
  if (/not a Mavci project/.test(full.stdout)) {
    ok('the full report still says "not a Mavci project" when the operator asks');
  } else {
    bad(`full doctor no longer reports an unconnected directory: ${JSON.stringify(full.stdout.slice(0, 300))}`);
  }
}

/* --- 4. positive control: the risk guard still blocks where it should --- */
{
  const repo = tmpdir('mavci-quiet-guard-');
  fs.mkdirSync(path.join(repo, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(repo, MANIFEST);

  const r = runHook('risk-guard.mjs', [], repo,
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
  if (/"permissionDecision"\s*:\s*"deny"/.test(r.stdout)) {
    ok('PreToolUse risk-guard still denies a tier-3 command inside a connected project');
  } else {
    bad(`the risk guard stopped denying: status=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 300))}`);
  }
}

} finally {
  for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
}

if (failures.length) {
  console.error(`\ncheck-hooks-quiet: ${failures.length} failure(s)\n`);
  process.exit(1);
}
console.log('\ncheck-hooks-quiet: all hooks are silent outside a Mavci project, and still speak inside one\n');

#!/usr/bin/env node
/**
 * Mavci Core - the fail-closed standards gate. ARCHITECTURE 6.3 and 6.4 (fixes 1 and 2).
 *
 * WHY THIS FILE EXISTS
 * Claude Code hooks fail OPEN, and this is documented, not incidental:
 *   - a hook that times out is "canceled, output discarded, no decision rendered" (4.17)
 *   - a hook that crashes is "non-blocking... action proceeds"                    (4.18)
 * So a checker that dies silently disables the entire enforcement layer with no
 * error anywhere. That is the exact opposite of what a gate needs. Everything
 * below exists to invert that default.
 *
 * HOW IT STAYS CHEAP (fix 2)
 * The gate returns in ~50ms and runs nothing at all unless either
 *   phase == "build", or the turn actually wrote files.
 * A question turn costs nothing.
 *
 * MODES
 *   (stdin hook JSON)        Stop / SubagentStop gate
 *   --mark-dirty             PostToolUse: record that this turn touched files
 *   --ci                     full scan for GitHub Actions, exit 2 on blockers
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PATHS, GATE_BUDGET_MS, GATE_MAX_CONTINUES } from './config.mjs';
import { abs, exists, readJsonOrNull } from './lib/fsx.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERIFY = path.join(HERE, 'verify.mjs');

/* ------------------------------------------------------------- plumbing */

/**
 * Read the hook payload.
 *
 * Malformed input is NOT swallowed. Returning `{}` on a parse error looks
 * harmless but is a fail-open: the gate would lose `cwd` and `prompt_id`, fall
 * back to process.cwd(), and reset its own loop counter every turn - silently
 * degrading in exactly the way this file exists to prevent. Empty stdin is
 * tolerated, because that is a human running the script by hand.
 *
 * @returns {{input: object, parseError: string|null}}
 */
function readStdin() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    return { input: {}, parseError: null };   // no stdin attached: manual invocation
  }
  if (!raw.trim()) return { input: {}, parseError: null };
  try {
    return { input: JSON.parse(raw), parseError: null };
  } catch (err) {
    return { input: {}, parseError: err.message };
  }
}

function markerPath(sessionId, promptId) {
  const safe = `${sessionId ?? 'nosession'}-${promptId ?? 'noprompt'}`.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `mavci-dirty-${safe}`);
}

/**
 * Emit a Stop decision. `continue: true` is the verified mechanism that refuses
 * to let the turn end (4.5): the model is handed the failure and must fix it.
 */
function emitContinue(event, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, continue: true, stopReason: reason },
  }));
}

function emitMessage(event, message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, systemMessage: message },
  }));
}

/**
 * Fail closed. Emits the JSON decision AND exits 2.
 * Belt and braces on purpose: if the hook output schema ever changes under us,
 * the exit code still blocks (4.2). This is the single most version-fragile
 * surface in the system, so it gets two independent mechanisms.
 */
function failClosed(event, reason) {
  emitContinue(event, `mavci: ENFORCEMENT DID NOT RUN. ${reason}`);
  process.exit(2);
}

/* ---------------------------------------------------------- the checker */

/**
 * Run verify.mjs as a child process with a hard timeout.
 * A child is what makes GATE_BUDGET_MS real: in-process synchronous work cannot
 * be preempted, so an in-process "budget" would be a comment, not a limit.
 * The budget sits below the hook `timeout` in hooks.json so we always return a
 * decision before Claude Code cancels us and renders none.
 */
function runVerify(root, extraArgs = []) {
  const out = execFileSync(process.execPath, [VERIFY, '--format=json', ...extraArgs], {
    cwd: root,
    encoding: 'utf8',
    timeout: GATE_BUDGET_MS,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return JSON.parse(out);
}

/** execFileSync throws for both a non-zero exit and a timeout; tell them apart. */
function interpretRunError(err) {
  if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
    return { kind: 'timeout' };
  }
  // verify.mjs exits 2 with a valid verdict on stdout when there are blockers.
  const stdout = err.stdout?.toString?.() ?? '';
  if (stdout.trim().startsWith('{')) {
    try { return { kind: 'verdict', verdict: JSON.parse(stdout) }; } catch { /* fall through */ }
  }
  const stderr = (err.stderr?.toString?.() ?? err.message ?? '').trim().split('\n')[0];
  return { kind: 'crash', message: stderr || 'unknown error' };
}

/* --------------------------------------------------------- continue count
 * Lives in control/integrity.json, not the OS temp directory: it is control-plane
 * state and it has to survive a session restart, otherwise an unsatisfiable gate
 * resets its own loop counter every time the session reconnects.
 */

function readContinues(root, promptId) {
  const last = readJsonOrNull(abs(root, PATHS.integrity))?.last_gate;
  if (!last || last.prompt_id !== promptId) return 0;
  return last.continues ?? 0;
}

/* ------------------------------------------------------- completion sentinel
 * The only thing that can be done about a hook timeout (config.mjs "gate").
 * A cancelled hook runs no further code, so it cannot report its own death.
 * What it CAN do is announce its intent before starting: an entry written here
 * and never marked complete is proof that a gate began and was killed.
 * The next turn's PreToolUse hook reads it and tells the operator.
 */

function openGateRun(root, promptId, sessionId) {
  try {
    fs.writeFileSync(abs(root, PATHS.gateRun), JSON.stringify({
      schema_version: 1,
      prompt_id: promptId,
      session_id: sessionId,
      started: new Date().toISOString().replace(/[.]\d{3}Z$/, 'Z'),
      completed: null,
      outcome: null,
      budget_ms: GATE_BUDGET_MS,
      plugin_version: readJsonOrNull(path.join(HERE, '..', '.claude-plugin', 'plugin.json'))?.version ?? null,
    }, null, 2) + '\n');
  } catch { /* a sentinel that cannot be written must not stop the gate running */ }
}

function closeGateRun(root, outcome) {
  try {
    const cur = readJsonOrNull(abs(root, PATHS.gateRun));
    if (!cur) return;
    cur.completed = new Date().toISOString().replace(/[.]\d{3}Z$/, 'Z');
    cur.outcome = outcome;
    fs.writeFileSync(abs(root, PATHS.gateRun), JSON.stringify(cur, null, 2) + '\n');
  } catch { /* best effort */ }
}

function stamp(root, payload) {
  try {
    // Imported lazily so a broken state.mjs cannot stop the gate from blocking.
    return import('./state.mjs').then((m) => m.stampGate(root, payload)).catch(() => null);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the gate */

async function gate(input) {
  const event = input.hook_event_name === 'SubagentStop' ? 'SubagentStop' : 'Stop';
  const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const promptId = input.prompt_id ?? null;
  const sessionId = input.session_id ?? null;

  // Not a Mavci project. Nothing to enforce, say nothing.
  if (!exists(abs(root, PATHS.manifest))) process.exit(0);

  /* ---- fast path (fix 2) ------------------------------------------- */
  const marker = markerPath(sessionId, promptId);
  const dirty = exists(marker);
  let phase = null;
  try {
    phase = readJsonOrNull(abs(root, PATHS.state))?.phase ?? null;
  } catch {
    // state.json unreadable is itself a control-plane problem: do not skip.
  }

  if (!dirty && phase !== 'build') {
    process.exit(0); // ~50ms: a question turn costs nothing
  }
  if (dirty) { try { fs.unlinkSync(marker); } catch { /* best effort */ } }

  /* ---- run the checker under a real budget -------------------------- */
  // Announce intent BEFORE doing any work. If the hook is cancelled from here
  // on, this record stays incomplete and the next turn reports it.
  openGateRun(root, promptId, sessionId);

  let verdict;
  try {
    verdict = runVerify(root, ['--record']);
  } catch (err) {
    const r = interpretRunError(err);
    if (r.kind === 'timeout') {
      closeGateRun(root, 'budget_exceeded');
      return failClosed(event,
        `The standards checker exceeded its ${GATE_BUDGET_MS / 1000}s budget and was stopped, so nothing was verified. `
        + 'Run /mavci:doctor to diagnose, or verify by hand with `node <plugin>/scripts/verify.mjs`.');
    }
    if (r.kind === 'crash') {
      closeGateRun(root, 'crashed');
      return failClosed(event,
        `The standards checker crashed: ${r.message}. Nothing was verified. `
        + 'This is a bug in the checker, not in your code. Run /mavci:doctor, and /mavci:retro to file it.');
    }
    verdict = r.verdict;
  }

  if (!verdict || typeof verdict.summary?.blockers !== 'number') {
    closeGateRun(root, 'unreadable_verdict');
    return failClosed(event, 'The standards checker returned an unreadable verdict, so nothing was verified.');
  }

  /* ---- pass ---------------------------------------------------------- */
  if (verdict.summary.blockers === 0) {
    closeGateRun(root, 'pass');
    await stamp(root, { prompt_id: promptId, session_id: sessionId, verdict: 'pass', continues: 0 });
    const s = verdict.summary;
    if (s.baselined || s.waived) {
      // Keep debt visible. Invisible debt is debt that never gets paid.
      emitMessage(event,
        `mavci: standards pass. ${s.baselined} baselined violation(s) and ${s.waived} waived remain - `
        + 'see /mavci:doctor.');
    }
    process.exit(0);
  }

  /* ---- fail ---------------------------------------------------------- */
  const continues = readContinues(root, promptId) + 1;
  closeGateRun(root, 'fail');
  await stamp(root, { prompt_id: promptId, session_id: sessionId, verdict: 'fail', continues });

  const blocking = verdict.checks
    .filter((c) => c.status === 'fail' || c.status === 'error')
    .slice(0, 5)
    .map((c) => {
      const loc = c.path ? `${c.path}${c.line ? `:${c.line}` : ''}` : '(repo)';
      return `${c.check_id} at ${loc} - ${c.evidence ?? 'see verdict'}${c.remedy ? ` FIX: ${c.remedy}` : ''}`;
    });

  const n = verdict.summary.blockers;
  const detail = `mavci: ${n} blocking standards violation${n === 1 ? '' : 's'}.\n- ${blocking.join('\n- ')}`;

  if (continues >= GATE_MAX_CONTINUES) {
    // Stop asking. An unsatisfiable gate must reach the operator, not spin.
    emitMessage(event,
      `${detail}\n\nThis is attempt ${continues} on the same prompt and the gate is still failing, `
      + 'so it will not block again. The verdict is recorded under .mavci/control/verdicts/. '
      + 'Options: fix it, `/mavci:waive <check_id> --path <file> --reason "..."` if the check is wrong, '
      + 'or /mavci:retro to turn this into a system fix.');
    process.exit(0);
  }

  emitContinue(event, `${detail}\n\nNot baselined, not waived. Fix these, then stop again.`);
  process.exit(0);
}

/* ------------------------------------------------------------------ CLI */

async function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (argv.includes('--mark-dirty')) {
    // PostToolUse on Edit|Write. Records that this turn touched files, so the
    // Stop gate knows to run. Deliberately in the OS temp dir, not the repo:
    // a per-turn marker must never appear in `git status`.
    const { input } = readStdin();
    try { fs.writeFileSync(markerPath(input.session_id, input.prompt_id), '1'); } catch { /* best effort */ }
    process.exit(0);
  }

  if (argv.includes('--ci')) {
    // No hook JSON, no fast path, no continue semantics. Just pass or fail the build.
    if (!exists(abs(root, PATHS.manifest))) {
      console.error('not a Mavci project: .mavci/project.json not found');
      process.exit(1);
    }
    const fmt = argv.find((a) => a.startsWith('--format=')) ?? '--format=github';
    try {
      execFileSync(process.execPath, [VERIFY, fmt, '--ci'], {
        cwd: root, stdio: 'inherit', timeout: GATE_BUDGET_MS * 4,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      });
      process.exit(0);
    } catch (err) {
      process.exit(typeof err.status === 'number' ? err.status : 2);
    }
  }

  const { input, parseError } = readStdin();
  if (parseError) {
    // Unparseable payload means we do not know the project, the prompt, or the
    // event. Guessing would silently reset the loop counter and scan the wrong
    // directory. Fail closed and say why.
    return failClosed('Stop',
      `The hook payload was not valid JSON (${parseError}), so the gate could not tell which `
      + 'project or turn it was checking. Nothing was verified. Run /mavci:doctor.');
  }
  await gate(input);
}

main().catch((err) => {
  // Even the gate's own failure must fail closed.
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop', continue: true,
      stopReason: `mavci: ENFORCEMENT DID NOT RUN. The gate itself failed: ${err.message}. Run /mavci:doctor.`,
    },
  }));
  process.exit(2);
});

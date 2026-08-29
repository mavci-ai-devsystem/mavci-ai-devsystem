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
 *   --mark-dirty --session=X a command marking its own turn (no hook payload)
 *   --sweep-markers          delete abandoned turn markers and report the count
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
 * A marker keyed on the SESSION alone, for a command that must be gated on a
 * turn it does not write files in.
 *
 * `/mavci-core:verify` is the case. Its Stop turn is normally clean and outside
 * the build phase, so the fast path below exits before the checker ever runs -
 * which left the skill's own inline probe as the only thing recording a verdict,
 * and an inline probe has three documented ways of not running at all
 * (NATIVE-CAPABILITIES 2.11). The command therefore marks its own turn, using
 * the dirty path that already exists and is already tested rather than an
 * exemption, which would be a second way for the gate to skip.
 *
 * Session-scoped because a skill can be given ${CLAUDE_SESSION_ID} but has no
 * way to learn the prompt id. It is consumed on the next Stop exactly like the
 * per-turn marker, so it costs one gate run, not a permanently dirty session.
 */
function sessionMarkerPath(sessionId) {
  const safe = `${sessionId ?? 'nosession'}`.replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `mavci-dirty-session-${safe}`);
}

/**
 * How long an unconsumed turn marker may live before it is litter.
 *
 * Both marker kinds are consumed by the very next Stop, so a surviving one means
 * the session was interrupted between marking and Stop. A day is far longer than
 * any real gap between the two and far shorter than "forever", which is what the
 * markers had before this existed.
 */
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete abandoned markers from the OS temp directory.
 *
 * A stale marker is not dangerous - it fails SAFE, costing one extra checker run
 * in whatever session next matches it - but it never expires on its own, so an
 * interrupted session leaves one behind permanently. Only these markers
 * accumulate: gate-run.json and the continue counter are single files inside
 * .mavci/control/ that are overwritten in place, so they need no sweep.
 *
 * Best effort throughout. A sweep that cannot run must never stop the gate from
 * running, which is the whole point of this file.
 *
 * @returns {number} how many were removed
 */
function sweepStaleMarkers(now = Date.now()) {
  let removed = 0;
  try {
    const dir = os.tmpdir();
    for (const name of fs.readdirSync(dir)) {
      // Prefix test first: tmpdir can hold thousands of entries and only ours
      // are worth a stat call.
      if (!name.startsWith('mavci-dirty-')) continue;
      const full = path.join(dir, name);
      try {
        if (now - fs.statSync(full).mtimeMs <= MARKER_TTL_MS) continue;
        fs.unlinkSync(full);
        removed++;
      } catch { /* raced with another gate, or not ours to delete: leave it */ }
    }
  } catch { /* tmpdir unreadable */ }
  return removed;
}

/**
 * Emit a Stop BLOCK: the refusal and the explanation, on both documented
 * carriers, before the caller exits 2.
 *
 * Verbatim, from the hooks reference (code.claude.com/docs/en/hooks, fetched
 * 2026-08-29). Read these before changing a character of this function; the
 * last two releases were each written from a paraphrase of them.
 *
 *   Exit-code-2 table:
 *     "`Stop` | Yes | Prevents Claude from stopping, continues the conversation"
 *
 *   Exit code 2, on where the text comes from:
 *     "The blocking message is the reason from your JSON's blocking decision
 *      when it makes one, and your stderr text otherwise."
 *
 *   Stop decision control, the two TOP-LEVEL fields:
 *     "`decision` | `"block"` prevents Claude from stopping. Omit to allow
 *      Claude to stop"
 *     "`reason`   | Required when `decision` is `"block"`. Tells Claude why it
 *      should continue"
 *     "A hook that blocks by exiting 2 routes the same way as `reason`: Claude
 *      receives the stderr message as the explanation for why it should
 *      continue."
 *
 *   And that mixing the two is sanctioned, not a conflict:
 *     "exit 2 keeps its blocking effect, and Claude Code still reads the JSON
 *      fields"
 *
 * So both carriers are written on purpose, and either one alone delivers. The
 * JSON wins when both are present; stderr is what survives a schema change,
 * since "A hook that exits 2 while printing JSON that fails JSON output schema
 * validation still blocks: Claude Code uses stderr as the blocking reason."
 * That is a real belt and braces, unlike 0.1.10's, where both halves were
 * fastened to nothing.
 *
 * What is deliberately NOT here, and must not come back:
 *   - `stopReason` nested inside `hookSpecificOutput`. This was the whole
 *     defect. For Stop the only `hookSpecificOutput` field honoured is
 *     `additionalContext` (plus the required `hookEventName`), so a nested
 *     `stopReason` is a field of no documented shape and renders NO decision.
 *     0.1.10 blocked with it and Gate 4's entire Stop feedback was "No stderr
 *     output": the refusal landed, the explanation went nowhere.
 *   - `continue`. It defaults to `true` and acts only when `false` ("If
 *     `false`, Claude stops processing entirely after the hook runs"), so
 *     `continue: true` was never the inversion it was recorded as - it was
 *     inert. Inert noise in a blocking payload is one more thing the next
 *     reader has to work out is meaningless, so it is gone.
 *   - top-level `stopReason`, which is "Message shown to the user when
 *     `continue` is `false`. Not shown to Claude" - never a model-facing
 *     carrier.
 *   - `ok`/`reason`/`impossible`, which is the `type: "prompt"` hook format.
 *     This is a `type: "command"` hook and cannot use it.
 *
 * Length: "Hook output strings, including `additionalContext`, `systemMessage`,
 * and plain stdout, are capped at 10,000 characters." `detail` fits with room
 * to spare - the fail path slices to the first 5 failing checks, and a check
 * line is a check id, a path:line, an evidence string and a remedy string, so
 * the worst realistic case is a few hundred characters times five. Anything
 * that widens that slice has to re-check this.
 *
 * See NATIVE-CAPABILITIES 4.5, corrected again in 0.1.11.
 */
function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.stderr.write(reason);
}

function emitMessage(event, message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, systemMessage: message },
  }));
}

/**
 * Fail closed: block the stop, and say that enforcement did not run.
 * The reason matters more here than on the violations path, not less. An agent
 * refused with no explanation reads it as a malfunction it cannot act on, and
 * `readContinues` will spend the whole ceiling reaching that same silence.
 */
function failClosed(reason) {
  emitBlock(`mavci: ENFORCEMENT DID NOT RUN. ${reason}`);
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
  const sessionMarker = sessionMarkerPath(sessionId);
  const dirty = exists(marker) || exists(sessionMarker);
  let phase = null;
  try {
    phase = readJsonOrNull(abs(root, PATHS.state))?.phase ?? null;
  } catch {
    // state.json unreadable is itself a control-plane problem: do not skip.
  }

  if (!dirty && phase !== 'build') {
    process.exit(0); // ~50ms: a question turn costs nothing
  }
  if (dirty) {
    // Consume both: a turn that is dirty for either reason must not stay dirty.
    for (const m of [marker, sessionMarker]) {
      try { fs.unlinkSync(m); } catch { /* best effort - it may not exist */ }
    }
  }

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
      return failClosed(
        `The standards checker exceeded its ${GATE_BUDGET_MS / 1000}s budget and was stopped, so nothing was verified. `
        + 'Run /mavci-core:doctor to diagnose, or verify by hand with `node <plugin>/scripts/verify.mjs`.');
    }
    if (r.kind === 'crash') {
      closeGateRun(root, 'crashed');
      return failClosed(
        `The standards checker crashed: ${r.message}. Nothing was verified. `
        + 'This is a bug in the checker, not in your code. Run /mavci-core:doctor, and /mavci-core:retro to file it.');
    }
    verdict = r.verdict;
  }

  if (!verdict || typeof verdict.summary?.blockers !== 'number') {
    closeGateRun(root, 'unreadable_verdict');
    return failClosed('The standards checker returned an unreadable verdict, so nothing was verified.');
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
        + 'see /mavci-core:doctor.');
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
      + 'Options: fix it, `/mavci-core:waive <check_id> --path <file> --reason "..."` if the check is wrong, '
      + 'or /mavci-core:retro to turn this into a system fix.');
    process.exit(0);
  }

  // Belt and braces, exactly as failClosed does - and now both braces hold
  // something. Exit 2 refuses the stop; the top-level decision and stderr each
  // carry `detail`, so the agent is told which check, which file and which line.
  // 0.1.9 emitted without exiting 2 and never blocked; 0.1.10 exited 2 with the
  // reason in a field nothing reads, and blocked in silence.
  emitBlock(`${detail}\n\nNot baselined, not waived. Fix these, then stop again.`);
  process.exit(2);
}

/* ------------------------------------------------------------------ CLI */

async function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Every invocation sweeps. It is a prefix-filtered readdir, it is best effort,
  // and it runs before the fast path so an abandoned marker cannot outlive the
  // session that made it by more than a day.
  const swept = sweepStaleMarkers();

  if (argv.includes('--sweep-markers')) {
    // Exposed so the sweep is testable at all: an untested sweep is a comment.
    console.log(`swept ${swept} stale turn marker(s)`);
    process.exit(0);
  }

  if (argv.includes('--mark-dirty')) {
    // PostToolUse on Edit|Write. Records that this turn touched files, so the
    // Stop gate knows to run. Deliberately in the OS temp dir, not the repo:
    // a per-turn marker must never appear in `git status`.
    // --session=<id> is the skill-invoked form: no hook payload on stdin, so the
    // per-turn marker cannot be keyed and a session-scoped one is written instead.
    const sessionArg = (argv.find((a) => a.startsWith('--session=')) ?? '').split('=').slice(1).join('=');
    if (sessionArg) {
      try {
        fs.writeFileSync(sessionMarkerPath(sessionArg), '1');
        // Printed, unlike the hook form, because a skill calls this from inline
        // shell: silence there is indistinguishable from the command not having
        // run at all, which is the failure mode 2.11 exists to make visible.
        console.log('gate armed: the standards gate will run at the end of this turn');
      } catch (err) {
        console.log(`gate NOT armed: ${err.message}`);
      }
      process.exit(0);
    }
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
    return failClosed(
      `The hook payload was not valid JSON (${parseError}), so the gate could not tell which `
      + 'project or turn it was checking. Nothing was verified. Run /mavci-core:doctor.');
  }
  await gate(input);
}

main().catch((err) => {
  // Even the gate's own failure must fail closed - and must say so. Inlined
  // rather than calling failClosed: this handler has to survive a fault in
  // anything above it, emitBlock included.
  const reason = `mavci: ENFORCEMENT DID NOT RUN. The gate itself failed: ${err.message}. Run /mavci-core:doctor.`;
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason })); } catch { /* stdout gone */ }
  try { process.stderr.write(reason); } catch { /* stderr gone */ }
  process.exit(2);
});

#!/usr/bin/env node
/**
 * Mavci Core - the control-plane writer. ARCHITECTURE 4.2 (blocker B1).
 *
 * Agents are denied `Edit(./.mavci/control/**)` by a permission rule, which is
 * verified to cover the Write tool too (NATIVE-CAPABILITIES 5.17). This script
 * writes there because it is a Node subprocess, and subprocess writes are
 * verified NOT to be covered by Read/Edit rules (5.18). Elsewhere that gap is a
 * weakness; here it is used deliberately as the sanctioned channel.
 *
 * The residual risk - an agent writing its own script to mutate control/ - is
 * caught by the integrity hash, which detects mutation through ANY channel
 * rather than trying to guess the attack.
 *
 * Every write passes through redact.mjs first (ARCHITECTURE 4.4).
 * Every write is schema-validated. Every write is atomic. Every write reseals.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PATHS, CONTROL_DIR, MAVCI_DIR, CONTROL_GLOBS,
  PHASES, TASK_STATUS, RISK_TIERS, UNSUPPRESSIBLE_SEVERITIES,
  WAIVER_DEFAULT_DAYS, WAIVER_MAX_DAYS, WAIVER_MIN_REASON_CHARS,
} from './config.mjs';
import {
  abs, exists, readJson, readJsonOrNull, readText, writeJsonAtomic, writeTextAtomic,
  canonicalJson, sha256, expandGlobs, nowIso, todayIso, addDaysIso, escapesRoot, toPosix,
} from './lib/fsx.mjs';
import { assertValid, validate } from './lib/schema.mjs';
import { buildRedactor } from './redact.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const SCHEMA_DIR = path.join(PLUGIN_ROOT, 'templates', 'schemas');

/* ------------------------------------------------------------- plumbing */

let _schemaCache = null;
export function schemas() {
  if (_schemaCache) return _schemaCache;
  _schemaCache = {};
  for (const f of fs.readdirSync(SCHEMA_DIR)) {
    if (!f.endsWith('.schema.json')) continue;
    _schemaCache[f.replace('.schema.json', '')] = readJson(path.join(SCHEMA_DIR, f));
  }
  return _schemaCache;
}

export function pluginVersion() {
  return readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json')).version;
}

/** Manifest schema version this build writes and requires. Bumped for the
 *  tenancy.model/isolation split; see migrateManifest. */
export const MANIFEST_SCHEMA_VERSION = 2;

export function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Everything a caller needs, loaded once. Missing files are null, never a throw. */
export function loadContext(root = projectRoot()) {
  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  return {
    root,
    manifest,
    state: readJsonOrNull(abs(root, PATHS.state)),
    baseline: readJsonOrNull(abs(root, PATHS.baseline)),
    waivers: readJsonOrNull(abs(root, PATHS.waivers)),
    integrity: readJsonOrNull(abs(root, PATHS.integrity)),
    redactor: buildRedactor(root, manifest),
    pluginVersion: pluginVersion(),
  };
}

export function isConnected(root = projectRoot()) {
  return exists(abs(root, PATHS.manifest)) && exists(abs(root, PATHS.state));
}

/* ------------------------------------------------------------ integrity */

/**
 * Hash the canonical serialisation of every control file, in sorted path order.
 * integrity.json itself is excluded - it holds the result, and its `last_gate`
 * heartbeat changes on every turn without the governing state changing.
 */
export function computeControlHash(root) {
  const files = expandGlobs(root, CONTROL_GLOBS).filter((f) => f !== PATHS.integrity);
  const parts = [];
  for (const rel of files) {
    const raw = readText(abs(root, rel));
    // Canonicalise so formatting churn is not treated as tampering.
    let body;
    try { body = canonicalJson(JSON.parse(raw)); } catch { body = raw; }
    parts.push(`${rel}\n${body}`);
  }
  return { hash: sha256(parts.join('\n---\n')), files };
}

/** Write integrity.json. Called after every control write. */
export function seal(root, { preserveLastGate = true } = {}) {
  const { hash, files } = computeControlHash(root);
  const prev = readJsonOrNull(abs(root, PATHS.integrity));
  const doc = {
    schema_version: 1,
    control_hash: hash,
    sealed_at: nowIso(),
    sealed_by_plugin_version: pluginVersion(),
    files,
  };
  if (preserveLastGate && prev?.last_gate) doc.last_gate = prev.last_gate;
  assertValid(doc, schemas().integrity, PATHS.integrity);
  writeJsonAtomic(abs(root, PATHS.integrity), doc);
  return doc;
}

/**
 * @returns {{ok: boolean, reason?: string}}
 * A mismatch is a hard stop, not a warning: it means the files that govern an
 * agent changed outside the one channel allowed to change them.
 */
export function verifyIntegrity(root) {
  const stored = readJsonOrNull(abs(root, PATHS.integrity));
  if (!stored) return { ok: false, reason: 'control/integrity.json is missing - the control plane was never sealed. Run: state.mjs --reseal' };
  const { hash } = computeControlHash(root);
  if (hash !== stored.control_hash) {
    return {
      ok: false,
      reason: 'control plane modified outside state.mjs. The files that govern agent behaviour '
        + '(phase, attempts, baseline, waivers, verdicts) no longer match their seal. '
        + 'Review `git diff .mavci/control/`, then run: state.mjs --reseal',
    };
  }
  return { ok: true };
}

/* --------------------------------------------------------------- writes */

/**
 * The single write path into the control plane.
 * Redact -> validate -> atomic write -> reseal. No caller skips a step.
 */
export function writeControl(root, relPath, doc, schemaName) {
  if (escapesRoot(root, relPath)) throw new Error(`refusing to write outside the project: ${relPath}`);
  if (!relPath.startsWith(CONTROL_DIR + '/')) throw new Error(`not a control path: ${relPath}`);
  const ctx = buildRedactor(root, readJsonOrNull(abs(root, PATHS.manifest)));
  const clean = ctx.redactDeep(doc);
  assertValid(clean, schemas()[schemaName], relPath);
  writeJsonAtomic(abs(root, relPath), clean);
  seal(root);
  return clean;
}

/** Agent-writable surface. Redacted and validated, but not sealed. */
export function writeSurface(root, relPath, doc, schemaName) {
  if (escapesRoot(root, relPath)) throw new Error(`refusing to write outside the project: ${relPath}`);
  const ctx = buildRedactor(root, readJsonOrNull(abs(root, PATHS.manifest)));
  const clean = ctx.redactDeep(doc);
  if (schemaName) assertValid(clean, schemas()[schemaName], relPath);
  writeJsonAtomic(abs(root, relPath), clean);
  return clean;
}

/* ---------------------------------------------------------------- state */

export function readState(root) {
  const s = readJsonOrNull(abs(root, PATHS.state));
  if (!s) throw new Error(`${PATHS.state} not found. This project is not connected - run /mavci-core:connect or /mavci-core:new-project.`);
  return s;
}

/**
 * THREE VERSION FACTS, AND THIS FUNCTION OWNS EXACTLY ONE OF THEM.
 *
 * Until 0.1.22 state.json carried a single `plugin_version` with three readers:
 * `--init` stamped it (created-by), `mavci-verify.yml` cloned the tag it named
 * (the CI pin), and `doctor` compared it against the installed version (the skew
 * signal). This function never restamped it, so plugin 0.1.21 wrote a gate4c
 * state.json at 2026-09-02T14:06:27Z that said "0.1.20", and in that project the
 * live value had in fact been set by `doctor --sync` - a fourth provenance no
 * reader's contract named.
 *
 * `written_by_plugin_version` is stamped HERE, on every write, because that is
 * the only place that knows the answer. It is also the fact finding 24's remedy
 * needs: reporting a schema rejection as version skew requires knowing which
 * version wrote the document being rejected.
 *
 * `ci_pinned_plugin_version` is deliberately NOT stamped here. The pin's whole
 * value is that it moves only when somebody means it - `doctor --sync` followed
 * by a commit. Restamping it on every write would repin CI from any machine with
 * a newer plugin installed, as a side effect of allocating a task.
 */
export function setState(root, patch) {
  const cur = readState(root);
  const next = { ...cur, ...patch, updated: nowIso(), written_by_plugin_version: pluginVersion() };
  // LEGACY. A project connected before 0.1.22 carries `plugin_version`, and what
  // it holds is the pin - that is what CI cloned from it. Carry it across on the
  // first write rather than dropping it, or CI loses its pin silently.
  if (next.plugin_version && !next.ci_pinned_plugin_version) {
    next.ci_pinned_plugin_version = next.plugin_version;
  }
  delete next.plugin_version;
  return writeControl(root, PATHS.state, next, 'state');
}

/** The CI pin. Operator-initiated only: `--init` and `doctor --sync`. */
export function setPin(root, version) {
  if (!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(String(version))) {
    throw new Error(`not a plugin version: ${version}`);
  }
  return setState(root, { ci_pinned_plugin_version: version });
}

/** The pin, reading the pre-0.1.22 field for projects that still carry it. */
export function ciPin(state) {
  return state?.ci_pinned_plugin_version ?? state?.plugin_version ?? null;
}

/**
 * ONE COMMAND MOVES BOTH HALVES, because they are required to agree.
 *
 * ARCHITECTURE 4.1 says the project phase in `state.json` and the task phase in
 * `control/tasks/<id>.json` must agree, that the control copy wins when they do
 * not, and that `doctor` reports the divergence. What produced the divergence on
 * the first real project was `--set-phase` itself: it moved the project and left
 * the task where it was, so `AI-Chatbot-Widget-SaaS` records `state.phase=verify`
 * over `task 0001 phase=plan` - by sanctioned command, exactly the surface/control
 * split carried-forward item 5 refused to create by hand.
 *
 * Two writers for one fact is the failure Gate 4c found four times. So the phase
 * of the task in progress moves with the project, in the same call. There is at
 * most one such task (`assertSoleInProgress`), and when there is none this is the
 * old behaviour unchanged - a project-level move with nothing to carry.
 *
 * It returns the task it moved so the CLI can say so. A control-plane write the
 * operator was not told about is the kind that gets discovered by `git diff`.
 */
/**
 * The steps `--advance-phase` will make, forward and back.
 *
 * `verify -> build` is the REWORK edge and it is deliberately here: a redispatch
 * after a failure needs the phase to move back, and the operator's instruction was
 * that it goes through the same gate as every other move rather than through a
 * free set. `release` is terminal - nothing advances out of it, because leaving it
 * means starting another task, which is `--begin-plan`.
 */
export const PHASE_STEPS = Object.freeze({
  plan: ['build'],
  build: ['verify'],
  verify: ['build', 'release'],
  release: [],
});

export function setPhase(root, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase "${phase}". One of: ${PHASES.join(', ')}`);
  let moved = null;
  for (const id of listControlTaskIds(root)) {
    if (readControlTask(root, id).status === 'in_progress') { moved = id; break; }
  }
  if (moved) updateControlTask(root, moved, { phase });
  setState(root, { phase });
  return { phase, task: moved };
}

/* ---------------------------------------------------------------- tasks */

export function controlTaskPath(id) { return `${PATHS.controlTasks}/${id}.json`; }
export function surfaceTaskPath(id) { return `${PATHS.tasks}/${id}.json`; }

export function readControlTask(root, id) {
  const p = abs(root, controlTaskPath(id));
  if (!exists(p)) throw new Error(`task ${id} not found at ${controlTaskPath(id)}`);
  return readJson(p);
}

export function allocateTaskId(root) {
  const s = readState(root);
  const id = String(s.next_task_id).padStart(4, '0');
  setState(root, { next_task_id: s.next_task_id + 1 });
  return id;
}

/** Both halves of a task under a caller-supplied id. Touches no state. */
function writeTaskHalves(root, id, { title, spec, owner_agent = null, max_attempts = 3 }) {
  const s = readState(root);
  const now = nowIso();
  writeControl(root, controlTaskPath(id), {
    schema_version: 1, id, project_id: s.project_id,
    phase: 'plan', status: 'pending', attempts: 0, attempts_total: 0, max_attempts,
    owner_agent, blocked_by: null, verdicts: [], created: now, updated: now,
  }, 'control-task');
  writeSurface(root, surfaceTaskPath(id), {
    schema_version: 1, id, project_id: s.project_id,
    title, spec, artifacts: [], notes: [],
  }, 'task');
  return id;
}

export function createTask(root, opts) {
  return writeTaskHalves(root, allocateTaskId(root), opts);
}

/**
 * THE PLAN TRANSITION, AS ONE SANCTIONED ACT.
 *
 * gate4c, 2026-09-02: the plan skill ran `--set-phase plan` and then
 * `--new-task`. The first succeeded; an external classifier denied the second.
 * The phase stayed advanced with no task allocated, and because risk-guard
 * freezes application code whenever `phase !== 'build'`, the project sat frozen
 * with nothing to plan against until a human ran the blocked command by hand.
 *
 * WE DO NOT OWN THAT CLASSIFIER. Two external gates ordered the risk of this
 * script backwards from our own classification - the privileged write went
 * through unconfirmed and the agent-safe one was refused - and no rule written
 * here changes that. What we own is that the sequence had an interruptible
 * middle for their decision to land in. It no longer has one.
 *
 * TWO REJECTED FIXES, for whoever reads this next and reaches for the smaller
 * change:
 *
 *   `--new-task` moving the phase. It is AGENT_OK and connect calls it once per
 *   baselined check, so that hands the gate deciding whether app code is
 *   writable to an unattended subagent. A privilege escalation dressed as an
 *   atomicity fix.
 *
 *   `--set-phase` refusing to enter plan with no task. There is no such state to
 *   test: `next_task_id` always increments, and `{phase: plan, active_task:
 *   null}` is exactly what `--init` writes, so the refusal would reject every
 *   fresh project's first legal transition and still guard only the half that
 *   succeeded.
 *
 * ORDER IS THE MECHANISM. The task halves go first and the SINGLE state write
 * goes last, so an interruption anywhere leaves the phase where it was. The
 * residue in that case is an orphan task file at an id that will be handed out
 * again and overwritten - the benign direction. The reverse order buys nothing
 * and reproduces the bug.
 */
export function beginPlan(root, { title, spec }) {
  const s = readState(root);
  const id = String(s.next_task_id).padStart(4, '0');
  writeTaskHalves(root, id, { title, spec });
  setState(root, { phase: 'plan', active_task: id, next_task_id: s.next_task_id + 1 });
  return id;
}

/**
 * Every task id with a control record. The invariant "at most one task
 * in_progress" is enforced at the transition, and a transition cannot enforce
 * what it cannot enumerate.
 */
export function listControlTaskIds(root) {
  const dir = abs(root, PATHS.controlTasks);
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^[0-9]{4}\.json$/.test(f)).map((f) => f.slice(0, 4)).sort();
}


/**
 * AT MOST ONE TASK IN PROGRESS, enforced at the transition rather than held as a
 * second copy of the fact.
 *
 * Carried-forward item 5 asked for exactly this. `state.json.active_task` is a
 * pointer to the same fact `status: "in_progress"` already carries, and a second
 * writer for one fact is the failure Gate 4c found four times; the invariant that
 * replaces the pointer has to be checked where it can be violated, which is here.
 *
 * BOTH writers call it, and that is the point. The first version guarded only
 * `--task-status`, and `--attempt` walked straight past it - `incrementAttempt`
 * sets `in_progress` too, and it is the one the orchestrator runs on every build.
 * A rule enforced at one of two doors is a rule with a door.
 */
export function assertSoleInProgress(root, id) {
  for (const other of listControlTaskIds(root)) {
    if (other === id) continue;
    if (readControlTask(root, other).status === 'in_progress') {
      throw new Error(`task ${other} is already in_progress. Two tasks in progress means two `
        + 'answers to "what is being built", and the phase gate has only one. Close '
        + `${other} first: --task-status ${other} --status <done|failed|blocked>.`);
    }
  }
}

/**
 * THE VERDICT IDENTITY COUNTER, read defensively.
 *
 * `attempts` is the retry POLICY counter: it counts tries against the current
 * ceiling and `--reset-attempts` zeroes it. `attempts_total` is the verdict
 * IDENTITY counter: tries ever, never reset. They are equal on every task that
 * has not been reset, which is why the fallback is exactly right for records
 * written before the field existed.
 *
 * Naming a verdict from the policy counter is what made the two collide. After a
 * reset the next try was "attempt 1" again, and its verdict path was the path of a
 * historical one - so recording it destroyed the evidence of the three failures
 * the operator had just reset past. Write-once turned that from silent data loss
 * into a refusal, and the refusal is what made the collision visible at all.
 */
export function attemptsTotal(task) {
  return typeof task?.attempts_total === 'number' ? task.attempts_total : (task?.attempts ?? 0);
}

export function updateControlTask(root, id, patch) {
  const cur = readControlTask(root, id);
  return writeControl(root, controlTaskPath(id), { ...cur, ...patch, updated: nowIso() }, 'control-task');
}

/** Returns the new attempt number. Refuses past the ceiling - ARCHITECTURE section 9. */
export function incrementAttempt(root, id) {
  const t = readControlTask(root, id);
  if (t.attempts >= t.max_attempts) {
    throw new Error(`task ${id} is at its retry ceiling (${t.attempts}/${t.max_attempts}). `
      + 'It cannot be retried. Use /mavci-core:retro, /mavci-core:waive if the check is wrong, '
      + 'or state.mjs --reset-attempts after changing something.');
  }
  assertSoleInProgress(root, id);
  const attempts = t.attempts + 1;
  // Both counters move together here, and only here. The ceiling counter is
  // zeroed elsewhere; the identity counter never is.
  const attempts_total = attemptsTotal(t) + 1;
  updateControlTask(root, id, { attempts, attempts_total, status: 'in_progress' });
  return { attempts, attempts_total };
}

/**
 * A CLOSED TASK IS NOT THE ACTIVE ONE.
 *
 * `state.json.active_task` gained a writer in 0.1.22 (`beginPlan`) and never
 * gained a clearer, so after a task reached `done` the field went on naming it -
 * observed on gate5, where a completed, verified, documented task was still the
 * project's `active_task`. A pointer that is only ever set reads as current
 * forever, and the next reader has no way to tell a stale one from a live one.
 *
 * This keeps the field TRUTHFUL; it does not settle whether the field should
 * exist. Carried-forward item 5 decided it should be deleted, because "which task
 * is in progress" is already carried by `status: "in_progress"` and enforced by
 * `assertSoleInProgress` - a second copy of one fact. Deleting it is a state-file
 * format change and stays queued as one. Until then, stale is strictly worse than
 * absent, and this is the cheap half that is safe to do now.
 */
function clearActiveTask(root, id) {
  const s = readState(root);
  if (s.active_task === id) setState(root, { active_task: null });
}

export function closeTask(root, id, status) {
  updateControlTask(root, id, { status });
  clearActiveTask(root, id);
}

/* ============================ SPEC APPROVAL AND THE SCOPED TRANSITION ======
 *
 * THE DISTINCTION THIS EXISTS TO KEEP: the orchestrator executing an operator
 * decision and the orchestrator making one are different acts, and until now
 * nothing in the control plane could tell them apart. `--set-phase` was a flat
 * grant - any phase, any time, no precondition - so an orchestrator holding it
 * was not carrying a decision forward, it was deciding.
 *
 * `spec_approved` is what separates them, which makes that field load-bearing;
 * it says so where it is defined. `--approve-spec` is the operator recording the
 * decision and is not reachable by any agent. `--advance-phase` is the
 * orchestrator carrying an approved task from one named phase to the next, and it
 * refuses on anything else.
 *
 * THE HASH IS NOT DECORATION. Approval is of a SPECIFIC spec, not of a task. An
 * approval with no hash is a permanent unlock: the architect could rewrite the
 * spec afterwards and every later transition would still pass, which is a stale
 * exemption in exactly the shape 0.1.14 established is indistinguishable from a
 * control that was never there.
 */

/** The spec's content hash, or null when there is no readable spec. */
export function specHash(root, task) {
  if (!task?.spec) return null;
  const p = abs(root, task.spec);
  if (!exists(p)) return null;
  return sha256(readText(p));
}

/**
 * Where the approved bytes of `spec` at `sha` are kept. Derived, never stored.
 *
 * A field in the task record would be a second name for one fact, and the record
 * already carries the hash under a seal. Deriving the path means a snapshot
 * cannot be pointed somewhere the approval does not name.
 */
export function specSnapshotPath(id, sha) {
  return `${PATHS.specSnapshots}/${id}-${sha.slice(0, 12)}.md`;
}

/**
 * Put the approved bytes back, and refuse to put anything else back.
 *
 * FINDING 8. The prevention - an approved spec is denied to every agent by
 * `risk-guard.mjs` - is a HOOK, and hooks fail open on timeout and crash
 * (NATIVE-CAPABILITIES 4.17/4.18) and are defeated outright by `disableAllHooks`.
 * So the prevention is the control and this is the recovery, and they are
 * independently load-bearing: neither covers the case the other is for.
 *
 * THE SNAPSHOT IS NOT TRUSTED, it is verified. Its bytes are hashed and compared
 * against `spec_approved.spec_sha256`, which lives in a SEALED record - so an
 * edited snapshot fails here rather than restoring a document nobody approved.
 * The restored file is then re-read and hashed again, because "I wrote it" and
 * "it is on disk with those bytes" are two facts and the second is the one that
 * matters. That is the exact gap the scribe fell into on gate5: it reported a
 * successful restore, held no shell, could not hash what it had written, and had
 * in fact produced a third distinct document.
 */
export function restoreSpec(root, id) {
  const t = readControlTask(root, id);
  const a = t?.spec_approved;
  if (!a?.spec_path || !a?.spec_sha256) {
    throw new Error(`task ${id} has no recorded spec approval, so there are no approved bytes to `
      + 'restore. There is nothing this command can put back that anyone agreed to.');
  }
  const snapRel = specSnapshotPath(id, a.spec_sha256);
  const snapAbs = abs(root, snapRel);
  if (!exists(snapAbs)) {
    throw new Error(`task ${id}'s approval names ${a.spec_sha256.slice(0, 12)} and no snapshot of `
      + `those bytes exists at ${snapRel}. Approvals recorded before this version were not `
      + 'snapshotted, so the approved document is only recoverable from version control. '
      + `Check: git log -- ${a.spec_path}`);
  }
  const body = readText(snapAbs);
  const have = sha256(body);
  if (have !== a.spec_sha256) {
    throw new Error(`the snapshot at ${snapRel} hashes to ${have.slice(0, 12)}, and the sealed `
      + `approval names ${a.spec_sha256.slice(0, 12)}. Refusing to restore it. A snapshot that `
      + 'does not match the approval is not the approved document, whatever its name says.');
  }
  const target = abs(root, a.spec_path);
  const before = exists(target) ? sha256(readText(target)) : null;
  writeTextAtomic(target, body);
  const after = sha256(readText(target));
  if (after !== a.spec_sha256) {
    throw new Error(`wrote ${a.spec_path} and it hashes to ${after.slice(0, 12)}, not the approved `
      + `${a.spec_sha256.slice(0, 12)}. The restore did NOT succeed. Do not report it as done.`);
  }
  return { spec: a.spec_path, sha: after, changed: before !== after, from: snapRel };
}

export function approveSpec(root, id) {
  const t = readControlTask(root, id);
  const surface = readJsonOrNull(abs(root, surfaceTaskPath(id)));
  const spec = surface?.spec ?? null;
  if (!spec) {
    throw new Error(`task ${id} has no spec pointer, so there is nothing to approve. `
      + 'The architect writes the spec and repoints the surface half; approve it after that.');
  }
  const hash = specHash(root, { spec });
  if (!hash) {
    throw new Error(`task ${id} points at ${spec}, which does not exist. Approving a spec that is `
      + 'not on disk would record a decision about a document nobody can read.');
  }
  /* THE SNAPSHOT IS TAKEN BEFORE THE RECORD IS WRITTEN.
   *
   * Finding 8. If the copy fails, no approval is recorded - so there is never a
   * recorded approval whose bytes were never kept. The other order gives an
   * approval that looks recoverable and is not, which is the state gate5 was in.
   */
  const snapRel = specSnapshotPath(id, hash);
  writeTextAtomic(abs(root, snapRel), readText(abs(root, spec)));
  updateControlTask(root, id, {
    spec_approved: { at: nowIso(), by: 'operator', spec_path: spec, spec_sha256: hash },
  });
  return { spec, hash, phase: t.phase, snapshot: snapRel };
}

/**
 * The orchestrator's transition. Scoped to one task, directional, and gated on a
 * recorded approval.
 *
 * Four refusals, and each is a way a flat grant would have said yes:
 *   1. the task's phase is not `from`      - the caller has stale state
 *   2. `to` is not the phase after `from`  - no skipping verify to reach release
 *   3. no `spec_approved`                  - no decision has been recorded
 *   4. the spec has changed since approval - the decision was about another document
 */
export function advancePhase(root, id, from, to) {
  if (!PHASES.includes(from) || !PHASES.includes(to)) {
    throw new Error(`--from and --to must each be one of: ${PHASES.join(', ')}`);
  }
  const t = readControlTask(root, id);
  /* THE PROJECT PHASE IS SHARED, AND THE IN-PROGRESS TASK OWNS IT.
   *
   * Found by running the chain: `--advance-phase 0002 --from plan --to build`
   * succeeded while task 0001 was still `in_progress`, moving the project phase
   * out from under a task that was mid-flight. Nothing else would have noticed -
   * 0002's own halves stayed consistent, and 0001's phase simply stopped matching
   * the project's, which is the divergence this whole release was closing.
   *
   * `assertSoleInProgress` already answers "is any OTHER task in progress", so
   * this is the same invariant enforced at a third transition rather than a new
   * rule. It was enforced at `--attempt` and `--task-status` and not here, which
   * is a rule with a door - the shape of finding 20's one-of-two-doors.
   */
  assertSoleInProgress(root, id);
  if (t.phase !== from) {
    throw new Error(`task ${id} is in phase "${t.phase}", not "${from}". --advance-phase names the `
      + 'phase it is moving FROM so a caller working from stale state is refused rather than '
      + `obeyed. Read the current phase and try again, or use --set-phase if you mean to override.`);
  }
  if (!PHASE_STEPS[from] || !PHASE_STEPS[from].includes(to)) {
    throw new Error(`"${from}" -> "${to}" is not a step this command makes. Legal steps: `
      + Object.entries(PHASE_STEPS).map(([f, l]) => `${f} -> ${l.join('|')}`).join(', ')
      + '. Skipping a phase is how a task reaches release without being verified, so it is '
      + 'refused here rather than trusted to the caller.');
  }
  const ok = t.spec_approved;
  if (!ok) {
    throw new Error(`task ${id} has no recorded spec approval, so there is no decision for this `
      + 'command to execute. The orchestrator carries an operator decision forward; it does not '
      + `make one. The operator runs: state.mjs --approve-spec ${id}`);
  }
  const current = specHash(root, { spec: ok.spec_path });
  if (current !== ok.spec_sha256) {
    throw new Error(`task ${id}'s spec has changed since it was approved `
      + `(${ok.spec_path}: approved ${ok.spec_sha256.slice(0, 12)}, now `
      + `${current ? current.slice(0, 12) : 'MISSING'}). The approval was of a specific document. `
      + 'TWO EXITS, and they are different decisions. If the change was INTENDED, the operator '
      + `re-approves: state.mjs --approve-spec ${id}. If it was NOT - an agent wrote the document `
      + 'you approved - put the approved bytes back rather than blessing the new ones: '
      + `state.mjs --restore-spec ${id}. Re-approving in order to close a task empties the gate `
      + 'of its meaning, which is why it is not the only exit named here.');
  }
  /* BOTH HALVES, EXPLICITLY, AND NOT THROUGH `setPhase`.
   *
   * `setPhase` is the free command and has to GUESS which task it carries: it
   * moves the one whose status is `in_progress`. That heuristic is right for a
   * global override and wrong here, because this command was given the task id.
   * Delegating to it moved the project and left a `pending` task behind - the
   * exact surface/control divergence this release was fixing, reintroduced by the
   * scoped command that exists to make transitions precise. Caught by D3b, which
   * asserts both halves rather than the command's exit status.
   *
   * ORDER IS THE MECHANISM, as it is in `beginPlan`: the task half goes first and
   * the single state write goes last, so an interruption between them leaves the
   * project phase where it was. The residue is a task one phase ahead of the
   * project, which the router reads as authoritative (ARCHITECTURE 4.1) and
   * reconciles - the benign direction. The reverse order leaves application code
   * writable for a task that never moved.
   */
  updateControlTask(root, id, { phase: to });
  setState(root, { phase: to });
  return { from, to, task: id };
}

export function blockTask(root, id, blocked_by) {
  updateControlTask(root, id, { status: 'blocked', phase: 'plan', blocked_by });
  setPhase(root, 'plan');
  clearActiveTask(root, id);
}

/* -------------------------------------------------------------- verdicts */

/**
 * WRITE-ONCE, AND THE REWORK LOOP IS WHY.
 *
 * ARCHITECTURE 4.3: "Verdicts are write-once and never deleted - they are the
 * audit trail", and section 9: "Each attempt writes its own immutable verdict."
 * Neither was enforced. `writeControl` writes atomically over whatever is there,
 * so verifying the SAME attempt twice replaced the first verdict with no trace -
 * and `verdicts[]` dedupes by path, so the control task could not show it either.
 *
 * The loop is exactly where it costs. A second verdict on attempt N is one of two
 * things, and both are bad silently:
 *
 *   - the code changed without an attempt being consumed, so the counter that
 *     bounds the rework loop has been stepped around and the history now claims
 *     the task passed in fewer tries than it took;
 *   - the code did not change, so the existing verdict already answers and the
 *     rewrite destroys a dated record to say the same thing.
 *
 * So it REFUSES, and names the move that makes a second verdict legitimate:
 * consume an attempt. That is what keeps "the attempt counter is what bounds it"
 * true rather than aspirational - a verdict cannot be obtained without one.
 *
 * The unattributed path is untouched: `adhoc-<epoch>.json` is unique per run, and
 * those are per-turn gate receipts rather than attempt evidence.
 */
export function recordVerdict(root, verdict) {
  const id = verdict.task_id;
  const attempt = verdict.attempt;
  const name = id
    ? `${id}-attempt-${String(attempt ?? 1).padStart(2, '0')}.json`
    : `adhoc-${Date.now()}.json`;
  const rel = `${PATHS.verdicts}/${name}`;
  if (id && exists(abs(root, rel))) {
    const prior = readJsonOrNull(abs(root, rel));
    throw new Error(`a verdict for task ${id} attempt ${attempt} already exists at ${rel}`
      + `${prior?.run_at ? ` (recorded ${prior.run_at}, verdict "${prior.verdict}")` : ''}. `
      + 'Verdicts are write-once: they are the audit trail, and overwriting one destroys the '
      + 'record of why a rework loop looped. If the code has changed, consume an attempt first '
      + `- state.mjs --attempt ${id} - and the next verdict is attempt ${(attempt ?? 1) + 1}. `
      + 'If it has not, the existing verdict already answers.');
  }
  writeControl(root, rel, verdict, 'verdict');
  if (id) {
    const t = readControlTask(root, id);
    if (!t.verdicts.includes(rel)) {
      updateControlTask(root, id, { verdicts: [...t.verdicts, rel] });
    }
  }
  return rel;
}

/* -------------------------------------------------------------- baseline
 * B2. Entries may be REMOVED, never ADDED after init. There is deliberately no
 * add operation in this module, so debt can only shrink.
 */

export function baselineInit(root, findings) {
  if (exists(abs(root, PATHS.baseline))) {
    throw new Error('baseline.json already exists. --baseline-init runs once, at connect. '
      + 'To retire fixed entries use --baseline-prune; there is no way to add entries.');
  }
  const critical = findings.filter((f) => UNSUPPRESSIBLE_SEVERITIES.has(f.severity));
  if (critical.length) {
    const lines = critical.map((c) => `  - ${c.check_id} at ${c.path ?? '(repo)'}`).join('\n');
    throw new Error(
      `refusing to baseline ${critical.length} critical finding(s):\n${lines}\n\n`
      + 'A critical finding is never acceptable technical debt. A committed secret must be '
      + 'removed and its key rotated. A broken marketplace registration must be fixed, because '
      + 'baselining it would file "nothing is enforced here" as debt. Then run '
      + '/mavci-core:connect again.');
  }
  const s = readJsonOrNull(abs(root, PATHS.state));
  const now = nowIso();
  const doc = {
    schema_version: 1,
    project_id: s?.project_id ?? readJson(abs(root, PATHS.manifest)).project_id,
    created: now,
    created_by_plugin_version: pluginVersion(),
    entries: dedupeEntries(findings.map((f) => ({
      check_id: f.check_id,
      path: f.path ?? '(repo)',
      first_seen: now,
      note: 'pre-existing at connect',
    }))),
  };
  return writeControl(root, PATHS.baseline, doc, 'baseline');
}

/**
 * Entries are keyed by check_id + path. The delimiter is `::` and must stay a
 * printable one: this file is the privileged write channel for the control
 * plane, and a NUL separator (which this used to use) makes git report
 * "Binary files differ" instead of a patch - so the one script that can bypass
 * the Edit deny would be the one script nobody can review in a diff. It also
 * makes `grep -r` skip the file silently unless the auditor remembers -a.
 *
 * `::` is unambiguous here because check_id is schema-constrained to
 * ^[a-z0-9]+([.][a-z0-9_]+)+$ and so can never contain a colon: the first `::`
 * in the key is always the delimiter, whatever the path holds.
 */
function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const k = `${e.check_id}::${e.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => (a.check_id + a.path).localeCompare(b.check_id + b.path));
}

/** Remove entries whose violation no longer occurs. The only way debt shrinks. */
export function baselinePrune(root, currentFindings) {
  const b = readJsonOrNull(abs(root, PATHS.baseline));
  if (!b) return { removed: [], remaining: 0 };
  const live = new Set(currentFindings.map((f) => `${f.check_id}::${f.path ?? '(repo)'}`));
  const kept = [];
  const removed = [];
  for (const e of b.entries) {
    if (live.has(`${e.check_id}::${e.path}`)) kept.push(e);
    else removed.push(e);
  }
  if (removed.length) {
    writeControl(root, PATHS.baseline, { ...b, entries: kept }, 'baseline');
    const s = readJsonOrNull(abs(root, PATHS.state));
    if (s) setState(root, { baseline_debt: kept.length });
  }
  return { removed, remaining: kept.length };
}

export function isBaselined(baseline, check_id, filePath) {
  if (!baseline) return false;
  const p = filePath ?? '(repo)';
  return baseline.entries.some((e) => e.check_id === check_id && e.path === p);
}

/* --------------------------------------------------------------- waivers
 * B3. Granted only via /mavci-core:waive, which sets disable-model-invocation:true,
 * so an agent cannot reach this at all. It must escalate instead.
 */

export function addWaiver(root, { check_id, filePath, reason, days = WAIVER_DEFAULT_DAYS, approved_by = 'operator', severity }) {
  if (!check_id || !/^[a-z0-9]+(\.[a-z0-9_]+)+$/.test(check_id)) {
    throw new Error(`invalid check_id "${check_id}"`);
  }
  if (!filePath) {
    throw new Error('a waiver needs a path. Project-wide waivers are not allowed - '
      + 'they would silence a check everywhere, which is what disableAllHooks does.');
  }
  if (severity && UNSUPPRESSIBLE_SEVERITIES.has(severity)) {
    throw new Error(`${check_id} is severity "${severity}" and can never be waived.`);
  }
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < WAIVER_MIN_REASON_CHARS) {
    throw new Error(`a waiver needs a reason of at least ${WAIVER_MIN_REASON_CHARS} characters `
      + `(got ${trimmed.length}). Say why the check is wrong here, for the person who reads this in three months.`);
  }
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || n > WAIVER_MAX_DAYS) {
    throw new Error(`--days must be between 1 and ${WAIVER_MAX_DAYS} (got ${days}). There are no permanent waivers.`);
  }

  const cur = readJsonOrNull(abs(root, PATHS.waivers))
    ?? { schema_version: 1, project_id: readState(root).project_id, waivers: [] };
  const others = cur.waivers.filter((w) => !(w.check_id === check_id && w.path === filePath));
  const doc = {
    ...cur,
    waivers: [...others, {
      check_id, path: filePath, reason: trimmed, approved_by,
      approved: todayIso(), expires: addDaysIso(n),
      created_by_plugin_version: pluginVersion(),
    }].sort((a, b) => (a.check_id + a.path).localeCompare(b.check_id + b.path)),
  };
  return writeControl(root, PATHS.waivers, doc, 'waivers');
}

export function activeWaiver(waivers, check_id, filePath, today = todayIso()) {
  if (!waivers) return null;
  const w = waivers.waivers.find((x) => x.check_id === check_id && x.path === (filePath ?? '(repo)'));
  if (!w) return null;
  return w.expires >= today ? w : null;
}

export function expiredWaivers(waivers, today = todayIso()) {
  if (!waivers) return [];
  return waivers.waivers.filter((w) => w.expires < today);
}

export function expiringWaivers(waivers, withinDays, today = new Date()) {
  if (!waivers) return [];
  const limit = addDaysIso(withinDays, today);
  const t = today.toISOString().slice(0, 10);
  return waivers.waivers.filter((w) => w.expires >= t && w.expires <= limit);
}

/* ------------------------------------------------------------- heartbeat
 * Fix 1. The only mechanism that detects a Stop hook which is not running.
 * Lives in integrity.json, which is excluded from the control hash, so stamping
 * a heartbeat never invalidates the seal.
 */

export function stampGate(root, { prompt_id, session_id, verdict, continues }) {
  const cur = readJsonOrNull(abs(root, PATHS.integrity));
  if (!cur) return null;
  const doc = {
    ...cur,
    last_gate: {
      prompt_id: prompt_id ?? null,
      session_id: session_id ?? null,
      at: nowIso(),
      verdict,
      continues,
      plugin_version: pluginVersion(),
    },
  };
  writeJsonAtomic(abs(root, PATHS.integrity), doc);
  return doc.last_gate;
}

export function lastGate(root) {
  return readJsonOrNull(abs(root, PATHS.integrity))?.last_gate ?? null;
}

/* ------------------------------------------------- hook registration receipt
 * Gate 3 finding. v0.1.2 installed cleanly and registered ZERO hooks: Claude
 * Code rejected every entry in hooks.json on a schema error and said nothing.
 * Nothing in the system noticed, because every local probe tested the SCRIPTS
 * rather than whether Claude Code had actually loaded them - doctor's own hook
 * self-test cheerfully reported "5 cases passed" with no hook registered at all.
 *
 * This file is the only artefact that cannot be produced without Claude Code
 * having run one of our hooks: doctor.mjs --preflight writes it, and it is
 * wired as a SessionStart hook, so it is stamped once per session IF AND ONLY
 * IF the plugin's hooks registered. `checkHookRegistration` in doctor.mjs turns
 * its absence into a FAIL.
 *
 * It lives in control/ so an agent cannot forge one, and outside CONTROL_GLOBS
 * so stamping it never invalidates the seal - exactly like gate-run.json.
 */
export function stampHookRun(root, { event, session_id }) {
  const p = abs(root, PATHS.hookRun);
  // No control directory, or no manifest to take project_id from, means this is
  // not a connected project: there is nothing to stamp and nothing that will
  // later read it. Return null rather than writing a file that fails its schema.
  if (!exists(path.dirname(p))) return null;
  const projectId = readJsonOrNull(abs(root, PATHS.manifest))?.project_id;
  if (!projectId) return null;

  const doc = {
    schema_version: 1,
    project_id: projectId,
    event,
    at: nowIso(),
    plugin_version: pluginVersion(),
    // Three independent ways to recognise "this session". Which of them Claude
    // Code populates is version-dependent, so a match on ANY is proof and a
    // match on none is not, by itself, taken as failure.
    session_id: session_id ?? null,
    env_session_id: process.env.CLAUDE_CODE_SESSION_ID ?? null,
    parent_pid: Number.isInteger(process.ppid) ? process.ppid : null,
  };

  // Validate before writing. An invalid receipt would fail state.schema_valid on
  // the next gate, which would turn a hook that is working correctly into a
  // blocker - the receipt must never be the thing that breaks the build.
  if (validate(doc, schemas()['hook-run']).length) return null;

  try { writeJsonAtomic(p, doc); } catch { return null; }
  return doc;
}

export function lastHookRun(root) {
  return readJsonOrNull(abs(root, PATHS.hookRun));
}

/* ------------------------------------------------------------------ init */

/* ------------------------------------------------------- manifest migration
 * v1 -> v2: tenancy.model/isolation split (finding 17).
 *
 * v1 fused schema layout and enforcement mechanism into one token, so a project
 * whose isolation is application-code filters under a service-role key had to
 * declare `shared-schema-rls` - a false premise in the file every rule reads.
 *
 * REFUSED ON READ, NOT SILENTLY UPGRADED. The manifest is operator surface. A read
 * path that rewrites it converts "your declaration is wrong" into "your declaration
 * changed while you were not looking", and the value being rewritten is the one that
 * decides whether the tenant-isolation rules run at all. `assertValid` fails a v1
 * manifest; doctor names this command; the operator runs it.
 *
 * `shared-schema-rls` maps to isolation `rls` because that is what it asserted. It
 * does NOT map to what the project actually does - this migration cannot know that,
 * and must not guess. A project whose isolation is really application filters comes
 * out of here declaring `rls`, which is the same false premise it went in with, and
 * the operator has to correct it. That is deliberate: a migration that silently
 * downgraded an isolation claim would be inventing a security posture.
 */
export function migrateManifest(root = projectRoot()) {
  const p = abs(root, PATHS.manifest);
  if (!exists(p)) throw new Error(`no manifest at ${PATHS.manifest}`);
  const m = readJson(p);
  const from = m.schema_version;
  if (from === MANIFEST_SCHEMA_VERSION) return { changed: false, from, to: from, notes: [] };
  if (from !== 1) throw new Error(`cannot migrate manifest schema_version ${from}; expected 1`);

  const notes = [];
  const legacy = m.tenancy?.model;
  const MAP = {
    'shared-schema-rls': { model: 'shared-schema', isolation: 'rls' },
    'schema-per-tenant': { model: 'schema-per-tenant', isolation: 'none' },
    'single-tenant': { model: 'single-tenant', isolation: 'none' },
  };
  if (!(legacy in MAP)) throw new Error(`unrecognised v1 tenancy.model "${legacy}"`);
  m.tenancy = { ...m.tenancy, ...MAP[legacy] };
  notes.push(`tenancy.model "${legacy}" -> model "${m.tenancy.model}", isolation "${m.tenancy.isolation}"`);
  if (legacy === 'shared-schema-rls') {
    notes.push('CHECK THIS: isolation was set to "rls" because that is what the old value '
      + 'asserted, not because anything verified it. If this project reaches its data through '
      + 'a service-role client, isolation is "application-filters" and RLS is not what '
      + 'protects it. Correcting that turns supabase.rls_enabled off and the scoped-query '
      + 'rule on - it does not reduce checking.');
  }
  m.schema_version = MANIFEST_SCHEMA_VERSION;
  assertValid(m, schemas().project, PATHS.manifest);
  writeJsonAtomic(p, m);
  return { changed: true, from, to: MANIFEST_SCHEMA_VERSION, notes };
}

export function init(root, manifest) {
  assertValid(manifest, schemas().project, PATHS.manifest);
  fs.mkdirSync(abs(root, PATHS.controlTasks), { recursive: true });
  fs.mkdirSync(abs(root, PATHS.verdicts), { recursive: true });
  fs.mkdirSync(abs(root, PATHS.tasks), { recursive: true });
  fs.mkdirSync(abs(root, PATHS.decisions), { recursive: true });
  fs.mkdirSync(abs(root, PATHS.lessons), { recursive: true });

  writeJsonAtomic(abs(root, PATHS.manifest), manifest);

  writeControl(root, PATHS.state, {
    schema_version: 1,
    project_id: manifest.project_id,
    phase: 'plan',
    active_task: null,
    next_task_id: 1,
    baseline_debt: 0,
    updated: nowIso(),
    // The pin CI clones, and the version that wrote this document. At init they
    // are equal and that agreement proves nothing - see check-state-transition.
    ci_pinned_plugin_version: pluginVersion(),
    written_by_plugin_version: pluginVersion(),
  }, 'state');

  writeControl(root, PATHS.waivers, {
    schema_version: 1, project_id: manifest.project_id, waivers: [],
  }, 'waivers');

  return readState(root);
}

/* --------------------------------------------------------------- validate */

export function validateAll(root) {
  const errors = [];
  const S = schemas();
  const check = (rel, schemaName) => {
    const p = abs(root, rel);
    if (!exists(p)) return;
    let doc;
    try { doc = readJson(p); } catch (e) { errors.push(e.message); return; }
    for (const e of validate(doc, S[schemaName])) errors.push(`${rel}: ${e}`);
  };

  check(PATHS.manifest, 'project');
  check(PATHS.state, 'state');
  check(PATHS.baseline, 'baseline');
  check(PATHS.waivers, 'waivers');
  check(PATHS.integrity, 'integrity');
  check(PATHS.hookRun, 'hook-run');
  // Same reasoning as hook-run in 0.1.4: a control file with no schema is a
  // control file nothing validates, and `state.schema_valid` is the rule that
  // would otherwise never look at it. It is written outside writeControl - on
  // the path where the checker has just crashed - so this is the only place its
  // shape is ever checked.
  check(PATHS.unverified, 'unverified');

  // The corpus result joins the sweep for the same reason, and with the sharpest
  // edge of the three: it is the ONLY artefact standing between a `doctor` FAIL and
  // a green tick on guardian's judgement. Validated only by its writer, a malformed
  // one - a `recorded_for` that is not a version, a `cases` array shorter than the
  // library - would be read by `doctor`, found to have `result === 'pass'`, and
  // cleared. This is the check that is not the writer.
  check(PATHS.guardianCorpus, 'guardian-corpus');

  // guardianRecords joins the sweep for the reason hook-run and unverified did:
  // a control file with no schema check is a control file nothing validates. It
  // matters more here than for either of those, because a guardian record is the
  // evidence a release gate reads - and until this line existed, the only thing
  // that would have caught a malformed one was the writer that produced it.
  for (const dir of [PATHS.controlTasks, PATHS.verdicts, PATHS.tasks, PATHS.guardianRecords]) {
    const d = abs(root, dir);
    if (!exists(d)) continue;
    const schemaName = dir === PATHS.controlTasks ? 'control-task'
      : dir === PATHS.verdicts ? 'verdict'
      : dir === PATHS.guardianRecords ? 'guardian' : 'task';
    for (const f of fs.readdirSync(d)) {
      if (f.endsWith('.json')) check(`${dir}/${f}`, schemaName);
    }
  }

  // ROADMAP data-format constraint 7 and 10: no absolute paths in state files.
  for (const rel of expandGlobs(root, CONTROL_GLOBS)) {
    const raw = readText(abs(root, rel));
    if (/"[A-Za-z]:\\\\/.test(raw) || /"\/(?:home|Users|var|etc)\//.test(raw)) {
      errors.push(`${rel}: contains an absolute path. State files must be machine-independent.`);
    }
  }

  return errors;
}

/* ------------------------------------------------------- guardian corpus */

/**
 * Record the guardian acceptance corpus result. OPERATOR ONLY - `risk-guard.mjs`
 * classifies `--record-corpus` as privileged and refuses it to every agent by
 * caller, the same way it refuses `--set-phase`.
 *
 * WHY THIS EXISTS. `doctor` FAILs when there is no corpus result for the running
 * plugin version, and until now there was no way to produce one: no writer, no
 * schema, and a deny rule plus this guard in the way of writing the file by hand.
 * A required artefact with no sanctioned producer is not a requirement, it is a
 * trap - the shape of Gate 4c finding 4, where seven messages pointed an agent at
 * a command that did not exist. The 0.1.18 corpus passed all three cases and could
 * not be recorded.
 *
 * THE POINT OF THE WHOLE FUNCTION IS THAT IT COMPUTES THE RESULT RATHER THAN
 * ACCEPTING ONE. Every verdict in this system is routed away from the party being
 * judged: guardian emits per-site answers and the SubagentStop writer derives the
 * verdict; the release gate recomputes that verdict from the coverage numbers
 * rather than trusting the record. The corpus is the acceptance test for
 * guardian's judgement, and for three releases it was scored by a model reading
 * two JSON files - which is why `corpus-score.mjs` exists. A writer that accepted
 * `--result pass` would reintroduce exactly that, through the back door, one layer
 * further out: the model would no longer be scoring the run, it would be asserting
 * the score. So this takes case/worklist PAIRS and nothing else, runs the scorer
 * over the documents on disk, and derives `result` from what the scorer returns.
 *
 * Three refusals, each of which is the cheap way to a green tick if it is absent:
 *
 *   1. `recorded_for` is stamped from `pluginVersion()` and can never be supplied.
 *      An argument-settable version key is worse than no key at all: `doctor`
 *      compares it for EQUALITY with the running version, so one flag would let a
 *      result from any tree satisfy any release. `library_fingerprint` is measured
 *      here for the same reason and covers what the version cannot: the version is a
 *      DECLARED string that moves when someone decides to move it, and the library
 *      gets edited inside a version - q3v7k's fixture was rewritten mid-0.1.18 - so
 *      a version-keyed result can be current evidence about a library it never saw.
 *      A caller-supplied fingerprint would be worse than a caller-supplied version:
 *      it would let a result name a library it never ran against.
 *   2. EVERY case in the library must be scored in one invocation. Recording a
 *      subset is the cheapest possible green corpus - drop the case that fails and
 *      the remaining ones all pass - and `cases_total` would still look plausible
 *      next to a `doctor` line that only ever prints it.
 *   3. A case the scorer CANNOT score is not recorded at all. `CannotScore` means
 *      the run could not be judged; treating it as either outcome invents a fact.
 *      Same reasoning as `no_report` in coverage.mjs and the distinct exit 2 in the
 *      scorer itself.
 *
 * A FAILING corpus is recorded, and deliberately so. `doctor` reports a non-pass
 * result as its own FAIL with the reason, which is what happened on 0.1.17; the
 * refusals above are about results this function cannot legitimately COMPUTE, not
 * about outcomes it dislikes.
 *
 * @param {string} root
 * @param {Array<{caseId: string, worklistId: string}>} runs
 */
export async function recordCorpus(root, runs) {
  const { listCases, EXPECTATIONS, libraryFingerprint } = await import('./corpus-stage.mjs');
  const { scoreCase, CannotScore } = await import('./corpus-score.mjs');

  const library = listCases();
  if (!library.length) {
    throw new Error('the corpus case library is empty, so there is nothing to record a result about.');
  }
  if (!Array.isArray(runs) || !runs.length) {
    throw new Error('no runs given. Pass one --run <case-id>=<worklist-id> per case in the library: '
      + library.join(', '));
  }

  // Refusal 2, checked before any scoring so a partial invocation costs nothing.
  const seen = new Map();
  for (const r of runs) {
    if (!library.includes(r.caseId)) {
      throw new Error(`"${r.caseId}" is not a case in the library. Known: ${library.join(', ')}. `
        + 'A result naming a case that does not exist has graded nothing.');
    }
    if (seen.has(r.caseId)) {
      throw new Error(`case "${r.caseId}" was given twice, as ${seen.get(r.caseId)} and `
        + `${r.worklistId}. One run per case: two records for one case means one of them is not `
        + 'the run being recorded, and picking either is this writer guessing.');
    }
    seen.set(r.caseId, r.worklistId);
  }
  const missing = library.filter((id) => !seen.has(id));
  if (missing.length) {
    throw new Error(`the library has ${library.length} case(s) and ${missing.length} `
      + `were not scored: ${missing.join(', ')}. Every case must be scored in one invocation. `
      + 'Recording a subset is the cheapest green corpus there is - drop the failing case and the '
      + 'rest pass - and nothing downstream reads which cases were actually run.');
  }

  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  const cases = [];

  // Scored in run_order, which is the library's own order, so the report reads the
  // way the run was performed.
  for (const caseId of library) {
    const worklistId = seen.get(caseId);
    const expectedPath = path.join(EXPECTATIONS, `${caseId}.json`);
    const worklistRel = `${PATHS.guardianDir}/${worklistId}.json`;
    const recordRel = `${PATHS.guardianRecords}/${worklistId}.json`;

    for (const [label, p] of [['expectation', expectedPath],
      ['worklist', abs(root, worklistRel)], ['record', abs(root, recordRel)]]) {
      if (!exists(p)) {
        throw new Error(`case ${caseId}: no ${label} at ${p}. Nothing is recorded: a corpus `
          + 'result that skipped a document it could not find would be a claim, not a score.');
      }
    }

    let outcome;
    try {
      outcome = scoreCase({
        expected: readJson(expectedPath),
        worklist: readJson(abs(root, worklistRel)),
        record: readJson(abs(root, recordRel)),
      });
    } catch (e) {
      // Refusal 3. CANNOT_SCORE is not a failing case and it is not a passing one.
      if (e instanceof CannotScore) {
        throw new Error(`case ${caseId} (worklist ${worklistId}) COULD NOT BE SCORED: ${e.message} `
          + 'Nothing was recorded. "could not tell" is not an outcome, and writing either one in '
          + 'its place invents a fact about a run that was never judged.');
      }
      throw e;
    }

    cases.push({
      case_id: caseId,
      worklist_id: worklistId,
      ok: outcome.ok,
      failures: outcome.failures ?? [],
    });
  }

  // Refusal 1 covers the LIBRARY as well as the version, and for a reason the
  // version cannot cover. `recorded_for` catches a result carried across a release;
  // it cannot catch the library being edited INSIDE one, which is what happened to
  // q3v7k's fixture mid-0.1.18. So the fingerprint is measured here, from the files
  // on disk at the moment of recording, and is as uncomputable by the caller as the
  // result and the version are.
  const fingerprint = libraryFingerprint();
  if (!fingerprint) {
    throw new Error('the case library produced no fingerprint, so there is nothing to tie this '
      + 'result to. A result that cannot name the library it graded is not evidence about one.');
  }

  const doc = {
    schema_version: 1,
    project_id: manifest?.project_id ?? null,
    // Refusal 1: stamped here, never read from an argument.
    recorded_for: pluginVersion(),
    library_fingerprint: fingerprint,
    // Derived from the scorer, never from the caller.
    result: cases.every((c) => c.ok) ? 'pass' : 'fail',
    cases_total: cases.length,
    run_at: nowIso(),
    scored_by: 'scripts/corpus-score.mjs',
    cases,
  };

  return writeControl(root, PATHS.guardianCorpus, doc, 'guardian-corpus');
}

/* -------------------------------------------------------------------- CLI */

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

async function main() {
  const root = projectRoot();
  const argv = process.argv.slice(2);
  const cmd = argv.find((a) => a.startsWith('--'));

  try {
    switch (cmd) {
      case '--validate': {
        const errors = validateAll(root);
        // A missing seal is a FAILURE, not an implicit ok - see verify.mjs.
        const integrity = verifyIntegrity(root);
        if (!integrity.ok) errors.push(integrity.reason);
        if (errors.length) {
          console.error(`state validation FAILED (${errors.length}):`);
          for (const e of errors) console.error('  - ' + e);
          process.exit(2);
        }
        console.log('state valid; control plane seal intact');
        return;
      }
      case '--reseal': {
        const d = seal(root);
        console.log(`resealed ${d.files.length} control file(s): ${d.control_hash.slice(0, 12)}...`);
        return;
      }
      case '--verify-integrity': {
        const r = verifyIntegrity(root);
        if (!r.ok) die(r.reason, 2);
        console.log('control plane seal intact');
        return;
      }
      case '--set-phase': {
        const phase = arg('--set-phase');
        if (phase === true || !phase) die(`usage: --set-phase <${PHASES.join('|')}>`);
        const moved = setPhase(root, phase);
        console.log(`phase = ${phase}` + (moved.task ? ` (task ${moved.task} moved with it)` : ''));
        return;
      }
      /* ---- the task lifecycle verbs --------------------------------------
       *
       * ATTEMPTS AND STATUS WERE MODELLED AND NEVER MOVED. `incrementAttempt`
       * and `blockTask` were exported and called from nowhere in the plugin, so
       * `status` never left `pending`, `owner_agent` was always null, and
       * `attempts` was always 0 - on a live project with 24 verdicts on disk.
       * A retry ceiling that no code can reach is not a ceiling; it is a comment
       * with a number in it, and it is the same shape as a probe that cannot
       * fail. The verbs below are the only writers, so the counter that governs
       * the loop is moved by the thing that runs the loop.
       *
       * All three are PRIVILEGED by caller in risk-guard.mjs: the control plane
       * is not writable by the agent it governs, and that does not change because
       * the writes are now routine.
       */
      case '--attempt': {
        const id = arg('--attempt');
        const agent = arg('--agent');
        if (id === true || !id) die('usage: --attempt <task-id> [--agent <agent-name>]');
        // Throws at the ceiling, with the three moves named. That refusal IS the
        // loop guard: it is the only thing standing between a failing task and an
        // unbounded rework cycle, so it must come from the writer rather than
        // from a caller remembering to look.
        const n = incrementAttempt(root, id);
        if (typeof agent === 'string') updateControlTask(root, id, { owner_agent: agent });
        // Both counters are printed when they disagree, because a disagreement is
        // the record of a reset and the reader is about to see a verdict numbered
        // from the second one.
        const same = n.attempts === n.attempts_total;
        console.log(`task ${id}: attempt ${n.attempts} of ${readControlTask(root, id).max_attempts}`
          + (same ? '' : ` (try ${n.attempts_total} overall - the ceiling was reset; the verdict is`
            + ` numbered ${String(n.attempts_total).padStart(2, '0')})`)
          + (typeof agent === 'string' ? `, owner ${agent}` : ''));
        return;
      }
      case '--task-status': {
        const id = arg('--task-status');
        const status = arg('--status');
        if (id === true || !id || typeof status !== 'string') {
          die(`usage: --task-status <task-id> --status <${TASK_STATUS.join('|')}>`);
        }
        if (!TASK_STATUS.includes(status)) {
          die(`unknown status "${status}". The enum is closed: ${TASK_STATUS.join(', ')}.`);
        }
        // The invariant lives in assertSoleInProgress, shared with incrementAttempt.
        if (status === 'in_progress') assertSoleInProgress(root, id);
        // A terminal status also releases the active-task pointer. `pending` and
        // `in_progress` are not terminal, so they leave it alone.
        if (status === 'done' || status === 'failed' || status === 'blocked') closeTask(root, id, status);
        else updateControlTask(root, id, { status });
        console.log(`task ${id}: status = ${status}`);
        return;
      }
      case '--block': {
        const id = arg('--block');
        const reason = arg('--reason');
        if (id === true || !id || typeof reason !== 'string' || !reason.trim()) {
          die('usage: --block <task-id> --reason "<blocked_by>"\n'
            + 'A terminal state with no reason is a future mystery: the next reader has the '
            + 'status and no way to know what to change.');
        }
        blockTask(root, id, reason);
        console.log(`task ${id}: blocked (${reason}); phase = plan`);
        return;
      }
      case '--approve-spec': {
        const id = arg('--approve-spec');
        if (id === true || !id) die('usage: --approve-spec <task-id>');
        const r = approveSpec(root, id);
        console.log(`task ${id}: spec approved - ${r.spec} @ ${r.hash.slice(0, 12)}`);
        console.log('This records YOUR decision. --advance-phase executes it and cannot make it, '
          + 'and it refuses again if the spec changes.');
        return;
      }
      case '--restore-spec': {
        const id = arg('--restore-spec');
        if (id === true || !id) die('usage: --restore-spec <task-id>');
        const r = restoreSpec(root, id);
        console.log(`task ${id}: ${r.changed ? 'restored' : 'already at'} the approved bytes - `
          + `${r.spec} @ ${r.sha.slice(0, 12)} (from ${r.from})`);
        console.log('The written file was re-read and re-hashed. This is not "I wrote it"; it is '
          + 'the document on disk hashing to what the operator approved.');
        return;
      }
      case '--advance-phase': {
        const id = arg('--advance-phase');
        const from = arg('--from');
        const to = arg('--to');
        if (id === true || !id || typeof from !== 'string' || typeof to !== 'string') {
          die('usage: --advance-phase <task-id> --from <phase> --to <phase>\n'
            + `phases: ${PHASES.join(', ')}; legal steps: `
            + Object.entries(PHASE_STEPS).map(([f, l]) => `${f}->${l.join('|') || '(terminal)'}`).join(' '));
        }
        const r = advancePhase(root, id, from, to);
        console.log(`task ${id}: ${r.from} -> ${r.to}`
          + (r.task ? ` (task ${r.task} moved with the project)` : ''));
        return;
      }
      case '--reset-attempts': {
        const id = arg('--reset-attempts');
        if (id === true || !id) die('usage: --reset-attempts <task-id>');
        // THE IDENTITY COUNTER IS NOT RESET. Zeroing it would make the next
        // verdict collide with a historical one, and recording it would destroy
        // the evidence of the very failures the operator is resetting past.
        const before = readControlTask(root, id);
        updateControlTask(root, id, { attempts: 0, status: 'pending', blocked_by: null });
        console.log(`task ${id}: attempts reset to 0 of ${before.max_attempts}. `
          + `${attemptsTotal(before)} previous attempt(s) and their verdicts are kept - the next `
          + `verdict is numbered ${String(attemptsTotal(before) + 1).padStart(2, '0')}, not 01.`);
        return;
      }
      case '--waive': {
        const check_id = arg('--waive');
        const filePath = arg('--path');
        const reason = arg('--reason');
        const days = arg('--days', WAIVER_DEFAULT_DAYS);
        if (check_id === true || !check_id) {
          die('usage: --waive <check_id> --path <file> --reason "..." [--days N]');
        }
        // Resolve the rule so a typo cannot create a waiver that silently does
        // nothing, and so a critical check is refused HERE rather than being
        // written and then ignored by the classifier.
        const { ruleById, RULES } = await import('./rules/index.mjs');
        const rule = ruleById(check_id);
        if (!rule) {
          die(`unknown check "${check_id}". A waiver for a check that does not exist would do nothing.\n`
            + `Known checks:\n  ${RULES.map((r) => r.id).join('\n  ')}`);
        }
        addWaiver(root, { check_id, filePath, reason, days, severity: rule.severity });
        console.log(`waived ${check_id} at ${filePath} until ${addDaysIso(Number(days))}`);
        return;
      }
      case '--record-corpus': {
        // Refusal 1, enforced at the CLI as well as in the writer. A flag that is
        // silently IGNORED is worse than one that is refused: the operator would
        // read the record afterwards and see the version they asked for, because it
        // happened to match, and never learn the flag did nothing.
        const asserted = ['--result', '--recorded-for', '--version', '--plugin-version', '--pass',
          '--library-fingerprint', '--fingerprint']
          .filter((f) => argv.includes(f));
        if (asserted.length) {
          die(`--record-corpus does not accept ${asserted.join(', ')}. The result, the plugin `
            + 'version and the library fingerprint are COMPUTED here, never supplied: the version is '
            + "stamped from the running plugin, the result comes from running corpus-score.mjs over "
            + "each case's record, and the fingerprint is hashed from the case library and its "
            + 'expectations on disk. A writer that accepted any of the three would put the model back '
            + 'in the chair corpus-score.mjs was written to take it out of - and a supplied '
            + 'fingerprint is the worst of them, because it would let a result name a library it '
            + 'never ran against.');
        }

        const runs = [];
        for (let i = 0; i < argv.length; i += 1) {
          if (argv[i] !== '--run') continue;
          const pair = argv[i + 1];
          if (!pair || pair.startsWith('--') || !pair.includes('=')) {
            die('usage: --record-corpus --run <case-id>=<worklist-id> [--run <case-id>=<worklist-id> ...]');
          }
          const eq = pair.indexOf('=');
          runs.push({ caseId: pair.slice(0, eq), worklistId: pair.slice(eq + 1) });
        }
        if (!runs.length) {
          die('usage: --record-corpus --run <case-id>=<worklist-id> [--run ...]. '
            + 'One --run per case in the corpus library. Every case must be scored in one '
            + 'invocation; a subset is refused.');
        }

        const rec = await recordCorpus(root, runs);
        console.log(`corpus result recorded for plugin ${rec.recorded_for}: ${rec.result.toUpperCase()} `
          + `(${rec.cases_total} case(s))`);
        for (const c of rec.cases) {
          console.log(`  ${c.ok ? 'pass' : 'FAIL'}  ${c.case_id}  ${c.worklist_id}`);
          for (const f of c.failures) console.log(`          ${f}`);
        }
        console.log(`  library ${rec.library_fingerprint}`);
        console.log(`  -> ${PATHS.guardianCorpus}`);
        return;
      }
      case '--migrate-manifest': {
        const r = migrateManifest(root);
        if (!r.changed) { console.log(`manifest already at schema_version ${r.to}`); return; }
        console.log(`manifest migrated: schema_version ${r.from} -> ${r.to}`);
        for (const n of r.notes) console.log(`  ${n}`);
        return;
      }
      case '--init': {
        const manifestPath = arg('--init');
        const src = manifestPath === true || !manifestPath ? PATHS.manifest : manifestPath;
        const p = abs(root, src);
        if (!exists(p)) die(`manifest not found: ${src}`);
        const s = init(root, readJson(p));
        console.log(`initialised ${s.project_id}: phase=${s.phase}, control plane sealed`);
        return;
      }
      case '--baseline-init': {
        // The one moment baseline entries may be created. Runs at /mavci-core:connect.
        const { runChecks } = await import('./verify.mjs');
        const { findings } = await runChecks(root, { scope: 'full' });
        const doc = baselineInit(root, findings);
        setState(root, { baseline_debt: doc.entries.length });
        console.log(`baseline created with ${doc.entries.length} pre-existing violation(s)`);
        const byCheck = new Map();
        for (const e of doc.entries) byCheck.set(e.check_id, (byCheck.get(e.check_id) ?? 0) + 1);
        for (const [id, n] of [...byCheck].sort()) console.log(`  ${id}: ${n}`);
        return;
      }
      case '--baseline-prune': {
        const { runChecks } = await import('./verify.mjs');
        const { findings } = await runChecks(root, { scope: 'full' });
        const { removed, remaining } = baselinePrune(root, findings);
        console.log(`baseline: removed ${removed.length}, ${remaining} remaining`);
        for (const r of removed) console.log(`  retired ${r.check_id} at ${r.path}`);
        return;
      }
      case '--new-task': {
        const title = arg('--new-task');
        if (title === true || !title) die('usage: --new-task "<title>" [--spec <path>]');
        const id = createTask(root, { title, spec: arg('--spec', `${PATHS.tasks}/pending.md`) });
        console.log(id);
        return;
      }
      case '--begin-plan': {
        const title = arg('--begin-plan');
        if (title === true || !title) die('usage: --begin-plan "<title>" [--spec <path>]');
        const id = beginPlan(root, { title, spec: arg('--spec', `${PATHS.tasks}/pending.md`) });
        console.log(`phase = plan, active_task = ${id}`);
        return;
      }
      case '--show': {
        const ctx = loadContext(root);
        console.log(canonicalJson({
          connected: isConnected(root),
          phase: ctx.state?.phase ?? null,
          // Without this a seeded project, a project whose transition halted
          // half-way, and a project with a task in hand all read identically -
          // which is why the gate4c halt was visible only in the transcript.
          active_task: ctx.state?.active_task ?? null,
          baseline_debt: ctx.baseline?.entries.length ?? 0,
          waivers: ctx.waivers?.waivers.length ?? 0,
          plugin_version: ctx.pluginVersion,
          ci_pinned_plugin_version: ciPin(ctx.state),
          written_by_plugin_version: ctx.state?.written_by_plugin_version ?? null,
          integrity: exists(abs(root, PATHS.integrity)) ? verifyIntegrity(root) : { ok: false, reason: 'not sealed' },
        }));
        return;
      }
      default:
        die([
          'usage: state.mjs <command>',
          '  --migrate-manifest             upgrade .mavci/project.json to the current schema (operator)',
          '  --record-corpus --run <case>=<worklist-id> ...   score every corpus case and record the result (operator)',
          '  --init [manifest-path]         create the control plane for a validated manifest',
          '  --baseline-init                record every current violation as pre-existing (connect only)',
          '  --validate                     schema-check every state file and the seal',
          '  --reseal                       recompute the control hash after a deliberate manual edit',
          '  --verify-integrity             check the seal only',
          '  --set-phase <phase>            plan | build | verify | release',
          '  --reset-attempts <task-id>     clear the retry ceiling after you changed something',
          '  --waive <check_id> --path <f> --reason "..." [--days N]',
          '  --baseline-prune               retire baseline entries that now pass',
          '  --new-task "<title>"           allocate an id and create both task halves',
          '  --begin-plan "<title>"         enter the plan phase AND allocate the task, as one write',
          '  --show                         one-line status as JSON',
        ].join('\n'), 2);
    }
  } catch (err) {
    die(`state.mjs: ${err.message}`, 1);
  }
}

// basename, not endsWith: a file named check-<this>.mjs ends with this
// script's name, so the endsWith form ran the CLI the moment a self-test
// imported the module. It cost one debugging session on check-retro.mjs.
if (process.argv[1] && path.basename(process.argv[1]) === 'state.mjs') main();

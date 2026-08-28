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
  PHASES, RISK_TIERS, UNSUPPRESSIBLE_SEVERITIES,
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
const SCHEMA_DIR = path.resolve(PLUGIN_ROOT, '../../templates/schemas');

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
  if (!s) throw new Error(`${PATHS.state} not found. This project is not connected - run /mavci:connect or /mavci:new-project.`);
  return s;
}

export function setState(root, patch) {
  const next = { ...readState(root), ...patch, updated: nowIso() };
  return writeControl(root, PATHS.state, next, 'state');
}

export function setPhase(root, phase) {
  if (!PHASES.includes(phase)) throw new Error(`unknown phase "${phase}". One of: ${PHASES.join(', ')}`);
  return setState(root, { phase });
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

export function createTask(root, { title, spec, owner_agent = null, max_attempts = 3 }) {
  const s = readState(root);
  const id = allocateTaskId(root);
  const now = nowIso();
  writeControl(root, controlTaskPath(id), {
    schema_version: 1, id, project_id: s.project_id,
    phase: 'plan', status: 'pending', attempts: 0, max_attempts,
    owner_agent, blocked_by: null, verdicts: [], created: now, updated: now,
  }, 'control-task');
  writeSurface(root, surfaceTaskPath(id), {
    schema_version: 1, id, project_id: s.project_id,
    title, spec, artifacts: [], notes: [],
  }, 'task');
  return id;
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
      + 'It cannot be retried. Use /mavci:retro, /mavci:waive if the check is wrong, '
      + 'or state.mjs --reset-attempts after changing something.');
  }
  const attempts = t.attempts + 1;
  updateControlTask(root, id, { attempts, status: 'in_progress' });
  return attempts;
}

export function blockTask(root, id, blocked_by) {
  updateControlTask(root, id, { status: 'blocked', phase: 'plan', blocked_by });
  setPhase(root, 'plan');
}

/* -------------------------------------------------------------- verdicts */

export function recordVerdict(root, verdict) {
  const id = verdict.task_id;
  const attempt = verdict.attempt;
  const name = id
    ? `${id}-attempt-${String(attempt ?? 1).padStart(2, '0')}.json`
    : `adhoc-${Date.now()}.json`;
  const rel = `${PATHS.verdicts}/${name}`;
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
      + 'A committed secret is not acceptable technical debt. Remove it, rotate the key, '
      + 'then run /mavci:connect again.');
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
 * B3. Granted only via /mavci:waive, which sets disable-model-invocation:true,
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
    plugin_version: pluginVersion(),
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

  for (const dir of [PATHS.controlTasks, PATHS.verdicts, PATHS.tasks]) {
    const d = abs(root, dir);
    if (!exists(d)) continue;
    const schemaName = dir === PATHS.controlTasks ? 'control-task' : dir === PATHS.verdicts ? 'verdict' : 'task';
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
        setPhase(root, phase);
        console.log(`phase = ${phase}`);
        return;
      }
      case '--reset-attempts': {
        const id = arg('--reset-attempts');
        if (id === true || !id) die('usage: --reset-attempts <task-id>');
        updateControlTask(root, id, { attempts: 0, status: 'pending', blocked_by: null });
        console.log(`task ${id}: attempts reset to 0`);
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
        // The one moment baseline entries may be created. Runs at /mavci:connect.
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
      case '--show': {
        const ctx = loadContext(root);
        console.log(canonicalJson({
          connected: isConnected(root),
          phase: ctx.state?.phase ?? null,
          baseline_debt: ctx.baseline?.entries.length ?? 0,
          waivers: ctx.waivers?.waivers.length ?? 0,
          plugin_version: ctx.pluginVersion,
          state_plugin_version: ctx.state?.plugin_version ?? null,
          integrity: exists(abs(root, PATHS.integrity)) ? verifyIntegrity(root) : { ok: false, reason: 'not sealed' },
        }));
        return;
      }
      default:
        die([
          'usage: state.mjs <command>',
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
          '  --show                         one-line status as JSON',
        ].join('\n'), 2);
    }
  } catch (err) {
    die(`state.mjs: ${err.message}`, 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('state.mjs')) main();

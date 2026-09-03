#!/usr/bin/env node
/**
 * Mavci Core - the standards checker. ARCHITECTURE 6.2.
 *
 * Runs the rule set, then applies the two suppression layers in order:
 *   baseline  - pre-existing violations recorded at connect (B2)
 *   waivers   - operator-granted, time-boxed exceptions (B3)
 * `critical` findings pass through both untouched; they are never suppressible.
 *
 * This module never decides whether to block. It reports. gate.mjs decides,
 * because gate.mjs is the piece that has to fail closed.
 *
 * CLI:
 *   node verify.mjs                    full scan, verdict JSON on stdout
 *   node verify.mjs --changed          scope to files git reports as modified
 *   node verify.mjs --advisory         human summary, never exits non-zero
 *   node verify.mjs --ci               full scan, GitHub annotations, exit 2 on blockers
 *   node verify.mjs --record --task ID attribute the verdict to a task attempt
 *
 * ATTRIBUTION. `recordVerdict` has always named a verdict `<id>-attempt-NN.json`
 * and appended it to the control task's `verdicts[]` - when given a `task_id`.
 * Nothing ever gave it one: `evaluate` and `buildVerdict` accepted `task_id` and
 * `attempt`, defaulted both to null, and no caller passed either. So every verdict
 * ever written by this system is `adhoc-<epoch>.json` and every control task's
 * `verdicts[]` is empty - 24 of them on the first real project. The audit trail
 * ARCHITECTURE 4.3 calls write-once and never deleted was being written, correctly,
 * about nothing in particular.
 *
 * `--task` supplies the id. It does NOT supply the attempt number: that is read
 * from `.mavci/control/tasks/<id>.json`, which is where the ceiling that governs
 * the loop already lives. A flag would be a second writer for one fact, and the
 * two would disagree on exactly the run where it mattered.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  PATHS, BLOCKING_SEVERITIES, UNSUPPRESSIBLE_SEVERITIES, DEFAULT_EXCLUDE_DIRS,
  EVIDENCE_MAX_CHARS, REMEDY_MAX_CHARS, CLAMP_MARKER,
} from './config.mjs';
import {
  abs, exists, readTextOrNull, readJsonOrNull, walk, nowIso, canonicalJson, matchesAny, toPosix,
} from './lib/fsx.mjs';
import { rulesFor, ruleById } from './rules/index.mjs';
import {
  loadContext, validateAll, verifyIntegrity, recordVerdict, readControlTask,
  isBaselined, activeWaiver, pluginVersion, projectRoot,
} from './state.mjs';

/* ------------------------------------------------------------ file list */

function gitChangedFiles(root) {
  try {
    const out = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    return out.split('\n')
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .map((p) => toPosix(p.includes(' -> ') ? p.split(' -> ')[1] : p));
  } catch {
    return null; // not a git repo, or git unavailable: caller falls back to a full scan
  }
}

function collectFiles(root, { scope, manifest }) {
  const exclude = manifest?.checks?.exclude_paths ?? [];
  const all = [...walk(root, { excludeDirs: DEFAULT_EXCLUDE_DIRS })];
  const filtered = exclude.length ? all.filter((p) => !matchesAny(p, exclude)) : all;

  if (scope !== 'changed') return { files: filtered, scope: 'full' };

  const changed = gitChangedFiles(root);
  if (!changed) return { files: filtered, scope: 'full' };
  const set = new Set(changed);
  const narrowed = filtered.filter((p) => set.has(p));
  // Whole-repo rules (secrets, RLS across migrations, legal pages) are meaningless
  // on a partial list, so a changed-scope run still passes the full list to them.
  return { files: narrowed, allFiles: filtered, scope: 'changed' };
}

/* -------------------------------------------------------------- running */

/** Rules that must always see the whole repository to mean anything. */
const WHOLE_REPO_RULES = new Set([
  'secrets.no_committed_secrets',
  'supabase.rls_enabled',
  'legal.pages_present',
  'legal.kvkk_structure',
  'state.schema_valid',
]);

/**
 * @returns {{findings: Array, ruleErrors: Array, ran: string[]}}
 * A rule that throws produces an `error` finding at blocker severity rather than
 * disappearing. A checker that quietly skips a rule is worse than one that fails.
 */
export async function runChecks(root = projectRoot(), { scope = 'full' } = {}) {
  const ctx0 = loadContext(root);
  const { files, allFiles, scope: actualScope } = collectFiles(root, { scope, manifest: ctx0.manifest });

  const cache = new Map();
  const makeCtx = (fileList) => ({
    root,
    manifest: ctx0.manifest,
    files: fileList,
    redactor: ctx0.redactor,
    /**
     * The propagation window, as two facts a rule can act on (finding 24).
     *
     * Propagation replaces the plugin ON DISK. A session already running keeps the
     * hooks it registered at SessionStart, so for the rest of that session every
     * hook is one version behind the writers the operator invokes by path - and
     * the procedure tells the operator to propagate mid-session, with nothing
     * saying the session must restart before the new format is written. It is not
     * a race: the window lasts until the next session start, which is exactly when
     * the work following a propagation happens.
     *
     * Both facts were already on disk and no rule looked at them. doctor computes
     * this same comparison one report away.
     */
    versions: {
      onDisk: pluginVersion(),
      hooksRegistered: readJsonOrNull(abs(root, PATHS.hookRun))?.plugin_version ?? null,
    },
    readOrNull(rel) {
      if (cache.has(rel)) return cache.get(rel);
      const t = readTextOrNull(abs(root, rel));
      cache.set(rel, t);
      return t;
    },
    /**
     * FINDING 24. A seal failure and a schema failure are different problems with
     * different fixes, and the rule that reports them used to print one remedy for
     * both: "it needs state.mjs --reseal". Resealing recomputes a hash. It does
     * nothing whatever to schema validity, so against a schema rejection that
     * remedy names an operator-only action that would not clear the block if the
     * operator took it - costing them an action and teaching them the message is
     * unreliable. The KIND travels with the error so the remedy can fit it.
     */
    validateState() {
      const errs = validateAll(root).map((message) => ({ message, kind: 'schema' }));
      // NO exists() guard on the seal. A MISSING integrity.json is the strongest
      // tamper signal there is - deleting one file used to disable tamper
      // detection entirely and report a clean pass, because validateAll also
      // skips files that are not there. verifyIntegrity already reports an
      // absent seal as "never sealed", so let it speak.
      // Only an unconnected directory is exempt: there is nothing to seal yet.
      if (exists(abs(root, PATHS.manifest))) {
        const r = verifyIntegrity(root);
        if (!r.ok) errs.push({ message: r.reason, path: PATHS.integrity, kind: 'seal' });
      }
      return errs;
    },
  });

  const narrowCtx = makeCtx(files);
  const wideCtx = makeCtx(allFiles ?? files);

  const findings = [];
  const ruleErrors = [];
  const ran = [];

  for (const rule of rulesFor(ctx0.manifest)) {
    const useWide = actualScope === 'changed' && WHOLE_REPO_RULES.has(rule.id);
    try {
      const res = rule.run(useWide ? wideCtx : narrowCtx) ?? [];
      findings.push(...res);
      ran.push(rule.id);
    } catch (err) {
      // Fail closed at the rule level too: an exception is a blocker, not a skip.
      ruleErrors.push({ check_id: rule.id, message: err.message });
      findings.push({
        check_id: rule.id, severity: 'blocker', path: null, line: null,
        evidence: `check crashed: ${err.message}`,
        remedy: 'This is a bug in the checker, not in your code. Run /mavci-core:retro to file it, '
          + 'or /mavci-core:waive if you need to proceed now.',
        errored: true,
      });
    }
  }

  return { findings, ruleErrors, ran, scope: actualScope };
}

/* ---------------------------------------------------------- suppression */

/**
 * Cut a finding string to the schema's cap, visibly.
 *
 * Gate 4c, finding 2. The cap used to fire at `writeControl`, as a THROW, after
 * the run: one 583-character evidence string made `verify.mjs --record` fail on
 * every turn in a project, which is the only mode the gate uses. The checker was
 * offline and the reason was one verbose rule.
 *
 * Truncating here is not a workaround for the static check - the two cover
 * different halves. `check-evidence-caps.mjs` holds the rule set's TEMPLATES
 * under the cap at authoring time, in CI, which is where a fix is cheap. But
 * templates interpolate live project data, so no static check can bound the
 * result; this is the backstop for the string that only exists at runtime.
 *
 * Marked, never silent. A string that stops mid-sentence with no sign it was cut
 * is finding 1 in a different costume - the message arrives, and the reader has
 * no way to know something was removed.
 */
function clamp(text, max) {
  if (typeof text !== 'string' || text.length <= max) return text ?? null;
  return text.slice(0, max - CLAMP_MARKER.length) + CLAMP_MARKER;
}

/**
 * Apply baseline then waivers. Order matters only for reporting: a finding that
 * is both baselined and waived reports as baselined, because that is the older
 * and less deliberate of the two.
 */
export function classify(findings, { baseline, waivers }) {
  const checks = [];
  for (const f of findings) {
    const suppressible = !UNSUPPRESSIBLE_SEVERITIES.has(f.severity);
    let status = 'fail';

    // `not_checked` is decided BEFORE suppression, and is never suppressible.
    // A baseline or waiver retires a VIOLATION; there is no violation here, only an
    // absence of evidence. Letting it be baselined would file "we never looked" as
    // accepted debt, and letting it be waived would put an expiry on a fact.
    if (f.not_checked) status = 'not_checked';
    else if (f.errored) status = 'error';
    else if (suppressible && isBaselined(baseline, f.check_id, f.path)) status = 'baselined';
    else if (suppressible && activeWaiver(waivers, f.check_id, f.path)) status = 'waived';

    checks.push({
      check_id: f.check_id,
      status,
      severity: f.severity,
      path: f.path ?? null,
      line: f.line ?? null,
      // Clamped HERE rather than at writeControl, so the human report, the CI
      // annotation and the recorded verdict all show the same string. Clamping
      // only on the way to disk would let `verify.mjs` and `verify.mjs --record`
      // disagree about what the checker found, which is the divergence that made
      // gate4c so hard to read.
      evidence: clamp(f.evidence ?? null, EVIDENCE_MAX_CHARS),
      remedy: clamp(f.remedy ?? null, REMEDY_MAX_CHARS),
    });
  }
  return checks;
}

export function summarise(checks, ranIds) {
  const failedIds = new Set(checks.filter((c) => c.status !== 'pass').map((c) => c.check_id));
  const passing = ranIds.filter((id) => !failedIds.has(id));

  const counts = { pass: passing.length, fail: 0, waived: 0, baselined: 0, error: 0, not_checked: 0, blockers: 0 };
  for (const c of checks) {
    if (c.status === 'fail') counts.fail++;
    else if (c.status === 'waived') counts.waived++;
    else if (c.status === 'baselined') counts.baselined++;
    else if (c.status === 'error') counts.error++;
    // Counted, reported, and NOT added to `pass`. `failedIds` above already excludes
    // it from `passing`, which is the property that matters: a rule that examined
    // nothing cannot inflate a clean run.
    else if (c.status === 'not_checked') counts.not_checked++;
    if ((c.status === 'fail' || c.status === 'error') && BLOCKING_SEVERITIES.has(c.severity)) counts.blockers++;
  }
  return { counts, passingIds: passing };
}

export function buildVerdict(root, { checks, summary, scope, task_id = null, attempt = null }) {
  const ctx = loadContext(root);
  return {
    schema_version: 1,
    project_id: ctx.state?.project_id ?? ctx.manifest?.project_id ?? 'unknown',
    task_id,
    attempt,
    run_at: nowIso(),
    verdict: summary.blockers > 0 ? 'fail' : 'pass',
    plugin_version: pluginVersion(),
    scope,
    checks: checks.filter((c) => c.status !== 'pass'), // passing checks are the default; recording them is noise
    summary,
  };
}

/**
 * One call: run, classify, summarise, build. Everything else is presentation.
 */
export async function evaluate(root = projectRoot(), { scope = 'full', task_id = null, attempt = null } = {}) {
  const ctx = loadContext(root);
  const { findings, ran, scope: actualScope, ruleErrors } = await runChecks(root, { scope });
  const checks = classify(findings, { baseline: ctx.baseline, waivers: ctx.waivers });
  const { counts } = summarise(checks, ran);
  const verdict = buildVerdict(root, { checks, summary: counts, scope: actualScope, task_id, attempt });
  return { verdict, checks, findings, ran, ruleErrors, ctx };
}

/* ------------------------------------------------------------ reporting */

export function formatHuman(verdict) {
  const s = verdict.summary;
  const lines = [];
  const reported = verdict.checks.filter((c) => c.status === 'fail' || c.status === 'error');

  // Label by SEVERITY, not by status. A `warning` printed as FAIL trains the
  // reader to ignore the word, which is how a real blocker gets scrolled past.
  const label = (c) => {
    if (!BLOCKING_SEVERITIES.has(c.severity)) return 'warn';
    return c.severity === 'critical' ? 'CRITICAL' : 'FAIL';
  };

  // Blocking first: the thing that stops the turn should not be below advice.
  const ordered = [...reported].sort(
    (a, b) => Number(BLOCKING_SEVERITIES.has(b.severity)) - Number(BLOCKING_SEVERITIES.has(a.severity)),
  );

  for (const c of ordered) {
    const loc = c.path ? `${c.path}${c.line ? `:${c.line}` : ''}` : '(repo)';
    lines.push(`  ${label(c).padEnd(8)}  ${c.check_id}  ${loc}`);
    if (c.evidence) lines.push(`        ${c.evidence}`);
    if (c.remedy) lines.push(`        fix: ${c.remedy}`);
  }

  const warns = reported.filter((c) => !BLOCKING_SEVERITIES.has(c.severity)).length;
  const tail = `${s.pass} passing, ${s.blockers} blocking, ${warns} warning(s), ${s.baselined} baselined, ${s.waived} waived`
    + (s.error ? `, ${s.error} checker error(s)` : '');
  lines.push(`  ${tail}`);
  return lines.join('\n');
}

/** GitHub Actions annotations - clickable in the PR diff. */
export function formatGithub(verdict) {
  const out = [];
  for (const c of verdict.checks) {
    if (c.status !== 'fail' && c.status !== 'error') continue;
    const level = c.severity === 'critical' ? 'error' : 'error';
    const file = c.path ? `file=${c.path},` : '';
    const line = c.line ? `line=${c.line},` : '';
    const msg = `${c.check_id}: ${c.evidence ?? ''}${c.remedy ? ` -- ${c.remedy}` : ''}`.replace(/\n/g, ' ');
    out.push(`::${level} ${file}${line}title=mavci ${c.check_id}::${msg}`);
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ CLI */

async function main() {
  const argv = process.argv.slice(2);
  const root = projectRoot();
  const advisory = argv.includes('--advisory');
  const ci = argv.includes('--ci');
  const scope = argv.includes('--changed') ? 'changed' : 'full';
  const format = (argv.find((a) => a.startsWith('--format=')) ?? '').split('=')[1] ?? (ci ? 'github' : 'json');
  const record = argv.includes('--record');

  /* ---- attribution -------------------------------------------------------
   * A run asked to attribute and unable to MUST refuse. Falling back to an
   * adhoc verdict would produce a file that looks exactly like a successful
   * attribution to every reader downstream, which is the fail-quiet shape this
   * repository has found eleven times.
   */
  const taskIx = argv.indexOf('--task');
  const task_id = taskIx === -1 ? null : (argv[taskIx + 1] ?? '');
  let attempt = null;
  if (taskIx !== -1) {
    if (!/^[0-9]{4}$/.test(task_id)) {
      console.error(`--task expects a four-digit task id; got ${JSON.stringify(task_id)}.`);
      process.exit(2);
    }
    let control;
    try {
      control = readControlTask(root, task_id);
    } catch {
      console.error(`--task ${task_id}: no control record at ${PATHS.controlTasks}/${task_id}.json. `
        + 'Refusing to write an unattributed verdict under an attribution flag: a verdict that '
        + 'silently lost its task is indistinguishable from one that never had one.');
      process.exit(2);
    }
    // The attempt this verdict is ABOUT is the one already recorded. A task at
    // attempts:0 has had no build, so there is no attempt for a verdict to name.
    if (!control.attempts) {
      console.error(`--task ${task_id}: attempts is 0, so no attempt has been made and there is `
        + 'nothing for a verdict to be about. Run `state.mjs --attempt ' + task_id + '` before building.');
      process.exit(2);
    }
    attempt = control.attempts;
  }

  if (!exists(abs(root, PATHS.manifest))) {
    if (advisory) return;                       // not a mavci project: stay silent
    console.error('not a Mavci project: .mavci/project.json not found. Run /mavci-core:connect first.');
    process.exit(ci ? 1 : 0);
  }

  const { verdict } = await evaluate(root, { scope, task_id, attempt });

  if (advisory) {
    // PostToolUse: informational only, must never exit non-zero and never block.
    if (verdict.summary.blockers > 0) {
      console.log(`mavci: ${verdict.summary.blockers} blocking violation(s) so far\n${formatHuman(verdict)}`);
    }
    return;
  }

  if (record) recordVerdict(root, verdict);

  if (format === 'github') {
    const ann = formatGithub(verdict);
    if (ann) console.log(ann);
    console.log(formatHuman(verdict));
  } else if (format === 'human') {
    console.log(formatHuman(verdict));
  } else {
    console.log(canonicalJson(verdict));
  }

  process.exit(verdict.summary.blockers > 0 ? 2 : 0);
}

// basename, not endsWith: a file named check-<this>.mjs ends with this
// script's name, so the endsWith form ran the CLI the moment a self-test
// imported the module. It cost one debugging session on check-retro.mjs.
if (process.argv[1] && path.basename(process.argv[1]) === 'verify.mjs') {
  main().catch((err) => {
    // The runner itself failed. Exit 2 so CI fails; gate.mjs turns this into a block.
    console.error(`verify.mjs crashed: ${err.stack ?? err.message}`);
    process.exit(2);
  });
}

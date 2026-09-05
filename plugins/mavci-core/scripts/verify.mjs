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

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  PATHS, BLOCKING_SEVERITIES, UNSUPPRESSIBLE_SEVERITIES, DEFAULT_EXCLUDE_DIRS,
  EVIDENCE_MAX_CHARS, REMEDY_MAX_CHARS, CLAMP_MARKER, CRITERION_NEEDS,
} from './config.mjs';
import {
  abs, exists, readTextOrNull, readJsonOrNull, walk, nowIso, canonicalJson, matchesAny, toPosix,
} from './lib/fsx.mjs';
import { rulesFor, ruleById } from './rules/index.mjs';
import { verdictOutcome, approvalCurrent } from './lib/route.mjs';
import { resolveBash, preflight, describeBash } from './lib/shell.mjs';
import { parseCriteriaBlock, runCriteria, isShellOnly, CRITERIA_FENCE } from './lib/criteria.mjs';
import {
  loadContext, validateAll, verifyIntegrity, recordVerdict, readControlTask, attemptsTotal,
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

export function buildVerdict(root, { checks, summary, scope, task_id = null, attempt = null,
  criteria = null }) {
  const ctx = loadContext(root);
  const doc = {
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
  /* ONE DERIVATION, NOT TWO. The router decides pass/fail/incomplete from a
   * verdict; a writer computing it independently is two answers to one question
   * and they diverge the moment either is edited. So the writer asks the same
   * function the reader asks, which is why it is imported rather than copied.
   *
   * With no criteria supplied the FIELD IS ABSENT, not empty. An empty array
   * would assert that the criteria were examined and there were none; absence
   * says the run did not answer, which is what a standards-only run did. */
  if (Array.isArray(criteria)) {
    doc.criteria = criteria;
    doc.verdict = verdictOutcome(doc);
  }
  return doc;
}

/**
 * One call: run, classify, summarise, build. Everything else is presentation.
 */
export async function evaluate(root = projectRoot(), { scope = 'full', task_id = null, attempt = null,
  criteria = null } = {}) {
  const ctx = loadContext(root);
  const { findings, ran, scope: actualScope, ruleErrors } = await runChecks(root, { scope });
  const checks = classify(findings, { baseline: ctx.baseline, waivers: ctx.waivers });
  const { counts } = summarise(checks, ran);
  const verdict = buildVerdict(root, { checks, summary: counts, scope: actualScope, task_id, attempt, criteria });
  return { verdict, checks, findings, ran, ruleErrors, ctx };
}

/* -------------------------------------------------- the acceptance criteria */

/**
 * Decide what `criteria[]` this run may record, and - when asked to execute -
 * produce it by running the approved spec's own commands.
 *
 * SEPARATED FROM THE CLI SO IT CAN BE ASSERTED. 0.1.26 found finding 25 sitting
 * for three releases inside `release-check.mjs`'s `main()`, where no test could
 * reach it, and 0.1.29 had to extract `cutTag` for the same reason. The exit is
 * the caller's; the decision is here.
 */
export async function resolveCriteria(root, { id, argv = [], execute, supplied = null }) {
  if (!/^[0-9]{4}$/.test(id ?? '')) {
    return { ok: false, error: '--run-criteria expects a four-digit task id.' };
  }

  let control;
  try {
    control = readControlTask(root, id);
  } catch {
    return { ok: false, error: `task ${id}: no control record at ${PATHS.controlTasks}/${id}.json.` };
  }

  /* THE AUTHORITY, AND THE ONLY REASON EXECUTING SPEC BYTES IS LEGITIMATE.
   *
   * The commands come out of a document an AGENT wrote, and they run as children
   * of this process - which `risk-guard.mjs` cannot see, because it is a
   * PreToolUse hook that sees one Bash call and never its descendants. What makes
   * that acceptable is not that the architect is trusted; it is that the operator
   * approved these exact bytes, that `--approve-spec` kept a content-addressed
   * copy of them, and that 0.1.26's class control denies every agent a write to
   * an approved spec. Take the hash away and this is an execution channel with no
   * gate on it at all, so it refuses rather than proceeding on a maybe. */
  const surface = readJsonOrNull(abs(root, `${PATHS.tasks}/${id}.json`));
  const specPath = surface?.spec ?? control.spec ?? null;
  const specText = specPath ? readTextOrNull(abs(root, specPath)) : null;

  const approval = control.spec_approved;
  const approved = approval && approvalCurrent({ ...control, spec: specPath }, specText);

  let declared = null;
  if (specText) {
    const parsed = parseCriteriaBlock(specText);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `task ${id}: the acceptance criteria in ${specPath} could not be read - ${parsed.error}`,
      };
    }
    declared = parsed.criteria;
  }

  if (!execute) {
    /* THE SUPPLIED PATH. Where the spec declares nothing, this is 0.1.33's
     * behaviour unchanged - an agent's attestation, which is what a project with
     * no block has and all it has. Where the spec DOES declare, the declaration
     * is what makes the substitution visible, and finding 4's second-order point
     * is exactly this case: "a precondition the spec does not declare becomes a
     * precondition the verifier silently substitutes around. It cannot create
     * the fixture, so it reads the handler instead and records passing." */
    if (!declared) return { ok: true, criteria: supplied };
    const index = new Map(declared.map((c) => [c.id, c]));
    for (const entry of supplied ?? []) {
      const decl = index.get(entry?.id);
      if (decl && entry?.mode === 'inspected' && isShellOnly(decl)) {
        return {
          ok: false,
          error: `criterion ${entry.id} may not be recorded \`mode: "inspected"\`. The approved spec `
            + 'declares it as needing only `shell`, so the runner could have RUN it: '
            + `\`${decl.run}\`. Reading the code and forming a view where a command was available is `
            + 'a substitution, and it is recorded in the field the system reserves for the stronger '
            + `evidence. Run \`verify.mjs --run-criteria ${id}\` instead.`,
        };
      }
    }
    return { ok: true, criteria: supplied };
  }

  if (!approval) {
    return {
      ok: false,
      error: `task ${id}: no spec approval is recorded, so there is nothing authorising this to run `
        + 'the commands in ' + (specPath ?? 'the spec') + '. Those commands were written by an agent '
        + 'and execute as children of this process, where the risk guard cannot see them; the '
        + "operator's approval of those exact bytes is the whole of what makes running them "
        + `legitimate. Run \`state.mjs --approve-spec ${id}\` first.`,
    };
  }
  if (!approved) {
    return {
      ok: false,
      error: `task ${id}: ${specPath} has CHANGED since the approval was recorded, so its commands are `
        + 'not the ones the operator approved. Recorded hash '
        + `${String(approval.spec_sha256).slice(0, 12)}. Restore the approved bytes with `
        + `\`state.mjs --restore-spec ${id}\`, or have the operator re-approve after reading what `
        + 'changed - and read it as a script, because that is what this will run.',
    };
  }

  if (!declared) {
    return {
      ok: false,
      error: `task ${id}: ${specPath} declares no \`${CRITERIA_FENCE}\` block, so there is nothing to `
        + 'execute. This is not a fault in the task - every spec written before the block existed is '
        + 'in this state, and retrofitting one changes its bytes and therefore breaks its approval. '
        + `Record what was observed with \`--criteria <path>\` instead, or have the architect declare `
        + 'the block on the NEXT task.',
    };
  }

  /* THE INTERPRETER IS PROVEN BEFORE ANYTHING IS SCORED, AND NAMED WHETHER OR
   * NOT IT WORKS. 0.1.22: a harness that trusted PATH scored 18 blocks `ok`
   * while executing nothing, because it asked "did this run?" by matching
   * English error strings and the stub answered in Turkish, in UTF-16LE. The fix
   * is not a longer list of strings. It is to prove the interpreter executes AT
   * ALL before trusting any per-item verdict from it - invariant 5 applied to
   * the harness rather than to the thing under test. */
  const bash = resolveBash();
  const pre = preflight(bash);
  if (!pre.ok) {
    return {
      ok: false,
      error: `the interpreter could not be proven to execute, so NO criterion was run and no claim is `
        + `made about any of them. interpreter ${describeBash(bash)}; the probe answered `
        + `${JSON.stringify(pre.answer)} (exit ${pre.status}). Pin a working shell with MAVCI_BASH.`,
    };
  }

  const have = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--have') continue;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) {
      return { ok: false, error: `--have expects a comma-separated capability list (${CRITERION_NEEDS.join(', ')}).` };
    }
    for (const cap of v.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!CRITERION_NEEDS.includes(cap)) {
        return { ok: false, error: `--have ${cap}: unrecognised capability. The vocabulary is closed: ${CRITERION_NEEDS.join(', ')}.` };
      }
      have.push(cap);
    }
  }

  const results = runCriteria(declared, { bash, cwd: root, have });
  const ranCount = results.filter((r) => r.status === 'pass' || r.status === 'fail').length;
  return {
    ok: true,
    criteria: results,
    note: `interpreter ${describeBash(bash)}; ran ${ranCount} of ${declared.length} acceptance `
      + `criteria from ${specPath}`
      + (have.length ? ` (declared available: ${have.join(', ')})` : ''),
  };
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
    // THE IDENTITY COUNTER, not the ceiling counter. `attempts` is zeroed by
    // --reset-attempts, so naming a verdict from it makes the next one collide
    // with a historical file. `attemptsTotal` falls back to `attempts` for a task
    // that has never been reset, which is every task predating the field.
    attempt = attemptsTotal(control);
  }

  if (!exists(abs(root, PATHS.manifest))) {
    if (advisory) return;                       // not a mavci project: stay silent
    console.error('not a Mavci project: .mavci/project.json not found. Run /mavci-core:connect first.');
    process.exit(ci ? 1 : 0);
  }

  /* ---- the acceptance criteria -------------------------------------------
   *
   * TWO WAYS IN, AND THEY ARE NOT EQUAL.
   *
   * `--run-criteria <id>` EXECUTES the criteria declared in the approved spec
   * and computes each result from what it observed. Nobody supplies an answer.
   *
   * `--criteria <path>` ACCEPTS results. It is 0.1.33's plumbing, kept because
   * every spec written before the block existed has no other way to answer, and
   * because a criterion needing a browser is legitimately read rather than run.
   * Where the spec DOES declare a block, this path is checked against it: a
   * criterion the block says needs only `shell` may not be recorded `inspected`,
   * because the runner could have run it.
   *
   * `--criteria` takes a PATH, never inline JSON. An argument goes through the
   * shell, and 0.1.31 records what that costs: `--record` lost four backticked
   * words to command substitution, one of them the word the finding was about. */
  const runCriteriaIx = argv.indexOf('--run-criteria');
  const critIx = argv.indexOf('--criteria');

  /* REFUSED BY NAME, IN --record-corpus's IDIOM, AND REFUSED RATHER THAN
   * IGNORED. A flag that is silently ignored is worse than one that is refused:
   * the caller reads the record afterwards and sees the answer they asked for,
   * because it happened to match, and never learns the flag did nothing. */
  if (runCriteriaIx !== -1) {
    const asserted = ['--status', '--mode', '--evidence', '--result', '--pass', '--fail', '--criteria']
      .filter((f) => argv.includes(f));
    if (asserted.length) {
      console.error(`--run-criteria does not accept ${asserted.join(', ')}. Every field of every `
        + 'criterion result is COMPUTED here: `status` from the command\'s exit code, `mode` from the '
        + 'path that was attempted, `evidence` from what the command printed. A writer that accepted '
        + 'any of them would put the model back in the chair this runner was written to take it out '
        + 'of - an unverified claim promoted to an artefact that reads as verification, which is the '
        + 'thing the loop exists to prevent.');
      process.exit(2);
    }
  }

  let criteria = null;
  let suppliedCriteria = null;
  if (critIx !== -1) {
    const cp = argv[critIx + 1];
    if (!cp || cp.startsWith('--')) {
      console.error('--criteria expects a path to a JSON array of per-criterion results.');
      process.exit(2);
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch (err) {
      console.error(`--criteria ${cp}: ${err.message}. Refusing to record a verdict whose criteria `
        + 'could not be read - an unreadable input recorded as an absent one is the fail-quiet shape.');
      process.exit(2);
    }
    if (!Array.isArray(parsed)) {
      console.error(`--criteria ${cp}: expected a JSON array, got ${typeof parsed}.`);
      process.exit(2);
    }
    suppliedCriteria = parsed;
    criteria = parsed;
  }

  if (runCriteriaIx !== -1 || suppliedCriteria) {
    const id = runCriteriaIx === -1 ? task_id : (argv[runCriteriaIx + 1] ?? '');
    const outcome = await resolveCriteria(root, {
      id, argv, execute: runCriteriaIx !== -1, supplied: suppliedCriteria,
    });
    if (!outcome.ok) {
      console.error(outcome.error);
      process.exit(2);
    }
    if (outcome.criteria) criteria = outcome.criteria;
    if (outcome.note) console.log(outcome.note);
  }

  const { verdict } = await evaluate(root, { scope, task_id, attempt, criteria });

  if (advisory) {
    // PostToolUse: informational only, must never exit non-zero and never block.
    if (verdict.summary.blockers > 0) {
      console.log(`mavci: ${verdict.summary.blockers} blocking violation(s) so far\n${formatHuman(verdict)}`);
    }
    return;
  }

  if (record) {
    try {
      recordVerdict(root, verdict);
    } catch (err) {
      /* A REFUSAL IS NOT A FAULT, AND MUST NOT BE WORDED AS ONE.
       *
       * The write-once guard throws, and `main().catch` prints "verify.mjs
       * crashed: ..." over the top of it. That is finding 24's shape: the
       * decision is right and the label sends the reader somewhere else - here,
       * to filing a checker bug instead of consuming an attempt. It also matters
       * to `gate.mjs`, whose `interpretRunError` classifies a crash as a checker
       * fault, blocks, and writes the UNVERIFIED marker. This path is reachable
       * only with `--task`, which the gate never passes, but a message that is
       * only safe because of who calls it is one caller away from being wrong. */
      console.error(err.message);
      process.exit(2);
    }
  }

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

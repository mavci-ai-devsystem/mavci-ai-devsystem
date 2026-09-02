/**
 * Mavci Core - shared constants.
 *
 * LOCKED IDENTIFIERS - ARCHITECTURE section 12.
 * These four values are written into every project's committed .claude/settings.json
 * and CI workflow. Changing one later means editing every project repo by hand.
 * They were decided once, deliberately, and are not to be revisited:
 *
 *   system repo      mavci-ai-devsystem/mavci-ai-devsystem   (private)
 *   marketplace      mavci
 *   plugin           mavci-core
 *   state directory  .mavci/
 *
 * `check-plugin.mjs` asserts these match the marketplace and plugin manifests,
 * so a rename cannot happen by accident in one place only.
 */

export const SYSTEM_REPO = 'mavci-ai-devsystem/mavci-ai-devsystem';
export const MARKETPLACE_NAME = 'mavci';
export const PLUGIN_NAME = 'mavci-core';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * The namespace every skill and agent this plugin ships is addressed by.
 *
 * It is derived from PLUGIN_NAME, NOT from MARKETPLACE_NAME. Claude Code
 * namespaces plugin components by the PLUGIN name (NATIVE-CAPABILITIES 6.11):
 * a skill is `/<plugin>:<skill>` and an agent is `<plugin>:<agent>`. The
 * marketplace name appears only in `enabledPlugins` and `/plugin update`, never
 * in a command.
 *
 * Because the two names differ here - marketplace `mavci`, plugin `mavci-core` -
 * the wrong one is a plausible mistake that produces a command nobody can type.
 * Gate 3 found that form in 105 places across docs, skills and agent contracts.
 * `check-plugin.mjs` now sweeps the whole tree for `/<marketplace>:` and fails
 * on it, so the two names cannot drift back together.
 */
export const COMMAND_PREFIX = `/${PLUGIN_NAME}:`;

/** The wrong form, spelled once so the sweep in check-plugin.mjs has an authority. */
export const BAD_COMMAND_PREFIX = `/${MARKETPLACE_NAME}:`;

/**
 * The GitHub Actions secret each project needs to clone this private repo.
 * Fine-grained PAT, Contents: read-only, scoped to SYSTEM_REPO alone.
 */
export const CI_TOKEN_SECRET = 'MAVCI_TOKEN';

/** Warn this many days before the recorded PAT expiry. */
export const CI_TOKEN_EXPIRY_WARN_DAYS = 30;

/** Minimum Node version. Enforced by doctor --preflight. */
export const MIN_NODE_MAJOR = 22;

/** Directory layout inside a consuming project. Repo-relative POSIX, always. */
export const MAVCI_DIR = '.mavci';
export const CONTROL_DIR = `${MAVCI_DIR}/control`;

export const PATHS = {
  manifest: `${MAVCI_DIR}/project.json`,
  tasks: `${MAVCI_DIR}/tasks`,
  decisions: `${MAVCI_DIR}/decisions`,
  lessons: `${MAVCI_DIR}/lessons`,
  state: `${CONTROL_DIR}/state.json`,
  controlTasks: `${CONTROL_DIR}/tasks`,
  verdicts: `${CONTROL_DIR}/verdicts`,
  baseline: `${CONTROL_DIR}/baseline.json`,
  waivers: `${CONTROL_DIR}/waivers.json`,
  integrity: `${CONTROL_DIR}/integrity.json`,
  gateRun: `${CONTROL_DIR}/gate-run.json`,
  hookRun: `${CONTROL_DIR}/hook-run.json`,
  unverified: `${CONTROL_DIR}/unverified.json`,
  /**
   * The operator-run guardian acceptance corpus result.
   *
   * KEYED ON PLUGIN VERSION, NEVER ON A DATE. Guardian's correctness is the one
   * property in this system that no deterministic check can establish, so the
   * evidence is a human reading a corpus run - and that evidence is about the
   * guardian that ran, not about the calendar. A corpus passed against 0.1.14 says
   * nothing about 0.1.16's guardian: the agent definition, the worklist, the rule
   * that feeds it and the prompt can all have changed. A date-keyed record would
   * let a recent result satisfy a version it never examined, which is the same
   * defect as a stale plugin_version steering CI (carried-forward item 2) with the
   * staleness moved one field over.
   */
  guardianCorpus: `${CONTROL_DIR}/guardian-corpus.json`,
  /** One file per guardian run, sealed. Swept by state.schema_valid: until it was,
   *  a malformed guardian record passed the standards checker entirely, and the
   *  ONLY thing that would have caught it was the writer that produced it. */
  /** The guardian run directory: worklists live here, records in the subdirectory
   *  below. Named once so a reader of a worklist id and a writer of one cannot
   *  drift - `corpus-score.mjs` and `state.mjs --record-corpus` both join on it. */
  guardianDir: `${CONTROL_DIR}/guardian`,
  guardianRecords: `${CONTROL_DIR}/guardian/records`,
  /**
   * The open-run marker. Written before guardian is dispatched, deleted on
   * exactly one path: a record was written.
   *
   * So an open ticket means A DISPATCH HAPPENED AND PRODUCED NO RECORD, and
   * until 0.1.16 NOTHING READ IT. Three components said otherwise in comments -
   * guardian-record.mjs, worklist.mjs, and the guardian skill all claimed "the
   * gate sees it" - and a grep for the path found exactly one consumer: the
   * component that writes it. The only signal a run had been lost was a
   * transient stderr line from a hook, in a session that then ended.
   *
   * `checkGuardianTicket` in doctor.mjs is that reader. This constant exists so
   * the reader and the writer name the file once, rather than twice.
   */
  guardianTicket: `${CONTROL_DIR}/guardian/ticket.json`,
};

/**
 * Every file the integrity hash covers. Anything that governs an agent belongs here.
 * `integrity.json` is excluded - it holds the hash. `gate-run.json`,
 * `hook-run.json` and `unverified.json` are excluded because they change on
 * every turn and every session by design; all three are still inside control/,
 * so agents cannot write them and cannot fake a completed gate, a registered
 * hook, or a verified session.
 *
 * `unverified.json` has a second reason to be excluded, and it is the important
 * one: it is written on the path where the checker has just CRASHED. A write
 * that had to reseal would need `state.mjs` to be healthy, which is exactly what
 * cannot be assumed at that moment - and a marker that fails to be written on a
 * broken system is a marker that only exists when it is not needed.
 */
export const CONTROL_GLOBS = [
  PATHS.state,
  PATHS.baseline,
  PATHS.waivers,
  // The corpus result governs: its presence and its `recorded_for` are what clear
  // a `doctor` FAIL, so by the rule above - anything that governs an agent belongs
  // here - it is sealed. It is not in the excluded set with gate-run and hook-run
  // because it does not change per turn or per session; it changes once per release.
  PATHS.guardianCorpus,
  `${PATHS.controlTasks}/**/*.json`,
  `${PATHS.verdicts}/**/*.json`,
];

/* ---------------------------------------------------------------- enums
 * Closed and versioned. A future Command Center reads these; never repurpose a value.
 * Mirrors ROADMAP "Data-format constraints", item 4.
 */
export const PHASES = ['plan', 'build', 'verify', 'release'];
export const TASK_STATUS = ['pending', 'in_progress', 'done', 'failed', 'blocked'];
/**
 * `not_checked` is NOT a pass and NOT a failure. It is the state where a rule ran
 * correctly over an EMPTY INPUT SET - a probe with nothing to probe (finding 5).
 * Invariant 5 says a failed probe is never reported as a pass; this is narrower and
 * more dangerous, because nothing looks wrong. It is excluded from the passing tally
 * in summarise(), so a rule that examined nothing can never inflate a clean run.
 */
export const CHECK_STATUS = ['pass', 'fail', 'waived', 'baselined', 'error', 'not_checked'];
export const SEVERITIES = ['critical', 'blocker', 'warning', 'info'];
export const VERDICTS = ['pass', 'fail'];
export const RISK_TIERS = ['sandbox', 'standard', 'regulated'];

/** Hook events wired to stamp control/hook-run.json. Mirrors hook-run.schema.json. */
export const HOOK_RUN_EVENTS = ['SessionStart', 'Stop', 'SubagentStop'];

/** Severities that stop a turn. `warning` and `info` never block. */
export const BLOCKING_SEVERITIES = new Set(['critical', 'blocker']);

/**
 * `critical` findings can never be baselined or waived.
 *
 * The category is "things it is never legitimate to suppress", and two kinds
 * qualify. A committed live key is not acceptable technical debt
 * (ARCHITECTURE 4.4 / 6.5 / 6.6). The absence of enforcement itself is not
 * either: `settings.marketplace_form` reports a project where the marketplace
 * never resolves, so no plugin installs and no hook registers. Baselining that
 * would file "nothing is checked here" as accepted debt.
 */
export const UNSUPPRESSIBLE_SEVERITIES = new Set(['critical']);

/* ------------------------------------------------------------- waivers */
export const WAIVER_DEFAULT_DAYS = 90;
export const WAIVER_MAX_DAYS = 180;
export const WAIVER_MIN_REASON_CHARS = 20;
export const WAIVER_EXPIRY_WARN_DAYS = 14;

/* --------------------------------------------------------------- gate
 *
 * A CRASH can be made fail-closed: gate.mjs catches it and exits 2.
 * A TIMEOUT cannot. If Claude Code cancels the hook, output is discarded and no
 * decision is rendered (NATIVE-CAPABILITIES 4.17). Nothing inside the hook runs
 * after that point, so there is no code that could block. The gate passes
 * silently. That asymmetry is structural and cannot be engineered away from here.
 *
 * Two consequences, and both are deliberate:
 *
 * 1. THE TIMEOUT IS SHORT. 30s, not 150s. A long timeout is the worst of both
 *    worlds: too long to sit through, and long enough that a hang looks like
 *    ordinary slowness rather than a fault. At 30s a hang is obvious. The
 *    internal budget sits below it so the normal path always returns a decision.
 *
 * 2. IT IS DETECTED AFTERWARDS. gate.mjs writes control/gate-run.json when it
 *    starts and marks it complete when it finishes. A cancelled gate leaves the
 *    record incomplete, and the NEXT turn's PreToolUse hook reports it.
 *    Detection, not prevention - but never silent.
 */
export const GATE_BUDGET_MS = 25_000;
export const GATE_HOOK_TIMEOUT_S = 30;

/** Consecutive blocking gates allowed for one prompt before giving up. */
export const GATE_MAX_CONTINUES = 3;

/* ------------------------------------------------- enforcement did not run
 *
 * Gate 4c, finding 3. Two arms of this gate block, and only one of them has an
 * exit the agent can reach.
 *
 * A VIOLATION is satisfiable: fix the code, the finding goes, the gate passes.
 * GATE_MAX_CONTINUES caps it anyway, as a loop guard.
 *
 * A CHECKER FAULT is not. The fault is in the checker, the agent is forbidden to
 * edit the checker, and the gate's own message says so - and then refused to let
 * the turn end anyway. Three consecutive turns in gate4c ended in the identical
 * crash; the fourth escaped by luck. The one arm the agent provably cannot
 * satisfy was the only arm with no ceiling. That was inverted.
 *
 * Blocking the turn is NOT what makes the system fail-closed. Fail-closed is a
 * property about not shipping unverified code, and it is held by `doctor`
 * FAILing and by the release path refusing - both of which work whether or not a
 * turn ends. What trapping the agent produces is no verification AND no report,
 * which is strictly worse than ending the turn, because then the operator never
 * hears about the crash at all.
 *
 * So: block ONCE, which gives the agent its chance to diagnose - genuinely
 * valuable in gate4c - then let the turn end and leave a sticky marker that
 * something outside the gate reports. `doctor` FAILs on it, the PreToolUse guard
 * repeats it every turn, and only a CLEAN gate run clears it.
 */
export const GATE_MAX_FAULT_BLOCKS = 1;

/**
 * How enforcement failed. Closed enum, mirrored in unverified.schema.json and
 * asserted equal by check-schemas.mjs - the hook-run.json precedent from 0.1.4,
 * where a duplicated enum could otherwise drift silently.
 *
 *   timeout             the hook exceeded GATE_BUDGET_MS and the child was killed
 *   crash               verify.mjs threw
 *   unreadable_verdict  it returned something that is not a verdict
 *   unreadable_payload  the hook payload was not JSON, so we knew neither project nor turn
 *   gate_error          the gate itself faulted above the checker
 */
export const GATE_FAULT_KINDS = ['timeout', 'crash', 'unreadable_verdict', 'unreadable_payload', 'gate_error'];

/**
 * How much of the checker's own error text the marker keeps.
 *
 * Not unbounded: this string ends up in a Stop reason, and hook output is capped
 * at 10,000 characters. Not one line either - that was finding 1, where
 * `.split('\n')[0]` threw away every error the validator existed to produce.
 */
export const FAULT_DETAIL_MAX_CHARS = 2000;

/* --------------------------------------------------- finding string caps
 *
 * Gate 4c, finding 2: THE CAP WAS ENFORCED AT THE WRONG END OF THE PIPE.
 *
 * `verdict.schema.json` has capped `evidence` at 500 and `remedy` at 300 since
 * 0.1.0. Nothing checked a rule's strings against those numbers when the rule
 * was written, because the numbers lived only in the schema and no code knew
 * them. So the cap fired at `writeControl` - after the run, inside the gate,
 * against a string already assembled from live project data.
 *
 * `settings.marketplace_form` produced 583 characters. The verdict could not be
 * written, so `verify.mjs --record` - the ONLY mode the gate uses - threw on
 * every turn in gate4c. Plain `verify.mjs` was healthy throughout: 11 pass,
 * 5 fail, 1 blocker. Only recording was broken, and recording is the path
 * enforcement runs on. One verbose string took the entire checker offline.
 *
 * Note the shape, because it generalises: the checker's most DETAILED finding is
 * the one that disabled the checker. Length correlates with importance, so the
 * cap bit hardest exactly where the evidence was most worth having.
 *
 * Three changes, and all three are needed:
 *   1. the numbers live HERE, so `check-evidence-caps.mjs` can enforce them over
 *      `scripts/rules/` at authoring time and fail the build;
 *   2. `check-schemas.mjs` asserts they still equal the schema's `maxLength`,
 *      because a cap checked at one number and enforced at another is worse
 *      than no check;
 *   3. `clampFinding` in verify.mjs TRUNCATES rather than throwing, because a
 *      static check cannot see an interpolated string and a finding reported at
 *      500 characters and visibly cut is worth incomparably more than a checker
 *      that does not run.
 *
 * Raising these is allowed and is a deliberate act: change the number here, in
 * verdict.schema.json, and say why. What is not allowed is discovering the cap
 * by watching the gate throw.
 */
export const EVIDENCE_MAX_CHARS = 500;
export const REMEDY_MAX_CHARS = 300;

/** Appended when a string is cut. Visible on purpose: a silent truncation is a lie. */
export const CLAMP_MARKER = ' [...cut]';

/* ------------------------------------------------------------ scanning */
export const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'build', 'out',
  'coverage', '.turbo', '.vercel', '.claude', '.mavci-system',
]);

/** Files verify.mjs will read. Anything else is skipped without opening it. */
export const SCANNABLE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.sql', '.json', '.md', '.mdx', '.env', '.yml', '.yaml',
]);

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

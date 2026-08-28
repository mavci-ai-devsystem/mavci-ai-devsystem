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
};

/**
 * Every file the integrity hash covers. Anything that governs an agent belongs here.
 * `integrity.json` is excluded - it holds the hash. `gate-run.json` is excluded
 * because it changes on every turn by design; it is still inside control/, so
 * agents cannot write it and cannot fake a completed gate.
 */
export const CONTROL_GLOBS = [
  PATHS.state,
  PATHS.baseline,
  PATHS.waivers,
  `${PATHS.controlTasks}/**/*.json`,
  `${PATHS.verdicts}/**/*.json`,
];

/* ---------------------------------------------------------------- enums
 * Closed and versioned. A future Command Center reads these; never repurpose a value.
 * Mirrors ROADMAP "Data-format constraints", item 4.
 */
export const PHASES = ['plan', 'build', 'verify', 'release'];
export const TASK_STATUS = ['pending', 'in_progress', 'done', 'failed', 'blocked'];
export const CHECK_STATUS = ['pass', 'fail', 'waived', 'baselined', 'error'];
export const SEVERITIES = ['critical', 'blocker', 'warning', 'info'];
export const VERDICTS = ['pass', 'fail'];
export const RISK_TIERS = ['sandbox', 'standard', 'regulated'];

/** Severities that stop a turn. `warning` and `info` never block. */
export const BLOCKING_SEVERITIES = new Set(['critical', 'blocker']);

/**
 * `critical` findings can never be baselined or waived.
 * A committed live key is not acceptable technical debt. ARCHITECTURE 4.4 / 6.5 / 6.6.
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

/** Consecutive `continue: true` gates allowed for one prompt before giving up. */
export const GATE_MAX_CONTINUES = 3;

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

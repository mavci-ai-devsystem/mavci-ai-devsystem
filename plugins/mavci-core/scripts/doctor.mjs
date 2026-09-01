#!/usr/bin/env node
/**
 * Mavci Core - drift detection, self-test and sync. ARCHITECTURE section 0 (C6).
 *
 * Six things decay silently, and each has a documented cause:
 *   1. On Windows, "don't ask again" writes allow rules into the COMMITTED
 *      .claude/settings.json (5.16), so the risk policy grows entries nobody chose.
 *   2. Claude Code changes; the hook output schema is the most fragile surface
 *      in the system, and a schema change turns every hard block into a no-op
 *      with no error anywhere.
 *   3. Baseline debt stops shrinking, and nobody notices because it never blocks.
 *   4. Waivers expire, or worse, quietly stop being needed and linger.
 *   5. The installed plugin version drifts from the version CI clones.
 *   6. The marketplace clone falls behind origin, so the loaded plugin is
 *      superseded code producing correct-looking output. `/plugin marketplace
 *      update` has been observed to skip a marketplace with no error, so the
 *      command's success is not evidence the clone moved (6.21).
 *
 *   node doctor.mjs              full report
 *   node doctor.mjs --preflight  SessionStart: only speak up if something is wrong
 *   node doctor.mjs --sync       record the installed plugin version so CI follows
 *   node doctor.mjs --selftest-hooks   prove a known-bad command is really blocked
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PATHS, MIN_NODE_MAJOR, WAIVER_EXPIRY_WARN_DAYS, SYSTEM_REPO, PLUGIN_ID, MARKETPLACE_NAME,
  CI_TOKEN_SECRET, CI_TOKEN_EXPIRY_WARN_DAYS, COMMAND_PREFIX,
} from './config.mjs';
import { abs, exists, readJson, readJsonOrNull, readTextOrNull, todayIso } from './lib/fsx.mjs';
import {
  pluginVersion, verifyIntegrity, validateAll, expiredWaivers, expiringWaivers, projectRoot,
  stampHookRun, lastHookRun, lastGate, MANIFEST_SCHEMA_VERSION,
} from './state.mjs';
// The queue is a directory, and retro.mjs is the one place that says what is in
// it. doctor used to compose its own path to the same file, which is how it came
// to answer "is anything queued?" by testing a name nobody had used.
import { queuedLessons, parseFindings, PENDING_STEM } from './retro.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');
const TEMPLATE_SETTINGS = path.join(PLUGIN_ROOT, 'templates', 'project.settings.json');

/** Template placeholders look like __SYSTEM_REPO__. Any survivor means an
 *  unfinished connect: the file was copied but never filled in. */
const PLACEHOLDER_RE = /__[A-Z0-9_]+__/;

/** The per-machine bootstrap step (ARCHITECTURE section 2), spelled once. */
const INSTALL_USER = `claude plugin install ${PLUGIN_ID} --scope user`;

/**
 * THE PROPAGATION PROCEDURE, spelled once.
 *
 * Neither half of the documented path moves anything on this machine:
 * `/plugin marketplace update` has left the clone at its existing HEAD in
 * 4 of 4 observations, and `claude plugin update` left the install at its
 * existing version in 1 of 1 (NATIVE-CAPABILITIES 6.21). Both links are
 * advanced by hand, and that is the supported route until Claude Code
 * changes - so remediation prints what works, not what is documented.
 */
function propagationSteps(clone, branch = 'main') {
  return `           git -C "${clone}" fetch origin\n`
    + `           git -C "${clone}" checkout -B ${branch} origin/${branch}\n`
    + `           claude plugin uninstall ${PLUGIN_ID}\n`
    + `           ${INSTALL_USER}`;
}

/** Larger of two dotted versions; ties and unparseable input return `a`. */
function newerVersion(a, b) {
  const parts = (v) => String(v ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? a : b;
  }
  return a;
}

const OK = 'ok  ';
const WARN = 'WARN';
const FAIL = 'FAIL';

function line(status, label, detail = '') {
  return `  [${status}] ${label}${detail ? `\n         ${detail}` : ''}`;
}

/* --------------------------------------------------------------- checks */

function checkNode(out) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    out.push({ status: FAIL, text: line(FAIL, `Node ${process.versions.node}`, `Mavci needs Node ${MIN_NODE_MAJOR}+. Every hook runs through node; on an older runtime they fail, and a failed hook FAILS OPEN.`) });
  } else {
    out.push({ status: OK, text: line(OK, `Node ${process.versions.node}`) });
  }
}

function checkConnected(root, out) {
  if (!exists(abs(root, PATHS.manifest))) {
    out.push({ status: WARN, text: line(WARN, 'not a Mavci project', 'No .mavci/project.json. Run /mavci-core:connect for an existing repo, or /mavci-core:new-project.') });
    return false;
  }
  out.push({ status: OK, text: line(OK, 'project connected') });
  return true;
}

/**
 * A manifest at an older schema_version is a FAIL, not a warning, and it is checked
 * before anything that reads the manifest's contents.
 *
 * Every other check that reads `.mavci/project.json` - protected environments, the CI
 * token, the marketplace form - assumes the shape it expects. Against a v1 manifest
 * those either crash or, worse, read a field that has moved and report on nothing.
 * `assertValid` already refuses a v1 manifest at every write path; without this check
 * doctor's own output would be the one place that failed to mention why.
 *
 * FAIL rather than WARN because the field that moved is `tenancy`: v1 fused schema
 * layout and enforcement into `shared-schema-rls`, and which tenant-isolation rules
 * run at all depends on the split value. A project sitting on v1 is not running the
 * checks it believes it is.
 */
function checkManifestVersion(root, out) {
  const m = readJsonOrNull(abs(root, PATHS.manifest));
  if (!m) return;
  const v = m.schema_version;
  if (v === MANIFEST_SCHEMA_VERSION) {
    out.push({ status: OK, text: line(OK, `manifest schema_version ${v}`) });
    return;
  }
  out.push({ status: FAIL, text: line(FAIL,
    `manifest is schema_version ${v}, this build requires ${MANIFEST_SCHEMA_VERSION}`,
    'Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --migrate-manifest`. '
    + 'v1 fused tenancy.model and the isolation mechanism into one value; the split decides '
    + 'which tenant-isolation rules run, so until it is migrated this project is not running '
    + 'the checks it appears to. The migration maps "shared-schema-rls" to isolation "rls" '
    + 'because that is what the old value asserted - NOT because anything verified it. If the '
    + 'project reaches its data through a service-role client, correct it to "application-filters" '
    + 'afterwards: that turns supabase.rls_enabled off and the scoped-query rule on, which is '
    + 'more checking, not less.') });
}

/**
 * Guardian's acceptance corpus. Design prediction 2b, and 3c of the build order.
 *
 * Guardian's MACHINERY is asserted in CI (check-guardian.mjs). Whether guardian
 * ANSWERS correctly needs a model and cannot run there. The fallback is an
 * operator-run corpus - and the move that stops that decaying into nothing is that
 * its ABSENCE IS A FAILURE, not a silence.
 *
 * Same construction as the hook receipt in 0.1.12: `control/hook-run.json` is an
 * artefact only a real run can produce, and doctor treats its absence as a FAIL
 * rather than inferring health from the scripts behaving. A corpus result is the
 * same kind of artefact.
 *
 * THE KEY IS THE PLUGIN VERSION, NOT A DATE, and the distinction is the whole
 * point. A corpus passed against 0.1.14 tells you nothing about 0.1.16's guardian -
 * the agent definition, the worklist, the rule feeding it and the prompt can all
 * have changed between them. A date-keyed record would let a recent result satisfy
 * a version it never examined. `recorded_for` must EQUAL the running plugin
 * version; newer is as wrong as older, because it is evidence about a different
 * component.
 */
function checkGuardianCorpus(root, out) {
  const running = pluginVersion();
  const rec = readJsonOrNull(abs(root, PATHS.guardianCorpus));

  if (!rec) {
    out.push({ status: FAIL, text: line(FAIL,
      `no guardian acceptance corpus result for plugin ${running}`,
      "Guardian's judgement is the one thing here that no deterministic check can verify, so "
      + 'the corpus is the only evidence it works - and an absent result is a FAIL, never a '
      + 'silence. The operator runs the guardian acceptance corpus and records the outcome '
      + `at ${PATHS.guardianCorpus}. Until then, a `
      + 'passing guardian verdict on this project rests on nothing.') });
    return;
  }
  if (rec.recorded_for !== running) {
    out.push({ status: FAIL, text: line(FAIL,
      `guardian corpus was recorded for plugin ${rec.recorded_for}, not the running ${running}`,
      'Version, not date: the corpus is evidence about the guardian that ran it. The agent '
      + 'definition, the worklist, the rule that feeds it and the prompt can all differ between '
      + 'versions, so a result from another version has not examined this one - whether it is '
      + 'older or newer. The operator re-runs the corpus against this version.') });
    return;
  }
  if (rec.result !== 'pass') {
    out.push({ status: FAIL, text: line(FAIL,
      `guardian corpus for plugin ${running} did not pass (result: ${rec.result})`,
      "The corpus is the acceptance test for guardian's judgement. A failing corpus means "
      + "guardian's findings are not trustworthy on this version.") });
    return;
  }
  out.push({ status: OK, text: line(OK, `guardian corpus passed for plugin ${running}`,
    `${rec.cases_total ?? '?'} case(s), recorded ${rec.run_at ?? 'at an unstated time'}`) });
}

/**
 * The locked identifiers (ARCHITECTURE section 12) must agree everywhere.
 * They are written into every project's committed settings and CI workflow, so a
 * value that drifts in one place and not another produces projects that install
 * from one repo and clone from a different one - a failure that looks like a
 * network problem rather than a configuration one.
 */
function checkLockedIdentifiers(out) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(SYSTEM_REPO) || SYSTEM_REPO.includes('<')) {
    out.push({ status: FAIL, text: line(FAIL, `SYSTEM_REPO is not a valid owner/repo: "${SYSTEM_REPO}"`,
      'Project scaffolding would write an unusable marketplace source and CI could not clone the system.') });
    return;
  }
  const mk = readJsonOrNull(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'));
  const pl = readJsonOrNull(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
  const drift = [];
  if (mk && mk.name !== MARKETPLACE_NAME) drift.push(`marketplace.json name "${mk.name}" != config "${MARKETPLACE_NAME}"`);
  if (pl && pl.name !== PLUGIN_ID.split('@')[0]) drift.push(`plugin.json name "${pl.name}" != config "${PLUGIN_ID.split('@')[0]}"`);
  if (drift.length) {
    out.push({ status: FAIL, text: line(FAIL, 'locked identifiers disagree', drift.join('\n         ')) });
  } else {
    out.push({ status: OK, text: line(OK, `locked: ${SYSTEM_REPO} / ${MARKETPLACE_NAME} / ${PLUGIN_ID.split('@')[0]}`) });
  }
}

function checkIntegrity(root, out) {
  if (!exists(abs(root, PATHS.integrity))) {
    out.push({ status: FAIL, text: line(FAIL, 'control plane not sealed', 'Run: state.mjs --reseal') });
    return;
  }
  const r = verifyIntegrity(root);
  out.push(r.ok
    ? { status: OK, text: line(OK, 'control plane seal intact') }
    : { status: FAIL, text: line(FAIL, 'control plane seal BROKEN', r.reason) });
}

function checkSchemas(root, out) {
  const errors = validateAll(root);
  out.push(errors.length
    ? { status: FAIL, text: line(FAIL, `${errors.length} state file error(s)`, errors.slice(0, 5).join('\n         ')) }
    : { status: OK, text: line(OK, 'state files valid') });
}

function checkVersionSkew(root, out, { sync = false } = {}) {
  const installed = pluginVersion();
  const state = readJsonOrNull(abs(root, PATHS.state));
  if (!state) {
    // Same rule as every other probe in this file: returning silently deleted the
    // version-skew line from the report, and an absent line reads as a pass.
    out.push({ status: WARN, text: line(WARN, 'version skew NOT CHECKED',
      `${PATHS.state} is missing or unreadable, so the installed plugin version cannot be`
      + ' compared with the tag CI clones.' + '\n         This is unknown, not passing. Run /mavci-core:connect, then re-run doctor.') });
    return;
  }
  const recorded = state.plugin_version;
  if (recorded === installed) {
    out.push({ status: OK, text: line(OK, `plugin ${installed} (CI clones tag v${recorded})`) });
    return;
  }
  const [im] = installed.split('.');
  const [rm] = recorded.split('.');
  const major = im !== rm;
  if (sync) {
    const next = { ...state, plugin_version: installed, updated: new Date().toISOString().replace(/[.]\d{3}Z$/, 'Z') };
    fs.writeFileSync(abs(root, PATHS.state), JSON.stringify(next, null, 2) + '\n');
    execFileSync(process.execPath, [path.join(HERE, 'state.mjs'), '--reseal'], { cwd: root, stdio: 'ignore' });
    out.push({ status: OK, text: line(OK, `synced plugin version ${recorded} -> ${installed}`, 'Commit .mavci/control/ so CI clones the matching tag.') });
    return;
  }
  out.push({
    status: major ? FAIL : WARN,
    text: line(major ? FAIL : WARN, `version skew: installed ${installed}, CI pinned to v${recorded}`,
      'Local hooks and CI are running different rule sets. Run /mavci-core:doctor --sync, then commit .mavci/control/state.json.'
      + (major ? ' This is a MAJOR difference, so the gate fails closed until it is resolved.' : '')),
  });
}

/**
 * DISTRIBUTION. The loaded plugin, the marketplace clone, and origin.
 *
 * Observed 2026-08-28, and the reason this check exists. v0.1.4 was committed
 * at 17:41 and the marketplace clone updated at 17:48, so it held 0.1.4.
 * v0.1.5 - which fixed the marketplace source form - was committed at 18:01.
 * A `/plugin marketplace update` at 18:17 refreshed a DIFFERENT marketplace and
 * left this one untouched, reporting no error. The clone stayed 13 minutes
 * behind a fix that was already pushed, and new-project then rendered a project
 * from the stale 0.1.4 template: the `url` marketplace form 0.1.5 had already
 * corrected, written into a project that looked entirely correct.
 *
 * Nothing could see it. The gate reads the project, not the toolchain that
 * produced it; verify runs the rules the stale plugin shipped; and "I ran the
 * update" is not evidence the clone moved. Doctor is the only thing positioned
 * to notice, because it is the only thing that can compare all three.
 *
 * Every arm WARNs rather than FAILs. Being behind origin is not a defect in the
 * project under inspection, and an offline machine must not be told its
 * configuration is broken. But it is never silent: an unknown answer is
 * reported as unknown, which is the invariant the rest of this file follows.
 */
/** ~/.claude, or wherever CLAUDE_CONFIG_DIR points. */
function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function clonePath() {
  return path.join(configDir(), 'plugins', 'marketplaces', MARKETPLACE_NAME);
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

function checkDistribution(out, { network = true } = {}) {
  const loaded = pluginVersion();
  const clone = clonePath();
  // Needed by the remediation text in BOTH branches below, so it is read before
  // the version comparison rather than inside the network-gated half.
  const branch = git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';

  if (!exists(clone)) {
    out.push({ status: WARN, text: line(WARN, 'marketplace clone NOT FOUND',
      `Expected at ${clone}. Without it the loaded plugin (${loaded}) cannot be compared`
      + '\n         with what the marketplace actually holds, so a stale install is undetectable.') });
    return;
  }

  /* --- 1. is the LOADED plugin what the clone holds? --- */
  const mk = readJsonOrNull(path.join(clone, '.claude-plugin', 'marketplace.json'));
  const subtree = mk?.plugins?.[0]?.source?.replace(/^\.\//, '') ?? `plugins/${PLUGIN_ID.split('@')[0]}`;
  const clonePl = readJsonOrNull(path.join(clone, subtree, '.claude-plugin', 'plugin.json'));

  if (!clonePl?.version) {
    out.push({ status: WARN, text: line(WARN, 'marketplace clone version UNREADABLE',
      `Could not read ${subtree}/.claude-plugin/plugin.json in ${clone}.`) });
  } else if (clonePl.version !== loaded) {
    // Name the NEWER of the two as the target. The old text always named the
    // clone's version, which is the STALE one whenever the clone is the half
    // that is behind - it told the operator to confirm an already-superseded
    // number.
    const target = newerVersion(loaded, clonePl.version);
    const cloneIsNewer = target !== loaded;
    out.push({ status: WARN, text: line(WARN,
      `loaded plugin ${loaded}, marketplace clone has ${clonePl.version}`,
      'The installed copy is not what the marketplace holds, so this session is running'
      + '\n         code that has already been superseded - and any project it scaffolds is'
      + `\n         rendered from ${loaded}'s templates.`
      + (cloneIsNewer
        ? `\n         ${target} is the newer of the two and is already in the clone. Install it:`
        : `\n         ${target} is the newer of the two and is already installed - the CLONE is the`
          + '\n         stale half. Move it forward, then reinstall so the two agree:')
      + `\n${propagationSteps(clone, branch)}`
      + `\n         Then RESTART the session and confirm doctor reports plugin ${target}.`
      + '\n         /plugin marketplace update does not move the clone (4 of 4) and claude plugin'
      + '\n         update does not move the install (1 of 1) - see NATIVE-CAPABILITIES 6.21.') });
  } else {
    out.push({ status: OK, text: line(OK, `loaded plugin ${loaded} matches the marketplace clone`) });
  }

  /* --- 2. is the CLONE current with origin? --- */
  if (!network) return;

  const head = git(clone, ['rev-parse', 'HEAD']);
  if (!head) {
    out.push({ status: WARN, text: line(WARN, 'marketplace clone is not a git checkout',
      `${clone} has no readable HEAD, so it cannot be compared with origin.`) });
    return;
  }
  const remote = git(clone, ['ls-remote', 'origin', branch]);
  if (remote === null) {
    out.push({ status: WARN, text: line(WARN, 'clone freshness NOT CHECKED',
      `Could not reach origin from ${clone} (offline, or no credential for a private repo).`
      + '\n         This is unknown, not current.') });
    return;
  }
  const remoteSha = remote.split(/\s+/)[0] ?? '';
  if (!remoteSha) {
    out.push({ status: WARN, text: line(WARN, 'clone freshness NOT CHECKED',
      `origin has no branch "${branch}" to compare against.`) });
    return;
  }
  if (remoteSha !== head) {
    out.push({ status: WARN, text: line(WARN,
      `marketplace clone is BEHIND origin/${branch}`,
      `clone ${head.slice(0, 7)}, origin ${remoteSha.slice(0, 7)}. The plugin you are running`
      + '\n         is older than what has been released, and it will keep producing output that'
      + '\n         looks correct while being generated by superseded code.'
      + '\n         Fix - BOTH links in the propagation chain are manual (6.21):'
      + `\n${propagationSteps(clone, branch)}`
      + '\n         Then RESTART the session and re-run doctor. Do not substitute /plugin marketplace'
      + '\n         update or claude plugin update: neither has been observed to move anything.') });
    return;
  }
  out.push({ status: OK, text: line(OK, `marketplace clone current with origin/${branch} (${head.slice(0, 7)})`) });
}

/* ------------------------------------------------- which GitHub account
 * A PERMISSION ERROR THAT READS AS ABSENCE.
 *
 * `gh` holds more than one account and switches between them globally. With the
 * wrong one active, every git and gh call against the system repo comes back
 * `Repository not found` - because a private repository is invisible to an
 * account without access, and GitHub deliberately does not distinguish "you may
 * not see this" from "this does not exist". Nothing in that message mentions
 * accounts. Observed on 2026-09-01: the operator very nearly recreated a
 * repository that had never gone anywhere.
 *
 * This runs BEFORE checkReleaseRun on purpose. That check makes exactly the API
 * call that 404s here, and reports it as "release job NOT CHECKED - gh is
 * unavailable, unauthenticated, or offline", which is three wrong explanations
 * for one right one.
 *
 * Compares logins, and nothing else. It needs no network, cannot be confused by
 * a rate limit, and answers the only question the 404 leaves open. What it
 * cannot see is whether some OTHER account has been granted access, so the
 * failure says so rather than asserting a state it has not established.
 */

/** @returns {{active: string|null, logins: string[]}|null} null = could not check. */
function readGhAccounts() {
  const gh = (args) => {
    try {
      return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    } catch (err) {
      // `gh auth status` exits 1 when any account has a token problem, and older
      // versions print to stderr. Both still carry the account list.
      const text = (err?.stdout?.toString() ?? '') + (err?.stderr?.toString() ?? '');
      return text || null;
    }
  };

  const raw = gh(['auth', 'status', '--json', 'hosts']);
  if (raw) {
    try {
      const hosts = JSON.parse(raw).hosts?.['github.com'] ?? [];
      const logins = hosts.map((h) => h.login).filter(Boolean);
      if (logins.length) return { active: hosts.find((h) => h.active)?.login ?? null, logins };
    } catch { /* not JSON: a gh too old for --json. Fall through. */ }
  }

  // Fallback, for a gh that predates `--json` on this command. The human form is
  // what the operator is told to run by hand, so parsing it costs nothing new -
  // and a version-gated check that silently stops running is the failure mode
  // this whole file exists to avoid.
  const text = gh(['auth', 'status']);
  if (!text) return null;
  const logins = [];
  let active = null;
  for (const chunk of text.split(/Logged in to \S+ account /).slice(1)) {
    const login = chunk.match(/^([\w.-]+)/)?.[1];
    if (!login) continue;
    logins.push(login);
    if (/Active account:\s*true/.test(chunk)) active = login;
  }
  return logins.length ? { active, logins } : null;
}

/** The decision, separated from the probe so it can be asserted on directly. */
export function ghAccountFinding(accounts, owner = SYSTEM_REPO.split('/')[0]) {
  if (!accounts) {
    return { status: WARN, text: line(WARN, 'active gh account NOT CHECKED',
      'gh is unavailable, or too old to report its accounts. This is unknown, not passing:\n'
      + `         with the wrong account active, every call against ${SYSTEM_REPO} returns\n`
      + '         "Repository not found", which reads as the repo being deleted.\n'
      + '         Check by hand: gh auth status') };
  }

  const { active, logins } = accounts;
  if (active === owner) {
    // All three outcomes say "active gh account" so that the self-test can prove
    // the check RAN without controlling which way it went. A wiring assertion
    // that only recognises the failure is a wiring assertion that passes on a
    // machine where the check was deleted.
    return { status: OK, text: line(OK, `the active gh account is ${active}, which owns ${SYSTEM_REPO}`) };
  }

  const others = logins.filter((l) => l !== active);
  const fix = logins.includes(owner)
    ? `gh auth switch --user ${owner}`
    : `gh auth login   (as ${owner} - it is not authenticated on this machine at all)`;
  return { status: FAIL, text: line(FAIL,
    active ? `the active gh account is ${active}, not ${owner}` : `no gh account is active; ${SYSTEM_REPO} needs ${owner}`,
    `${SYSTEM_REPO} is private, so from another account every git and gh call against it\n`
    + '         returns "Repository not found" - a permission error worded as absence. Nothing\n'
    + '         in that message mentions accounts, and it reads as the repo having been deleted.\n'
    + `         Fix: ${fix}`
    + (others.length ? `\n         Also authenticated here: ${others.join(', ')}` : '')
    + '\n         doctor compares logins. If the active account is a collaborator with access,\n'
    + '         this line is wrong - and it is the only thing checkable without a network call.') };
}

function checkGhAccount(out, { network = true } = {}) {
  if (!network) return;
  out.push(ghAccountFinding(readGhAccounts()));
}

/**
 * THE RELEASE JOB FOR THE VERSION YOU ARE ACTUALLY RUNNING.
 *
 * `release.yml` asserts that the tag matches `plugin.json`, and that assertion
 * is correct. It is also the only thing that checks it, it fires AFTER the tag
 * exists, and nothing downstream consults its verdict: fetching the clone,
 * uninstalling and installing are all manual operator steps that ask no CI
 * whether the release was sound.
 *
 * v0.1.8 is what that costs. Tagged with `plugin.json` still at 0.1.7; run
 * 33265540461 went red in 9 seconds on exactly that assertion; the tag
 * propagated and installed regardless. The operator did not see it, because
 * seeing it required opening the Actions tab of a repo they were not working in.
 * NATIVE-CAPABILITIES 6.24.
 *
 * `check-pretag.mjs` closes the door before the tag; this closes the loop after
 * it, on every machine that installed the release. The two are not redundant -
 * the pre-tag gate protects the person cutting, this protects everyone who
 * already pulled.
 *
 * Read strictly: a red release job for the INSTALLED version is a FAIL, not a
 * warning. It means the artefact on this machine came from a tree its own
 * release gate rejected. Anything unknown - gh missing, unauthenticated, no
 * network, no run found - is a WARN that names the manual command, never a pass.
 * An unchecked control is not a working control.
 */
function checkReleaseRun(out, { network = true } = {}) {
  if (!network) return;
  const version = pluginVersion();
  if (!version || version === 'unknown') return;
  const tag = `v${version}`;
  const manual = `gh run list --repo ${SYSTEM_REPO} --workflow release.yml --branch ${tag}`;

  let run = null;
  try {
    const raw = execFileSync('gh',
      ['api', `repos/${SYSTEM_REPO}/actions/workflows/release.yml/runs?branch=${tag}&per_page=1`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    run = JSON.parse(raw).workflow_runs?.[0] ?? false;
  } catch {
    out.push({ status: WARN, text: line(WARN, `release job for ${tag} NOT CHECKED`,
      'gh is unavailable, unauthenticated, or offline, so the release gate\'s verdict for the\n'
      + '         version on this machine is unknown. This is unknown, not passing.\n'
      + `         Check by hand: ${manual}`) });
    return;
  }

  if (run === false) {
    out.push({ status: WARN, text: line(WARN, `no release job has ever run for ${tag}`,
      'Either the tag was never pushed, or it was pushed without the workflow firing. The\n'
      + '         installed plugin therefore passed no release gate at all.\n'
      + `         Check by hand: ${manual}`) });
    return;
  }

  if (run.status !== 'completed') {
    out.push({ status: WARN, text: line(WARN, `release job for ${tag} is still ${run.status}`,
      `${run.html_url}`) });
    return;
  }

  if (run.conclusion === 'success') {
    out.push({ status: OK, text: line(OK, `release job for ${tag} passed`) });
    return;
  }

  out.push({ status: FAIL, text: line(FAIL, `the release job for ${tag} is ${String(run.conclusion).toUpperCase()}`,
    'This is the version installed on THIS machine, so the plugin you are running came from a\n'
    + '         tree its own release gate rejected. The most likely cause is the one that produced\n'
    + '         this check: plugin.json disagreeing with the tag, which makes every version number\n'
    + '         downstream - including the tag your projects\' CI clones - name the wrong tree.\n'
    + `         ${run.html_url}\n`
    + '         Fix in the system repo, then cut a new version with:\n'
    + '           node scripts/ci/check-pretag.mjs v<next> --cut') });
}

/**
 * INSTALL SCOPE. Which record in the registry is holding this plugin up.
 *
 * The bootstrap installs mavci-core ONCE PER MACHINE at user scope
 * (ARCHITECTURE section 2). That single record is what makes a project's
 * committed settings.json sufficient in every repo afterwards. The state this
 * check exists for is the one where that anchor is missing and the only record
 * left is PINNED to one directory:
 *
 *   { "scope": "project", "projectPath": "C:\\Projelerim\\gate4" }
 *
 * Observed 2026-08-28: with exactly that record and nothing else, a second
 * project carrying byte-equivalent settings, trust accepted, loaded no agents
 * and no hooks (6.20). The resolver answered for a different directory, and
 * every observable an operator would reach for still read as success.
 *
 * A pinned record ALONGSIDE a user-scope one is normal and harmless: Claude
 * Code writes it automatically at session start, because `fromOwnConfig` is
 * OR-ed across settings sources while scope is taken from the LAST source that
 * enabled the plugin - so a user-scope install plus a project's own settings
 * yields {scope: project, projectPath: cwd, fromOwnConfig: true} and the
 * auto-record fires (6.22). Failing on that would fail on every correctly
 * bootstrapped machine, in every project, immediately. So the FAIL is on the
 * ABSENCE OF AN ANCHOR, never on the presence of a pin.
 *
 * Read from the registry FILE, never from `claude plugin list`: section 11
 * requires this toolchain to run where Claude Code is not installed at all.
 */
function checkInstallScope(out) {
  const cfg = configDir();
  const registry = path.join(cfg, 'plugins', 'installed_plugins.json');
  // The registry is Claude Code's file, not ours. A malformed one is a
  // could-not-check, never a crash that takes the rest of the report with it.
  let db = null;
  try { db = readJsonOrNull(registry); } catch { db = null; }
  if (!db) {
    out.push({ status: WARN, text: line(WARN, 'install scope NOT CHECKED',
      `No readable plugin registry at ${registry}.`
      + '\n         Whether this machine ever ran the per-machine install is unknown, not passing.') });
    return;
  }

  const records = Array.isArray(db.plugins?.[PLUGIN_ID]) ? db.plugins[PLUGIN_ID] : [];
  const userSettings = readJsonOrNull(path.join(cfg, 'settings.json'));
  const enabledForUser = userSettings?.enabledPlugins?.[PLUGIN_ID] === true;

  // 'managed' is an administrator-deployed record. It anchors the machine the
  // same way a user record does, and it is not ours to tell anyone to remove.
  const anchors = records.filter((r) => r.scope === 'user' || r.scope === 'managed');
  const pins = records.filter((r) => r.scope === 'project' || r.scope === 'local');

  const pinLines = pins
    .map((r) => `           ${r.scope}: ${r.projectPath ?? '(no path recorded)'}`).join('\n');
  const removal = pins
    .map((r) => `           cd "${r.projectPath ?? '<that project>'}" && claude plugin uninstall ${PLUGIN_ID} --scope ${r.scope}`)
    .join('\n');

  if (!records.length) {
    out.push({ status: WARN, text: line(WARN, `${PLUGIN_ID} has no install record on this machine`,
      'This session loaded the plugin regardless - settings-alone resolution has been observed to\n'
      + '         work with an empty registry (6.20) - but that is not the path the bootstrap specifies,\n'
      + '         and it did not reproduce once a foreign project-scoped record existed. Run the\n'
      + '         per-machine step once, from anywhere:\n'
      + `           ${INSTALL_USER}`) });
    return;
  }

  if (!anchors.length) {
    out.push({ status: FAIL, text: line(FAIL,
      `${PLUGIN_ID} is registered ONLY at ${pins[0]?.scope ?? 'project'} scope`,
      'Every record for this plugin names one directory, so in EVERY OTHER PROJECT on this machine\n'
      + '         the resolver answers for a directory that is not the one being opened: no agents, no\n'
      + '         skills, NO HOOKS, nothing enforced, and no error at any layer. Pinned to:\n'
      + `${pinLines}\n`
      + '         Fix, in this order. Remove the pin AT ITS OWN SCOPE - uninstall defaults to\n'
      + '         --scope user, so the obvious command leaves a project record untouched - then\n'
      + '         install once for the machine:\n'
      + `${removal}\n`
      + `           ${INSTALL_USER}\n`
      + '         Then restart the session and confirm the agents are listed.') });
    return;
  }

  const anchor = anchors[0];
  const detail = pins.length
    ? `Plus ${pins.length} auto-recorded project pin(s), harmless while the anchor stands:\n${pinLines}`
    : '';
  out.push({ status: OK, text: line(OK,
    `${PLUGIN_ID} anchored at ${anchor.scope} scope (${anchor.version ?? 'unknown version'})`, detail) });

  if (anchor.scope === 'user' && !enabledForUser) {
    out.push({ status: WARN, text: line(WARN,
      `${PLUGIN_ID} has a user record but is not enabled in user settings`,
      `${path.join(cfg, 'settings.json')} has no enabledPlugins["${PLUGIN_ID}"] = true.\n`
      + '         The record and the enablement are written together by the install command, so one\n'
      + '         without the other means something edited settings afterwards. The anchor is only as\n'
      + `         good as the enablement. Re-run: ${INSTALL_USER}`) });
  }
}

/** The Windows drift documented at 5.16. */
function checkSettingsDrift(root, out) {
  const projSettings = readJsonOrNull(abs(root, '.claude/settings.json'));
  if (!projSettings) {
    out.push({ status: WARN, text: line(WARN, 'no .claude/settings.json', 'The tier-3 deny rules are missing. Re-run /mavci-core:connect.') });
    return;
  }
  const tpl = readJsonOrNull(TEMPLATE_SETTINGS);
  if (!tpl) {
    // Same rule as the CI-token probe: a check that could not run is UNKNOWN, not
    // passing. Returning silently here deleted the tier-3 deny-rule line from the
    // report entirely, so a report with no FAIL read as "deny rules are present".
    out.push({ status: WARN, text: line(WARN, 'tier-3 deny rules NOT CHECKED',
      'The reference template is missing, so this project cannot be diffed against it:\n'
      + `         ${TEMPLATE_SETTINGS}\n`
      + '         This is unknown, not passing. Reinstall the plugin and re-run doctor.') });
    return;
  }

  const tplDeny = new Set(tpl.permissions?.deny ?? []);
  const projDeny = new Set(projSettings.permissions?.deny ?? []);
  const missing = [...tplDeny].filter((r) => !projDeny.has(r));

  const tplAllow = new Set(tpl.permissions?.allow ?? []);
  const extraAllow = (projSettings.permissions?.allow ?? []).filter((r) => !tplAllow.has(r));

  if (missing.length) {
    out.push({ status: FAIL, text: line(FAIL, `${missing.length} tier-3 deny rule(s) missing`, missing.slice(0, 6).join('\n         ')) });
  } else {
    out.push({ status: OK, text: line(OK, `${tplDeny.size} tier-3 deny rules present`) });
  }

  if (extraAllow.length) {
    out.push({
      status: WARN,
      text: line(WARN, `${extraAllow.length} allow rule(s) added outside the template`,
        extraAllow.slice(0, 8).join('\n         ')
        + '\n         On Windows, "Yes, and don\'t ask again" writes into the COMMITTED settings file rather than'
        + '\n         settings.local.json. Review these in `git diff` and delete any you did not intend.'),
    });
  }

  if (projSettings.permissions?.disableBypassPermissionsMode !== 'disable') {
    out.push({ status: WARN, text: line(WARN, 'bypassPermissions is not disabled', 'Hook behaviour under bypassPermissions is unverified; the system is not certified for it.') });
  }
}

function checkMarketplace(root, out) {
  const s = readJsonOrNull(abs(root, '.claude/settings.json'));
  const mk = s?.extraKnownMarketplaces?.[MARKETPLACE_NAME];
  const enabled = s?.enabledPlugins?.[PLUGIN_ID];
  if (!mk || !enabled) {
    out.push({ status: WARN, text: line(WARN, 'marketplace not declared in project settings', `Expected extraKnownMarketplaces.${MARKETPLACE_NAME} and enabledPlugins["${PLUGIN_ID}"].`) });
    return;
  }

  // The source must be the `git` form pointing at SYSTEM_REPO EXACTLY. Printing
  // whatever is there and calling it ok is a fail-open: a marketplace Claude Code
  // cannot resolve means the plugin never installs, so no hook is registered and
  // NOTHING is enforced - the total-enforcement-failure case, reported green.
  //
  // THREE source forms look plausible and only one works (Gate 3, 6.4):
  //
  //   {"source":"git","url":"https://github.com/owner/repo.git"}   <- WORKS
  //     Cloned over HTTPS through the machine's ordinary git credential helper,
  //     which is the credential the onboarding protocol already requires.
  //
  //   {"source":"github","repo":"owner/repo"}                       <- SSH
  //     Resolves over SSH. It works on the machine that wrote it and fails on
  //     any machine with no SSH key loaded - the worst kind of defect, because
  //     it is invisible where it was authored.
  //
  //   {"source":"url","url":"https://github.com/owner/repo.git"}    <- 404
  //     `url` means "fetch a remote marketplace.json over HTTP", not "clone this
  //     git remote". Pointed at a .git address it 404s. This one is especially
  //     dangerous because it is what 0.1.3 and 0.1.4 shipped in the template and
  //     what doctor itself demanded: a checker that fails every project into the
  //     broken form is worse than no checker.
  //
  // A fourth way in is a settings file copied from the template but never filled
  // in, leaving the literal __SYSTEM_REPO__ placeholder in the source.
  const src = mk.source ?? {};
  const expected = `https://github.com/${SYSTEM_REPO}.git`;
  const fix = `Fix: "source": { "source": "git", "url": "${expected}" }  (or re-run ${COMMAND_PREFIX}connect)`;
  const shown = src.url ?? src.repo;

  if (typeof shown === 'string' && PLACEHOLDER_RE.test(shown)) {
    out.push({
      status: FAIL,
      text: line(FAIL, `marketplace ${MARKETPLACE_NAME} still contains a template placeholder: "${shown}"`,
        'Settings were copied but never filled in. Claude Code cannot resolve this marketplace,'
        + '\n         so the plugin never installs, no hook is registered, and nothing is enforced.'
        + `\n         ${fix}`),
    });
    return;
  }

  if (src.source === 'github') {
    out.push({
      status: FAIL,
      text: line(FAIL, `marketplace ${MARKETPLACE_NAME} uses the "github" source form`,
        'That form resolves over SSH. On any machine without an SSH key loaded the clone'
        + '\n         fails, the plugin never installs, and nothing is enforced there - while it keeps'
        + '\n         working on the machine that wrote it.'
        + `\n         ${fix}`),
    });
    return;
  }

  if (src.source === 'url') {
    out.push({
      status: FAIL,
      text: line(FAIL, `marketplace ${MARKETPLACE_NAME} uses the "url" source form`,
        '"url" means "fetch a remote marketplace.json over HTTP", not "clone this git remote".'
        + '\n         Against a .git address it 404s, so the marketplace never resolves, the plugin never'
        + '\n         installs, no hook is registered, and nothing is enforced.'
        + `\n         ${fix}`),
    });
    return;
  }

  if (src.source !== 'git' || src.url !== expected) {
    out.push({
      status: FAIL,
      text: line(FAIL, `marketplace ${MARKETPLACE_NAME} points at ${shown === undefined ? '(no source url)' : `"${shown}"`}`
        + `${src.source === undefined ? ' with no source form' : ` via source form "${src.source}"`}, not ${expected} via "git"`,
        'Claude Code cannot resolve this marketplace, so the plugin never installs,'
        + '\n         no hook is registered, and nothing is enforced at all.'
        + `\n         ${fix}`),
    });
    return;
  }

  out.push({ status: OK, text: line(OK, `marketplace ${MARKETPLACE_NAME} -> ${expected} (source form "git")`) });
}

/**
 * A protected environment with nothing to identify it protects nothing.
 *
 * risk-guard builds its protected set from the supabase_ref of every
 * environment marked `protected: true`, then drops the falsy ones:
 *
 *   protectedRefs = Object.values(environments).filter(e => e?.protected)
 *                     .map(e => e.supabase_ref).filter(Boolean)
 *
 * With no supabase_ref the set is EMPTY, and both arms that use it go inert -
 * the deny for a call naming a protected ref, and the confirm for a SQL call
 * naming no ref at all (`protectedRefs.size` is 0). So a manifest reading
 * `prod: { protected: true }` displays as protected, is described as protected
 * in the schema, and stops nothing: a write to the production database is
 * allowed without even a confirm.
 *
 * That is the fail-open shape this system exists to prevent, so it is a FAIL,
 * not a warning. Only meaningful when the project actually uses Supabase;
 * with `db: none` there is no ref to match and nothing to say.
 */
function checkProtectedEnvironments(root, out) {
  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  if (!manifest) {
    out.push({ status: WARN, text: line(WARN, 'protected environments NOT CHECKED',
      `${PATHS.manifest} is missing or unreadable. This is unknown, not passing.`) });
    return;
  }
  if (manifest.stack?.db !== 'supabase-postgres') {
    out.push({ status: OK, text: line(OK, 'protected environments n/a (project declares no Supabase database)') });
    return;
  }

  const envs = Object.entries(manifest.environments ?? {});
  const protectedEnvs = envs.filter(([, e]) => e?.protected === true);
  if (!protectedEnvs.length) {
    out.push({ status: WARN, text: line(WARN, 'no environment is marked protected',
      'risk-guard has nothing to hard-block, so an agent may write to any environment it can'
      + ' reach. Set `"protected": true` on prod in .mavci/project.json.') });
    return;
  }

  const blind = protectedEnvs.filter(([, e]) => !e.supabase_ref);
  if (blind.length) {
    const names = blind.map(([n]) => n).join(', ');
    out.push({ status: FAIL, text: line(FAIL,
      `${blind.length} protected environment(s) with no supabase_ref: ${names}`,
      'risk-guard matches an MCP call against the supabase_ref of each protected environment.'
      + '\n         With none recorded that set is empty, so BOTH guards are inert: a call naming'
      + '\n         the production project is allowed, and a SQL call naming no project is not even'
      + '\n         confirmed. This environment reads as protected and is not.'
      + `\n         Fix: add "supabase_ref" to environments.${blind[0][0]} in ${PATHS.manifest}.`) });
    return;
  }

  out.push({ status: OK, text: line(OK,
    `${protectedEnvs.length} protected environment(s) carry a supabase_ref`) });
}

function checkBaseline(root, out) {
  const b = readJsonOrNull(abs(root, PATHS.baseline));
  if (!b) {
    out.push({ status: WARN, text: line(WARN, 'no baseline', 'A greenfield project has an empty baseline; a connected repo should have one. Run /mavci-core:connect.') });
    return;
  }
  const n = b.entries.length;
  if (n === 0) { out.push({ status: OK, text: line(OK, 'baseline debt: 0') }); return; }
  const byCheck = new Map();
  for (const e of b.entries) byCheck.set(e.check_id, (byCheck.get(e.check_id) ?? 0) + 1);
  const top = [...byCheck].sort((a, b2) => b2[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${v}`);
  out.push({
    status: WARN,
    text: line(WARN, `baseline debt: ${n} pre-existing violation(s)`,
      top.join('\n         ') + '\n         These never block. They shrink when you fix them: /mavci-core:verify prunes automatically.'),
  });
}

function checkWaivers(root, out) {
  const w = readJsonOrNull(abs(root, PATHS.waivers));
  if (!w || !w.waivers.length) { out.push({ status: OK, text: line(OK, 'no waivers') }); return; }
  const expired = expiredWaivers(w);
  const soon = expiringWaivers(w, WAIVER_EXPIRY_WARN_DAYS);
  out.push({ status: OK, text: line(OK, `${w.waivers.length} waiver(s) active`) });
  if (soon.length) {
    out.push({ status: WARN, text: line(WARN, `${soon.length} waiver(s) expire within ${WAIVER_EXPIRY_WARN_DAYS} days`,
      soon.map((x) => `${x.check_id} at ${x.path} expires ${x.expires}`).join('\n         ')) });
  }
  if (expired.length) {
    out.push({ status: WARN, text: line(WARN, `${expired.length} waiver(s) EXPIRED and no longer apply`,
      expired.map((x) => `${x.check_id} at ${x.path} expired ${x.expires}`).join('\n         ')
      + '\n         The check blocks again. Fix it, or grant a fresh waiver with a current reason.') });
  }
}

/**
 * The CI token (blocker B4). Two separate questions, because they fail differently.
 *
 * PRESENCE is checkable: `gh` can list a repository's secret NAMES.
 * EXPIRY is not. GitHub exposes no API for a secret's value or a PAT's expiry
 * date, so the only thing that can be warned on is a date the operator recorded
 * in the manifest. That is a weaker guarantee than it looks, and saying so is
 * better than implying doctor knows something it cannot know.
 *
 * A lapsed token surfaces in CI as "repository not found", which reads like the
 * system repo was deleted. Thirty days of warning is worth the manual date entry.
 */
function checkCiToken(root, out) {
  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  const ci = manifest?.ci ?? {};
  const secretName = ci.token_secret ?? CI_TOKEN_SECRET;
  // Defaults to "repository": the system repo's owner is a user account, not a
  // GitHub organisation, so an org-level secret is not even possible unless the
  // operator has deliberately moved the repo under an org and recorded that here.
  const scope = ci.token_scope ?? 'repository';

  // --- presence -------------------------------------------------------
  const slug = repoSlug(root);
  if (!slug) {
    out.push({ status: WARN, text: line(WARN, 'no git remote', 'Cannot check whether ' + secretName + ' is configured.') });
  } else {
    const found = secretExists(slug, secretName, scope);
    if (found === null) {
      // WARN, not OK. The probe did not run, so this control is UNKNOWN, and an
      // unchecked control must never render as a checked one: reporting a green
      // line here tells the operator CI can clone the system repo when doctor has
      // no evidence either way. Under --preflight, OK is also silent - so the one
      // case where the operator most needs telling would print nothing at all.
      out.push({ status: WARN, text: line(WARN, `${secretName} presence NOT CHECKED`,
        'gh is unavailable or not authenticated, so doctor could not confirm the secret exists.\n'
        + '         This is unknown, not passing. Run `gh auth login`, then re-run doctor.') });
    } else if (found) {
      out.push({ status: OK, text: line(OK, `${secretName} is configured (${found})`) });
    } else {
      out.push({
        status: FAIL,
        text: line(FAIL, `${secretName} is NOT set for ${slug}`,
          'CI cannot clone the private system repo without it, so the standards checker never runs on push.\n'
          + `         Fix: gh secret set ${secretName} --body "<fine-grained PAT, Contents:read-only on ${SYSTEM_REPO}>"`
          + (scope === 'organization'
            ? `\n         Or once for every project: gh secret set ${secretName} --org ${SYSTEM_REPO.split('/')[0]} --body "<token>"`
            : '')),
      });
    }
  }

  // --- expiry ---------------------------------------------------------
  if (!ci.token_expires) {
    out.push({
      status: WARN,
      text: line(WARN, 'no CI token expiry recorded',
        'GitHub exposes no API for a PAT\'s expiry, so doctor can only warn from a date you record.\n'
        + '         Add to .mavci/project.json:  "ci": { "token_expires": "YYYY-MM-DD" }\n'
        + '         Without it, the token lapses silently and CI fails with "repository not found".'),
    });
    return;
  }

  const days = Math.floor((Date.parse(ci.token_expires + 'T00:00:00Z') - Date.now()) / 86_400_000);
  if (days < 0) {
    out.push({ status: FAIL, text: line(FAIL, `${secretName} EXPIRED ${-days} day(s) ago (${ci.token_expires})`,
      'CI has been failing at the checkout step since then. Mint a new PAT, update the secret, and update ci.token_expires.') });
  } else if (days <= CI_TOKEN_EXPIRY_WARN_DAYS) {
    out.push({ status: WARN, text: line(WARN, `${secretName} expires in ${days} day(s) (${ci.token_expires})`,
      'Rotate it before it lapses: a dead token fails CI with a message that does not mention tokens.') });
  } else {
    out.push({ status: OK, text: line(OK, `${secretName} valid for ${days} more day(s)`) });
  }
}

/** owner/repo for the project's own origin remote, or null. */
function repoSlug(root) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch { return null; }
}

/**
 * @returns {'repository'|'organization'|false|null}
 * null means "could not check" - gh missing or unauthenticated. That is reported
 * as an unknown, never as a pass: an unchecked control is not a working control.
 *
 * `scope` is ci.token_scope, defaulting to "repository". The orgs/ probe only
 * runs when the operator has declared an organisation-scoped secret. Firing it
 * unconditionally against a user-owned repo costs a guaranteed-404 call every
 * run and, worse, that 404 returns through the same catch as "gh is broken" -
 * so it makes "there is no org" and "could not check" indistinguishable.
 */
function secretExists(slug, name, scope = 'repository') {
  const has = (args) => {
    try {
      const out = execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
      return JSON.parse(out).secrets?.some((s) => s.name === name) ?? false;
    } catch { return null; }
  };
  const repo = has(['api', `repos/${slug}/actions/secrets`]);
  if (repo === true) return 'repository';
  // null propagates as "could not check", false as "absent" - never as a pass.
  if (scope !== 'organization') return repo;
  const org = has(['api', `orgs/${slug.split('/')[0]}/actions/secrets`]);
  if (org === true) return 'organization';
  if (repo === null && org === null) return null;
  return false;
}

/**
 * Every watermarked legal page, listed every run.
 *
 * `legal.pages_present` reports REVIEW REQUIRED as a warning during development,
 * because blocking every build turn on "a lawyer has not read this yet" is the
 * wrong gate in the wrong place. The trade for that leniency is that the debt is
 * never out of sight: doctor names each page, every time, and never collapses
 * the list to a count. An unreviewed legal page is a public claim the operator
 * has not verified, and it must not become background noise.
 *
 * Phase 1 condition: nothing built in Phase 1 goes to production. This check is
 * what keeps that visible rather than remembered.
 */
function checkLegalWatermarks(root, out) {
  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  const required = manifest?.compliance?.required_pages ?? [];
  if (!required.length) return;

  const marked = [];
  const absent = [];
  const unreadable = [];
  for (const slug of required) {
    const re = new RegExp(`^(?:src/)?app/(?:\\([^/]+\\)/)*${slug}/page\\.(tsx|ts|jsx|js|mdx)$`);
    const found = findFile(root, re);
    // A page that is not there was never inspected. It is not "reviewed", and it
    // must not fall through into the clean line below - which is what it used to
    // do, so a MISSING legal page printed as "no unreviewed legal pages".
    // findFile also swallows an unreadable app/ or src/ via `catch { continue }`,
    // and that arrives here as the same empty result, so it is reported the same.
    if (!found) { absent.push(slug); continue; }
    const text = readTextOrNull(abs(root, found));
    if (text === null) { unreadable.push(found); continue; }
    if (/REVIEW REQUIRED/i.test(text)) marked.push({ slug, path: found });
  }

  if (absent.length) {
    out.push({ status: WARN, text: line(WARN, `${absent.length} required legal page(s) NOT FOUND`,
      absent.join(', ')
      + '\n         Nothing was inspected for these, so their review status is unknown.'
      + '\n         Either the page is missing - legal.pages_present is the gate that blocks'
      + '\n         on that - or app/ could not be read at all.') });
  }

  if (unreadable.length) {
    out.push({ status: WARN, text: line(WARN, `${unreadable.length} legal page(s) could not be READ`,
      unreadable.join('\n         ')
      + '\n         Their watermark status is unknown, not clean.') });
  }

  if (!marked.length) {
    // Only claim a clean bill when every required page was actually inspected.
    if (!absent.length && !unreadable.length) {
      out.push({ status: OK, text: line(OK, `${required.length} legal page(s) present, none watermarked`) });
    }
    return;
  }

  out.push({
    status: WARN,
    text: line(WARN, `${marked.length} legal page(s) NOT reviewed by a lawyer`,
      marked.map((m) => `${m.path}   (${m.slug})`).join('\n         ')
      + '\n         These carry a REVIEW REQUIRED watermark. The checker verifies the required'
      + '\n         sections are present; it cannot judge legal sufficiency and does not claim to.'
      + '\n         DO NOT SHIP TO PRODUCTION until a lawyer has reviewed the text and the'
      + '\n         OPERATOR has removed the watermark. An agent may not remove it: deleting'
      + '\n         the marker asserts a review that did not happen.'),
  });
}

/** First repo-relative path matching `re`, searched shallowly under app/ and src/. */
function findFile(root, re) {
  const stack = ['app', 'src'];
  const seen = [];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(abs(root, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { stack.push(rel); continue; }
      seen.push(rel);
    }
  }
  return seen.find((p) => re.test(p)) ?? null;
}

/**
 * Queued system changes, NAMED.
 *
 * 0.1.12 tested one path: `.mavci/lessons/pending-system-change.md`. The file
 * that was actually queued the first time this ran was
 * `pending-system-change-0.1.12.md`, written by hand before `retro` existed, and
 * doctor was silent about it - because it was answering "is anything queued?"
 * with "does the name I picked in advance exist?".
 *
 * So this lists what is there rather than reporting that something is. Naming
 * the file is the whole point of the line: "a system change is queued" tells the
 * operator nothing they can act on, and `--clear` has no way to know which file
 * they meant either.
 */
function checkLessons(root, out) {
  let files;
  try {
    files = queuedLessons(root);
  } catch (err) {
    out.push({ status: WARN, text: line(WARN, 'queued system changes NOT CHECKED',
      `${PATHS.lessons} exists and could not be listed: ${err.message}\n`
      + '         Unknown, not empty. A finding filed here is the record of an unfixed problem,\n'
      + '         and doctor is the only thing that keeps saying so.') });
    return;
  }
  if (!files.length) return;

  const named = files.map((f) => {
    const text = readTextOrNull(abs(root, f));
    if (text === null) return `${f}   (UNREADABLE - queued, contents unknown)`;
    return `${f}   (${parseFindings(text).length} finding(s))`;
  });

  // "or delete it" used to end this line with no actor named. Deleting the
  // record of an unfixed problem is an operator act, and a remedy that does not
  // say so reads as an option to whoever is stuck - the same defect as "then
  // delete the REVIEW REQUIRED marker". `retro.mjs --clear` is denied to an
  // agent by the risk guard, so an agent that tried would hit a wall it was
  // sent to; saying it here is cheaper than that.
  out.push({
    status: WARN,
    text: line(WARN, `${files.length} system change file(s) queued and unapplied`,
      named.join('\n         ')
      + `\n         Apply them in the system repo with ${COMMAND_PREFIX}retro --apply, then clear`
      + `\n         each with ${COMMAND_PREFIX}retro --clear <name>.`
      + '\n         AUTHORITY: both are the operator\'s and the risk guard refuses them to an'
      + '\n         agent. Filing is not fixing, and clearing without applying loses the only'
      + '\n         record that the problem exists.'
      + `\n         Every ${PATHS.lessons}/${PENDING_STEM}*.md is counted, whoever wrote it.`),
  });
}

/**
 * ENFORCEMENT DID NOT RUN, and the gate has stopped saying so.
 *
 * The other half of Gate 4c finding 3, and the half that makes ending the turn
 * safe. `gate.mjs` blocks once on a checker fault and then lets the turn end,
 * because the agent cannot fix a checker it is forbidden to edit. What stops
 * that from being a plain fail-open is that something OUTSIDE the gate keeps
 * saying it happened - which is the Phase 2 design constraint applied here:
 * no component may be the only witness to its own failure.
 *
 * FAIL, not WARN. Invariant 5: "could not check" is never OK, and this marker
 * is the system's own record that it could not check. It clears on a clean gate
 * run and on nothing else, so a standing one is a live condition rather than
 * a stale note.
 */
function checkUnverified(root, out) {
  const m = readJsonOrNull(abs(root, PATHS.unverified));
  if (!m) return;
  const ageM = Math.round((Date.now() - Date.parse(m.last_at ?? m.since)) / 60_000);
  const detail = String(m.detail ?? '').split('\n').slice(0, 3).join('\n         ');
  out.push({
    status: FAIL,
    text: line(FAIL, `ENFORCEMENT DID NOT RUN - ${m.consecutive} turn(s), fault "${m.fault}", last ${ageM}m ago`,
      'The standards gate could not verify these turns, and stopped blocking so the session'
      + '\n         could continue. Code written in them was NEVER CHECKED. This is a fault in the'
      + '\n         checker, not in the project, and an agent is not permitted to repair it.'
      + `\n         ${PATHS.unverified} holds the full record. What it caught:`
      + `\n         ${detail}`
      + `\n         File it with ${COMMAND_PREFIX}retro, quoting that text. The marker clears only when a`
      + '\n         gate run passes cleanly - not when a turn merely ends, and not by deleting it.'
      + '\n         AUTHORITY: deleting this marker is the operator\'s, and deleting it instead of'
      + '\n         fixing the checker files "unverified" away rather than resolving it.'),
  });
}

function checkGateHeartbeat(root, out) {
  const last = readJsonOrNull(abs(root, PATHS.integrity))?.last_gate;
  if (!last?.at) {
    out.push({ status: WARN, text: line(WARN, 'the standards gate has never run here', 'Expected after any turn that edits files. If it never runs, hooks are not registered: check /plugin and restart the session.') });
    return;
  }
  const ageH = (Date.now() - Date.parse(last.at)) / 3_600_000;
  out.push({ status: OK, text: line(OK, `gate last ran ${ageH < 1 ? 'under an hour' : `${Math.round(ageH)}h`} ago (${last.verdict})`) });
}

/* ------------------------------------------------ hook REGISTRATION probe
 * Gate 3 finding, and the reason the self-test below is no longer allowed to
 * report a pass on its own.
 *
 * v0.1.2 installed cleanly and registered ZERO hooks - Claude Code rejected
 * every entry in hooks.json on a schema error and reported it nowhere doctor
 * could see. Meanwhile doctor printed "hook self-test passed (5 cases)",
 * because that test spawns the scripts itself. It was proving the scripts work,
 * which was never in question, while the thing that calls them did not exist.
 *
 * The only evidence that Claude Code actually loaded our hooks is an artefact
 * one of them wrote. `doctor.mjs --preflight` is wired as a SessionStart hook
 * and stamps control/hook-run.json; gate.mjs stamps integrity.json.last_gate.
 * Neither can be produced by anything but a hook Claude Code chose to run.
 *
 * Returns: 'proven' | 'absent' | 'version-skew' | 'stale' | 'unmatched'.
 */
const HOOK_RECEIPT_MAX_AGE_H = 12;

function checkHookRegistration(root, out) {
  const receipts = [lastHookRun(root), lastGate(root)].filter((r) => r?.at);
  if (!receipts.length) {
    out.push({
      status: FAIL,
      text: line(FAIL, 'NO PLUGIN HOOK HAS EVER RUN IN THIS PROJECT',
        'Claude Code did not register the plugin\'s hooks, so there is no risk guard, no'
        + '\n         standards gate and no phase gate here - nothing is enforced at all.'
        + '\n         The plugin can install cleanly and still register zero hooks: a schema error'
        + '\n         in hooks.json makes the loader drop every entry silently.'
        + '\n         Check: /plugin  ->  mavci-core  ->  Errors, then restart the session.'),
    });
    return 'absent';
  }

  const newest = receipts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const installed = pluginVersion();
  if (newest.plugin_version && newest.plugin_version !== installed) {
    out.push({
      status: FAIL,
      text: line(FAIL, `the registered hooks are from plugin ${newest.plugin_version}, not ${installed}`,
        'The plugin was updated but the session still holds the old hooks, or the new'
        + '\n         version failed to load. Restart the session, then re-run doctor.'),
    });
    return 'version-skew';
  }

  // Which of these Claude Code populates is version-dependent, so a match on
  // ANY of the three is proof. A match on none is not proof of failure.
  const mine = [process.env.CLAUDE_CODE_SESSION_ID, process.env.CLAUDE_PID].filter(Boolean).map(String);
  const theirs = [newest.session_id, newest.env_session_id, newest.parent_pid].filter((v) => v != null).map(String);
  if (mine.some((m) => theirs.includes(m))) {
    out.push({ status: OK, text: line(OK, `plugin hooks are registered (${newest.event ?? 'gate'} hook ran in this session)`) });
    return 'proven';
  }

  const ageH = (Date.now() - Date.parse(newest.at)) / 3_600_000;
  if (!(ageH < HOOK_RECEIPT_MAX_AGE_H)) {
    out.push({
      status: FAIL,
      text: line(FAIL, `no plugin hook has run for ${Math.round(ageH)}h`,
        'SessionStart fires on every session, so a receipt this old means the hooks are'
        + '\n         no longer registered. Check /plugin -> mavci-core -> Errors and restart.'),
    });
    return 'stale';
  }

  out.push({
    status: WARN,
    text: line(WARN, `a plugin hook ran ${Math.round(ageH * 60)}m ago, but not provably in THIS session`,
      'Claude Code did not expose a session id this run, so registration could not be'
      + '\n         confirmed for the current session. Restart the session if enforcement looks absent.'),
  });
  return 'unmatched';
}

/* ----------------------------------------------------------- hook selftest
 * Runs the guard against a command that MUST be denied and asserts the denial.
 * A config that parses is not evidence that a block still works.
 *
 * IMPORTANT: this proves the SCRIPTS behave. It says nothing about whether
 * Claude Code calls them - that is checkHookRegistration above, and this
 * function refuses to report a pass without it.
 */
function selftestHooks(out, registration) {
  const cases = [
    { name: 'rm -rf', input: { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, expect: 'deny' },
    { name: 'prod deploy', input: { tool_name: 'Bash', tool_input: { command: 'vercel deploy --prod' } }, expect: 'deny' },
    { name: 'control-plane edit', input: { tool_name: 'Edit', tool_input: { file_path: '.mavci/control/state.json' } }, expect: 'deny' },
    { name: 'read .env', input: { tool_name: 'Bash', tool_input: { command: 'cat .env.local' } }, expect: 'deny' },
    { name: 'ordinary build', input: { tool_name: 'Bash', tool_input: { command: 'npm run build' } }, expect: 'allow' },

    // Per-agent edit scope, driven by a PLUGIN-QUALIFIED agent_type - the form
    // Claude Code actually sends (`mavci-core:mavci-architect`), not the bare
    // form agent-scopes.json keys on.
    //
    // These two cases exist because the five above did not have an `agent_type`
    // between them, so this self-test asserted nothing whatsoever about the
    // per-agent scope control. On 2026-08-29 it printed "hook self-test passed
    // (5 cases)" in a session where that control was denying every edit by every
    // agent. Same shape as 0.1.2's zero registered hooks and 6.21's untested
    // command invocation: the probe and the thing it claims to prove were never
    // connected. NATIVE-CAPABILITIES 6.24.
    //
    // The first is the discriminating one - it is an ALLOW, and the broken build
    // returned deny. The second proves the fix did not simply disable the scope.
    { name: 'agent in scope (qualified)', expect: 'allow',
      input: { tool_name: 'Edit', tool_input: { file_path: '.mavci/tasks/0001-probe.md' },
        agent_type: 'mavci-core:mavci-architect' } },
    { name: 'agent out of scope (qualified)', expect: 'deny',
      input: { tool_name: 'Edit', tool_input: { file_path: 'app/page.tsx' },
        agent_type: 'mavci-core:mavci-architect' } },
  ];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-selftest-'));
  try {
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, 'templates', 'fixtures', 'selftest-project.json'),
      path.join(tmp, '.mavci', 'project.json'));

    const failures = [];
    for (const c of cases) {
      const payload = JSON.stringify({ ...c.input, cwd: tmp });
      let stdout = '';
      try {
        stdout = execFileSync(process.execPath, [path.join(HERE, 'risk-guard.mjs')],
          { input: payload, encoding: 'utf8', timeout: 15000 });
      } catch (err) {
        stdout = err.stdout?.toString() ?? '';
      }
      const decision = stdout.trim()
        ? (JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? 'allow')
        : 'allow';
      if (decision !== c.expect) failures.push(`${c.name}: expected ${c.expect}, got ${decision}`);
    }

    if (failures.length) {
      out.push({ status: FAIL, text: line(FAIL, 'HOOK SELF-TEST FAILED', failures.join('\n         ')
        + '\n         Enforcement is not working. This usually means Claude Code changed the hook'
        + '\n         output schema. Do NOT continue as if the system is protecting you.') });
    } else if (registration === 'proven') {
      out.push({ status: OK, text: line(OK, `hook self-test passed (${cases.length} cases), and the hooks that run them are registered`) });
    } else if (registration === 'unknown' || registration === 'unmatched') {
      out.push({ status: WARN, text: line(WARN, `hook self-test passed (${cases.length} cases) - SCRIPTS ONLY`,
        'This spawned the scripts directly, so it is not evidence that Claude Code calls them.'
        + (registration === 'unmatched'
          ? '\n         See the hook-registration line above.'
          : '\n         Hook registration can only be checked inside a connected project.')) });
    } else {
      // registration is 'absent', 'stale' or 'version-skew': the scripts are fine
      // and nothing invokes them. Reporting this as a pass is how v0.1.2 certified
      // an enforcement layer that did not exist.
      out.push({ status: FAIL, text: line(FAIL, `the guard scripts behave correctly (${cases.length} cases) but NOTHING CALLS THEM`,
        'The plugin\'s hooks are not registered, so every one of those denials is'
        + '\n         theoretical. Enforcement is absent. Fix registration first.') });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ main */

/**
 * SessionStart hands us JSON on stdin (4.8). Read it only when we are actually
 * running as a hook: `readFileSync(0)` on an interactive terminal would block.
 */
function readHookStdin() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function main() {
  const argv = process.argv.slice(2);
  const root = projectRoot();
  const preflight = argv.includes('--preflight');
  const sync = argv.includes('--sync');
  const out = [];

  // Stamp the registration receipt FIRST and unconditionally. Reaching this line
  // under --preflight means Claude Code ran a hook from this plugin, and that is
  // the only fact the later probe can trust. Best effort by design: a receipt we
  // could not write must never take the session down.
  if (preflight) {
    try { stampHookRun(root, { event: 'SessionStart', session_id: readHookStdin().session_id }); }
    catch { /* never let bookkeeping break a session */ }

    // The per-machine install is at USER scope, so this plugin resolves in
    // every repository on the machine and this hook now runs in repositories
    // that have nothing to do with Mavci. There is nothing to enforce there and
    // nothing to report - not even the toolchain warnings, because a stale
    // marketplace clone is not that repository's business. A standards plugin
    // that speaks up in someone's unrelated project is a standards plugin that
    // gets uninstalled.
    //
    // Scoped to the hook. The operator-invoked `/mavci-core:doctor` still
    // reports everything here, including "not a Mavci project".
    // check-hooks-quiet.mjs asserts both halves.
    if (!exists(abs(root, PATHS.manifest))) process.exit(0);
  }

  try {
    checkNode(out);
    checkLockedIdentifiers(out);
    // Not gated on `connected`: a stale plugin is a toolchain fault, and it is most
    // dangerous in exactly the directory that is about to be scaffolded.
    checkDistribution(out, { network: !preflight });
    // Before checkReleaseRun, which is the check that 404s on a wrong account
    // and calls it "gh is unavailable, unauthenticated, or offline".
    checkGhAccount(out, { network: !preflight });
    // Same network gating as checkDistribution: a SessionStart hook must not
    // make an API call on every session in every repo on the machine.
    checkReleaseRun(out, { network: !preflight });
    // Also not gated on `connected`: a machine with no anchor is broken for
    // every project on it, and the directory about to be scaffolded is exactly
    // where that needs saying.
    checkInstallScope(out);
    const connected = checkConnected(root, out);
    if (connected) {
      checkManifestVersion(root, out);
      checkGuardianCorpus(root, out);
      checkIntegrity(root, out);
      checkSchemas(root, out);
      checkVersionSkew(root, out, { sync });
      checkSettingsDrift(root, out);
      checkMarketplace(root, out);
      checkProtectedEnvironments(root, out);
      checkCiToken(root, out);
      checkBaseline(root, out);
      checkWaivers(root, out);
      checkLegalWatermarks(root, out);
      checkGateHeartbeat(root, out);
      // Before the heartbeat's "gate last ran (pass)" line would be read as reassurance.
      checkUnverified(root, out);
      checkLessons(root, out);
    }
    // Outside a connected project there is no control/ directory to hold a
    // receipt, so registration is unknowable rather than absent. 'unknown'
    // still refuses to let the self-test below print a clean pass.
    const registration = connected ? checkHookRegistration(root, out) : 'unknown';
    if (!preflight) selftestHooks(out, registration);
  } catch (err) {
    out.push({ status: FAIL, text: line(FAIL, 'doctor crashed', err.message) });
  }

  const fails = out.filter((o) => o.status === FAIL);
  const warns = out.filter((o) => o.status === WARN);

  if (preflight) {
    // SessionStart: silent unless something is actually wrong. A greeting every
    // session is noise, and noise is what gets hook output ignored.
    if (!fails.length && !warns.length) process.exit(0);
    const msg = [...fails, ...warns].map((o) => o.text).join('\n');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `Mavci health check:\n${msg}\n\nRun /mavci-core:doctor for the full report.`,
      },
    }));
    process.exit(0);
  }

  console.log(`\nMavci doctor - plugin ${pluginVersion()}\n`);
  for (const o of out) console.log(o.text);
  console.log(`\n  ${out.length - fails.length - warns.length} ok, ${warns.length} warning(s), ${fails.length} failure(s)\n`);
  process.exit(fails.length ? 1 : 0);
}

// Guarded so the self-test can import the decision functions above without
// running a whole report. basename, not endsWith: `check-doctor.mjs` ends with
// "doctor.mjs" and would otherwise run main() on import.
if (process.argv[1] && path.basename(process.argv[1]) === 'doctor.mjs') main();

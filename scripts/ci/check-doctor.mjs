#!/usr/bin/env node
/**
 * Regression tests for doctor's HOOK REGISTRATION probe.
 *
 * The bug this exists for: v0.1.2 installed cleanly, Claude Code rejected all
 * eight entries in hooks.json on a schema error, the plugin registered ZERO
 * hooks - and doctor reported "hook self-test passed (5 cases)". That test
 * spawns the guard scripts itself, so it was proving the scripts work, which
 * was never in doubt, while the thing that calls them did not exist. Doctor
 * certified an enforcement layer that was entirely absent.
 *
 * Every case below asserts a FAIL. A probe that cannot fail is not a probe, and
 * that is exactly the class of defect being fixed here - so the assertions are
 * on the failures, not on the happy path alone.
 *
 * Section 7 covers the MARKETPLACE SOURCE FORM, which is the same class of bug
 * one layer up: 0.1.3 and 0.1.4 shipped `{"source":"url"}` in the template and
 * had doctor demand it, so the checker drove every project into a form that
 * 404s - installing no plugin, registering zero hooks, and enforcing nothing.
 * A checker that certifies the broken configuration is worse than no checker.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const DOCTOR = path.join(SCRIPTS, 'doctor.mjs');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { PATHS, MARKETPLACE_NAME, PLUGIN_ID, SYSTEM_REPO } =
  await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));
const PLUGIN_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json'), 'utf8')).version;

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-doctor-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  return tmp;
}

/** Run doctor against a project. Never throws; returns stdout plus exit status. */
function runDoctor(cwd, { args = [], env = {}, input = '' } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [DOCTOR, ...args], {
      cwd, input, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '', ...env },
    });
    return { stdout, status: 0 };
  } catch (err) {
    return { stdout: err.stdout?.toString() ?? '', status: err.status ?? -1 };
  }
}

const cleanup = [];
try {

/* --- 1. no receipt at all: the Gate 3 case ---------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const r = runDoctor(tmp);
  if (r.status === 1 && /NO PLUGIN HOOK HAS EVER RUN/.test(r.stdout)) {
    ok('a project where no hook ever ran FAILS doctor');
  } else {
    bad(`no-receipt: expected exit 1 and "NO PLUGIN HOOK HAS EVER RUN", got status=${r.status}`);
  }
  if (/NOTHING CALLS THEM/.test(r.stdout)) {
    ok('the hook self-test refuses to report a pass when nothing is registered');
  } else {
    bad('no-receipt: the hook self-test still reported a pass. This is the exact v0.1.2 defect: '
      + 'the scripts behave, nothing calls them, and doctor certifies the enforcement layer anyway.');
  }
}

/* --- 2. --preflight stamps a receipt, and it is believed --------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const pre = runDoctor(tmp, {
    args: ['--preflight'],
    env: { CLAUDE_CODE_SESSION_ID: 'session-A' },
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'session-A', cwd: tmp }),
  });
  if (pre.status !== 0) bad(`--preflight exited ${pre.status}; a SessionStart hook must never fail the session`);
  else ok('--preflight exits 0');

  const receiptPath = path.join(tmp, PATHS.hookRun);
  if (!fs.existsSync(receiptPath)) {
    bad('--preflight did not write control/hook-run.json, so registration can never be proven');
  } else {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.session_id === 'session-A' && receipt.plugin_version === PLUGIN_VERSION) {
      ok('--preflight records the session id from hook stdin and the plugin version');
    } else {
      bad(`receipt is wrong: ${JSON.stringify(receipt)}`);
    }

    // Locked format rules, ROADMAP "Data-format constraints": schema_version,
    // project_id, ISO-8601 UTC, closed enums.
    if (receipt.schema_version === 1 && receipt.project_id === MANIFEST.project_id
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.]\d+)?Z$/.test(receipt.at ?? '')) {
      ok('the receipt carries schema_version, project_id and an ISO-8601 UTC timestamp');
    } else {
      bad(`receipt violates the locked state-file format: ${JSON.stringify(receipt)}`);
    }

    // The receipt is covered by state.schema_valid, so a malformed one is a
    // blocker rather than something the gate walks past.
    const errs = state.validateAll(tmp);
    if (errs.length === 0) ok('a stamped receipt passes state.schema_valid');
    else bad(`a freshly stamped receipt fails validateAll: ${JSON.stringify(errs)}`);

    const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-A' } });
    if (/\[ok  \] plugin hooks are registered/.test(r.stdout)) {
      ok('a receipt from this session proves registration');
    } else {
      bad('a fresh matching receipt was not accepted as proof of registration');
    }
  }
}

/* --- 3. a receipt from another plugin version is not proof ------------ */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify({
    schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: new Date().toISOString(),
    plugin_version: '0.0.1-old', session_id: 'session-B', env_session_id: null, parent_pid: null,
  }, null, 2));
  const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-B' } });
  if (r.status === 1 && /are from plugin 0\.0\.1-old/.test(r.stdout)) {
    ok('a receipt from a different plugin version FAILS');
  } else {
    bad(`version skew: expected exit 1 and a version-skew line, got status=${r.status}`);
  }
}

/* --- 4. a stale receipt is not proof ---------------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const old = new Date(Date.now() - 72 * 3_600_000).toISOString();
  fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify({
    schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: old,
    plugin_version: PLUGIN_VERSION, session_id: 'long-gone', env_session_id: null, parent_pid: null,
  }, null, 2));
  const r = runDoctor(tmp, { env: { CLAUDE_CODE_SESSION_ID: 'session-C' } });
  if (r.status === 1 && /no plugin hook has run for \d+h/.test(r.stdout)) {
    ok('a receipt older than the freshness window FAILS');
  } else {
    bad(`stale receipt: expected exit 1 and a staleness line, got status=${r.status}`);
  }
}

/* --- 5. the receipt cannot be written outside control/ ---------------- */
// stampHookRun is deliberately best-effort: it must return null rather than
// throw when there is nowhere to write, or a SessionStart hook in a
// non-project directory would take the session down with it.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-doctor-bare-'));
  cleanup.push(tmp);
  let threw = null;
  let result = 'not-called';
  try { result = state.stampHookRun(tmp, { event: 'SessionStart', session_id: 'x' }); }
  catch (err) { threw = err; }
  if (!threw && result === null) ok('stampHookRun returns null, not a throw, outside a project');
  else bad(`stampHookRun outside a project: threw=${threw?.message ?? 'no'} result=${JSON.stringify(result)}`);

  const r = runDoctor(tmp, { args: ['--preflight'], input: '' });
  if (r.status === 0) ok('--preflight in a non-project directory still exits 0');
  else bad(`--preflight outside a project exited ${r.status}`);
}

/* --- 6. state.schema_valid really covers the receipt ------------------ */
// "It has a schema" is worth exactly as much as the schema being enforced.
// Without this, hook-run.schema.json could sit unreferenced in templates/schemas/
// and every claim about it would still read as true.
{
  const tmp = makeProject(); cleanup.push(tmp);
  const cases = [
    [{ schema_version: 1, event: 'SessionStart', at: new Date().toISOString(), plugin_version: '1.0.0' },
      'project_id', 'a receipt with no project_id'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'Whenever', at: new Date().toISOString(), plugin_version: '1.0.0' },
      'event', 'an event outside the closed enum'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: '28/08/2026', plugin_version: '1.0.0' },
      'at', 'a timestamp that is not ISO-8601'],
    [{ schema_version: 1, project_id: MANIFEST.project_id, event: 'SessionStart', at: new Date().toISOString(), plugin_version: '1.0.0', rogue: true },
      'rogue', 'an undeclared property'],
  ];
  for (const [doc, needle, label] of cases) {
    fs.writeFileSync(path.join(tmp, PATHS.hookRun), JSON.stringify(doc, null, 2));
    const errs = state.validateAll(tmp);
    if (errs.some((e) => String(e).includes(PATHS.hookRun) && String(e).includes(needle))) {
      ok(`state.schema_valid rejects ${label}`);
    } else {
      bad(`state.schema_valid ACCEPTED ${label}. The receipt's schema is not enforced: ${JSON.stringify(errs)}`);
    }
  }

  // stampHookRun must refuse to write a receipt it knows is invalid, rather than
  // leaving one behind that blocks the next gate.
  fs.rmSync(path.join(tmp, PATHS.hookRun), { force: true });
  const written = state.stampHookRun(tmp, { event: 'NotAnEvent', session_id: 'x' });
  if (written === null && !fs.existsSync(path.join(tmp, PATHS.hookRun))) {
    ok('stampHookRun refuses to write a receipt that would fail its own schema');
  } else {
    bad('stampHookRun wrote an invalid receipt, which would fail state.schema_valid on the next gate');
  }
}

/* --- 7. the marketplace source form ----------------------------------
 * Exactly one of the four documented forms resolves (NATIVE-CAPABILITIES 6.4).
 * Each wrong one must FAIL, and each failure must print the form that works -
 * a FAIL that does not say what to write instead just moves the guessing.
 */
{
  const EXPECTED = `https://github.com/${SYSTEM_REPO}.git`;

  const writeSettings = (dir, source) => {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
      extraKnownMarketplaces: { [MARKETPLACE_NAME]: { source } },
      enabledPlugins: { [PLUGIN_ID]: true },
    }, null, 2));
  };

  const cases = [
    [{ source: 'github', repo: SYSTEM_REPO }, /uses the "github" source form/,
      'the "github" form (resolves over SSH)'],
    [{ source: 'url', url: EXPECTED }, /uses the "url" source form/,
      'the "url" form (fetches a remote marketplace.json; 404s on a .git address)'],
    [{ source: 'url', url: 'https://github.com/__SYSTEM_REPO__.git' }, /template placeholder/,
      'an unsubstituted __SYSTEM_REPO__ placeholder'],
    [{ source: 'git', url: 'https://github.com/someone-else/other.git' }, /points at/,
      'the right form pointing at the wrong repo'],
    [{ source: 'git' }, /points at/, 'the right form with no url at all'],
  ];

  for (const [source, re, label] of cases) {
    const tmp = makeProject(); cleanup.push(tmp);
    writeSettings(tmp, source);
    const r = runDoctor(tmp);
    const hit = re.exec(r.stdout);
    if (!hit) {
      bad(`doctor did NOT fail ${label}. A project configured this way installs no plugin, `
        + 'registers zero hooks and enforces nothing, and doctor would call it green.');
      continue;
    }
    // The FAIL must be a FAIL, not a warning dressed as one.
    const failLine = r.stdout.split('\n').find((l) => re.test(l));
    if (!/\[fail\]/i.test(failLine ?? '')) {
      bad(`doctor reported ${label} but not as a FAIL: ${failLine}`);
      continue;
    }
    // And it must name the form that works.
    if (!r.stdout.includes(`"source": "git", "url": "${EXPECTED}"`)) {
      bad(`doctor failed ${label} without printing the working form. `
        + 'The operator is left to guess, which is how the "url" form got shipped.');
      continue;
    }
    ok(`doctor FAILS ${label}, and prints the "git" form as the fix`);
  }

  // The happy path: the one form that works must pass, or doctor fails every
  // correctly configured project - which is the 0.1.4 defect with the sign flipped.
  {
    const tmp = makeProject(); cleanup.push(tmp);
    writeSettings(tmp, { source: 'git', url: EXPECTED });
    const r = runDoctor(tmp);
    if (r.stdout.includes(`[ok  ] marketplace ${MARKETPLACE_NAME} -> `)) {
      ok('doctor accepts the "git" form pointing at the system repo');
    } else {
      bad('doctor did not accept the ONLY marketplace source form that works. '
        + 'Every correctly configured project would be told to change it.');
    }
  }

  // The template every project is written from must be the form doctor accepts.
  // These two drifted apart in 0.1.3 and nothing noticed for two releases.
  {
    const tmplSrc = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/templates/project.settings.json'), 'utf8'))
      .extraKnownMarketplaces?.[MARKETPLACE_NAME]?.source;
    const tmp = makeProject(); cleanup.push(tmp);
    writeSettings(tmp, { ...tmplSrc, url: String(tmplSrc?.url ?? '').replace('__SYSTEM_REPO__', SYSTEM_REPO) });
    const r = runDoctor(tmp);
    if (r.stdout.includes(`[ok  ] marketplace ${MARKETPLACE_NAME} -> `)) {
      ok('templates/project.settings.json writes the form doctor accepts');
    } else {
      bad('doctor REJECTS the marketplace source form that templates/project.settings.json writes. '
        + 'Connect would configure every project into a state doctor calls broken.');
    }
  }
}

/* --- 8. distribution: loaded plugin vs marketplace clone vs origin ----
 * A stale marketplace clone produces output that looks correct and is generated
 * by superseded code. Observed 2026-08-28: `/plugin marketplace update` refreshed
 * one marketplace, silently skipped this one, and new-project then rendered a
 * project from a template that had already been fixed and released.
 *
 * Doctor is the only component positioned to see it, so the check must be PROVEN
 * to fire. Both cases assert a WARN, not a pass: a freshness probe that cannot
 * report staleness is the same fail-open shape as a doctor that certifies a
 * broken marketplace form.
 */
{
  const stageClone = (version) => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-cfg-'));
    cleanup.push(cfg);
    const name = PLUGIN_ID.split('@')[0];
    const clone = path.join(cfg, 'plugins', 'marketplaces', MARKETPLACE_NAME);
    const sub = path.join(clone, 'plugins', name, '.claude-plugin');
    fs.mkdirSync(path.join(clone, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(clone, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: MARKETPLACE_NAME, plugins: [{ name, source: `./plugins/${name}` }] }, null, 2));
    fs.writeFileSync(path.join(sub, 'plugin.json'), JSON.stringify({ name, version }, null, 2));
    return cfg;
  };

  const tmp = makeProject(); cleanup.push(tmp);

  // A clone holding a DIFFERENT version than the loaded plugin.
  const r1 = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: stageClone('99.99.99') } });
  if (/\[WARN\] loaded plugin .*marketplace clone has 99\.99\.99/.test(r1.stdout)) {
    ok('doctor WARNs when the loaded plugin differs from the marketplace clone');
  } else {
    bad('doctor did NOT report a loaded plugin differing from the marketplace clone. A session '
      + 'running superseded code, and every project it scaffolds, would look clean.');
  }

  // No clone at all: unknown, and unknown must be reported rather than skipped.
  const missing = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-nocfg-'));
  cleanup.push(missing);
  const r2 = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: missing } });
  if (/\[WARN\] marketplace clone NOT FOUND/.test(r2.stdout)) {
    ok('doctor reports an absent marketplace clone as unknown rather than passing');
  } else {
    bad('doctor was SILENT with no marketplace clone present. An absent line reads as a pass.');
  }
}

/* --- 9. install scope: which record is holding the plugin up ----------
 *
 * The state this exists for. An in-session `/plugin install` takes no scope
 * argument, so run in a project whose settings enable the plugin it writes
 * `{"scope":"project","projectPath":"<that directory>"}` - and that record is
 * then the only answer the resolver has for every OTHER project on the machine.
 * Observed 2026-08-28: a second project with byte-equivalent settings and trust
 * accepted loaded no agents and no hooks, and said nothing about it (6.20).
 *
 * The opposite error is just as bad and much easier to make. Claude Code writes
 * a project record AUTOMATICALLY at session start on any correctly bootstrapped
 * machine (6.22), so a check that FAILs on the presence of a project record
 * would FAIL in every project, on every healthy machine, permanently - and a
 * checker that cries wolf everywhere is a checker nobody reads. Both directions
 * are asserted here.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);

  /** A fake CLAUDE_CONFIG_DIR holding just a plugin registry and user settings. */
  const registry = (records, userEnabled) => {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-registry-'));
    cleanup.push(cfg);
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { [PLUGIN_ID]: records } }, null, 2));
    fs.writeFileSync(path.join(cfg, 'settings.json'),
      JSON.stringify({ enabledPlugins: userEnabled ? { [PLUGIN_ID]: true } : {} }, null, 2));
    return cfg;
  };

  const PIN = { scope: 'project', installPath: 'x', version: PLUGIN_VERSION, projectPath: 'C:\\Projelerim\\gate4' };
  const ANCHOR = { scope: 'user', installPath: 'x', version: PLUGIN_VERSION };

  // 9a. a pin and nothing else: the state that breaks every other project.
  {
    const r = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: registry([PIN], false) } });
    const failed = r.status === 1;
    const named = /registered ONLY at project scope/.test(r.stdout)
      && r.stdout.includes('C:\\Projelerim\\gate4');
    const remedy = /claude plugin uninstall .*--scope project/.test(r.stdout)
      && /claude plugin install .*--scope user/.test(r.stdout);
    if (failed && named) {
      ok('a project-scoped record with no user anchor FAILS doctor, and the pinned repo is named');
    } else {
      bad(`project-only registry: expected exit 1 naming the pinned repo, got status=${r.status}`);
    }
    if (remedy) {
      ok('the failure prints both the scoped uninstall and the user-scope install');
    } else {
      bad('the failure does not tell the operator how to fix it: uninstall defaults to --scope user, '
        + 'so without the exact command the pin survives the obvious attempt');
    }
  }

  // 9b. anchor plus the auto-recorded pin: the NORMAL state. Must not fail.
  {
    const r = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: registry([ANCHOR, PIN], true) } });
    if (!/registered ONLY at/.test(r.stdout) && /anchored at user scope/.test(r.stdout)) {
      ok('a user anchor alongside an auto-recorded project pin is reported as OK, not as a fault');
    } else {
      bad('doctor treats the auto-recorded project pin as a fault. Claude Code writes that record '
        + 'itself at session start (6.22), so this FAILs on every healthy machine in every project.');
    }
    if (r.stdout.includes('C:\\Projelerim\\gate4')) {
      ok('the pin is still listed, so an operator can see what would be left if the anchor went');
    } else {
      bad('the pin is invisible in the healthy case; removing the anchor would then be a silent cliff');
    }
  }

  // 9c. an empty registry. Observed to load anyway (6.20, gate3-b), so it is
  //     unknown territory rather than a defect - but it is never silence.
  {
    const r = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: registry([], false) } });
    // The exit code belongs to the whole report - this fixture has other
    // failures - so assert on the scope lines themselves.
    const warned = /\[WARN\] mavci-core@mavci has no install record on this machine/.test(r.stdout)
      && /claude plugin install mavci-core@mavci --scope user/.test(r.stdout);
    const notFailed = !/\[FAIL\] mavci-core@mavci is registered ONLY/.test(r.stdout);
    if (warned && notFailed) {
      ok('an empty registry is reported as a WARN with the install command, not as a FAIL');
    } else {
      bad(`empty registry: expected a WARN naming the per-machine install, warned=${warned} notFailed=${notFailed}`);
    }
  }

  // 9d. an unreadable registry is a could-not-check, and must not take the
  //     rest of the report down with it.
  {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-registry-bad-'));
    cleanup.push(cfg);
    fs.mkdirSync(path.join(cfg, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(cfg, 'plugins', 'installed_plugins.json'), '{ not json');
    const r = runDoctor(tmp, { env: { CLAUDE_CONFIG_DIR: cfg } });
    if (/install scope NOT CHECKED/.test(r.stdout) && !/doctor crashed/.test(r.stdout)) {
      ok('a malformed registry is reported as unknown, and doctor still finishes its report');
    } else {
      bad('a malformed registry crashed doctor or was passed over silently');
    }
  }
}

/* --- 10. which gh account is active -----------------------------------
 *
 * A PERMISSION ERROR THAT READS AS ABSENCE. `gh` switches accounts globally,
 * and against a private repo the wrong one returns `Repository not found` -
 * indistinguishable from a deleted repository, and mentioning no account
 * anywhere. Observed 2026-09-01: the operator nearly recreated a repo that had
 * never gone anywhere.
 *
 * The decision is asserted directly, because the probe cannot be steered from
 * here on every platform - and then the wiring is asserted separately, because
 * a correct decision function nothing calls is the defect this whole file is
 * about.
 */
{
  const doctor = await import(pathToFileURL(DOCTOR).href);
  const OWNER = SYSTEM_REPO.split('/')[0];
  const OTHER = 'globalmvpllc-oss';   // the account that was actually active
  // Asserted on the rendered line, which is what the operator reads. doctor's
  // status constants are internal, and a check that imported them would agree
  // with itself rather than with the report.
  const decide = (accounts) => doctor.ghAccountFinding(accounts, OWNER).text;

  // 10a. the healthy case
  {
    const r = decide({ active: OWNER, logins: [OWNER, OTHER] });
    if (r.startsWith('  [ok') && r.includes(OWNER)) ok('the owner being active reads as OK');
    else bad(`active owner did not report OK: ${r}`);
  }

  // 10b. the observed case: wrong account active, owner authenticated here
  {
    const r = decide({ active: OTHER, logins: [OWNER, OTHER] });
    const named = r.includes(OTHER) && r.includes(OWNER);
    const remedy = r.includes(`gh auth switch --user ${OWNER}`);
    const explains = /Repository not found/.test(r);
    if (r.startsWith('  [FAIL]') && named && remedy) {
      ok('a mismatched active account FAILS, names both accounts, and prints gh auth switch');
    } else {
      bad(`mismatched account: named=${named} remedy=${remedy}, line was ${r.split('\n')[0]}. A WARN `
        + 'here is not enough - every call against the system repo is failing and saying nothing true.');
    }
    if (explains) {
      ok('the failure explains that "Repository not found" is the symptom, not evidence of deletion');
    } else {
      bad('the failure does not connect the account to the 404. Without that sentence the operator '
        + 'reads "Repository not found" and concludes the repo is gone.');
    }
  }

  // 10c. the owner is not authenticated at all. `gh auth switch --user X` fails
  //      when X has never logged in, so the switch remedy is the adjacent-but-
  //      wrong one here: it sends the operator to a command that errors.
  {
    const r = decide({ active: OTHER, logins: [OTHER] });
    if (r.startsWith('  [FAIL]') && /gh auth login/.test(r) && !r.includes('gh auth switch')) {
      ok('an owner who is not authenticated here gets gh auth login, not a switch that would fail');
    } else {
      bad(`owner absent: expected FAIL with gh auth login and no switch remedy, got: ${r}`);
    }
  }

  // 10d. could not check is never a pass (invariant 5)
  {
    const r = decide(null);
    if (r.startsWith('  [WARN]') && /NOT CHECKED/.test(r)) {
      ok('gh being unavailable is reported as unknown, never as a passing account check');
    } else {
      bad(`unreadable gh state: expected WARN NOT CHECKED, got: ${r.split('\n')[0]}`);
    }
  }

  // 10e. WIRING. The three outcomes share the phrase "active gh account", so
  //      this proves the check ran without having to control which way it went.
  {
    const tmp = makeProject(); cleanup.push(tmp);
    const r = runDoctor(tmp);
    if (/active gh account/.test(r.stdout)) {
      ok('doctor reports on the active gh account in its own run');
    } else {
      bad('doctor never mentions the active gh account. The decision function is correct and '
        + 'nothing calls it, which is exactly the shape this file exists to catch.');
    }
  }

  // 10f. END TO END, with a gh that answers. execFileSync resolves a PATH entry
  //      directly on POSIX; on Windows a .cmd shim cannot be spawned without a
  //      shell, so the substitution is skipped there and said out loud rather
  //      than passed over.
  if (process.platform !== 'win32') {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-fakegh-'));
    cleanup.push(bin);
    const hosts = JSON.stringify({ hosts: { 'github.com': [
      { login: OTHER, active: true }, { login: OWNER, active: false },
    ] } });
    fs.writeFileSync(path.join(bin, 'gh'),
      `#!/bin/sh\nif [ "$1" = "auth" ]; then printf '%s' '${hosts}'; exit 0; fi\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);

    const tmp = makeProject(); cleanup.push(tmp);
    const r = runDoctor(tmp, { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    if (r.status === 1
        && new RegExp(`the active gh account is ${OTHER}, not ${OWNER}`).test(r.stdout)
        && r.stdout.includes(`gh auth switch --user ${OWNER}`)) {
      ok('doctor run against a wrong-account gh exits 1 and prints the switch command');
    } else {
      bad(`end to end: expected exit 1 naming ${OTHER}, got status=${r.status}`);
    }
  } else {
    console.log('  --   end-to-end gh substitution skipped on win32 (a .cmd shim cannot be spawned '
      + 'without a shell); 10a-10e still ran');
  }
}

} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\ndoctor check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ndoctor check passed: hook registration is proven, not assumed.');

#!/usr/bin/env node
/**
 * Mavci Core - drift detection, self-test and sync. ARCHITECTURE section 0 (C6).
 *
 * Five things decay silently, and each has a documented cause:
 *   1. On Windows, "don't ask again" writes allow rules into the COMMITTED
 *      .claude/settings.json (5.16), so the risk policy grows entries nobody chose.
 *   2. Claude Code changes; the hook output schema is the most fragile surface
 *      in the system, and a schema change turns every hard block into a no-op
 *      with no error anywhere.
 *   3. Baseline debt stops shrinking, and nobody notices because it never blocks.
 *   4. Waivers expire, or worse, quietly stop being needed and linger.
 *   5. The installed plugin version drifts from the version CI clones.
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
  CI_TOKEN_SECRET, CI_TOKEN_EXPIRY_WARN_DAYS,
} from './config.mjs';
import { abs, exists, readJson, readJsonOrNull, readTextOrNull, todayIso } from './lib/fsx.mjs';
import { pluginVersion, verifyIntegrity, validateAll, expiredWaivers, expiringWaivers, projectRoot } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');
const TEMPLATE_SETTINGS = path.join(REPO_ROOT, 'templates', 'project.settings.json');

/** Template placeholders look like __SYSTEM_REPO__. Any survivor means an
 *  unfinished connect: the file was copied but never filled in. */
const PLACEHOLDER_RE = /__[A-Z0-9_]+__/;

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
    out.push({ status: WARN, text: line(WARN, 'not a Mavci project', 'No .mavci/project.json. Run /mavci:connect for an existing repo, or /mavci:new-project.') });
    return false;
  }
  out.push({ status: OK, text: line(OK, 'project connected') });
  return true;
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
  if (!state) return;
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
      'Local hooks and CI are running different rule sets. Run /mavci:doctor --sync, then commit .mavci/control/state.json.'
      + (major ? ' This is a MAJOR difference, so the gate fails closed until it is resolved.' : '')),
  });
}

/** The Windows drift documented at 5.16. */
function checkSettingsDrift(root, out) {
  const projSettings = readJsonOrNull(abs(root, '.claude/settings.json'));
  if (!projSettings) {
    out.push({ status: WARN, text: line(WARN, 'no .claude/settings.json', 'The tier-3 deny rules are missing. Re-run /mavci:connect.') });
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

  // The repo must match SYSTEM_REPO EXACTLY. Printing whatever is there and
  // calling it ok is a fail-open: a marketplace Claude Code cannot resolve means
  // the plugin never installs, so no hook is registered and NOTHING is enforced -
  // the total-enforcement-failure case, reported green. The commonest way to get
  // there is a settings file copied from the template but never filled in, which
  // leaves the literal __SYSTEM_REPO__ placeholder sitting in the marketplace
  // source. That is called out separately because it names its own fix.
  const repo = mk.source?.repo;
  if (repo !== SYSTEM_REPO) {
    const isPlaceholder = typeof repo === 'string' && PLACEHOLDER_RE.test(repo);
    out.push({
      status: FAIL,
      text: line(FAIL, `marketplace ${MARKETPLACE_NAME} points at ${repo === undefined ? '(no source.repo)' : `"${repo}"`}, not ${SYSTEM_REPO}`,
        (isPlaceholder
          ? 'That is an UNSUBSTITUTED template placeholder: settings were copied but never filled in.' + '\n         '
          : '')
        + 'Claude Code cannot resolve this marketplace, so the plugin never installs,'
        + '\n         no hook is registered, and nothing is enforced at all. Re-run /mavci:connect.'),
    });
    return;
  }

  out.push({ status: OK, text: line(OK, `marketplace ${MARKETPLACE_NAME} -> ${repo}`) });
}

function checkBaseline(root, out) {
  const b = readJsonOrNull(abs(root, PATHS.baseline));
  if (!b) {
    out.push({ status: WARN, text: line(WARN, 'no baseline', 'A greenfield project has an empty baseline; a connected repo should have one. Run /mavci:connect.') });
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
      top.join('\n         ') + '\n         These never block. They shrink when you fix them: /mavci:verify prunes automatically.'),
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
      + '\n         watermark is removed. /mavci:release treats this as a blocker.'),
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

function checkLessons(root, out) {
  const p = abs(root, `${PATHS.lessons}/pending-system-change.md`);
  if (exists(p)) {
    out.push({ status: WARN, text: line(WARN, 'a system change is queued and unapplied', `${PATHS.lessons}/pending-system-change.md — apply it in the system repo with /mavci:retro --apply, or delete it.`) });
  }
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

/* ----------------------------------------------------------- hook selftest
 * The single most important check in this file. It does not read config - it
 * runs the guard against a command that MUST be denied and asserts the denial.
 * A config that parses is not evidence that a block still works.
 */
function selftestHooks(out) {
  const cases = [
    { name: 'rm -rf', input: { tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, expect: 'deny' },
    { name: 'prod deploy', input: { tool_name: 'Bash', tool_input: { command: 'vercel deploy --prod' } }, expect: 'deny' },
    { name: 'control-plane edit', input: { tool_name: 'Edit', tool_input: { file_path: '.mavci/control/state.json' } }, expect: 'deny' },
    { name: 'read .env', input: { tool_name: 'Bash', tool_input: { command: 'cat .env.local' } }, expect: 'deny' },
    { name: 'ordinary build', input: { tool_name: 'Bash', tool_input: { command: 'npm run build' } }, expect: 'allow' },
  ];

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-selftest-'));
  try {
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'templates', 'fixtures', 'selftest-project.json'),
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
    } else {
      out.push({ status: OK, text: line(OK, `hook self-test passed (${cases.length} cases)`) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ main */

function main() {
  const argv = process.argv.slice(2);
  const root = projectRoot();
  const preflight = argv.includes('--preflight');
  const sync = argv.includes('--sync');
  const out = [];

  try {
    checkNode(out);
    checkLockedIdentifiers(out);
    const connected = checkConnected(root, out);
    if (connected) {
      checkIntegrity(root, out);
      checkSchemas(root, out);
      checkVersionSkew(root, out, { sync });
      checkSettingsDrift(root, out);
      checkMarketplace(root, out);
      checkCiToken(root, out);
      checkBaseline(root, out);
      checkWaivers(root, out);
      checkLegalWatermarks(root, out);
      checkGateHeartbeat(root, out);
      checkLessons(root, out);
    }
    if (!preflight) selftestHooks(out);
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

main();

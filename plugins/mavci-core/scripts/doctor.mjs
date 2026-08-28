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
  CI_TOKEN_SECRET, CI_TOKEN_EXPIRY_WARN_DAYS, COMMAND_PREFIX,
} from './config.mjs';
import { abs, exists, readJson, readJsonOrNull, readTextOrNull, todayIso } from './lib/fsx.mjs';
import {
  pluginVersion, verifyIntegrity, validateAll, expiredWaivers, expiringWaivers, projectRoot,
  stampHookRun, lastHookRun, lastGate,
} from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');
const TEMPLATE_SETTINGS = path.join(PLUGIN_ROOT, 'templates', 'project.settings.json');

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
    out.push({ status: WARN, text: line(WARN, 'not a Mavci project', 'No .mavci/project.json. Run /mavci-core:connect for an existing repo, or /mavci-core:new-project.') });
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
      + '\n         watermark is removed. /mavci-core:release treats this as a blocker.'),
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
    out.push({ status: WARN, text: line(WARN, 'a system change is queued and unapplied', `${PATHS.lessons}/pending-system-change.md — apply it in the system repo with /mavci-core:retro --apply, or delete it.`) });
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
  }

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
      checkProtectedEnvironments(root, out);
      checkCiToken(root, out);
      checkBaseline(root, out);
      checkWaivers(root, out);
      checkLegalWatermarks(root, out);
      checkGateHeartbeat(root, out);
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

main();

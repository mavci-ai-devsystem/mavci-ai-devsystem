#!/usr/bin/env node
/**
 * Template substitution - the ONE path, used by the skills and by CI.
 *
 * Templates carry `__TOKEN__` placeholders. Until this file existed, filling them
 * in was an instruction in prose inside SKILL.md, and prose is not executable: of
 * the ten tokens, only `__SYSTEM_REPO__` was ever named, so nine survived into
 * generated projects. `__PROJECT_ID__` landed in package.json, where npm rejects a
 * name beginning with an underscore, so `npm ci` failed and the "green from commit
 * one" claim (ARCHITECTURE 6.8) was not true.
 *
 * check-escape-hatch.mjs did not catch it because it substituted its own hard-coded
 * map instead of whatever a real run produces - test data that cannot disagree with
 * production data, so the check could never fire. That is the same fail-open class
 * as reporting a skipped probe as a pass (CLAUDE.md invariant 5). Both callers now
 * go through `substitutions()`, so the test and the real run cannot drift.
 *
 * Every value comes from the manifest. A missing one throws by name - never a
 * silent empty string, which would put "" in a legal page or package.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_REPO } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
// Templates are owned by the plugin and resolved from PLUGIN_ROOT, never from the
// repo above it. Until 0.1.6 this was <plugin>/../../templates, which is correct in
// a repo checkout and absent in an installed plugin - Claude Code caches only the
// plugins/mavci-core/ subtree. new-project therefore exited 2 on every real install
// while passing in CI, and the documented workaround (run from the marketplace
// checkout) is what rendered gate4 from a stale 0.1.4 template.
const TEMPLATES = path.join(PLUGIN_ROOT, 'templates');

/** Any `__TOKEN__`. A survivor in generated output is always a bug. */
export const PLACEHOLDER_RE = /__[A-Z0-9_]+__/g;

/**
 * Where each token's value comes from. Adding a placeholder to a template WITHOUT
 * adding it here is caught by check-placeholders.mjs, which fails the build.
 */
const SOURCES = {
  __SYSTEM_REPO__: { from: '(config.mjs SYSTEM_REPO)', get: () => SYSTEM_REPO },
  __PROJECT_ID__: { from: 'project_id', get: (m) => m.project_id },
  __DISPLAY_NAME__: { from: 'display_name', get: (m) => m.display_name },
  __DEPLOY_TARGET__: { from: 'deploy.target', get: (m) => m.deploy?.target },
  __SITE_URL__: { from: 'deploy.site_url', get: (m) => m.deploy?.site_url },
  __LEGAL_NAME__: { from: 'compliance.entity.legal_name', get: (m) => m.compliance?.entity?.legal_name },
  __ADDRESS__: { from: 'compliance.entity.address', get: (m) => m.compliance?.entity?.address },
  __EMAIL__: { from: 'compliance.entity.email', get: (m) => m.compliance?.entity?.email },
  __MERSIS__: { from: 'compliance.entity.mersis', get: (m) => m.compliance?.entity?.mersis },
  __KEP__: { from: 'compliance.entity.kep', get: (m) => m.compliance?.entity?.kep },
};

export const KNOWN_TOKENS = Object.keys(SOURCES);

/**
 * Resolve every token from the manifest.
 *
 * @param {object} manifest  parsed .mavci/project.json
 * @param {{only?: string[]}} opts  restrict to the tokens a given file set needs
 * @returns {Record<string,string>}
 * @throws  when a needed value is absent, naming the manifest field to add
 */
export function substitutions(manifest, { only = null } = {}) {
  const wanted = only ?? KNOWN_TOKENS;
  const subs = {};
  const missing = [];
  for (const token of wanted) {
    const src = SOURCES[token];
    if (!src) { missing.push(`${token} (no source defined in render.mjs)`); continue; }
    const value = src.get(manifest);
    if (typeof value !== 'string' || value.length === 0) {
      missing.push(`${token} <- ${src.from}`);
      continue;
    }
    subs[token] = value;
  }
  if (missing.length) {
    throw new Error(
      'cannot render templates: the manifest is missing values for '
      + `${missing.length} placeholder(s).\n  ` + missing.join('\n  ')
      + '\nAdd them to .mavci/project.json and re-run. Rendering with an empty value'
      + ' would put "" into package.json or a legal page.');
  }
  return subs;
}

/** Replace every token in `text`. Plain split/join - no regex escaping worries. */
export function applySubs(text, subs) {
  let out = text;
  for (const [token, value] of Object.entries(subs)) out = out.split(token).join(value);
  return out;
}

/** Tokens actually present in a string. */
export function tokensIn(text) {
  return [...new Set(text.match(PLACEHOLDER_RE) ?? [])];
}

/**
 * Copy one file with substitution applied.
 * @returns {string} the destination path
 */
export function renderFile(from, to, subs) {
  const text = fs.readFileSync(from, 'utf8');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, applySubs(text, subs), 'utf8');
  return to;
}

/**
 * Recursively copy a directory with substitution applied.
 * @returns {string[]} destination paths, repo-relative to `to`
 */
export function renderTree(from, to, subs) {
  const written = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      written.push(...renderTree(s, d, subs));
      continue;
    }
    if (!entry.isFile()) continue;
    renderFile(s, d, subs);
    written.push(path.relative(to, d).split(path.sep).join('/'));
  }
  return written;
}

/**
 * Files BOTH commands write. `connect` does not copy the scaffold, but it does
 * copy these - which is why `__DISPLAY_NAME__` and `__DEPLOY_TARGET__` reached
 * connected repos unsubstituted too, not only new ones.
 */
export const SHARED_FILES = [
  { from: 'project.settings.json', to: '.claude/settings.json' },
  { from: 'project.CLAUDE.md', to: '.claude/CLAUDE.md' },
  { from: 'mavci-verify.yml', to: '.github/workflows/mavci-verify.yml' },
];

/** The config files every connected or new project gets. */
export function renderSharedConfig(dest, manifest) {
  const subs = substitutions(manifest);
  return SHARED_FILES.map(({ from, to }) =>
    path.relative(dest, renderFile(path.join(TEMPLATES, from), path.join(dest, to), subs))
      .split(path.sep).join('/'));
}

/** The application scaffold - new projects only. */
export function renderScaffold(dest, manifest) {
  const subs = substitutions(manifest);
  return renderTree(path.join(TEMPLATES, 'scaffold'), dest, subs);
}

/**
 * Scan a generated tree for surviving placeholders.
 * @returns {{file: string, tokens: string[]}[]}  empty when clean
 */
export function findSurvivingPlaceholders(root, { skipDirs = new Set(['node_modules', '.git']) } = {}) {
  const hits = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const tokens = tokensIn(text);
      if (tokens.length) {
        hits.push({ file: path.relative(root, full).split(path.sep).join('/'), tokens });
      }
    }
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file));
}

/* ------------------------------------------------------------------- CLI */

function readManifest(root) {
  const p = path.join(root, '.mavci', 'project.json');
  if (!fs.existsSync(p)) {
    console.error(`::error::${p} not found. Write the manifest before rendering templates.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const wantConfig = argv.includes('--config');
  const wantScaffold = argv.includes('--scaffold');

  if (!wantConfig && !wantScaffold) {
    console.error('usage: render.mjs [--config] [--scaffold]\n'
      + '  --config    .claude/settings.json, .claude/CLAUDE.md, .github/workflows/mavci-verify.yml\n'
      + '  --scaffold  templates/scaffold/ into the project (new projects only)');
    process.exit(2);
  }

  let manifest;
  const written = [];
  try {
    manifest = readManifest(root);
    if (wantScaffold) written.push(...renderScaffold(root, manifest));
    if (wantConfig) written.push(...renderSharedConfig(root, manifest));
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }

  // Never report success on output that still carries a placeholder.
  const surviving = findSurvivingPlaceholders(root);
  if (surviving.length) {
    console.error('::error::rendering left placeholders in the project:');
    for (const h of surviving) console.error(`  ${h.file}: ${h.tokens.join(', ')}`);
    process.exit(2);
  }

  for (const f of written) console.log(`  wrote ${f}`);
  console.log(`rendered ${written.length} file(s), no placeholders remain`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

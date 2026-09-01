#!/usr/bin/env node
/**
 * The plugin must be self-contained.
 *
 * Claude Code installs a plugin by copying the subtree named in
 * .claude-plugin/marketplace.json - here `./plugins/mavci-core` - into
 * ~/.claude/plugins/cache/. Nothing above that directory comes along.
 *
 * Until 0.1.6 render.mjs resolved templates as <plugin>/../../templates. In a
 * repo checkout that is the real templates/ directory, so every CI script and
 * every developer run passed. In an installed plugin it points at
 * cache/<marketplace>/templates, which does not exist, so
 * /mavci-core:new-project exited 2 on every genuine install. The documented
 * workaround - run the scripts from the marketplace checkout instead - is what
 * silently rendered a project from a stale 0.1.4 template while reporting
 * success.
 *
 * That defect was invisible to CI for one reason: every check ran from the repo,
 * where the wrong path happens to resolve. So this check does not test the repo.
 * It copies the plugin subtree ALONE, exactly as the installer does, and renders
 * from there.
 *
 * Section 3 is a negative control. A packaging check that passes when templates/
 * is missing is the same fail-open shape as a doctor that certifies a broken
 * marketplace form, so the check is required to prove it can fail.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARKETPLACE = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));

/** The subtree the installer copies, straight from the marketplace manifest -
 *  never hard-coded, so a repo re-layout cannot leave this check testing a
 *  directory that is no longer the shipped one. */
const PLUGIN_SUBTREE = MARKETPLACE.plugins[0].source.replace(/^\.\//, '');
const PLUGIN_SRC = path.join(ROOT, PLUGIN_SUBTREE);
const FIXTURE = path.join(PLUGIN_SRC, 'templates', 'fixtures', 'selftest-project.json');

const failures = [];
const bad = (m) => { failures.push(m); console.log(`  [fail] ${m}`); };
const ok = (m) => console.log(`  [ok  ] ${m}`);

/** Copy the plugin subtree into an isolated dir with NO repo above it. */
function stageInstall(label) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mavci-pkg-${label}-`));
  fs.cpSync(PLUGIN_SRC, path.join(tmp, 'mavci-core'), { recursive: true });
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, '.mavci'), { recursive: true });
  fs.copyFileSync(FIXTURE, path.join(proj, '.mavci', 'project.json'));
  return { tmp, plugin: path.join(tmp, 'mavci-core'), proj };
}

function render({ plugin, proj }) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(plugin, 'scripts', 'render.mjs'), '--scaffold', '--config'],
      // stdio pinned: section 3 fails render.mjs ON PURPOSE, and render.mjs
      // reports failures with `::error::`. execFileSync forwards a child's
      // stderr to the parent by default, so that deliberate failure was landing
      // in the runner log and GitHub was rendering it as a red annotation on a
      // release job that exited 0. A red mark on a green run trains exactly the
      // habit that let run 33265540461 go unread.
      { cwd: proj, encoding: 'utf8', timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/* --- 1. templates/ ships inside the plugin --------------------------- */

console.log('\n1. the plugin subtree carries its own templates/');
if (!fs.existsSync(path.join(PLUGIN_SRC, 'templates'))) {
  bad(`${PLUGIN_SUBTREE}/templates/ does not exist. The installer copies only that`
    + ' subtree, so new-project cannot render from a real install.');
} else {
  ok(`${PLUGIN_SUBTREE}/templates/ is inside the shipped subtree`);
}

/* No plugin script may reach above PLUGIN_ROOT for templates. This is the exact
 * expression that made the bug invisible, so it is banned by name.
 *
 * Comments are stripped first. The banned path has to be quotable in prose -
 * the comment in render.mjs explaining why it is banned contains it verbatim -
 * and a check that fires on its own documentation trains people to ignore it. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const escapes = [];
for (const f of fs.readdirSync(path.join(PLUGIN_SRC, 'scripts'), { withFileTypes: true })) {
  if (!f.isFile() || !f.name.endsWith('.mjs')) continue;
  const code = stripComments(fs.readFileSync(path.join(PLUGIN_SRC, 'scripts', f.name), 'utf8'));
  if (/\.\.[/\\]\.\.[/\\]templates|REPO_ROOT,\s*'templates'/.test(code)) escapes.push(f.name);
}
if (escapes.length) {
  bad(`these plugin scripts resolve templates/ above the plugin root: ${escapes.join(', ')}.`
    + ' That path exists only in a repo checkout.');
} else {
  ok('no plugin script resolves templates/ above PLUGIN_ROOT');
}

/* --- 2. a copied-out plugin can actually render ---------------------- */

console.log('\n2. render from an isolated copy of the plugin subtree');
const good = stageInstall('good');
const r = render(good);
if (r.code !== 0) {
  bad(`render.mjs exited ${r.code} from an isolated plugin copy - this is what every`
    + ` real install would do.\n         ${r.stdout.trim().split('\n').slice(-3).join('\n         ')}`);
} else if (!/no placeholders remain/.test(r.stdout)) {
  bad('render.mjs exited 0 but did not confirm placeholder substitution');
} else {
  ok('render.mjs exited 0 and left no placeholders');
}

/* The rendered project must be the one a user gets: check the two values that
 * shipped wrong in 0.1.3/0.1.4, so a stale template cannot pass this check. */
const rendered = path.join(good.proj, '.claude', 'settings.json');
if (!fs.existsSync(rendered)) {
  bad('render produced no .claude/settings.json');
} else {
  const src = JSON.parse(fs.readFileSync(rendered, 'utf8'))
    ?.extraKnownMarketplaces?.[MARKETPLACE.name]?.source;
  if (src?.source !== 'git') {
    bad(`rendered settings.json uses the "${src?.source}" marketplace source form, not "git".`
      + ' Every other form leaves the plugin uninstalled and nothing enforced.');
  } else {
    ok('rendered settings.json carries the "git" marketplace source form');
  }
}

/* --- 3. negative control -------------------------------------------- */

console.log('\n3. negative control: the check must fail when templates/ is absent');
const broken = stageInstall('broken');
fs.rmSync(path.join(broken.plugin, 'templates'), { recursive: true, force: true });
const rb = render(broken);
if (rb.code === 0) {
  bad('render.mjs SUCCEEDED with templates/ removed from the plugin copy. It is'
    + ' reaching outside the plugin root, so section 2 proves nothing.');
} else {
  ok(`render.mjs exited ${rb.code} with templates/ removed, as it must`);
}

/* -------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n::error::check-packaging: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\ncheck-packaging: the plugin is self-contained\n');

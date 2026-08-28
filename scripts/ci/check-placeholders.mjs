#!/usr/bin/env node
/**
 * No template placeholder may reach a generated project.
 *
 * Ten `__TOKEN__` placeholders live in templates/. Nine of them were substituted
 * by nothing at all: the skills named only `__SYSTEM_REPO__`, and the escape-hatch
 * test used its own hard-coded map, so its test data could not disagree with what
 * a real run produced and the gap stayed invisible through a full CI suite.
 *
 * The sharpest consequence was `__PROJECT_ID__` in package.json. npm package names
 * may not begin with an underscore, so `npm ci` fails, and with it `tsc --noEmit`
 * and `next build` - acceptance Part A step 10. The claim that a fresh scaffold is
 * green from commit one (ARCHITECTURE 6.8) was simply not true.
 *
 * This runs the real renderer, not a copy of it, and ends with a negative control:
 * a check that has never failed is not evidence of anything.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const TEMPLATES = path.join(ROOT, 'templates');

const render = await import(pathToFileURL(path.join(SCRIPTS, 'render.mjs')).href);
const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

const MANIFEST = JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'fixtures', 'selftest-project.json'), 'utf8'));

/* --- 1. every placeholder in templates/ has a declared source -------- */
{
  const declared = new Set(render.KNOWN_TOKENS);
  const found = new Map(); // token -> files
  const stack = [TEMPLATES];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      for (const t of render.tokensIn(text)) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        found.set(t, [...(found.get(t) ?? []), rel]);
      }
    }
  }
  const orphans = [...found.keys()].filter((t) => !declared.has(t));
  if (orphans.length) {
    for (const t of orphans) {
      bad(`${t} appears in templates/ but has no source in render.mjs SOURCES `
        + `(${found.get(t).join(', ')}) - nothing would ever substitute it`);
    }
  } else {
    ok(`all ${found.size} placeholder(s) in templates/ have a declared source in render.mjs`);
  }

  // The reverse: a declared source nothing uses is dead weight, not a failure.
  const unused = render.KNOWN_TOKENS.filter((t) => !found.has(t));
  if (unused.length) console.log(`  note declared but unused in templates/: ${unused.join(', ')}`);
}

/* --- 2. a simulated new-project run leaves nothing behind ------------ */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-placeholders-'));
  try {
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
    render.renderScaffold(tmp, MANIFEST);
    render.renderSharedConfig(tmp, MANIFEST);
    state.init(tmp, MANIFEST);

    const surviving = render.findSurvivingPlaceholders(tmp);
    if (surviving.length) {
      for (const h of surviving) bad(`${h.file} still contains ${h.tokens.join(', ')} after a full render`);
    } else {
      ok('a simulated /mavci:new-project run leaves zero placeholders');
    }

    /* --- 3. the specific acceptance blocker: package.json is installable --- */
    const pkgPath = path.join(tmp, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      bad('package.json was not generated');
    } else {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      // npm: lowercase, no leading underscore or dot, url-safe, <= 214 chars.
      const NPM_NAME = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
      if (typeof pkg.name !== 'string' || !NPM_NAME.test(pkg.name) || pkg.name.length > 214) {
        bad(`package.json name ${JSON.stringify(pkg.name)} is not a valid npm package name, so `
          + '`npm ci` fails and acceptance Part A step 10 (tsc --noEmit, next build) cannot pass');
      } else {
        ok(`package.json name "${pkg.name}" is a valid npm package name`);
      }
    }

    /* --- 4. shared config really was rendered for BOTH commands ------- */
    // Guard the loop: zero entries would run zero assertions and still print ok.
    if (!render.SHARED_FILES.length) bad('render.SHARED_FILES is empty, so nothing was checked');
    for (const { to } of render.SHARED_FILES) {
      const p = path.join(tmp, to);
      if (!fs.existsSync(p)) { bad(`${to} was not rendered`); continue; }
      const text = fs.readFileSync(p, 'utf8');
      const left = render.tokensIn(text);
      if (left.length) bad(`${to} still contains ${left.join(', ')}`);
    }
    ok('shared config files (.claude/settings.json, .claude/CLAUDE.md, mavci-verify.yml) are clean');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* --- 5. negative control: the scan must actually detect one ---------- */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-placeholders-neg-'));
  try {
    fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'app', 'page.tsx'), 'export default () => <h1>__DISPLAY_NAME__</h1>;\n');
    const hits = render.findSurvivingPlaceholders(tmp);
    if (hits.length === 1 && hits[0].tokens.includes('__DISPLAY_NAME__')) {
      ok('negative control: a planted placeholder is detected');
    } else {
      bad(`negative control FAILED: planted __DISPLAY_NAME__ but scan returned ${JSON.stringify(hits)}. `
        + 'The placeholder scan does not work, so every pass above is meaningless.');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* --- 6. a manifest missing a value must throw, not render "" --------- */
{
  const broken = JSON.parse(JSON.stringify(MANIFEST));
  delete broken.compliance.entity.kep;
  let threw = false;
  try { render.substitutions(broken); } catch (err) { threw = /__KEP__/.test(err.message); }
  if (threw) ok('a manifest missing compliance.entity.kep throws by name instead of rendering ""');
  else bad('substitutions() did not throw for a missing value - it would write an empty string '
    + 'into a legal page rather than refusing');
}

if (failures.length) {
  console.error(`\nplaceholder check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\nplaceholder check passed: no template placeholder can reach a generated project.');

#!/usr/bin/env node
/**
 * Every `*.mjs` named in shipped code must exist.
 *
 * `check-command-refs.mjs` does this for `/mavci-core:<name>` and has since 0.1.12,
 * because a command reference is a promise to an agent that has no way to answer
 * back. A SCRIPT reference is the same defect in a different namespace, and nothing
 * covered it: `scripts/rules/index.mjs` named `check-remedy-authority.mjs` in two
 * places, that file was never committed, and finding out which of the two cases it
 * was - folded into another check, or lost with its assertions - took an audit and a
 * `git log`. The assertions turned out to be alive inside `check-evidence-caps.mjs`;
 * the name was the only thing missing. This check exists so the next one costs a CI
 * run instead.
 *
 * It also catches the opposite and more dangerous case, which is why "the assertions
 * were fine this time" is not a reason to skip it: a check named in a comment as the
 * thing that guarantees a property, where no such check exists anywhere, is a
 * documented control that does not run. `CLAUDE.md` invariant 5 - an unchecked
 * control is not a working control - with the reader unable to tell, because the
 * comment says otherwise.
 *
 * FORWARD-LOOKING: findings 10, 14 and 15 in the 0.1.15 queue all promise
 * `check-agent-contracts.mjs`. The moment those are applied this check fails until
 * that file exists, which is the correct order.
 *
 * Prose that is ABOUT a missing script is not a reference to it. `docs/` and the
 * lessons queue are excluded for that reason - a lesson recording that a name
 * dangled must be able to say the name.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * Declared exclusions, each with a reason, printed on every pass.
 *
 * 0.1.14's rule for `release.yml`: a gate that does not name what it did not check
 * is asserting more than it verified. Two kinds only, and both are narrow:
 *
 *   - a single-letter name is an EXAMPLE inside a test fixture, never a real script
 *   - this file's own header is prose ABOUT names that dangled, which is the same
 *     exemption `docs/` gets: a record of a missing name must be able to say it
 */
const EXCLUDED = [
  [/^[a-z]\.mjs$/, 'single-letter placeholder used as example data inside a check fixture'],
];
const EXCLUDED_FILES = [
  ['scripts/ci/check-script-refs.mjs', "this check's own header names the scripts that dangled"],
  ['scripts/ci/check-pretag.mjs', 'builds synthetic release.yml fixtures naming scripts that do not exist by design'],
  ['scripts/ci/check-skill-placeholders.mjs', 'builds synthetic SKILL.md fixtures naming example scripts'],
];

/** Shipped code and its comments. NOT docs/ or the lessons queue - see the header. */
const SCAN = ['plugins/mavci-core/scripts', 'plugins/mavci-core/hooks', 'plugins/mavci-core/skills',
  'plugins/mavci-core/agents', 'agent-defs', 'scripts/ci', '.github/workflows'];

// Negative lookbehind on the backslash: `\ncheck-tags.mjs` inside a string literal
// is an escape sequence followed by a name, and \b matches after the backslash - so a
// plain \b invented `ncheck-tags.mjs` and reported it as dangling.
const SCRIPT_RE = /(?<![\A-Za-z0-9-])([a-z][a-z0-9-]*\.mjs)\b/g;

/** Every .mjs anywhere in the repository, by basename. A narrower search was the
 *  first version's bug: `rules/index.mjs` sits a level below `scripts/`, so every
 *  reference to it read as dangling. */
const present = new Set();
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.mjs')) present.add(e.name);
  }
}(ROOT));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|json|md|ya?ml)$/.test(e.name)) out.push(p);
  }
  return out;
}

const dangling = new Map();
let scanned = 0;
for (const dir of SCAN) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const file of walk(d)) {
    scanned++;
    const rel0 = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXCLUDED_FILES.some(([f]) => f === rel0)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(SCRIPT_RE)) {
      const name = m[1];
      if (present.has(name)) continue;
      if (EXCLUDED.some(([re]) => re.test(name))) continue;
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const line = text.slice(0, m.index).split('\n').length;
      if (!dangling.has(name)) dangling.set(name, []);
      dangling.get(name).push(`${rel}:${line}`);
    }
  }
}

console.log(`script refs: scanned ${scanned} file(s) across ${SCAN.length} shipped trees, `
  + `${present.size} script(s) present`);
for (const [re, why] of EXCLUDED) console.log(`  excluded  ${re}  - ${why}`);
for (const [f, why] of EXCLUDED_FILES) console.log(`  excluded  ${f}  - ${why}`);

if (dangling.size) {
  console.log('');
  console.log(`${dangling.size} script name(s) referenced in shipped code but not present:`);
  for (const [name, where] of dangling) {
    console.log(`  ${name}`);
    for (const w of where) console.log(`      ${w}`);
  }
  console.log('');
  console.log('A named script that does not exist is one of two things and the reader cannot tell');
  console.log('which: the assertions moved into another file and only the name is stale, or the');
  console.log('check was never built and a documented control does not run. Either point the');
  console.log('reference at the file that carries the work, or build it. One name for one check.');
  process.exit(1);
}

console.log('script refs: every .mjs named in shipped code exists');

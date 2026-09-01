#!/usr/bin/env node
/**
 * Every `/mavci-core:<name>` the plugin PRINTS must resolve to a skill that ships.
 *
 * WHY THIS EXISTS
 * Gate 4c, finding 4. `gate.mjs` traps an agent on a checker crash and tells it
 * to run `/mavci-core:retro`. There was no `skills/retro/`. The plugin named its
 * own escalation channel in seven places and shipped none of it, across eleven
 * releases, and nothing could see that because a command reference is a prose
 * string: no code constructs it, no loader resolves it, and the agent it is
 * addressed to has no way to report that the door it was sent through is a wall.
 *
 * It is the 0.1.5 shape one more time - a value written down once and copied -
 * except here the value was never written down at all, only referred to.
 *
 * WHAT IT ASSERTS
 *   Every literal `/mavci-core:<name>` under the scanned roots has a matching
 *   plugins/mavci-core/skills/<name>/SKILL.md.
 *
 * A reference is a PROMISE TO AN AGENT THAT CANNOT ANSWER BACK. Warning on a
 * broken one and continuing would be the adjacent-but-wrong signal this Gate
 * found eight times: the check that reports and does not fail is the check that
 * let the reference ship. So an unresolved reference FAILS the build.
 *
 * SCOPE, AND WHY IT IS WIDER THAN THE FINDING ASKED FOR
 * The finding named `scripts/` and `skills/`. Those are counted separately below,
 * so its "fails seven times" prediction stays checkable. But the scanned set is
 * everything the plugin SHIPS - agents/ and templates/ too - because a generated
 * agent telling an agent to run a command that does not exist is the identical
 * defect reached by a different file. `docs/` is deliberately NOT scanned: a
 * roadmap that names an unbuilt command is describing a plan, which is the one
 * legitimate use of a forward reference.
 *
 * CONSTRUCTED REFERENCES
 * `build-agents.mjs` builds `/mavci-core:standards-${pack}` from a def. A
 * template hole cannot be resolved statically, so it is classified separately
 * and held to a weaker claim: the literal PREFIX must match at least one real
 * skill. The strong claim is still made, one step later, against the rendered
 * agents/ output - which is why agents/ is in scope. A constructed reference is
 * never silently skipped; it is reported by name on every run.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');
const SKILLS = path.join(PLUGIN, 'skills');

const { COMMAND_PREFIX } = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'config.mjs')).href);

/** The finding's own scope, kept separate so its prediction stays falsifiable. */
const FINDING_SCOPE = ['scripts', 'skills'];
/** Everything the plugin ships. A reference in any of these is printed at an agent. */
const SCAN_ROOTS = ['scripts', 'skills', 'agents', 'templates', 'hooks'];

const SKIP_DIRS = new Set(['node_modules', '.git', 'fixtures']);
const TEXT_EXT = new Set(['.mjs', '.js', '.json', '.md', '.mdx', '.ts', '.tsx', '.yml', '.yaml', '.txt']);

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(full);
    } else if (TEXT_EXT.has(path.extname(e.name))) {
      yield full;
    }
  }
}

/** Skills that actually ship: a directory under skills/ holding a SKILL.md. */
function shippedSkills() {
  const out = new Set();
  for (const name of fs.readdirSync(SKILLS)) {
    if (fs.existsSync(path.join(SKILLS, name, 'SKILL.md'))) out.add(name);
  }
  return out;
}

/**
 * Every reference in one file, with its line and whether the name is complete.
 *
 * The name is matched greedily and then what FOLLOWS it is inspected, because
 * that is the only way to tell `/mavci-core:standards-` + `${p}` (a hole) from
 * `/mavci-core:doctor` (a name). Matching the hole as if it were a name reports
 * a missing skill called "standards-", which is a true failure for a false
 * reason - and a check that fails for the wrong reason gets edited until it
 * stops, which is how a real failure leaves with it.
 */
function referencesIn(file) {
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`${COMMAND_PREFIX.replace('/', '\\/')}([a-z0-9-]*)`, 'g');
  const out = [];
  for (const m of text.matchAll(re)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    out.push({
      name: m[1],
      constructed: after.startsWith('${') || after.startsWith('$('),
      line: text.slice(0, m.index).split('\n').length,
      file: path.relative(ROOT, file).replace(/\\/g, '/'),
    });
  }
  return out;
}

const skills = shippedSkills();
const unresolved = [];
const constructed = [];
let total = 0;

for (const rootName of SCAN_ROOTS) {
  for (const file of walk(path.join(PLUGIN, rootName))) {
    for (const ref of referencesIn(file)) {
      total += 1;
      ref.inFindingScope = FINDING_SCOPE.includes(rootName);
      if (ref.constructed) {
        // Weak claim only: the literal prefix must be a prefix of a real skill.
        const anyMatch = [...skills].some((s) => s.startsWith(ref.name));
        constructed.push({ ...ref, resolves: anyMatch });
        if (!anyMatch) unresolved.push({ ...ref, why: `constructed prefix "${ref.name}" matches no skill` });
        continue;
      }
      if (!skills.has(ref.name)) {
        unresolved.push({ ...ref, why: `no plugins/mavci-core/skills/${ref.name}/SKILL.md` });
      }
    }
  }
}

/* --- negative control ---------------------------------------------------
 * A check that only ever runs over a healthy tree cannot tell "nothing is
 * broken" from "nothing is being looked at". These two assertions are what stop
 * this file going green by accident: an empty skill set, a regex that matches
 * nothing, or a walk that visits no files would all pass silently otherwise.
 * That is the failure mode `check-gate.mjs` shipped for seven releases.
 */
{
  const fabricated = 'definitely-not-a-skill-' + Date.now().toString(36);
  if (skills.has(fabricated)) {
    console.error('negative control is impossible: the fabricated skill name exists');
    process.exit(2);
  }
  if (!skills.size) {
    console.error('negative control FAILED: no skills were discovered at all, so every reference '
      + 'would resolve against an empty set and this check would assert nothing');
    process.exit(2);
  }
  if (!total) {
    console.error('negative control FAILED: no command references were found anywhere. Either the '
      + 'scan roots are wrong or COMMAND_PREFIX changed; either way this check is inert.');
    process.exit(2);
  }
}

const inScope = unresolved.filter((u) => u.inFindingScope);

console.log(`scanned ${total} command reference(s) across ${SCAN_ROOTS.join(', ')}`);
console.log(`  ${skills.size} skill(s) ship: ${[...skills].sort().join(', ')}`);
for (const c of constructed) {
  console.log(`  constructed: ${c.file}:${c.line} - prefix "${c.name}" `
    + `${c.resolves ? 'resolves' : 'DOES NOT RESOLVE'}`);
}

if (unresolved.length) {
  console.error(`\ncommand reference check FAILED (${unresolved.length} unresolved), `
    + `${inScope.length} of them in the finding's own scope (${FINDING_SCOPE.join(', ')}):\n`);
  const byName = new Map();
  for (const u of unresolved) {
    if (!byName.has(u.name)) byName.set(u.name, []);
    byName.get(u.name).push(u);
  }
  for (const [name, list] of [...byName].sort()) {
    const scoped = list.filter((u) => u.inFindingScope).length;
    console.error(`  ${COMMAND_PREFIX}${name} - ${list.length} reference(s) `
      + `(${scoped} in scripts/ and skills/), ${list[0].why}`);
    for (const u of list) console.error(`      ${u.file}:${u.line}`);
  }
  console.error('\nA command reference is a promise to an agent that has no way to answer back. '
    + 'Either ship the skill, or stop naming it.');
  process.exit(2);
}

console.log(`\ncommand refs: every ${COMMAND_PREFIX}<name> the plugin ships resolves to a real skill`);

#!/usr/bin/env node
/**
 * Every instruction in a rendered agent definition must be one that agent can obey.
 *
 * -------------------------------------------------------------- WHY THIS EXISTS
 *
 * Finding 20. `agent-defs/_contract.md` is shared prose rendered into all five
 * agents, and the agents do not have the same capabilities. Two of its fixed
 * blocks ordered guardian to do things guardian's own grants refuse:
 *
 *   STEP 3, "Invoke these skills now, before doing any work". Guardian's
 *   frontmatter grants `Read, Grep, Glob`. Nothing in that list can invoke a
 *   skill. Guardian hit this twice during the 0.1.18 corpus run and said so in
 *   `suggested_next` - a field the record writer then discarded (finding 19), so
 *   the component being broken reported the break, twice, into nothing.
 *
 *   SECTION 8, "Read `attempts` and `max_attempts` from
 *   `.mavci/control/tasks/<id>.json`". Guardian's `read_scope` denies `.mavci/**`
 *   with one exception - the ticketed worklist - and risk-guard enforces it. An
 *   agent obeying the contract received a refusal on its first instruction after
 *   the report format.
 *
 * Both had the same root: guardian's overrides covered startup steps 1 and 2 and
 * nothing else, so every other block of shared prose went on addressing an agent
 * with capabilities it does not have. Making those two overridable fixes the two.
 * This fixes the CLASS - the next shared block added to the contract has exactly
 * the same problem, and the way it surfaces today is an agent reporting a refusal
 * it cannot act on, in a field that may not survive to an artefact.
 *
 * --------------------------------------------------------------- THE TWO RULES
 *
 * 1. TOOL. An instruction naming a capability must be satisfiable by `tools`.
 * 2. PATH. An instruction naming a `.mavci/` path must be satisfiable by
 *    `read_scope` - the same allow/deny the PreToolUse hook actually enforces.
 *
 * ------------------------------------------------------ WHAT THIS CANNOT SEE
 *
 * It reads instructions written as prose, so it matches on the phrasings the
 * contract uses today. A future block that orders a skill invocation in words
 * this does not recognise passes and proves nothing - the same blind spot every
 * prose assertion in this repository has, and the reason the two rules below are
 * anchored on VERBS and PATHS rather than on whole sentences. It also says
 * nothing about whether an instruction is a good one; only whether the agent
 * addressed could carry it out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFS = path.join(ROOT, 'agent-defs');
const AGENTS = path.join(ROOT, 'plugins', 'mavci-core', 'agents');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

/** Phrasings that order a skill invocation, and the tool that can carry one out. */
const SKILL_ORDER = /\binvoke (?:these|the|this) skills?\b|\binvoke\b[^.\n]{0,40}`\/mavci-core:/i;
const SKILL_TOOLS = ['Skill', 'SlashCommand'];

/** A `.mavci/...` path named inside backticks in an instruction. */
const MAVCI_PATH = /`(\.mavci\/[^`]*)`/g;

/**
 * Does read_scope permit this path? Deny wins, and an unlisted path under a
 * denied prefix is denied - the hook's own reading, not a looser one.
 */
function readable(scope, p) {
  if (!scope) return true;                       // no scope declared: unrestricted
  const norm = p.replace(/\\/g, '/');
  const match = (pat) => {
    const rx = new RegExp('^' + pat.split('**').map((s) =>
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return rx.test(norm);
  };
  if ((scope.allow ?? []).some(match)) return true;
  return !(scope.deny ?? []).some(match);
}

const defs = fs.readdirSync(DEFS).filter((f) => f.endsWith('.json')).sort();
if (!defs.length) {
  console.error('\nagent contract check FAILED:\n  - no agent definitions found; refusing to');
  console.error('    report green over an empty set.');
  process.exit(2);
}

console.log('every instruction is one the agent addressed can obey:');

let toolChecks = 0;
let pathChecks = 0;

for (const file of defs) {
  const def = JSON.parse(fs.readFileSync(path.join(DEFS, file), 'utf8'));
  const rendered = path.join(AGENTS, `${def.name ?? def.slug}.md`);
  if (!fs.existsSync(rendered)) {
    bad(`${def.slug}: no rendered definition at ${path.relative(ROOT, rendered)} - run build-agents.mjs`);
    continue;
  }
  const text = fs.readFileSync(rendered, 'utf8');
  const tools = def.tools ?? [];

  /* ---- rule 1: an ordered capability must be granted -------------------- */
  toolChecks += 1;
  const ordersSkill = SKILL_ORDER.test(text);
  const canSkill = tools.some((t) => SKILL_TOOLS.includes(t));
  check(!ordersSkill || canSkill,
    `${def.slug}: ${ordersSkill ? 'orders a skill invocation' : 'orders no skill invocation'}`
    + `, and holds ${canSkill ? 'a tool that can' : 'NO tool that can'} (tools: ${tools.join(', ')})`);

  /* ---- rule 2: an ordered path must be readable -------------------------- */
  const named = [...new Set([...text.matchAll(MAVCI_PATH)].map((m) => m[1]))]
    // A glob or a <placeholder> in the prose stands for a real path; test the
    // directory it sits in, which is what read_scope is written in terms of.
    .map((p) => p.replace(/<[^>]*>/g, 'X').replace(/\*+/g, 'X'));
  const refused = named.filter((p) => !readable(def.read_scope, p));
  pathChecks += named.length;
  check(refused.length === 0,
    `${def.slug}: all ${named.length} .mavci/ path(s) named in its instructions are inside its read scope`
    + (refused.length ? ` - REFUSED: ${refused.join(', ')}` : ''));
}

/* ---- negative controls. A static check over a healthy tree cannot tell
 * "nothing is wrong" from "nothing is being examined", and every wrong-gate
 * finding in this repository had that shape. --------------------------------- */

check(SKILL_ORDER.test('3. Load the standards you need. Invoke these skills now, before doing any work:'),
  'negative control: the exact step-3 wording finding 20 was filed against IS matched');
check(!SKILL_ORDER.test('You may consult the standards packs listed in the manifest.'),
  'negative control: ordinary prose about standards is NOT matched');
check(!readable({ allow: ['.mavci/control/guardian/wl-X.json'], deny: ['.mavci/**'] },
  '.mavci/control/tasks/X.json'),
  'negative control: the exact path finding 20 was filed against reads as REFUSED under guardian-shaped scope');
check(readable({ allow: ['.mavci/control/guardian/X'], deny: ['.mavci/**'] },
  '.mavci/control/guardian/X'),
  'negative control: and the one allowed exception still reads as permitted');
check(toolChecks === defs.length && pathChecks > 0,
  `negative control: ${toolChecks} definition(s) examined and ${pathChecks} path(s) actually tested`);

console.log('');
if (failures.length) {
  console.log(`agent contract check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`agent contract: ${defs.length} definition(s); no agent is ordered to use a tool it lacks`);
console.log('                or to read a path its own scope refuses');

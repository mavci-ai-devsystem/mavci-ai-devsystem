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
import { PHASES } from '../../plugins/mavci-core/scripts/config.mjs';

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
 * The startup phase gate, and the phase value it compares against.
 *
 * RULE 3 - A GATE MUST NAME A GATE VALUE THAT EXISTS. Rendered from
 * `DEFAULT_STARTUP_STEP_2`, which substitutes `def.phase` into "If `phase` is not
 * `X`". `PHASES` is the closed enum every `state.json` is validated against, so an
 * agent whose X is outside it compares a real value against a value nothing can
 * ever write, stops, and reports `wrong_phase:<actual>` on EVERY invocation.
 *
 * That is not a hypothetical. `scribe` declares `phase: "any"`, meaning "runs in
 * any phase"; the contract rendered it as a literal, and scribe has been unable to
 * start since it shipped. Nobody noticed because no skill invokes scribe - an
 * unrun component looks identical to a working one, which is the whole reason this
 * file exists.
 *
 * It is finding 20's shape and, more precisely, it is the SAME defect 0.1.21 fixed
 * one step further down. `NO_STANDARDS_STEP_3` was added because step 3 told an
 * agent with no packs to "invoke these skills now" over an empty list. Step 2, in
 * the block directly above it, was telling the same agent to wait for a phase that
 * does not exist. The fix walked past it.
 */
const PHASE_GATE = /If `phase` is not `([^`]+)`/;

/** The affirmative statement an any-phase agent gets instead of a gate. */
const ANY_PHASE_NOTE = /You are not phase-scoped/;

/**
 * A dispatcher's phase check, for an agent whose gate legitimately lives in the
 * skill that dispatches it. Deliberately loose on prose and strict on the two
 * things that matter: it names the state file, and it names the phase.
 */
const DISPATCHER_GATE = (phase) =>
  new RegExp('state\.json[^]{0,400}`' + phase + '`|`' + phase + '`[^]{0,400}state\.json');

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
let gateChecks = 0;

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

  /* ---- rule 3: a phase gate must name a reachable phase ------------------ */
  const gate = PHASE_GATE.exec(text);
  gateChecks += 1;
  if (gate) {
    check(PHASES.includes(gate[1]),
      `${def.slug}: its startup gate waits for phase \`${gate[1]}\`, which is `
      + `${PHASES.includes(gate[1]) ? 'in' : 'NOT in'} the phase enum (${PHASES.join('|')})`
      + (PHASES.includes(gate[1]) ? '' : ' - this agent can never start'));
  } else if (def.phase === 'any') {
    // An agent that is genuinely not phase-scoped renders no gate, and the
    // contract says so affirmatively instead of saying nothing.
    check(ANY_PHASE_NOTE.test(text),
      `${def.slug}: declares phase \`any\` and is TOLD it is not phase-scoped`
      + (ANY_PHASE_NOTE.test(text) ? '' : ' - it renders no gate and no statement, so it is told nothing'));
  } else if (typeof def.phase_gate === 'string' && def.phase_gate.startsWith('dispatcher:')) {
    // DECLARED EXEMPTION, AND IT IS ASSERTED, NOT LISTED. The named dispatcher
    // must still contain a phase check naming this agent's phase - so a dispatcher
    // that stops checking fails HERE, rather than leaving a stale exemption that
    // quietly excuses its own replacement. Same construction as check-pretag's
    // EXCLUDED_STEPS, and for the reason 0.1.14 wrote down: an exemption expressed
    // by absence is indistinguishable from a block that was lost.
    const rel = def.phase_gate.slice('dispatcher:'.length);
    const disp = path.join(ROOT, rel);
    const found = fs.existsSync(disp) && DISPATCHER_GATE(def.phase).test(fs.readFileSync(disp, 'utf8'));
    check(found,
      `${def.slug}: renders no gate and declares the check lives in ${rel}, which `
      + (found ? `does check for phase \`${def.phase}\`` : 'does NOT check the phase - the exemption is now stale'));
  } else {
    // An agent that declares a real phase, renders no gate and declares no
    // dispatcher is unconstrained by phase and nobody decided that.
    check(false,
      `${def.slug}: declares phase \`${def.phase}\`, renders NO startup phase gate, and `
      + 'declares no `phase_gate` exemption - nothing checks its phase anywhere');
  }
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
check(PHASE_GATE.exec('Read `.mavci/control/state.json`. If `phase` is not `any`, **stop** and')?.[1] === 'any',
  'negative control: the exact scribe wording rule 3 was filed against IS matched, and yields `any`');
check(!PHASES.includes('any'),
  'negative control: `any` is genuinely outside the phase enum - the rule is not vacuous');
check(PHASE_GATE.exec('If `phase` is not `build`, **stop**')?.[1] === 'build',
  'negative control: a healthy gate is matched and yields its phase, so a match failure cannot pass as absence');
check(DISPATCHER_GATE('verify').test('`.mavci/control/state.json` does not say `verify`, stop'),
  'negative control: the guardian dispatcher wording IS matched by the dispatcher probe');
check(!DISPATCHER_GATE('verify').test('This command emits a worklist and dispatches guardian.'),
  'negative control: a dispatcher that does NOT check the phase is not matched');
check(!DISPATCHER_GATE('build').test('`.mavci/control/state.json` does not say `verify`, stop'),
  'negative control: the probe is phase-specific - a check for another phase does not satisfy it');
check(toolChecks === defs.length && pathChecks > 0 && gateChecks === defs.length,
  `negative control: ${toolChecks} definition(s) examined, ${pathChecks} path(s) and ${gateChecks} phase gate(s) actually tested`);

console.log('');
if (failures.length) {
  console.log(`agent contract check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`agent contract: ${defs.length} definition(s); no agent is ordered to use a tool it lacks,`);
console.log('                to read a path its own scope refuses, or to wait for a phase that cannot occur');

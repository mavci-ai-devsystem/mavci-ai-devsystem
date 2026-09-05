#!/usr/bin/env node
/**
 * The orchestrator's contract: what it runs, what it hands over, and whether the
 * two agree with the guard that would actually decide.
 *
 * 0.1.33, from the operator-load measurement of 2026-09-05. Of ~105 operator
 * acts that day, about 16 were decisions and the rest was movement - and the
 * largest single block was invisible to every artefact in this repository,
 * because a copy-paste round trip produces no finding and no state file. One
 * decision cost four transports: the assistant wrote a command, the operator
 * copied it, pasted it into a terminal, copied the output, and pasted it back.
 *
 * WHAT THIS CHECK CAN AND CANNOT DO, said first because most of it is prose.
 *
 * `skills/ship/SKILL.md` is instructions to a model. Nothing here proves the
 * model follows them - that is `check-command-invocation`'s territory for the
 * blocks that execute, and nobody's for the paragraphs that do not. What these
 * assertions hold is narrower and still worth having: that the contract SAYS the
 * things the day's findings required, that it has not quietly widened, and -
 * C6 and C7 - that where it makes a claim about the GUARD, the guard agrees.
 *
 * C6 and C7 are the two that are not prose. C7 in particular exists because
 * ship's paragraph names `WORKFLOW_MOVES` member by member, which is a second
 * list of the same fact: two lists of one thing is the defect this repository
 * has recorded at check-pretag vs release.yml, at selftest.yml vs release.yml,
 * and at the writer/parser dash. It is asserted rather than trusted.
 *
 * THE PAIRING, because half of these assertions pass on a build that has gone
 * the wrong way entirely. C3 (the ban still stands) and C4 (the free verbs are
 * free) are each other's control: a contract that bans everything satisfies C3
 * and fails C4, a contract that bans nothing does the reverse. Asserting only
 * one of them is 0.1.26's E6 and check-retro's A9e, a third time.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHIP = path.join(ROOT, 'plugins/mavci-core/skills/ship/SKILL.md');
const GUARD = path.join(ROOT, 'plugins/mavci-core/scripts/risk-guard.mjs');
const FIXTURE = path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

const { ACTIONS } = await import(pathToFileURL(
  path.join(ROOT, 'plugins/mavci-core/scripts/lib/route.mjs')).href);

const shipRaw = fs.readFileSync(SHIP, 'utf8');
const guardSrc = fs.readFileSync(GUARD, 'utf8');

/* PROSE IS MATCHED AGAINST A WHITESPACE-FLATTENED COPY, and the first run of
 * this file is why. C2 failed against correct text because the sentence it looks
 * for happened to wrap between two words. A check that depends on where a
 * paragraph was reflowed is not asserting the property it claims to - it is
 * asserting the line width, and the next person to reformat this document gets a
 * red build and no defect. Flattening on READ only; nothing rewrites the file. */
const ship = shipRaw.replace(/\s+/g, ' ');

/* The prohibition list is one block. Read it as one, so a verb moved OUT of it
 * elsewhere in the document does not read as still banned. */
const banBlock = (shipRaw.match(/\*\*Do not run `--reset-attempts`[\s\S]*?\n\n/) ?? [''])[0]
  .replace(/\s+/g, ' ');

/* --- C1. it reads its own outputs ------------------------------------- */
{
  const forbidsPaste = /Never ask the operator to paste/i.test(ship);
  const background = /start it in the BACKGROUND/i.test(ship);
  if (forbidsPaste && background) {
    ok('ship forbids asking the operator to paste output, and names the background run');
  } else {
    bad('ship does not tell the orchestrator to obtain its own output '
      + `(forbids-paste=${forbidsPaste}, background=${background}). Three of the worst relays of `
      + '2026-09-05 - a 502, a server log and a probe result - were carried by hand into a session '
      + 'that could have run the command itself.');
  }
}

/* --- C2. and it does not diagnose twice from one frame ----------------- */
{
  if (/cheapest probe that DISCRIMINATES/.test(ship)) {
    ok('ship requires a discriminating probe before a second round of diagnosis');
  } else {
    bad('ship does not require a discriminating probe before re-diagnosing. Two rounds and eight '
      + 'candidates, none correct, were settled by one probe in 0.58 seconds that was available '
      + 'from the first minute.');
  }
}

/* --- C3. the decision-recording commands are still handed over --------- */
{
  const banned = ['--approve-spec', '--waive'].filter((v) => banBlock.includes(v)
    || new RegExp(`Do not run \`${v}\``).test(ship));
  if (banned.length === 2) {
    ok('ship still hands --approve-spec and --waive to the operator as commands');
  } else {
    bad(`ship no longer bans ${['--approve-spec', '--waive'].filter((v) => !banned.includes(v)).join(', ')}. `
      + "`state.mjs` writes `by: 'operator'` as a constant, so a record made by the orchestrator is "
      + 'byte-identical to one the operator typed. Lifting the ban before the record can carry who '
      + 'was asked and what they answered trades a weak guarantee for none.');
  }
}

/* --- C4. and the free ones are actually free --------------------------- */
{
  const free = ['--sync', '--record-corpus'];
  const named = free.filter((v) => new RegExp(`You MAY run[\\s\\S]{0,200}${v}`).test(ship)
    || new RegExp(`\`${v}\`[^\\n]*NOT on that list`).test(ship)
    || new RegExp(`${v}[\\s\\S]{0,120}NOT on that list`).test(ship));
  const stillBanned = free.filter((v) => banBlock.includes(v));
  if (named.length === free.length && stillBanned.length === 0) {
    ok('ship names --sync and --record-corpus as its own to run');
  } else {
    bad(`ship does not release --sync and --record-corpus to the orchestrator `
      + `(named: ${named.join(', ') || 'none'}; still in the ban block: ${stillBanned.join(', ') || 'none'}). `
      + 'Neither records a decision - --record-corpus refuses seven ways for a caller to supply the '
      + 'result - so printing them for the operator to paste is the transport this command exists '
      + 'to delete.');
  }
}

/* --- C5. and nothing else escaped the list while we were looking ------- */
{
  const mustStay = ['--reset-attempts', '--reseal', '--baseline-init', '--set-phase', 'retro.mjs --apply'];
  const gone = mustStay.filter((v) => !banBlock.includes(v));
  if (!gone.length) {
    ok(`the prohibition still covers ${mustStay.length} operator verbs`);
  } else {
    bad(`these left ship's prohibition list: ${gone.join(', ')}. --set-phase IS the decision - any `
      + 'phase, any time, no precondition - and the rest override a recorded one.');
  }
}

/* --- C6. the guard agrees about the free verbs ------------------------- *
 * Not prose. If ship says the orchestrator may run these, the component that
 * would actually stop it must not be denying them to the main session. */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-ship-'));
  try {
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.copyFileSync(FIXTURE, path.join(tmp, '.mavci', 'project.json'));
    const run = (command) => {
      let out = '';
      try {
        out = execFileSync(process.execPath, [GUARD], {
          input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: tmp, tool_name: 'Bash', tool_input: { command } }),
          encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) { out = err.stdout?.toString() ?? ''; }
      if (!out.trim()) return 'allow';
      return JSON.parse(out).hookSpecificOutput?.permissionDecision ?? 'allow';
    };
    const cases = [
      ['node scripts/doctor.mjs --sync', 'doctor --sync'],
      ['node scripts/state.mjs --record-corpus --run m8f2r=w1', 'state --record-corpus'],
    ];
    const denied = cases.filter(([cmd]) => run(cmd) === 'deny').map(([, label]) => label);
    if (!denied.length) {
      ok('and the risk guard does not deny either of them to the main session');
    } else {
      bad(`ship says the orchestrator may run ${denied.join(', ')}, and risk-guard.mjs DENIES it to `
        + 'the main session. A contract and the guard that enforces it disagreeing about one machine '
        + 'is this system\'s oldest defect shape.');
    }
    /* The control: the guard must still deny these to an AGENT. Without it a
     * guard that allowed everything would satisfy the assertion above. */
    const asAgent = (command) => {
      let out = '';
      try {
        out = execFileSync(process.execPath, [GUARD], {
          input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: tmp, agent_type: 'mavci-builder',
            tool_name: 'Bash', tool_input: { command } }),
          encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) { out = err.stdout?.toString() ?? ''; }
      if (!out.trim()) return 'allow';
      return JSON.parse(out).hookSpecificOutput?.permissionDecision ?? 'allow';
    };
    if (asAgent('node scripts/state.mjs --record-corpus --run m8f2r=w1') === 'deny') {
      ok('and still denies --record-corpus to a subagent, so the caller split is intact');
    } else {
      bad('risk-guard no longer denies --record-corpus to a subagent. The orchestrator being '
        + 'allowed to run it rests entirely on the guard authorising by CALLER; if that stops '
        + 'holding, this contract has widened the grant for every agent instead.');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* --- C7. ship's copy of WORKFLOW_MOVES is not a second list ------------ */
{
  const m = guardSrc.match(/const WORKFLOW_MOVES = \[([^\]]*)\]/);
  if (!m) {
    bad('risk-guard.mjs no longer declares WORKFLOW_MOVES where this check can read it, so ship\'s '
      + 'copy of it is unverified. That list is what the orchestrator is allowed to run without '
      + 'asking, and an unverified copy of it is the grant drifting silently.');
  } else {
    const actual = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const missing = actual.filter((v) => !ship.includes(v));
    const extra = ['--approve-spec', '--waive', '--set-phase', '--reseal']
      .filter((v) => new RegExp(`WORKFLOW_MOVES[\\s\\S]{0,300}\`${v}\``).test(ship));
    if (!missing.length && !extra.length) {
      ok(`ship names all ${actual.length} WORKFLOW_MOVES verbs and claims no others`);
    } else {
      bad(`ship's account of WORKFLOW_MOVES disagrees with risk-guard.mjs`
        + `${missing.length ? ` - not named: ${missing.join(', ')}` : ''}`
        + `${extra.length ? ` - wrongly claimed as exempt: ${extra.join(', ')}` : ''}. `
        + 'The exempt set decides what the orchestrator may run without asking; two lists of it is '
        + 'the shape that produced check-pretag running 13 of 17 checks.');
    }
  }
}

/* ============================= EVERY ACTION THE ROUTER CAN RETURN HAS A ROW ==
 *
 * NOT PROSE, AND IT FOUND ITS INSTANCE ON THE FIRST RUN. 0.1.33 added the
 * `incomplete` action to `ACTIONS` and never added a row to ship's table - so for
 * a whole release the orchestrator's only instruction for the action it would hit
 * after EVERY verify was the table's silence. An action with no row is not a stop
 * and not a step; it is a model deciding what to do next, which is the one thing
 * this contract exists to remove.
 *
 * 0.1.14's shape - two lists of the same set, edited once - for the third time.
 * The list that governs is the router's, so it is IMPORTED rather than
 * transcribed: a copy here would be the same defect wearing the fix's clothes.
 */
{
  const missing = ACTIONS.filter((a) => !shipRaw.includes(`| \`${a}\` |`));
  if (missing.length) {
    bad(`ship's action table has no row for ${missing.join(', ')}. The router can return every one `
      + 'of those, and an action with no row leaves the orchestrator to invent a response to the '
      + 'state the router stopped it in.');
  } else ok(`C9 every one of the router's ${ACTIONS.length} actions has a row in ship's table`);
}

if (failures.length) {
  console.error(`\nship contract check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\nship contract: it reads its own outputs, hands over only what records a decision,');
console.log('               and its account of the exempt set agrees with the guard.');

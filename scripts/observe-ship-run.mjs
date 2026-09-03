#!/usr/bin/env node
/**
 * Read a project's control plane and say whether a `/mavci-core:ship` run left the
 * evidence a ship run is supposed to leave.
 *
 * NOT a CI check, and deliberately not in `scripts/ci/`: it asserts facts about a
 * real session that only an operator can produce, so it can never run in a
 * workflow. `check-route.mjs` asserts what the ROUTER decides; this asserts what
 * a SESSION left behind. They are different questions and neither substitutes.
 *
 *   node scripts/observe-ship-run.mjs <project-dir> [--expect-action <action>]
 *
 * WHY IT EXISTS. The observation it replaces is "look at the control plane and see
 * if it seems right", which is a judgement call over eight files, made by someone
 * who already believes the run worked. Every property below has a way of being
 * subtly wrong that reads as fine: a verdict that exists but is unattributed, an
 * approval that exists but is for a different spec, two halves of a phase that
 * agree because nothing moved either of them. So each is checked rather than
 * looked at, and the ones that would be invisible are marked.
 *
 * IT REPORTS, IT DOES NOT SCORE. A ship run that stopped at `awaiting_approval` is
 * a PASS - that is the gate working. What would be a failure is reaching that stop
 * with the evidence chain broken behind it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.argv[2];
if (!root || root.startsWith('--')) {
  console.error('usage: node scripts/observe-ship-run.mjs <project-dir> [--expect-action <action>]');
  process.exit(2);
}
const ei = process.argv.indexOf('--expect-action');
const expected = ei === -1 ? null : process.argv[ei + 1];

const P = (...p) => path.join(root, '.mavci', ...p);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const exists = (f) => fs.existsSync(f);

const failures = [];
const notes = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL  ${m}`); };
const note = (m) => { notes.push(m); console.log(`  note  ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

if (!exists(P('project.json'))) {
  console.error(`not a Mavci project: ${P('project.json')} is absent`);
  process.exit(2);
}

console.log(`\nobserving ${root}\n`);

/* ---------------------------------------------- 1. DID THE HOOKS RUN AT ALL */

console.log('1. the hooks — checked FIRST, because nothing below means anything if they were silent:');
{
  const hookRun = readJson(P('control', 'hook-run.json'));
  check(!!hookRun,
    'a plugin hook has run in this project (control/hook-run.json exists). '
    + 'Absent means Claude Code registered no hooks: no risk guard, no standards gate, '
    + 'no phase gate - and every result below was produced with nothing enforcing it.');
  if (hookRun) {
    note(`SessionStart ran under plugin ${hookRun.plugin_version ?? '(unstated)'}`);
  }
  const gateRun = readJson(P('control', 'gate-run.json'));
  check(!!gateRun,
    'the standards gate has run (control/gate-run.json exists) - the Stop hook is live, '
    + 'not merely the SessionStart one. These are different registrations and only one of '
    + 'them enforces anything.');
  if (gateRun) note(`last gate run: ${gateRun.outcome ?? gateRun.status ?? JSON.stringify(gateRun).slice(0, 80)}`);
}

/* ------------------------------------------------------ 2. THE EVIDENCE CHAIN */

console.log('\n2. the evidence chain:');
const state = readJson(P('control', 'state.json'));
check(!!state, 'control/state.json is readable');

const taskDir = P('control', 'tasks');
const ids = exists(taskDir)
  ? fs.readdirSync(taskDir).filter((f) => /^[0-9]{4}\.json$/.test(f)).map((f) => f.slice(0, 4)).sort()
  : [];
check(ids.length > 0, `at least one task exists - found ${ids.length}: ${ids.join(', ') || '(none)'}`);

const verdictDir = P('control', 'verdicts');
const verdictFiles = exists(verdictDir) ? fs.readdirSync(verdictDir).filter((f) => f.endsWith('.json')) : [];
const adhoc = verdictFiles.filter((f) => f.startsWith('adhoc-'));
const attributed = verdictFiles.filter((f) => /^[0-9]{4}-attempt-[0-9]{2}\.json$/.test(f));

for (const id of ids) {
  const t = readJson(path.join(taskDir, `${id}.json`));
  if (!t) { bad(`task ${id}: control record unreadable`); continue; }
  const line = `task ${id}: status=${t.status} phase=${t.phase} attempts=${t.attempts}/${t.attempts_total ?? '(pre-field)'}`;

  // A task that has consumed attempts must have a verdict for each verified one,
  // and every one of them must be ATTRIBUTED. An unattributed verdict is not a
  // weaker record of the same fact - the router ignores it entirely.
  const mine = attributed.filter((f) => f.startsWith(`${id}-`));
  const linked = Array.isArray(t.verdicts) ? t.verdicts : [];
  check(mine.length === linked.length,
    `${line}; ${mine.length} attributed verdict(s) on disk and ${linked.length} linked from the `
    + 'control record - a verdict the task does not link is evidence nothing will read');

  for (const rel of linked) {
    const abs = path.join(root, rel);
    const v = readJson(abs);
    if (!v) { bad(`task ${id}: linked verdict ${rel} is missing or unreadable`); continue; }
    check(v.task_id === id && typeof v.attempt === 'number',
      `  ${rel}: task_id=${JSON.stringify(v.task_id)} attempt=${JSON.stringify(v.attempt)} `
      + `verdict=${v.verdict} - carries its own attribution, not just its filename`);
    const fromName = Number(/-attempt-([0-9]{2})\.json$/.exec(rel)?.[1]);
    check(fromName === v.attempt,
      `  ${rel}: the filename and the document agree on the attempt (${fromName} vs ${v.attempt}) `
      + '- if they disagree the audit trail is ordered by one and read by the other');
  }

  // The approval, and whether it is still about the spec on disk. An approval that
  // exists but is stale is the failure mode the hash was added for, and it is
  // invisible to anyone reading the field for presence.
  if (t.spec_approved) {
    const surface = readJson(P('tasks', `${id}.json`));
    const specRel = t.spec_approved.spec_path ?? surface?.spec;
    const specAbs = specRel ? path.join(root, specRel) : null;
    if (specAbs && exists(specAbs)) {
      const live = createHash('sha256').update(fs.readFileSync(specAbs, 'utf8')).digest('hex');
      check(live === t.spec_approved.spec_sha256,
        `  task ${id}: the recorded approval still matches the spec on disk `
        + `(${specRel}) - a stale approval reads as approved to anyone checking the field`);
    } else {
      bad(`  task ${id}: approved spec ${specRel ?? '(no path)'} is not on disk`);
    }
  } else {
    note(`  task ${id}: no operator approval recorded - correct if it is waiting at awaiting_approval`);
  }

  // Both halves of the phase must agree, EXCEPT while a task is open and the
  // project has moved on to another. This is the divergence 0.1.23 closed.
  if (state && t.status === 'in_progress') {
    check(t.phase === state.phase,
      `  task ${id} is in_progress: its phase (${t.phase}) and the project's (${state.phase}) agree`);
  }
}

check(adhoc.length === 0,
  `no unattributed verdicts were written during task work - found ${adhoc.length}`
  + (adhoc.length ? ` (${adhoc.slice(0, 3).join(', ')}${adhoc.length > 3 ? ', ...' : ''}). `
    + 'Per-turn gate verdicts are legitimately adhoc; a VERIFIER run that produced one is not.' : ''));

if (state) {
  const openInProgress = ids.filter((id) => readJson(path.join(taskDir, `${id}.json`))?.status === 'in_progress');
  check(openInProgress.length <= 1,
    `at most one task in_progress - found ${openInProgress.length}${openInProgress.length ? ` (${openInProgress.join(', ')})` : ''}`);
  check(!state.active_task || openInProgress.includes(state.active_task),
    `state.active_task (${JSON.stringify(state.active_task)}) names a task that is actually in progress, `
    + 'or is null - a pointer that is only ever set reads as current forever');
}

/* --------------------------------------------------------- 3. WHERE IT STOPPED */

if (expected) {
  console.log('\n3. where the run stopped:');
  note(`expected action: ${expected}. Run the router yourself to confirm:`);
  note(`  node <plugin>/scripts/route.mjs   (in ${root})`);
  note('A ship run that STOPPED at an operator gate is a pass. What would be a failure');
  note('is reaching that stop with the evidence above broken behind it.');
}

console.log('');
if (failures.length) {
  console.error(`ship-run observation FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f.split(' - ')[0]);
  process.exit(1);
}
console.log(`ship-run observation: ${attributed.length} attributed verdict(s), ${adhoc.length} adhoc,`);
console.log(`                      ${ids.length} task(s), hooks live, evidence chain intact.`);

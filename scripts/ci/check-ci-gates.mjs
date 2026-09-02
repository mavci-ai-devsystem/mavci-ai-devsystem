#!/usr/bin/env node
/**
 * Every assertion in every CI check must be able to fail the build.
 *
 * -------------------------------------------------------------- WHY THIS EXISTS
 *
 * `check-guardian.mjs` grew in two halves. The first half ended, correctly, with
 *
 *     if (failures.length) { ...; process.exit(1); }
 *     console.log('guardian coverage: ...');
 *
 * and then the file CARRIED ON for another 250 lines - the whole SubagentStop
 * writer section (design 4.3, "the three ways it manufactures a pass"), the skill
 * text constraints, and the hot-path ordering check. Every one of those pushed
 * into the same `failures` array, and nothing ever read it again. 31 assertions
 * printed `FAIL` and the process exited 0.
 *
 * It was found by mutation, not by reading: removing the record's `source` field
 * made seven writer assertions print FAIL while the script still exited 0 and CI
 * would still have gone green. The assertions were real, the harness was not.
 *
 * THIS IS THE HOUSE FAILURE MODE, in its purest form yet. CLAUDE.md: "an
 * assertion never demonstrated failing is not coverage". These had never been
 * demonstrated failing, because they COULD not fail - and every one of them read
 * green on every run since 0.1.15, which is exactly what made them invisible.
 *
 * ------------------------------------------------------------------- THE RULE
 *
 * A script's assertions must all sit BEFORE the last point at which it can exit
 * non-zero. An assertion after that point is decoration. This is a structural
 * property of the file, checkable without running anything, which is the only
 * reason it is worth having: a check that had to execute each suite to find this
 * would be a check nobody ran.
 *
 * ------------------------------------------------- WHAT THIS CANNOT SEE
 *
 * It proves an assertion CAN fail the build. It proves nothing about whether the
 * assertion DISCRIMINATES. Three blind spots, in increasing order of how much
 * they matter:
 *
 *   1. THAT THE GATE IS REACHED. A `process.exit(1)` inside a branch that never
 *      executes satisfies this check and stops nothing. The shape is static; the
 *      reachability is not.
 *
 *   2. AN ASSERTION THAT PASSES FOR THE WRONG REASON. `check(x !== undefined)`
 *      over a value that is never undefined is green, gated, and empty. So is an
 *      assertion whose subject silently stopped being loaded. This check counts
 *      such an assertion as covered, because from here it is indistinguishable
 *      from one that bites.
 *
 *   3. AN ASSERTION THAT TESTS THE HALF THAT WORKS. The failure this repository
 *      keeps finding in its own probes - 0.1.2's clean start over zero registered
 *      hooks, the self-test printing "5 cases passed" while agent scope denied
 *      every edit, `doctor` comparing the running plugin against its own copy.
 *      Every one of those was gated correctly and would pass this check.
 *
 * So this is a NECESSARY condition and nowhere near a sufficient one. It moves an
 * assertion from "cannot possibly fail" to "might fail if it is any good", and
 * the only thing that establishes the second half is running the suite against a
 * deliberately broken subject and watching the specific assertion go red. That is
 * mutation, it is manual, it is one suite at a time, and there is no static
 * substitute for it. CLAUDE.md states the rule; this check enforces the floor
 * beneath it, not the rule itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const failures = [];

/** A line that can end the process with a non-zero status. */
const EXITS = /process\.exit\(\s*[1-9]|process\.exitCode\s*=\s*[1-9]/;
/** A line that makes an assertion. */
const ASSERTS = /^\s*(check|bad|assert)\(/;

const files = fs.readdirSync(HERE)
  .filter((n) => n.startsWith('check-') && n.endsWith('.mjs'))
  .sort();

if (!files.length) {
  console.error('\nci gate check FAILED:\n  - no check-*.mjs found. A check that finds nothing to');
  console.error('    check must fail rather than report green over an empty set.');
  process.exit(2);
}

console.log('every assertion can fail the build:');

for (const name of files) {
  const lines = fs.readFileSync(path.join(HERE, name), 'utf8').split('\n');

  let lastExit = -1;
  lines.forEach((l, i) => { if (EXITS.test(l)) lastExit = i; });

  const stranded = [];
  lines.forEach((l, i) => { if (i > lastExit && ASSERTS.test(l)) stranded.push(i + 1); });

  if (lastExit === -1) {
    // Nothing here can fail. Either it asserts nothing, or none of it counts.
    const total = lines.filter((l) => ASSERTS.test(l)).length;
    failures.push(`${name} has NO non-zero exit at all, so none of its ${total} assertion(s) can `
      + 'fail the build. It reports green whatever it finds.');
    console.log(`  FAIL ${name} - no non-zero exit`);
    continue;
  }
  if (stranded.length) {
    const shown = stranded.slice(0, 6).join(', ') + (stranded.length > 6 ? ', ...' : '');
    failures.push(`${name}: ${stranded.length} assertion(s) sit AFTER the last non-zero exit `
      + `(line ${lastExit + 1} of ${lines.length}) and cannot fail the build - lines ${shown}. `
      + 'Move the failure gate to the end of the file, or split the script.');
    console.log(`  FAIL ${name} - ${stranded.length} assertion(s) after the gate at line ${lastExit + 1}`);
    continue;
  }
  console.log(`  ok   ${name}`);
}

console.log('');
if (failures.length) {
  console.log(`ci gate check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`ci gates: ${files.length} check script(s), every assertion ahead of a gate that can fail`);

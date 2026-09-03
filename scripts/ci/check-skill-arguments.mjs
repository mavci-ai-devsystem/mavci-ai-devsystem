#!/usr/bin/env node
/**
 * A skill that takes the operator's request must HAND IT to the script that
 * routes on it.
 *
 * -------------------------------------------------------------- WHY THIS EXISTS
 *
 * `/mavci-core:ship "<request>"` shipped from 0.1.23 with its preflight reading
 *
 *     !`node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" 2>&1`
 *
 * - no `--request`, no `$ARGUMENTS`. `route.mjs` parses the request out of argv,
 * so it received `request = null`, took the no-request branch, and printed
 * `next: release_gate -> the operator`. Per ship's own action table that means
 * STOP, so the chain terminated before its first router consultation, on a
 * request that routes to `plan` the moment the argument is passed. The line
 * twelve lines further down - the loop body, inside a fenced block - carried
 * `--json --request "$ARGUMENTS"` and was correct. **The line that executes was
 * not the line that was written to be right, and it is the one the operator
 * meets first.**
 *
 * THE FAILURE IS SILENT AND READS AS A LEGITIMATE VERDICT. `release_gate` is a
 * real action with a plausible explanation attached, so a dropped argument is
 * indistinguishable from a project genuinely sitting in the release phase. From
 * `idle` the same drop yields `idle`, which is also a stop and also looks
 * correct. There is no input for which the bare call is right and no output that
 * announces it was wrong.
 *
 * ------------------------------------------------- WHY NOTHING ELSE SAW IT
 *
 * `check-route.mjs` asserts every router case, as a pure function, with a request
 * already in hand. It asserts the CALLEE and assumes the CALLER.
 * `check-command-invocation.mjs` executes every inline block - but it substitutes
 * `$ARGUMENTS` with the empty string by construction, because it is asking
 * whether the block RUNS, not what it was handed. Both were green on the broken
 * build. This is the same shape as the counter split recorded for 0.1.23: each
 * side right in isolation, the seam between them asserted by nothing.
 *
 * ------------------------------------------------------------------- THE RULE
 *
 * For every SKILL.md whose body declares `$ARGUMENTS`, each command it invokes
 * through an inline `!`...`` block either RECEIVES those arguments, or is named
 * in `EXEMPT` with a reason.
 *
 * The exemptions are not decoration and the allowlist is the load-bearing half.
 * `verify` calls `route.mjs` bare and is CORRECT: its `$ARGUMENTS` is a task id,
 * not a request, and the router has no task-id parameter. A rule with no
 * allowlist would report that as the same defect and get itself "fixed" into a
 * bug. So an exemption is a written claim about what a skill's arguments MEAN,
 * and it is keyed by skill: the same script is exempt in one caller and required
 * in another, which is exactly the discrimination that was missing.
 *
 * Every key is asserted to still match a block in the tree, so an exemption that
 * outlives its command fails here rather than sitting behind whatever replaces
 * it - `check-pretag.mjs`'s `EXCLUDED_STEPS` rule, for the reason given there.
 *
 * ------------------------------------------------- WHAT THIS CANNOT SEE
 *
 * It reads the CALL, never the callee's argv parsing. A skill that passes
 * `--request "$ARGUMENTS"` to a script which parses `--req` satisfies this check
 * and drops the request just as completely. That gap is real and is closed
 * nowhere: `check-command-invocation.mjs` executes the block and
 * `check-script-refs.mjs` proves the callee exists, but neither of them, nor this
 * file, asserts that the two flag names agree. Stated rather than implied,
 * because an unstated blind spot is the defect above, one layer up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS = path.join(ROOT, 'plugins', 'mavci-core', 'skills');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/** The loader's own shape, identical to check-command-invocation.mjs. */
const INLINE = /!`([^`]+)`/g;

/* --- the allowlist: calls that legitimately receive no arguments -------- */
// Keyed `<skill>::<callee>`, because the answer depends on the CALLER. Audited
// at 0.1.24 against every skill that declares $ARGUMENTS; `ship` was the only
// defect. Each reason states what the skill's own $ARGUMENTS are, since that is
// the fact that makes the call correct - not the callee's flag list.
export const EXEMPT = new Map([
  ['build::scripts/state.mjs',
    "build's $ARGUMENTS is a task id. This block is `--show`, a preflight that reports the "
    + 'whole control plane; the id is bound into prose for the model, and state.mjs has no '
    + 'per-task read mode for it to be passed to.'],
  ['plan::scripts/state.mjs',
    "plan's $ARGUMENTS is the request, and it goes to the architect agent, not to a script. "
    + 'This block is the same `--show` preflight and takes nothing.'],
  ['scribe::scripts/state.mjs', "scribe's $ARGUMENTS is a task id; the `--show` preflight, as above."],
  ['scribe::git', 'a fixed `git log --oneline -10` for context. Takes no operator input.'],
  ['retro::scripts/retro.mjs',
    "retro's $ARGUMENTS is the finding text, which reaches retro.mjs through `--record` when "
    + 'the operator commits to filing it. This block is `--list`, which shows what is already '
    + 'queued and must not be handed a finding it would then be ambiguous about writing.'],
  ['verify::scripts/gate.mjs',
    "verify's $ARGUMENTS is a task id. `--mark-dirty --session=` arms the standards gate for "
    + 'the session and is not about a task.'],
  ['verify::scripts/route.mjs',
    'THE EXEMPTION THAT MAKES THE RULE USABLE. verify\'s $ARGUMENTS is a task id, not a '
    + 'request, and the router takes no task-id parameter - it reads the control plane. '
    + 'Passing `--request "<task id>"` here would fabricate a request out of an identifier, '
    + 'and is the bug this entry exists to stop someone "fixing" this call into.'],
  ['verify::git', 'a fixed `git status --porcelain` for context. Takes no operator input.'],
  ['new-project::ls',
    "new-project's $ARGUMENTS is the project name. Its two blocks probe the CURRENT directory "
    + '- is it empty, is it already connected - and are about the cwd, not the name.'],
]);

/* --- the classification, as one pure function -------------------------- */
// The controls below and the loop call THIS. A control exercising a second copy
// of the rule would be asserting that the copy works.

/** What a block calls: a plugin script by its plugin-relative path, else argv[0]. */
export function callee(cmd) {
  const node = /^node\s+"?\$\{CLAUDE_PLUGIN_ROOT\}\/(scripts\/[A-Za-z0-9_.-]+\.mjs)/.exec(cmd.trim());
  if (node) return node[1];
  return cmd.trim().split(/\s+/)[0];
}

/** `forwards` (gets the arguments), `exempt` (declared not to need them), or `violation`. */
export function classify(skill, cmd) {
  if (/\$ARGUMENTS/.test(cmd)) return { verdict: 'forwards', key: null };
  const key = `${skill}::${callee(cmd)}`;
  return { verdict: EXEMPT.has(key) ? 'exempt' : 'violation', key };
}

/* --- controls, ahead of the loop --------------------------------------- */
// check-command-invocation.mjs's 0.1.22 lesson, applied here from the start: a
// control that can invalidate every line below it belongs above them.

function preflightControls() {
  const SHIPPED = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" 2>&1';
  const FIXED = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/route.mjs" --request "$ARGUMENTS" 2>&1';

  // Negative: the exact form 0.1.23 shipped must be caught.
  const neg = classify('ship', SHIPPED);
  if (neg.verdict === 'violation') {
    ok('negative control: the 0.1.23 ship preflight is caught - route.mjs, called from ship, given nothing');
  } else {
    bad(`negative control FAILED: the shipped 0.1.23 form classified as "${neg.verdict}". `
      + 'This check cannot detect the defect it exists for, so nothing it reports means anything.');
  }

  // Positive, half one: the fix must pass, or this check blocks every correct tree.
  const pos = classify('ship', FIXED);
  if (pos.verdict === 'forwards') ok('positive control: the corrected ship preflight forwards the request');
  else bad(`positive control FAILED: the corrected form classified as "${pos.verdict}" - this check would block a correct tree.`);

  // Positive, half two: the allowlist must actually exempt, or every bare call
  // reads as the defect and the rule becomes a rule against a correct call.
  const exempt = classify('verify', SHIPPED);
  if (exempt.verdict === 'exempt') ok("positive control: verify's bare route.mjs is exempt - the allowlist discriminates by caller");
  else bad(`positive control FAILED: verify's legitimate bare route.mjs classified as "${exempt.verdict}".`);
}

/* --- the tree ----------------------------------------------------------- */

console.log('every skill that takes arguments hands them to what routes on them:');
preflightControls();

if (failures.length) {
  console.log('  ..   controls failed - no skill was inspected, and no claim is made about any');
}

const skills = failures.length
  ? []
  : fs.readdirSync(SKILLS).filter((s) => fs.existsSync(path.join(SKILLS, s, 'SKILL.md'))).sort();

const used = new Set();
let withArgs = 0;
let blocks = 0;

for (const skill of skills) {
  const body = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
  if (!/\$ARGUMENTS/.test(body)) continue;
  withArgs++;

  for (const m of body.matchAll(INLINE)) {
    blocks++;
    const cmd = m[1];
    const { verdict, key } = classify(skill, cmd);
    if (verdict === 'forwards') { ok(`${skill}: ${callee(cmd)} receives $ARGUMENTS`); continue; }
    if (verdict === 'exempt') { used.add(key); ok(`${skill}: ${callee(cmd)} declared argument-free - ${EXEMPT.get(key)}`); continue; }
    bad(`${skill}: the inline block \`${cmd.slice(0, 70)}\` executes at skill-load time and receives `
      + `NEITHER $ARGUMENTS nor an exemption. ${skill}'s body declares $ARGUMENTS, so the operator `
      + 'typed something this call throws away - and a script that routes on a request it never got '
      + 'answers confidently about a different question. Pass the arguments, or add '
      + `"${key}" to EXEMPT in this file with the reason its arguments are not for this call.`);
  }
}

// A floor. A recogniser that silently matched nothing would otherwise report a
// clean tree in the confident voice of a check that inspected one.
if (!failures.length && !withArgs) {
  bad('no SKILL.md declares $ARGUMENTS. Either the placeholder was renamed or the skills directory '
    + 'was not read - and this check inspected nothing while reporting green.');
}
if (!failures.length && withArgs && !blocks) {
  bad(`${withArgs} skill(s) declare $ARGUMENTS and not one contains an inline \`!\` block. `
    + 'Nothing was classified, so nothing here is evidence.');
}

// A stale exemption is worse than none: it silently excuses whatever takes the
// place of the call it was written for.
if (!failures.length) {
  for (const [key, reason] of EXEMPT) {
    if (used.has(key)) continue;
    bad(`EXEMPT holds "${key}", which matches no inline block in the tree. The call it excuses is gone `
      + `or renamed, and the exemption now covers whatever replaces it. Reason on record: ${reason}`);
  }
}

console.log('');
if (failures.length) {
  console.error(`skill argument check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log(`skill arguments: ${blocks} inline block(s) across ${withArgs} skill(s) that declare $ARGUMENTS; `
  + `every one forwards them or is exempt with a reason (${EXEMPT.size} exemption(s), all still matched).`);

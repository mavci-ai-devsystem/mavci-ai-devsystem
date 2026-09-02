#!/usr/bin/env node
/**
 * The pre-tag gate. Runs BEFORE the tag exists, which is the whole point.
 *
 * `release.yml` already asserts that the tag equals `plugin.json`'s version, and
 * that assertion is correct. It is also too late. It fires `on: push: tags`, so
 * by the time it can fail, the tag has been created, pushed, and is fetchable by
 * every machine — and every step that consumes a release (fetch the clone,
 * uninstall, install) is a manual operator action that consults no CI verdict.
 *
 * v0.1.8 is the proof. It was tagged with `plugin.json` still reading 0.1.7. Run
 * 33265540461 failed in 9 seconds on exactly that assertion, on 2026-08-29. The
 * tag propagated and installed anyway, the loaded payload self-reported the
 * wrong version, `doctor`'s skew check compared that wrong value against itself
 * and passed, and every project's CI went on cloning `v0.1.7` — a tag that is
 * not the code they run. Nothing malfunctioned. The check was right and nothing
 * was required to read it. NATIVE-CAPABILITIES 6.24.
 *
 * So this runs first, locally, and refuses. And because a check nobody is
 * required to run is the same failure one layer up, `--cut` makes this script
 * the thing that CREATES the tag: pass the gate and it tags, fail it and there
 * is no tag. The gate is not advisory when it is the only door.
 *
 *   node scripts/ci/check-pretag.mjs v0.1.9          check only
 *   node scripts/ci/check-pretag.mjs v0.1.9 --cut    check, then create the annotated tag
 *   node scripts/ci/check-pretag.mjs --selftest      exercise the derivation itself
 *
 * With no tag argument it reports the tag `plugin.json` currently authorises.
 *
 * ---------------------------------------------------------------------------
 * v0.1.14: THE SUITE IS DERIVED FROM release.yml, NOT LISTED BESIDE IT.
 *
 * Through v0.1.13 this file carried a hardcoded array of checks under a comment
 * claiming it was "everything release.yml would run". It was not. It ran 13 of
 * release.yml's 17: `redact.mjs --selftest`, `check-retro.mjs`,
 * `check-escape-hatch.mjs` and `check-command-invocation.mjs` were all absent,
 * and only `check-tags.mjs` had its absence explained. The other four read as
 * decisions and were omissions — and those two are indistinguishable when an
 * exclusion is expressed by not appearing in a list.
 *
 * `check-retro.mjs` was added to release.yml in v0.1.13 and to that array
 * never, which is how the drift happened and how it would have kept happening:
 * two lists, one edit. **A gate that admits what the next gate rejects is not a
 * gate** — it is a slower way of finding out. This one is the door that is
 * supposed to be the only door, and it was narrower than the one behind it.
 *
 * So the array is gone. `deriveReleaseSuite` reads release.yml, and the suite
 * IS what release.yml runs. Same move as `findingHeading()` and `FINDING_RE`
 * sharing their pieces in retro.mjs: writer and reader change together or
 * neither does. Adding a check to release.yml adds it here with no second edit,
 * and — the half that makes drift impossible rather than merely unlikely — a
 * step this file can neither run nor name in EXCLUDED_STEPS is a FAILURE. So
 * release.yml cannot grow a step that this gate silently skips.
 *
 * ---------------------------------------------------------------------------
 * v0.1.17: THE IDENTITY THAT WILL PUSH, CHECKED AT THE MOMENT IT MATTERS.
 *
 * doctor has compared the active `gh` account against the system repo's owner
 * since v0.1.13. Right check, wrong moment. It fires when someone runs doctor;
 * the damage happens at `git push`, which consults no doctor. `gh` switches
 * accounts globally, and against a PRIVATE repo the wrong one gets
 * `Repository not found` - a permission error worded as absence, mentioning no
 * account anywhere. On 2026-09-01 that message came up four times in one day
 * and nearly had the operator recreate a repository that had never gone
 * anywhere.
 *
 * This gate runs immediately before the one irreversible step, so this is where
 * the question belongs. And it already held the answer without knowing it:
 * `git ls-remote origin` is a live authorisation probe, made with the exact
 * credential that is about to push. What it lacked was an explanation - the
 * failing arm said "Check the network and re-run", which is this file's own copy
 * of the wrong explanation doctor was fixed for.
 *
 * So the two are not redundant and neither is decorative. REACHABILITY IS THE
 * GROUND TRUTH; the account comparison is what turns its silence into a sentence
 * naming the cause. Origin answers => the pushing credential can read the repo,
 * whatever `gh` reports, because git's credential helper need not be gh and a
 * FAIL there would be a false positive in a release gate - the most expensive
 * place in the system to put one (0.1.12 item 5: a guard that fires wrongly and
 * often trains everyone to turn it off). Origin is silent => refuse, name the
 * account, and stop BEFORE the suite: every remaining check compares this tree
 * against a remote this machine cannot read, and each would volunteer its own
 * wrong explanation for the same one cause.
 *
 * READ, NOT WRITE - and deliberately not a check. `ls-remote` proves the
 * credential can READ the repository; it proves nothing about pushing, and a
 * read-only token (`MAVCI_TOKEN` is exactly that shape) passes this gate and
 * fails at the push. That gap is left open on purpose: `--cut` creates the tag
 * LOCALLY and pushes nothing, so a credential that cannot write fails at the
 * operator's own `git push`, immediately and in words, with the tag still local
 * and deletable (`git tag -d <tag>`). The failure is loud and free to undo, and
 * a control belongs where the loss is - which is the same argument that put the
 * read probe here, applied honestly in the other direction.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Imported, not reimplemented. doctor owns the probe and the decision; this gate
// owns the moment. A second copy of either would be the shape this system has
// hit repeatedly - a value written down once, wrongly, and then propagated.
import { ghAccountFinding, readGhAccounts } from '../../plugins/mavci-core/scripts/doctor.mjs';
import { SYSTEM_REPO } from '../../plugins/mavci-core/scripts/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json');
const RELEASE_YML = path.join(ROOT, '.github/workflows/release.yml');
const SELFTEST_YML = path.join(ROOT, '.github/workflows/selftest.yml');
const OWNER = SYSTEM_REPO.split('/')[0];

/* --- what release.yml runs that this gate deliberately does not --------- */
// Declared, with the reason, because an exclusion implied by absence is
// indistinguishable from an omission - which is exactly what shipped for four
// checks through v0.1.13. Every key is asserted to still exist in release.yml,
// so a renamed or deleted step fails here rather than leaving a stale exemption
// behind that quietly excuses whatever takes its place.
export const EXCLUDED_STEPS = new Map([
  ['Tag must equal plugin.json version',
    'this gate IS that assertion, moved to before the tag exists - see section 2'],
  ['Tag is the mainline, and every tag is annotated',
    'a POST-tag condition. Before the tag exists main is always one commit ahead of it, '
    + 'so running it here would fail every release by construction. It runs after --cut '
    + 'instead, against the tag just created, and the tag is rolled back if it fails.'],
  ['Install Claude Code',
    'installs a global npm package. release.yml does that in a disposable runner; this '
    + 'gate runs on the operator machine and does not mutate it.'],
  ['Claude Code validates the tagged plugin and marketplace',
    'requires Claude Code installed, and a local --plugin-dir run does not exercise the '
    + 'plugin loader schema validation anyway (NATIVE-CAPABILITIES 4.22). release.yml '
    + 'runs it on the tagged tree and remains the documented authority; this gate does '
    + 'not claim to replace it, and says so on every pass.'],
]);

/* --- what selftest.yml runs that release.yml does not ------------------- */
// selftest.yml is the escape-hatch proof (ARCHITECTURE section 11), so every
// check in it is a dependency-free node script with no model in the loop -
// exactly the shape release.yml can also run. "selftest is a subset of release"
// held for every check in the file until 0.1.18 added four that only selftest
// ran, and because this gate derives its suite from release.yml ALONE, a check
// absent there is a check no release gate has ever executed. That is 0.1.14's
// finding through a different door: two lists, one edit, and the narrower list
// is the one guarding the tag.
//
// Scripts are compared by PATH, not by full command: the two workflows may
// legitimately pass different arguments, and this arm claims only that the
// release gate runs the same checks - not that it runs them identically.
// Non-node steps in selftest.yml (the "command -v claude" proof, the npm-surface
// proof) are deliberately out of scope: they assert things about the RUNNER that
// release.yml is not trying to assert.
//
// Declared with a reason rather than left silent, for the reason EXCLUDED_STEPS
// gives - an exclusion implied by absence is indistinguishable from an omission.
export const SELFTEST_ONLY = new Map([]);

// A floor, not a second list. A recogniser that silently matched nothing would
// otherwise report "0 checks pass" in the confident voice of a gate that ran.
const MIN_DERIVED = 8;

// ONE recogniser for "this step runs a node check", shared by the release
// derivation and the selftest-coverage arm. Two copies of a pattern is the
// shape this repository keeps finding: they agree until one is edited.
const NODE_STEP_RE = /^node\s+(\S+\.mjs)(?:\s+(.*))?$/;

/* --- deriving it -------------------------------------------------------- */
// Deliberately NOT a general YAML parser. It reads the one file it owns, in
// this repository, and fails closed on anything it does not recognise. The
// 0.1.12 lesson - `blankSource` reading a backtick inside a regex literal as a
// template literal - is why the recogniser is strict and why the unrecognised
// arm is a failure rather than a skip.

export function parseSteps(yml) {
  const steps = [];
  let cur = null;
  let runIndent = null;

  for (const raw of yml.split(/\r?\n/)) {
    const named = /^\s*-\s+name:\s*(.+?)\s*$/.exec(raw);
    if (named) {
      cur = { name: named[1].replace(/^['"]|['"]$/g, ''), commands: [] };
      steps.push(cur);
      runIndent = null;
      continue;
    }
    if (/^\s*-\s+uses:/.test(raw)) { cur = null; runIndent = null; continue; }
    if (!cur) continue;

    const block = /^(\s*)run:\s*\|\s*$/.exec(raw);
    if (block) { runIndent = block[1].length; continue; }

    const inline = /^\s*run:\s*(\S.*?)\s*$/.exec(raw);
    if (inline) { cur.commands.push(inline[1]); runIndent = null; continue; }

    if (runIndent === null) continue;
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= runIndent) { runIndent = null; continue; }
    cur.commands.push(raw.trim());
  }
  return steps;
}

export function deriveReleaseSuite(yml) {
  const steps = parseSteps(yml);
  const suite = [];
  const undeclared = [];
  const seen = new Set();

  for (const step of steps) {
    if (EXCLUDED_STEPS.has(step.name)) { seen.add(step.name); continue; }
    for (const command of step.commands) {
      const m = NODE_STEP_RE.exec(command);
      if (!m) { undeclared.push({ step: step.name, command }); continue; }
      suite.push([m[1], ...(m[2] ?? '').split(/\s+/).filter(Boolean)]);
    }
  }

  const stale = [...EXCLUDED_STEPS.keys()].filter((k) => !seen.has(k));
  return { steps, suite, undeclared, stale };
}

/**
 * Every node check selftest.yml runs, and which of them release.yml does not.
 * Reuses parseSteps rather than recognising the same shape a second time.
 */
export function selftestCoverage(releaseYml, selftestYml) {
  const released = new Set(deriveReleaseSuite(releaseYml).suite.map(([script]) => script));
  const scripts = [];
  for (const step of parseSteps(selftestYml)) {
    for (const command of step.commands) {
      const m = NODE_STEP_RE.exec(command);
      if (m && !scripts.includes(m[1])) scripts.push(m[1]);
    }
  }
  const seen = new Set();
  const uncovered = [];
  for (const script of scripts) {
    if (SELFTEST_ONLY.has(script)) { seen.add(script); continue; }
    if (!released.has(script)) uncovered.push(script);
  }
  const stale = [...SELFTEST_ONLY.keys()].filter((k) => !seen.has(k));
  return { scripts, uncovered, stale };
}

/* --- the identity that is about to push ---------------------------------- */

/**
 * doctor's finding, re-indented for this file's failure list.
 *
 * The point is that the WORDING is doctor's - the remedy, the sentence
 * explaining that "Repository not found" is a permission error and not a
 * deletion, the caveat that only logins were compared. Two gates that disagree
 * about what to tell the operator is the defect this system keeps finding; two
 * gates that agree because one asked the other is the fix.
 */
export function reflow(text) {
  return text.replace(/^\s*\[[^\]]+\]\s*/, '')
    .split('\n')
    .map((l, i) => (i === 0 ? l : '    ' + l.trim()))
    .join('\n');
}

/**
 * @param {{origin: string|null, accounts: object|null, owner?: string}} input
 *        `origin` is the raw `git ls-remote origin refs/heads/main` result:
 *        null means the command FAILED, '' means it answered and has no such
 *        ref. That distinction is the whole check, so it is kept rather than
 *        collapsed into a boolean by the caller.
 * @returns {{status: 'ok'|'note'|'fail', text: string}}
 */
export function identityVerdict({ origin, accounts, owner = OWNER }) {
  const finding = ghAccountFinding(accounts, owner);
  const active = accounts?.active ?? null;

  if (origin !== null) {
    // Origin answered. Whatever gh reports, the credential that will push can
    // read a private repository - which is the only thing being asked here.
    if (active === owner) {
      return { status: 'ok',
        text: `origin answered and the active gh account is ${owner}, which owns ${SYSTEM_REPO}.` };
    }
    // NOT a failure, deliberately. git's credential helper need not be gh, so a
    // login mismatch is not evidence of anything once origin has answered - and
    // a release gate is the worst place in the system to put a false positive.
    return { status: 'note',
      text: `origin answered, so the credential that will push can read ${SYSTEM_REPO} - but gh `
        + `reports ${active ? `"${active}"` : 'no active account'}, not ${owner}.\n`
        + '    Reported, not failed: git need not use the gh credential helper, and origin has\n'
        + '    already answered the question a login comparison could only estimate. doctor\n'
        + '    reports the same mismatch in full, with the remedy - it is not repeated here,\n'
        + '    because a remedy printed on a passing run is a remedy for nothing.' };
  }

  // Origin did not answer. From here the gate is blind, and the only question
  // worth answering is WHICH of the two causes it is.
  const stop = '\n    No tag is worth cutting against a remote this machine cannot read: the push would\n'
    + '    fail, or "Repository not found" would come back and read as the repository being gone.';

  if (accounts && active !== owner) {
    return { status: 'fail',
      text: 'git could not read origin, and the active gh account is why:\n'
        + `    ${reflow(finding.text)}` + stop };
  }

  if (accounts) {
    // The account is right, so do NOT accuse it. Name both candidates and
    // assert neither: the defect this check exists for is a message that
    // explained one cause confidently and wrongly.
    return { status: 'fail',
      text: 'git could not read origin.\n'
        + `    The active gh account IS ${owner}, so this is not the mismatch doctor checks for. It\n`
        + '    is the network, or a git credential helper holding a different identity than gh\n'
        + '    does - which this gate cannot tell apart and does not guess between.\n'
        + '    Check by hand: git ls-remote origin refs/heads/main' + stop };
  }

  return { status: 'fail',
    text: 'git could not read origin, and gh could not be read either, so the account can be\n'
      + '    neither ruled in nor ruled out:\n'
      + `    ${reflow(finding.text)}` + stop };
}

/* --- the self-test ------------------------------------------------------ */
// v0.1.13 recorded the rule this obeys: a component that reports on others
// needs a test that EXERCISES it, not only checks that construct it. This gate
// is a reporter, and until now it had no behavioural test of any kind - which
// is the whole reason its suite could disagree with release.yml for four checks
// across several releases while every release run went green.

function selftest() {
  const failed = [];
  let ran = 0;
  const ok = (name, cond, detail = '') => {
    ran += 1;
    if (cond) { console.log(`  ok    ${name}`); return; }
    failed.push(`${name}${detail ? `\n        ${detail}` : ''}`);
    console.log(`  FAIL  ${name}`);
  };

  const FIXTURE = [
    'jobs:',
    '  build:',
    '    steps:',
    '      - uses: actions/checkout@v7.0.1',
    '      - name: Excluded on purpose',
    '        run: node scripts/ci/never-run-me.mjs',
    '      - name: Two checks',
    '        run: |',
    '          node scripts/ci/check-alpha.mjs',
    '          node scripts/ci/check-beta.mjs --strict',
    '      - name: Inline form',
    '        run: node scripts/ci/check-gamma.mjs',
    '',
  ].join('\n');

  const flat = (s) => s.suite.map((c) => c.join(' '));

  // 1. block form, inline form and arguments all survive the derivation.
  const base = deriveReleaseSuite(FIXTURE);
  ok('derives block-form, inline-form and argument-carrying commands',
    JSON.stringify(flat(base)) === JSON.stringify([
      'scripts/ci/never-run-me.mjs',
      'scripts/ci/check-alpha.mjs',
      'scripts/ci/check-beta.mjs --strict',
      'scripts/ci/check-gamma.mjs',
    ]),
    `got ${JSON.stringify(flat(base))}`);

  // 2. THE ASSERTION THIS FILE EXISTS FOR. A check added to the workflow is in
  //    the suite with no second edit. Against the hardcoded array this is the
  //    case that could not pass, because nothing read the workflow at all.
  const grown = deriveReleaseSuite(FIXTURE.replace(
    '          node scripts/ci/check-beta.mjs --strict',
    '          node scripts/ci/check-beta.mjs --strict\n          node scripts/ci/check-added-later.mjs'));
  ok('a check added to release.yml appears here with no second edit',
    flat(grown).includes('scripts/ci/check-added-later.mjs'));

  // 3. the closure property, against the REAL workflow: every `node X.mjs` line
  //    in release.yml is either run by this gate or inside a declared-excluded
  //    step. This is the one that fails if the two ever diverge again.
  const realYml = fs.readFileSync(RELEASE_YML, 'utf8');
  const real = deriveReleaseSuite(realYml);
  const runs = flat(real);
  const excludedCommands = real.steps
    .filter((s) => EXCLUDED_STEPS.has(s.name))
    .flatMap((s) => s.commands);
  const orphans = [...realYml.matchAll(/^\s*(node\s+\S+\.mjs[^\n]*)$/gm)]
    .map((m) => m[1].trim())
    .filter((c) => !runs.includes(c.replace(/^node\s+/, '')) && !excludedCommands.includes(c));
  ok('every node command in release.yml is run here or declared excluded',
    orphans.length === 0,
    orphans.length ? `unaccounted for: ${orphans.join(' | ')}` : '');

  // 3b. and the same closure over NON-node commands, against the real file.
  //     Assertion 3 only sees `node X.mjs` lines, so a workflow that grew a
  //     `./deploy.sh` step would sail past it. Without this, adding a shell step
  //     to release.yml changes nothing here - which is the exact blind spot
  //     this whole release is about, reproduced one level down.
  ok('release.yml has no command this gate neither runs nor declares',
    real.undeclared.length === 0,
    real.undeclared.length
      ? real.undeclared.map((u) => `[${u.step}] ${u.command}`).join(' | ') : '');

  // 4. an undeclared non-node step is a failure, not a silent skip. This is the
  //    half that makes drift impossible rather than merely unlikely.
  const withShell = deriveReleaseSuite(FIXTURE.replace(
    '      - name: Inline form\n        run: node scripts/ci/check-gamma.mjs',
    '      - name: Some new shell step\n        run: |\n          ./deploy.sh --now'));
  ok('an undeclared non-node step is reported, naming the step',
    withShell.undeclared.some((u) => u.step === 'Some new shell step' && u.command === './deploy.sh --now'));

  // 5. a declared exclusion whose step no longer exists is a failure. Without
  //    this, a renamed step leaves an exemption behind that excuses its
  //    successor - the stale-value shape this system has now hit repeatedly.
  ok('a declared exclusion with no matching step is reported as stale',
    deriveReleaseSuite(FIXTURE).stale.length === EXCLUDED_STEPS.size);

  // 6. and the real workflow has no stale exclusions right now.
  ok('every declared exclusion still names a step release.yml has',
    real.stale.length === 0,
    real.stale.length ? `stale: ${real.stale.join(' | ')}` : '');

  // 7. the floor. A recogniser that matched nothing must fail, not pass empty.
  ok(`the real workflow derives at least ${MIN_DERIVED} checks`,
    real.suite.length >= MIN_DERIVED, `derived ${real.suite.length}`);

  // 8. every derived path exists. A suite naming a deleted script would
  //    otherwise fail late, inside the runner, as a confusing ENOENT.
  const ghosts = real.suite.filter(([s]) => !fs.existsSync(path.join(ROOT, s)));
  ok('every derived script exists on disk',
    ghosts.length === 0, ghosts.length ? `missing: ${ghosts.map((g) => g[0]).join(' | ')}` : '');

  /* --- the second pair of lists (v0.1.18) ------------------------------
   *
   * BROKEN BUILD THESE MUST CATCH: 0.1.18 as first recovered, where
   * check-corpus-score, check-corpus-isolation, check-corpus-blind and
   * check-read-scope were added to selftest.yml and to release.yml never.
   * Every assertion above passes against that build - the suite is derived
   * correctly, it is just derived from a file that does not mention them - so
   * this gate would have certified a release whose own new checks it never ran.
   */
  const realSelftest = fs.readFileSync(SELFTEST_YML, 'utf8');

  // 8b. the real pair. This is the one that fails if they diverge again.
  {
    const cov = selftestCoverage(realYml, realSelftest);
    ok('every check selftest.yml runs is also run by release.yml',
      cov.uncovered.length === 0,
      cov.uncovered.length ? `release.yml never runs: ${cov.uncovered.join(' | ')}` : '');
    // The floor. A recogniser matching nothing reports perfect coverage of
    // nothing, in the confident voice of an arm that ran.
    ok('selftest.yml yields a non-empty set of node checks',
      cov.scripts.length >= 8, `found ${cov.scripts.length}`);
  }

  // 8c. negative control: a selftest-only check is NAMED, not counted.
  //     "something is uncovered" is not a pointer - 0.1.13's rule.
  {
    const grown = realSelftest.replace(
      '      - name: Prove Claude Code is absent',
      '      - name: A check release.yml has never heard of\n'
      + '        run: node scripts/ci/check-only-here.mjs\n\n'
      + '      - name: Prove Claude Code is absent');
    const cov = selftestCoverage(realYml, grown);
    ok('a selftest-only check is reported by name',
      cov.uncovered.includes('scripts/ci/check-only-here.mjs'),
      `uncovered: ${cov.uncovered.join(' | ') || '(none)'}`);
  }

  // 8d. negative control: a declared exclusion whose step is gone is stale,
  //     for the same reason EXCLUDED_STEPS carries that arm.
  {
    SELFTEST_ONLY.set('scripts/ci/check-never-existed.mjs', 'negative control');
    try {
      const cov = selftestCoverage(realYml, realSelftest);
      ok('a declared selftest-only exclusion with no matching step is stale',
        cov.stale.includes('scripts/ci/check-never-existed.mjs'));
    } finally {
      SELFTEST_ONLY.delete('scripts/ci/check-never-existed.mjs');
    }
  }

  /* --- the identity arm (v0.1.17) --------------------------------------
   *
   * BROKEN BUILD THESE MUST CATCH: every version through 0.1.16, where an
   * unreachable origin was reported as "could not reach origin to check whether
   * the tag already exists ... Check the network and re-run" - a confident wrong
   * explanation for a wrong `gh` account, at the one moment nobody was looking.
   *
   * Asserted on the DECISION, which is a pure function of two inputs, and then
   * on the wiring end to end - because a correct decision function that nothing
   * calls is the shape this repository has now found eleven times.
   */
  const OTHER = 'globalmvpllc-oss';           // the account that was actually active
  const REF = 'abc1234\trefs/heads/main';     // what a reachable origin answers
  const mine = { active: OWNER, logins: [OWNER, OTHER] };
  const theirs = { active: OTHER, logins: [OWNER, OTHER] };

  // 9. the healthy case.
  {
    const v = identityVerdict({ origin: REF, accounts: mine });
    ok('origin answering with the owner active reads as ok',
      v.status === 'ok' && v.text.includes(OWNER), `got ${v.status}: ${v.text}`);
  }

  // 10. THE FALSE-POSITIVE GUARD, and the reason this is not doctor's check
  //     moved. git's credential helper need not be gh, so once origin has
  //     ANSWERED, a login mismatch is not evidence of anything. A release gate
  //     is the most expensive place in this system to refuse wrongly.
  {
    const v = identityVerdict({ origin: REF, accounts: theirs });
    ok('a login mismatch does NOT fail the gate once origin has answered',
      v.status === 'note' && v.text.includes(OTHER),
      `got ${v.status}. A fail here refuses releases on every machine whose git credential `
      + 'helper is not gh - and a guard that fires wrongly is a guard that gets turned off.');
  }

  // 11. the observed case: origin silent, wrong account active.
  const blind = identityVerdict({ origin: null, accounts: theirs });
  ok('an unreachable origin with the wrong account FAILS and names the account',
    blind.status === 'fail' && blind.text.includes(OTHER) && blind.text.includes(OWNER)
      && blind.text.includes(`gh auth switch --user ${OWNER}`),
    `got ${blind.status}: ${blind.text.split('\n')[0]}`);

  ok('...and explains that "Repository not found" is a permission error, not a deletion',
    /Repository not found/.test(blind.text),
    'without that sentence the operator reads the 404 and concludes the repo is gone, which '
    + 'is what nearly happened on 2026-09-01.');

  ok('...and does not offer the network as the explanation, which is what it used to say',
    !/network/i.test(blind.text), blind.text);

  // 12. origin silent, but the account IS the owner. Do not accuse it. The
  //     defect being fixed is a message that explained one cause confidently
  //     and wrongly; inverting which cause it names is not a fix.
  {
    const v = identityVerdict({ origin: null, accounts: mine });
    ok('an unreachable origin with the RIGHT account names both causes and accuses neither',
      v.status === 'fail' && /network/i.test(v.text) && /credential helper/.test(v.text)
        && !v.text.includes('gh auth switch'),
      `got ${v.status}: ${v.text.split('\n')[0]}`);
  }

  // 13. gh unreadable. Invariant 5: could-not-check is never a pass - and here
  //     it is not even a note, because origin is silent and the gate is blind.
  {
    const v = identityVerdict({ origin: null, accounts: null });
    ok('an unreachable origin with an unreadable gh fails and says the account is unknown',
      v.status === 'fail' && /gh auth status/.test(v.text),
      `got ${v.status}: ${v.text.split('\n')[0]}`);
  }

  // 14. THE WORDING IS DOCTOR'S, NOT A COPY OF IT. Re-type the remedy here and
  //     the two gates start telling the operator different things about the
  //     same machine, which is this system's oldest defect shape.
  ok('the failure renders the doctor finding rather than a second copy of it',
    blind.text.includes(reflow(ghAccountFinding(theirs, OWNER).text)),
    'the text no longer contains the rendered doctor finding, so the two can now disagree.');

  // 15. WIRING, END TO END, and the assertion is that the gate STOPPED - not
  //     merely that it failed. github.com is rewritten to a closed port, so
  //     ls-remote fails offline and instantly; MAVCI_PRETAG_NO_SUITE marks the
  //     line this run must never reach.
  {
    const cfgdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-pretag-'));
    const cfg = path.join(cfgdir, 'gitconfig');
    fs.writeFileSync(cfg, '[url "http://127.0.0.1:1/"]\n\tinsteadOf = https://github.com/\n');
    const authorised = `v${JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).version}`;
    let out = '';
    let status = 0;
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/ci/check-pretag.mjs'), authorised], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: cfg,
          GIT_TERMINAL_PROMPT: '0',
          MAVCI_PRETAG_NO_SUITE: '1',
        },
      });
    } catch (err) {
      status = err.status ?? -1;
      out = String(err.stderr ?? '') + String(err.stdout ?? '');
    }
    fs.rmSync(cfgdir, { recursive: true, force: true });

    ok('the gate itself refuses when origin cannot be read, and stops before the suite',
      status === 2 && /could not read origin/.test(out) && /SKIPPED/.test(out)
        && !/MAVCI_PRETAG_NO_SUITE=1/.test(out),
      `exit ${status}. ${/MAVCI_PRETAG_NO_SUITE=1/.test(out)
        ? 'The run reached the release suite, so the identity arm did not stop it: the decision '
          + 'function is correct and main() carries on regardless of it.'
        : out.split('\n').slice(0, 6).join(' | ')}`);
  }

  if (failed.length) {
    console.error(`\ncheck-pretag --selftest FAILED (${failed.length}):\n`);
    for (const f of failed) console.error('  - ' + f + '\n');
    process.exit(2);
  }
  // Counted, not written down. A hardcoded total is a second list of the same
  // thing, which is the defect this whole file was rewritten for in v0.1.14.
  console.log(`\ncheck-pretag --selftest: ${ran} assertions pass; the suite is derived from `
    + `release.yml, ${EXCLUDED_STEPS.size} exclusions are declared, and the gate refuses a `
    + 'release it cannot authenticate.');
}

/* --- the gate ----------------------------------------------------------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { selftest(); return; }

  const cut = argv.includes('--cut');
  const wanted = argv.find((a) => !a.startsWith('--')) ?? null;

  const failures = [];
  const notes = [];

  /** The one refusal path. `skipped` names what this run did NOT get to. */
  const refuse = (skipped = '') => {
    console.error(`\npre-tag check FAILED for ${wanted}:\n`);
    for (const f of failures) console.error('  - ' + f + '\n');
    if (skipped) console.error(skipped + '\n');
    console.error('No tag was created. Fix the above and re-run.');
    process.exit(2);
  };

  const git = (args, { allowFail = false } = {}) => {
    try {
      return execFileSync('git', args, {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
      }).trim();
    } catch (err) {
      if (allowFail) return null;
      throw new Error(`git ${args.join(' ')} failed: ${String(err.stderr ?? err.message).trim()}`);
    }
  };

  /* --- 1. the manifest version, which is the authority ------------------- */

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(String(version ?? ''))) {
    console.error(`check-pretag: plugin.json version is not a release version: ${JSON.stringify(version)}`);
    process.exit(2);
  }
  const authorised = `v${version}`;

  if (!wanted) {
    console.log(`plugin.json version is ${version}, so the only tag this tree authorises is ${authorised}.`);
    console.log(`  node scripts/ci/check-pretag.mjs ${authorised} --cut`);
    process.exit(0);
  }

  /* --- 2. tag must equal the manifest ------------------------------------ */
  // The defect this file exists for. Stated first and stated plainly.

  if (wanted !== authorised) {
    failures.push(`the tag and plugin.json DISAGREE.\n`
      + `      you asked to cut:  ${wanted}\n`
      + `      plugin.json says:  ${version}  (so: ${authorised})\n`
      + `    Every project's CI clones the system at tag v<state.json.plugin_version>, so a\n`
      + `    mismatch ships one tree under another tree's name. Fix ONE of the two, not both:\n`
      + `    bump plugin.json to ${wanted.replace(/^v/, '')}, or cut ${authorised} instead.`);
  }

  /* --- 3. the tag must not already exist, on this machine ---------------- */
  // Moving a tag a machine has already fetched is worse than the mistake it fixes:
  // the clone keeps the object it holds, so one tag name means two different
  // commits on two machines. check-tags.mjs records that reasoning for v0.1.3/4.

  const localTag = git(['tag', '--list', wanted]);
  if (localTag) failures.push(`${wanted} already exists locally. A released tag is immutable - bump the version instead of re-cutting.`);

  /* --- 4. the tree being tagged must be the tree that was tested --------- */
  // Offline, and deliberately BEFORE anything touches the network: a machine
  // that cannot reach origin should still be told its tree is dirty.

  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    failures.push(`the working tree is dirty, so the tag would not name the tree you validated:\n`
      + dirty.split('\n').map((l) => `      ${l}`).join('\n'));
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') {
    failures.push(`HEAD is on "${branch}", not main. Every project clones the release tag; it must be the mainline.`);
  }

  /* --- 5. the identity that is about to push ----------------------------- */
  // v0.1.17, and the header says why this is the moment rather than doctor's.
  // ONE ls-remote, read twice: it is the live authorisation probe here, and the
  // origin/main comparison in section 6. Two calls would be two answers to one
  // question, which is how a gate comes to explain itself two different ways.

  const remoteMain = git(['ls-remote', 'origin', 'refs/heads/main'], { allowFail: true });
  const identity = identityVerdict({ origin: remoteMain, accounts: readGhAccounts() });
  if (identity.status === 'note') notes.push(identity.text);
  if (identity.status === 'fail') {
    failures.push(identity.text);
    // Stop HERE. Everything below compares this tree against a remote that did
    // not answer, and each arm would offer its own confident wrong explanation
    // for the one cause already named above - which is the defect this section
    // exists to remove, not to reproduce three lines further down.
    refuse('  The remaining checks compare this tree against origin, and then run the release suite.\n'
      + '  Both were SKIPPED: neither can mean anything while the remote cannot be read.');
  }

  /* --- 6. and the tag must not already exist ON ORIGIN ------------------- */

  const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${wanted}`], { allowFail: true });
  if (remoteTag === null) {
    failures.push('origin answered for refs/heads/main and then failed on refs/tags.\n'
      + '    Refusing rather than cutting blind: a tag that already exists on the remote is the one\n'
      + '    case where proceeding is unrecoverable, and this gate no longer knows whether it does.');
  } else if (remoteTag !== '') {
    failures.push(`${wanted} already exists ON ORIGIN. It may have been fetched already; do not move it. Bump the version.`);
  }

  const head = git(['rev-parse', 'HEAD']);
  const remoteSha = remoteMain.split(/\s+/)[0] ?? '';
  if (!remoteSha) {
    failures.push('origin answered, but has no refs/heads/main to compare HEAD against.\n'
      + '    Every project clones the release tag off the mainline; there is no mainline here.');
  } else if (remoteSha !== head) {
    failures.push(`HEAD (${head.slice(0, 7)}) is not origin/main (${remoteSha.slice(0, 7)}).\n`
      + '    Push the commit BEFORE tagging it. A tag pointing at an unpushed commit resolves\n'
      + '    for nobody, and a tag pointing at a commit origin has moved past is not the mainline.');
  }

  /* --- 7. everything release.yml would run, run now ---------------------- */

  // A run FORBIDDEN to execute the suite can certify nothing, so it refuses at
  // the point it would have run it. --selftest's wiring probe sets this: without
  // it, a build whose identity arm failed to stop the run would reach the suite,
  // which runs `check-pretag.mjs --selftest`, which spawns the gate again - the
  // negative control would be a fork bomb rather than a failed assertion. There
  // is no value of this variable that lets a tag be cut; it can only ADD a
  // refusal, and reaching it at all is the thing the probe asserts must not
  // happen.
  if (process.env.MAVCI_PRETAG_NO_SUITE === '1') {
    failures.push('MAVCI_PRETAG_NO_SUITE=1, and this run reached the release suite it is forbidden to\n'
      + '    run, so it can certify nothing. If you did not set that variable, something in this\n'
      + '    environment did, and no tag should be cut from it.');
    refuse();
  }


  // Not a substitute for CI - it is the same suite, DERIVED from the same file,
  // moved to before the irreversible step. CI still runs it after, and `--cut`
  // deliberately does not push.

  let derived;
  let coverage;
  try {
    const releaseYml = fs.readFileSync(RELEASE_YML, 'utf8');
    derived = deriveReleaseSuite(releaseYml);
    coverage = selftestCoverage(releaseYml, fs.readFileSync(SELFTEST_YML, 'utf8'));
  } catch (err) {
    console.error(`check-pretag: could not read a workflow it derives from: ${err.message}`);
    console.error('The suite is derived from those files, so an unreadable workflow is a refusal, not an empty suite.');
    process.exit(2);
  }

  if (derived.undeclared.length) {
    failures.push('release.yml runs commands this gate neither runs nor declares:\n'
      + derived.undeclared.map((u) => `      [${u.step}]  ${u.command}`).join('\n')
      + '\n    Either it is a node <script>.mjs check (and is then run here automatically), or it\n'
      + '    belongs in EXCLUDED_STEPS with the reason. An exclusion implied by absence is\n'
      + '    indistinguishable from an omission - that is the defect this arm exists to stop.');
  }

  if (coverage.uncovered.length) {
    failures.push('selftest.yml runs checks release.yml does not, so this gate never runs them:\n'
      + coverage.uncovered.map((c) => `      ${c}`).join('\n')
      + '\n    This suite is derived from release.yml ALONE, so a check absent there is a check no\n'
      + '    release gate has ever executed - and it looks covered, because CI is green on push.\n'
      + '    Add it to release.yml, or declare it in SELFTEST_ONLY with the reason.');
  }

  if (coverage.stale.length) {
    failures.push('SELFTEST_ONLY names checks selftest.yml no longer runs:\n'
      + coverage.stale.map((c) => `      ${c}`).join('\n')
      + '\n    A stale exemption outlives the check it excused and silently excuses its replacement.');
  }

  if (derived.stale.length) {
    failures.push('EXCLUDED_STEPS names steps release.yml no longer has:\n'
      + derived.stale.map((s) => `      ${s}`).join('\n')
      + '\n    A stale exemption outlives the step it excused and silently excuses its replacement.');
  }

  if (derived.suite.length < MIN_DERIVED) {
    failures.push(`only ${derived.suite.length} checks were derived from release.yml, below the floor of ${MIN_DERIVED}.\n`
      + '    Refusing rather than reporting a pass over an empty suite: a recogniser that matches\n'
      + '    nothing looks exactly like a workflow with nothing to run.');
  }

  for (const [script, ...args] of derived.suite) {
    try {
      execFileSync(process.execPath, [path.join(ROOT, script), ...args],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
    } catch (err) {
      const tail = String(err.stdout ?? '').trim().split('\n').slice(-4).join('\n');
      failures.push(`${path.basename(script)} FAILED (exit ${err.status}):\n`
        + (tail ? tail.split('\n').map((l) => `      ${l}`).join('\n') : '      (no output)'));
    }
  }

  /* --- verdict ----------------------------------------------------------- */

  if (failures.length) refuse();

  for (const n of notes) console.log(`  note  ${n}`);
  console.log(`pre-tag: ${wanted} agrees with plugin.json, tag is unused, tree is clean and equals `
    + `origin/main, the credential that will push can read ${SYSTEM_REPO}, and `
    + `${derived.suite.length} checks derived from release.yml pass.`);
  // Said on every pass, because a gate that does not name what it did NOT check
  // is asserting more than it verified.
  console.log(`  not covered here, by declaration: ${[...EXCLUDED_STEPS.keys()].join('; ')}`);

  if (!cut) {
    console.log(`\nNothing was created. To cut it:\n  node scripts/ci/check-pretag.mjs ${wanted} --cut`);
    process.exit(0);
  }

  // Annotated, because check-tags.mjs requires it from v0.1.7 forward and a
  // lightweight tag silently breaks every `^{commit}` comparison downstream.
  git(['tag', '-a', wanted, '-m', `${wanted} - see docs/ROADMAP.md and docs/NATIVE-CAPABILITIES.md`]);

  // Now that the tag exists, its own post-condition is checkable: annotated form,
  // and the newest tag IS the mainline. If it does not hold, roll the tag back -
  // it is local-only until pushed, so this is the last moment it is free to undo.
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/ci/check-tags.mjs')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  } catch (err) {
    git(['tag', '-d', wanted], { allowFail: true });
    console.error(`\ncheck-tags.mjs rejected ${wanted} after it was created, so the tag was DELETED:\n`);
    console.error(String(err.stdout ?? '').trim());
    console.error('\nNothing was pushed. The repository is as it was.');
    process.exit(2);
  }

  console.log(`\ncreated annotated tag ${wanted} at ${head.slice(0, 7)} (local only), and check-tags.mjs accepts it.`);
  console.log(`Push it, then WATCH THE RELEASE JOB - it is the last gate and nothing downstream reads it:`);
  console.log(`  git push origin ${wanted}`);
  console.log(`  gh run watch "$(gh run list --workflow release.yml --branch ${wanted} --limit 1 --json databaseId --jq '.[0].databaseId')"`);
}

// Basename, not endsWith. v0.1.13's finding: `scripts/ci/check-retro.mjs` ends
// with `retro.mjs`, so a suffix test ran retro's CLI when its own self-test
// imported it. This file previously had no guard at all and executed the entire
// gate on import, which is the same defect one step worse - it is why this
// script had no behavioural test until now.
if (process.argv[1] && path.basename(process.argv[1]) === 'check-pretag.mjs') main();

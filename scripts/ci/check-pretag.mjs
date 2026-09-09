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
 *   node scripts/ci/check-pretag.mjs v0.1.9 --cut    check, tag, push, verify, watch CI
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
 * READ, NOT WRITE. `ls-remote` proves the credential can READ the repository;
 * it proves nothing about pushing, and a read-only token (`MAVCI_TOKEN` is
 * exactly that shape) passes this probe and fails at the push. That gap is
 * still open and is now closed one step later rather than left to the operator:
 * `--cut` pushes, and a credential that cannot write fails inside the gate,
 * which deletes the tag it created. See section v0.1.29 below - the paragraph
 * that used to stand here argued the failure was loud and free to undo BECAUSE
 * the operator pushed by hand. It was right about the property and wrong about
 * who should hold it.
 *
 * ---------------------------------------------------------------------------
 * v0.1.29: THE PUSH IS INSIDE THE GATE, AND THE TAG IS READ BACK OFF ORIGIN.
 *
 * Through v0.1.28 `--cut` created the tag, printed `git push origin <tag>` as
 * advice, and exited. Two things then failed silently, on the same day, and
 * neither was visible from the other's output:
 *
 *   - `--cut` run inside `~/.claude/plugins/marketplaces/mavci` cut the tag in
 *     generated state. Every arm of this gate passes there - it is a real
 *     checkout of this repository, same remote, same branch - and propagation
 *     resets the directory.
 *   - the push reported "Everything up-to-date" and sent nothing, which is
 *     indistinguishable from a push that worked.
 *
 * Section 2 of this header already settled where such a check belongs: a check
 * nobody is required to run is the same failure one layer up, which is why
 * `--cut` creates the tag rather than advising a tag. The post-push assertion
 * is that argument applied once more. `--cut` cannot make it after it exits, so
 * `--cut` does not exit before the push: it pushes by EXPLICIT REFSPEC, then
 * reads the tag back off origin and compares the peeled commit against the one
 * it tagged. A second command the operator has to remember is advice with a
 * different shape.
 *
 * WHAT IT ASSERTS, AND WHERE IT STOPS. Three facts had to be checked by hand
 * after every release: the tag reached origin, the release run started, and the
 * release run passed. `--cut` takes all three - it reads the tag back off
 * origin, then polls the release run to a bound.
 *
 * THE BOUND HAS A STATED BEHAVIOUR, which is the part with no obvious right
 * answer. Ten minutes total, two of them for the run to appear at all, polled
 * every fifteen seconds. Still running when that is spent is UNKNOWN: not a
 * pass, because invariant 5 says a failed probe is never reported as one, and
 * not a failure, because the tag IS released and calling it a failure invites
 * the one repair that must never happen. So there are three exit statuses and
 * they are three different answers:
 *
 *   0   the tag is on origin and its release run passed
 *   2   a refusal - and up to and including the push, nothing was released
 *   3   the tag is on origin and the verdict could not be read. Finish the
 *       watch by hand; the tag stands.
 *
 * ATOMICITY, AND WHY IT IS THE PROPERTY THAT MATTERS. Every arm up to and
 * including the push leaves either the tag on origin or NO TAG AT ALL - never a
 * local tag that origin does not have. A failed `--cut` is therefore retryable
 * by re-running the same command, and nobody has to work out which of three
 * places the tag is in before they can act. That is why the `absent` and
 * `unknown` arms delete the local tag rather than keeping it as evidence: a
 * state with one possibility in it beats a state with three, even when all
 * three are individually recoverable.
 *
 * From the watch onward the direction reverses and NOTHING is rolled back. The
 * tag is on origin, immutable, and possibly already fetched; un-pushing a
 * released tag is worse than an unresolved watch, and a machine that has
 * fetched a tag keeps the object it holds, so a moved tag means one name and
 * two commits. `watchRelease` is not even given a git runner, and every arm of
 * it that is not a pass says the tag stands.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Imported, not reimplemented. doctor owns the probe and the decision; this gate
// owns the moment. A second copy of either would be the shape this system has
// hit repeatedly - a value written down once, wrongly, and then propagated.
import { clonePath, configDir, ghAccountFinding, readGhAccounts } from '../../plugins/mavci-core/scripts/doctor.mjs';
import { SYSTEM_REPO } from '../../plugins/mavci-core/scripts/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json');
const RELEASE_YML = path.join(ROOT, '.github/workflows/release.yml');
const SELFTEST_YML = path.join(ROOT, '.github/workflows/selftest.yml');
const OWNER = SYSTEM_REPO.split('/')[0];

/** Canonical path, or the path itself when it does not exist yet. A clone held
 *  as a junction or a symlink is the case a lexical comparison misses. */
const realpath = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

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

// How much of a failing check's own report to reproduce. Was 4, which is smaller
// than the failure list of any check that finds more than a couple of things -
// so the gate routinely showed a fraction of the evidence and did not say so.
// Whatever is cut is now counted and announced.
const TAIL_LINES = 40;

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

/* --- the tree this gate must never cut a tag in (v0.1.29) ---------------- */
/**
 * `--cut` creates the tag in the tree it is RUNNING FROM, and that tree is not
 * always the one the operator is editing.
 *
 * `~/.claude/plugins/marketplaces/mavci` is a real git checkout of this
 * repository - same remote, same branch, same workflows, same manifest - so
 * every arm in this gate passes there. It is also generated state: propagation
 * is `git fetch origin` then `git checkout -B main origin/main`, which discards
 * whatever is in that directory with no prompt and no reflog entry for content
 * never committed (0.1.18, docs/lessons/0.1.18-the-clone-is-generated-state.md).
 *
 * The two halves of the failure do not meet. A tag cut in the clone is a tag in
 * a directory that gets reset; the operator then pushes from the repository they
 * ARE editing, where the tag does not exist, and `git push --follow-tags`
 * answers "Everything up-to-date". Neither output mentions the other, and the
 * first symptom is the worst signal this system has: a release that is green
 * everywhere and absent.
 *
 * retro.mjs got this refusal in v0.1.25 by the same argument - it had been
 * writing findings into the clone, reporting success, and the next propagation
 * erased them. This is that refusal placed at the one step that is irreversible.
 *
 * THE PREDICATE IS THE CLASS, NOT THE INSTANCE. Everything under
 * `<config>/plugins` is written by `/plugin` and replaced by it - the clone and
 * the plugin cache both live there - so the containment test is what refuses,
 * and the clone is matched by canonical path as well, because a development
 * machine can hold it as a junction or a symlink and a lexical test would miss
 * that entirely.
 *
 * Pure, and given its three paths rather than reading them, so the self-test can
 * assert the decision without relocating this file.
 */
export function generatedStateVerdict({ root, pluginsDir, clone }) {
  const canon = (p) => {
    const abs = path.resolve(p);
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  const within = (dir, p) => {
    const rel = path.relative(canon(dir), canon(p));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  const tail = '\n\n  Run this from the source checkout - the repository you edit, commit and push in.\n'
    + '  Nothing else can produce a release.';

  if (clone && canon(root) === canon(clone)) {
    return { text:
      'REFUSING: a release cut in generated state is not a release - this is the marketplace\n'
      + '  clone, and the tag you are about to create would be destroyed by the next propagation\n'
      + '  into it, unread by anybody.\n\n'
      + `  ${root}\n\n`
      + '  Propagation into that directory is `git fetch origin` then\n'
      + '  `git checkout -B main origin/main`, which discards whatever is there with no prompt and\n'
      + '  no reflog entry for content never committed. And `git push --follow-tags` from the\n'
      + '  repository you ARE editing would then answer "Everything up-to-date", because the tag is\n'
      + '  not in it - so neither half of that failure is visible from the other half\'s output.'
      + tail };
  }

  if (pluginsDir && within(pluginsDir, root)) {
    return { text:
      'REFUSING: a release cut in generated state is not a release - this tree is inside the\n'
      + '  plugin directory, which `/plugin` overwrites, so the tag you are about to create would\n'
      + '  be destroyed by the next propagation or install.\n\n'
      + `  ${root}\n`
      + `  is under ${pluginsDir}\n\n`
      + '  Everything there is written by `/plugin` and replaced by it: the marketplace clone is\n'
      + '  reset by `git checkout -B main origin/main`, and the cache is re-populated on install.'
      + tail };
  }

  return null;
}

/* --- the push, and the assertion after it (v0.1.29) ---------------------- */
/**
 * What a fully green `--cut` still does NOT establish, declared with the reason
 * rather than left silent - the same rule EXCLUDED_STEPS follows, and for the
 * same reason: an exclusion expressed by not appearing is indistinguishable
 * from an omission.
 *
 * This list SHRANK in v0.1.29 and the shape of what is left changed with it.
 * It used to hold "the release run started" and "the release run passed",
 * because the gate stopped at the push and those were checked by hand after
 * every release. They are watched now, to a bound. What remains is not another
 * thing the gate could check and chose not to - it is the two links that are
 * manual by design, and naming them here is the only place a passing release
 * says so.
 */
export const POST_PUSH_NOT_COVERED = new Map([
  ['PROPAGATION to any machine',
    'a pushed tag moves nothing by itself. The clone is moved by `git fetch origin` and\n'
    + '    `git checkout -B main origin/main`, and the install by `claude plugin uninstall` then\n'
    + '    `claude plugin install --scope user`, then a restart - one operator visit per machine\n'
    + '    per release. `/plugin marketplace update` and `claude plugin update` move neither.'],
  ['that the released plugin ANSWERS correctly',
    'release.yml runs this repository\'s own suite against the tagged tree, which is a\n'
    + '    different question from whether guardian\'s answers are right. That is the corpus,\n'
    + '    it is operator-run, and doctor FAILs every project until a result for it exists.'],
]);

export function postPushReport(tag) {
  return ['  A green release run is where this gate ends. It does NOT establish:',
    ...[...POST_PUSH_NOT_COVERED].map(([what, why]) => `    ${what} - ${why}`),
    `  Nothing further is owed for ${tag} itself.`,
  ].join('\n');
}

/**
 * The two refs a tag question is actually about, and the reason they are built
 * here rather than written out at the call site.
 *
 * THE LS-REMOTE PATTERN DEFECT, 2026-09-04, and it cost a false refusal on a
 * tag that was already released. It is named here by what it is rather than by
 * a finding number, because the number is assigned when the retro is filed and
 * a number written down before it is issued is this repository's oldest defect
 * shape - a value recorded once, wrongly, and then copied everywhere. `git ls-remote
 * --tags origin refs/tags/<tag>` does NOT return `refs/tags/<tag>^{}`: a
 * pattern is matched against the tail of a ref NAME, and the peeled ref's name
 * ends in `^{}`, so it is filtered out. Asking that way and then looking for
 * the peeled line is a query that can never answer yes - so EVERY annotated tag
 * reads as lightweight, which is what v0.1.29 was told about itself while
 * sitting correctly annotated on origin, minutes before its release run agreed
 * it was fine.
 *
 * The assertion was right about what to check and wrong about how to ask. That
 * is v0.1.17's shape - a login compared by name where the remote could have
 * been probed - and it is not fixed by widening the reader, because the reader
 * never saw the line. Both patterns come from here so that a tag question
 * cannot be posed a second way, and the self-test hands THIS function to real
 * git rather than re-typing what it believes git does.
 *
 * @param {string} tag
 * @returns {string[]} the unpeeled ref and the peeled one, in that order
 */
export const tagRefspecs = (tag) => [`refs/tags/${tag}`, `refs/tags/${tag}^{}`];

/**
 * Push the tag this gate just created, and then prove it arrived by reading it
 * back off the remote.
 *
 * THE PUSH IS INSIDE THE GATE, and v0.1.17's paragraph saying it deliberately
 * was not is rewritten above rather than left standing. The reason given there
 * - that a read-only credential should fail loudly with the tag still local and
 * deletable - is not an argument against pushing here; it is an argument for
 * exactly what the `push-failed` arm below does, which is better than the
 * operator's own push because the rollback is automatic instead of remembered.
 * The reason the push moved is that a post-push assertion `--cut` cannot make is
 * a second command someone has to remember, and this file's own header already
 * settled what those are worth: a check nobody is required to run is the same
 * failure one layer up. That is why `--cut` creates the tag; it is why `--cut`
 * now pushes it.
 *
 * EXPLICIT REFSPEC, ALWAYS. `git push` with no refspec, and `git push --tags`,
 * are both able to answer "Everything up-to-date" and send nothing - which is
 * the observation that reads as success and is the whole reason this exists.
 *
 * @param {{tag: string, head: string, git: (args: string[]) =>
 *          {ok: boolean, out: string, err: string}}} input
 * @returns {{status: 'ok'|'push-failed'|'unknown'|'absent'|'unpeeled'|'mismatch', text: string}}
 */
export function pushAndVerify({ tag, head, git }) {
  const push = git(['push', 'origin', `refs/tags/${tag}`]);
  if (!push.ok) {
    // The one arm that rolls back KNOWING: a single-ref push either happened or
    // it did not. The two arms below also delete, for the weaker reason that a
    // local tag origin may not have is the one state worth ruling out - but this
    // is the only one that can say the push definitely sent nothing.
    const rolled = git(['tag', '-d', tag]);
    return { status: 'push-failed',
      text: `the push FAILED, so ${tag} was ${rolled.ok ? 'DELETED locally' : 'left in place - `git tag -d ' + tag + '` failed too'} and nothing was released:\n`
        + `      ${(push.err || '(no output)').split('\n').join('\n      ')}\n`
        + '    A read-only credential fails exactly here. MAVCI_TOKEN is that shape by design and is\n'
        + '    not what a release is pushed with; check which identity git is using before re-running.' };
  }

  // BOTH refspecs, for the reason tagRefspecs carries: the peeled ref is a
  // separate ref NAME, and a pattern naming only the unpeeled one filters it
  // out - which made the `unpeeled` arm below unreachable-except-wrongly.
  const probe = git(['ls-remote', '--tags', 'origin', ...tagRefspecs(tag)]);
  if (!probe.ok) {
    // Invariant 5 at the last step. The push exited 0 and the remote could not
    // be read, and this gate will not choose between the two explanations - the
    // defect it exists to remove is a message that picked one confidently.
    //
    // The local tag still goes, for the reason the absent arm gives: it is the
    // one half this gate CAN make certain, and removing it collapses three
    // possible states into two - the tag is on origin, or it is nowhere. What
    // it must NOT do is say which, because it has not established that.
    const rolled = git(['tag', '-d', tag]);
    return { status: 'unknown',
      text: `${tag} was pushed without error and origin could not then be read, so whether it arrived\n`
        + '    is UNKNOWN - and could-not-check is not a pass:\n'
        + `      ${(probe.err || '(no output)').split('\n').join('\n      ')}\n`
        + (rolled.ok
          ? '    The local tag was deleted, so this is now either on origin or nowhere - never a\n'
            + '    third state. This gate has NOT established which, and does not guess.\n'
          : `    The local tag could not be deleted either; remove it by hand: git tag -d ${tag}\n`)
        + '    Settle it before re-running - if origin has it, the release happened:\n'
        + `      git ls-remote --tags origin ${tagRefspecs(tag).map((r) => `'${r}'`).join(' ')}` };
  }

  const lines = probe.out.split('\n').map((l) => l.trim()).filter(Boolean);
  const refs = lines.filter((l) => l.includes(`refs/tags/${tag}`));

  if (!refs.length) {
    // ATOMICITY, and it is the property that makes the whole step survivable.
    // The tag is not on origin, so the local one is deleted and no tag now
    // exists anywhere: the failure is retryable by re-running this command, and
    // nobody has to work out which of three places the tag is in before they
    // can act. A state with one possibility in it beats a state with three,
    // even when all three are individually recoverable.
    const rolled = git(['tag', '-d', tag]);
    return { status: 'absent',
      text: `${tag} pushed WITHOUT ERROR and origin does not have it.\n`
        + '    This is the observation this arm exists for: a push that reports success and sends\n'
        + '    nothing leaves a release that exists on one machine, while every project CI clones\n'
        + '    v<state.json.plugin_version> and gets a tag that resolves for nobody.\n'
        + (rolled.ok
          ? '    The local tag was DELETED, so no tag now exists anywhere and re-running this command\n'
            + '    is the whole recovery.'
          : `    The local tag could NOT be deleted, so nothing is on origin and one tag remains here.\n`
            + `    Remove it before re-running:  git tag -d ${tag}`) };
  }

  const peeled = refs.find((l) => l.endsWith(`refs/tags/${tag}^{}`));
  if (!peeled) {
    return { status: 'unpeeled',
      text: `${tag} reached origin as a LIGHTWEIGHT tag: the remote reports no ${tag}^{} to compare\n`
        + '    against the commit this gate tagged. check-tags.mjs has required annotated tags since\n'
        + '    v0.1.7, and a lightweight one silently breaks every ^{commit} comparison downstream.\n'
        + '    Nothing was deleted. Read the remote before doing anything else:\n'
        + `      git ls-remote --tags origin ${tagRefspecs(tag).map((r) => `'${r}'`).join(' ')}` };
  }

  const commit = peeled.split(/\s+/)[0];
  if (commit !== head) {
    return { status: 'mismatch',
      text: `${tag} is on origin at ${commit.slice(0, 7)}, not the commit this gate tagged `
        + `(${head.slice(0, 7)}).\n`
        + '    Origin did not have this tag when this run checked, minutes ago, so something else\n'
        + '    created it in between. One tag name now means two commits on two machines, which is\n'
        + '    the one state a released tag must never reach. Do NOT move it; resolve it by hand\n'
        + '    before anything fetches it.' };
  }

  return { status: 'ok',
    text: `${tag} is on origin at ${head.slice(0, 7)}, read back off the remote rather than inferred\n`
      + '  from the push exiting 0.' };
}

/* --- watching the release run (v0.1.29) ---------------------------------- */
/**
 * The bound, and it is a decision rather than a number.
 *
 * `appearMs` is how long to wait for a run to EXIST for the tag. GitHub creates
 * it asynchronously, so nothing has happened yet is the normal first answer.
 * `totalMs` is the whole budget. `release.yml` installs Claude Code and runs the
 * full suite, so a healthy run is minutes; ten is roughly double that, which is
 * the shape a bound should have - long enough that hitting it means something,
 * short enough that a release does not hang on a queue nobody is watching.
 *
 * Both are exported so the self-test asserts the loop against the same numbers
 * the gate uses, rather than against a copy that can drift from them.
 */
export const WATCH = { appearMs: 120_000, totalMs: 600_000, pollMs: 15_000 };

/** Dependency-free synchronous sleep. Node builtin, no npm, Node 22 safe. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Poll the release run for a tag that is already on origin, to a bound.
 *
 * THREE OUTCOMES, NOT TWO, and the third is the reason this is written out
 * rather than shelled to `gh run watch`. A watch can end without a verdict -
 * the run has not appeared, the run is still going, gh cannot be read - and
 * every one of those is UNKNOWN. Not a pass, because invariant 5 says a failed
 * probe is never reported as one. Not a failure, because the tag IS released
 * and calling it a failure would invite exactly the wrong repair.
 *
 * IT IS GIVEN NO `git`, DELIBERATELY. By the time this runs the tag is on
 * origin, immutable, and possibly fetched; the correct response to every
 * unknown here is to leave it there and finish the watch by hand. A function
 * that cannot reach git cannot be talked into un-pushing a released tag by some
 * later edit, and every non-passing arm says out loud that the tag stands.
 *
 * @param {{tag: string,
 *          gh: (args: string[]) => {ok: boolean, out: string, err: string},
 *          sleep?: (ms: number) => void, now?: () => number, cfg?: typeof WATCH}} input
 * @returns {{status: 'passed'|'failed'|'unfinished'|'no-run'|'unavailable',
 *            exit: 0|2|3, text: string}}
 */
export function watchRelease({ tag, gh, sleep = sleepSync, now = Date.now, cfg = WATCH }) {
  const minutes = Math.round(cfg.totalMs / 60_000);
  const seconds = Math.round(cfg.appearMs / 1000);
  const stands = `\n    The tag was NOT deleted and must not be: it is on origin, it is immutable, and`
    + '\n    un-pushing a released tag is worse than an unresolved watch.';
  const byHand = `\n    Finish it by hand:\n      gh run list --workflow release.yml --branch ${tag}`;

  const started = now();
  let seen = null;

  for (;;) {
    const r = gh(['run', 'list', '--workflow', 'release.yml', '--branch', tag,
      '--limit', '1', '--json', 'databaseId,status,conclusion,url']);

    if (!r.ok) {
      return { status: 'unavailable', exit: 3,
        text: `${tag} is on origin and its release run could NOT be read, so whether the release\n`
          + '    passed is UNKNOWN - and could-not-check is never a pass:\n'
          + `      ${(r.err || '(no output)').split('\n').join('\n      ')}\n`
          + '    gh is unavailable, unauthenticated, or offline.' + stands + byHand };
    }

    let rows;
    try { rows = JSON.parse(r.out || '[]'); } catch {
      return { status: 'unavailable', exit: 3,
        text: `${tag} is on origin and gh answered with something this gate cannot parse, so whether\n`
          + '    the release passed is UNKNOWN - and could-not-check is never a pass:\n'
          + `      ${String(r.out).slice(0, 200)}` + stands + byHand };
    }

    if (Array.isArray(rows) && rows.length) {
      seen = rows[0];
      if (seen.status === 'completed') {
        if (seen.conclusion === 'success') {
          return { status: 'passed', exit: 0,
            text: `${tag} is on origin and its release run PASSED.\n      ${seen.url ?? ''}` };
        }
        return { status: 'failed', exit: 2,
          text: `${tag} is on origin and its release run FAILED (${seen.conclusion}):\n`
            + `      ${seen.url ?? `run ${seen.databaseId}`}` + stands + '\n'
            + '    The fix is a NEW version - never a moved tag, because a machine that has already\n'
            + '    fetched this one keeps the object it holds and one tag name then means two commits.\n'
            + '    Read the run before doing anything else.' };
      }
    }

    const elapsed = now() - started;

    if (!seen && elapsed >= cfg.appearMs) {
      return { status: 'no-run', exit: 3,
        text: `${tag} is on origin and no release run appeared for it within ${seconds} seconds, so\n`
          + '    whether CI ran at all is UNKNOWN - which is not a pass.\n'
          + '    This is NOT evidence that the workflow did not trigger: GitHub creates the run\n'
          + '    asynchronously and a queue can exceed this bound. The gate waited and did not look\n'
          + '    long enough to say which it is.' + stands + byHand };
    }

    if (elapsed >= cfg.totalMs) {
      return { status: 'unfinished', exit: 3,
        text: `${tag} is on origin and its release run was STILL RUNNING after ${minutes} minutes, so\n`
          + '    whether the release passed is UNKNOWN. That is not a pass and not a failure.' + stands
          + `\n    Finish the watch by hand:\n      gh run watch ${seen?.databaseId ?? '<id>'}\n`
          + '    If it passes, the release is good and nothing further is owed. If it fails, the tag\n'
          + '    stands and the fix is a NEW version.' };
    }

    sleep(cfg.pollMs);
  }
}

/**
 * Everything `--cut` does once the gate has passed: create the annotated tag,
 * let check-tags.mjs judge it, push it, prove it arrived, and watch the release
 * run it triggers.
 *
 * EXTRACTED FROM main() DELIBERATELY. Through v0.1.28 this sequence lived
 * inline in the CLI, where no test could reach it - which is exactly where
 * v0.1.26 found finding 25 sitting for three releases. The order is the part
 * that matters and the part that was unasserted:
 *
 *   - the check-tags rollback has to fire BEFORE anything is pushed, because
 *     that is the last moment the tag is free to undo. A sequence that pushed
 *     first would have a correct-looking rollback that deletes a local copy of
 *     a tag origin already holds.
 *   - the watch has to fire AFTER the tag is confirmed on origin, and not at
 *     all when it is not. Watching for a run of a tag that is not there polls
 *     to its bound and reports UNKNOWN, burying the one thing that IS known.
 *
 * ATOMICITY. Every arm up to and including the push either leaves the tag on
 * origin or leaves no tag at all - never a local tag that origin does not have.
 * That is what makes a failed cut retryable by re-running the same command
 * instead of a thing somebody has to diagnose first. From the watch onward the
 * tag is on origin and immutable, so nothing is rolled back and every arm says
 * so; `watchRelease` is not even given a git runner.
 *
 * @param {{tag: string, head: string,
 *          git: (args: string[]) => {ok: boolean, out: string, err: string},
 *          checkTags: () => {ok: boolean, out: string},
 *          watch: () => {status: string, exit: number, text: string}}} input
 */
export function cutTag({ tag, head, git, checkTags, watch }) {
  // Annotated, because check-tags.mjs requires it from v0.1.7 forward and a
  // lightweight tag silently breaks every `^{commit}` comparison downstream.
  const made = git(['tag', '-a', tag, '-m',
    `${tag} - see docs/ROADMAP.md and docs/NATIVE-CAPABILITIES.md`]);
  if (!made.ok) {
    return { status: 'tag-failed', exit: 2,
      text: `git could not create ${tag}, so nothing was cut and nothing was pushed:\n`
        + `      ${(made.err || '(no output)').split('\n').join('\n      ')}` };
  }

  // Now that the tag exists, its own post-condition is checkable: annotated
  // form, and the newest tag IS the mainline. If it does not hold, roll it back
  // - it is local and unpushed, so this is the last moment it is free to undo.
  const judged = checkTags();
  if (!judged.ok) {
    git(['tag', '-d', tag]);
    return { status: 'check-tags-rejected', exit: 2,
      text: `check-tags.mjs rejected ${tag} after it was created, so the tag was DELETED:\n`
        + `      ${(judged.out || '(no output)').trim().split('\n').join('\n      ')}\n`
        + '    Nothing was pushed. The repository is as it was.' };
  }

  const landed = pushAndVerify({ tag, head, git });
  const cut = `created annotated tag ${tag} at ${head.slice(0, 7)}, and check-tags.mjs accepts it.\n\n`;
  if (landed.status !== 'ok') return { status: landed.status, exit: 2, text: cut + landed.text };

  const ran = watch();
  return { status: ran.status, exit: ran.exit,
    text: cut + landed.text + '\n\n' + ran.text
      + (ran.exit === 0 ? '\n\n' + postPushReport(tag) : '') };
}

/* --- the self-test ------------------------------------------------------ */
// v0.1.13 recorded the rule this obeys: a component that reports on others
// needs a test that EXERCISES it, not only checks that construct it. This gate
// is a reporter, and until v0.1.14 it had no behavioural test of any kind -
// which is the whole reason its suite could disagree with release.yml for four
// checks across several releases while every release run went green.
//
// ===========================================================================
// BEFORE YOU ADD AN ASSERTION HERE, READ THIS.
// ===========================================================================
//
// A GREEN MUTATION IS A FINDING ABOUT THE ASSERTION, ALWAYS. It is never
// evidence that the fix was unnecessary. Break the thing an assertion is
// supposed to catch, run this file, and watch it go red - and when it does not,
// the assertion is what you have just learned something about.
//
// This is not general advice; it is the only instrument that has ever caught
// the failure this file keeps producing, which is an assertion that is correct,
// adjacent to the defect, and unable to fail. Four scales of it are on record,
// each one further from the code and closer to the thing meant to catch it:
//
//   comment    ARCHITECTURE 6.4 still showed the `"command": ["node", ...]`
//              array form - the one that made v0.1.2 install with ZERO hooks -
//              as canonical, in the governing document. check-guardian.mjs's
//              Bash assertion read "fully natively contained" after guardian's
//              reads had become hook-enforced, so a green check made a false
//              claim.
//   fixture    v0.1.14's assertion 4 tested the undeclared-step arm against a
//              FIXTURE only, so adding a shell step to the real release.yml
//              changed nothing - the blind spot that release was about,
//              reproduced inside the test written to prevent it. That is why
//              assertion 3b exists and reads the real file.
//   lesson     v0.1.25: docs/lessons/0.1.18-the-clone-is-generated-state.md sat
//              IN the directory `retro --apply` was writing into, and did not
//              bind.
//   assertion  v0.1.26's E6 was written to catch a mutation whose whole point
//              was that the decision and the REASON are two facts. It matched
//              neither: adjacent wording, no match, green.
//
// v0.1.29 added a fifth, a PLACEMENT, and it is the one closest to home. The
// generated-state refusal was put first in main(), ahead of the --selftest
// dispatch, which is what a control placed early looks like. Mutating the
// predicate to fire on every tree (P12) made the gate refuse to run its own
// self-test - so assertion 16, which exists precisely to catch an over-firing
// predicate, was the first thing the defect took offline, and the mutation
// reported NO failures at all. Nothing static could have found that. The
// --selftest dispatch is above the refusal now, with the reason at the line.
//
// v0.1.35 added a sixth, an AXIS, and it is the only one where every case was
// already correct. `watermarkBanner` in route.mjs asks two questions at once -
// does the marker OPEN the line, and is it UNQUOTED - and every case written for
// it answered both the same way: a mention was mid-line AND quoted, a banner
// line-leading AND bare. So M4, which made a quote count as banner punctuation,
// reddened NOTHING. The form half was load-bearing in the code and asserted
// nowhere, and the suite was green for the whole time it was. W13 - a marker
// quoted at the head of a bullet - is where the two come apart, and M4 reddens
// it alone.
//   The five scales above are a case in the wrong place: something written to
// catch a defect, sitting where the defect could not reach it. This one is a
// case SET that is complete on every case it contains and silent on an axis none
// of them separates. Counting the cases does not find it. Reading them does not
// find it, because each one is right. Breaking one half at a time is the only
// instrument that can, and that is the whole reason the rule at the top of this
// block is stated as ALWAYS.
//
// check-ci-gates.mjs proves every assertion in here CAN fail. It says outright
// that it cannot prove any of them DISCRIMINATES. That gap is closed by hand,
// per assertion, by mutation, or it is not closed.

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

  /* --- generated state (v0.1.29) ---------------------------------------
   *
   * BROKEN BUILD THESE MUST CATCH: every version through 0.1.28, in which
   * `--cut` run inside ~/.claude/plugins/marketplaces/mavci passes every arm
   * above - same remote, same branch, same workflows - and creates the release
   * tag in a directory whose whole contract is that propagation overwrites it.
   */
  const CLONE = path.join('/home/u/.claude', 'plugins', 'marketplaces', 'mavci');
  const PLUGINS = path.join('/home/u/.claude', 'plugins');

  // 16. an ordinary checkout is not generated state, and a refusal that fired
  //     on one would refuse every release on every machine.
  ok('a source checkout is NOT reported as generated state',
    generatedStateVerdict({ root: '/src/mavci', pluginsDir: PLUGINS, clone: CLONE }) === null);

  // 17. the observed case: the tree IS the marketplace clone.
  {
    const v = generatedStateVerdict({ root: CLONE, pluginsDir: PLUGINS, clone: CLONE });
    // The FIRST LINE has to name what is refused and why, in one sentence.
    // Mutation P21 replaced it with "REFUSING: generated state." and every
    // assertion here stayed green, because they all read the body: the path was
    // still printed and the propagation command was still quoted three lines
    // down. Somebody who hits this needs to understand that the tag they are
    // about to create would be destroyed - not that a path check failed.
    ok('the marketplace clone is refused, naming the path and what resets it',
      v !== null && v.text.includes(CLONE) && /checkout -B main origin\/main/.test(v.text),
      v ? v.text : 'no refusal');

    ok('...and the refusal SENTENCE says what it refuses and why, before any path',
      v !== null
        && /^REFUSING: a release cut in generated state is not a release/.test(v.text)
        && /destroyed by the next propagation/.test(v.text.split(`  ${CLONE}`)[0]),
      v ? v.text.split('\n').slice(0, 3).join(' ') : 'no refusal');
  }

  // 18. THE CLASS, not the instance. The plugin cache is generated state by
  //     the same argument and is not the clone.
  {
    const cache = path.join(PLUGINS, 'cache', 'mavci-core');
    const v = generatedStateVerdict({ root: cache, pluginsDir: PLUGINS, clone: CLONE });
    ok('anything under <config>/plugins is refused, not only the clone',
      v !== null && v.text.includes(cache), v ? v.text : 'no refusal');
  }

  // 19. WIRING, END TO END. A junction at <tmp>/plugins/marketplaces/mavci
  //     pointing at this repository makes the canonical clone path equal the
  //     canonical root, which is the shape a development machine produces when
  //     the clone is a link. The assertion is that the gate STOPPED: it must
  //     not reach the identity probe, and MAVCI_PRETAG_NO_SUITE marks the line
  //     it must never reach.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-generated-'));
    const link = path.join(tmp, 'plugins', 'marketplaces');
    fs.mkdirSync(link, { recursive: true });
    let linked = true;
    try {
      fs.symlinkSync(ROOT, path.join(link, 'mavci'), 'junction');
    } catch { linked = false; }

    if (!linked) {
      ok('the gate refuses to cut a tag in generated state', false,
        'could not create a junction, so the wiring could not be exercised - and an unexercised '
        + 'probe is not a pass (invariant 5).');
    } else {
      const authorised = `v${JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).version}`;
      let out = '';
      let status = 0;
      try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/ci/check-pretag.mjs'), authorised], {
          cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
          env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, MAVCI_PRETAG_NO_SUITE: '1' },
        });
      } catch (err) {
        status = err.status ?? -1;
        out = String(err.stderr ?? '') + String(err.stdout ?? '');
      }
      ok('the gate refuses to cut a tag in generated state, before anything else runs',
        status === 2 && /generated state/i.test(out) && !/MAVCI_PRETAG_NO_SUITE=1/.test(out)
          && !/pre-tag check FAILED/.test(out) && !/already exists locally/.test(out),
        `exit ${status}. ${out.split('\n').slice(0, 6).join(' | ') || '(no output)'}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* --- the push, and the assertion after it (v0.1.29) -------------------
   *
   * BROKEN BUILD THESE MUST CATCH: every version through 0.1.28, where --cut
   * created the tag, printed `git push origin <tag>` as advice, and exited. The
   * push was the operator's, and nothing anywhere read origin back. A push that
   * sends nothing reports "Everything up-to-date", which is indistinguishable
   * from a push that worked.
   */
  const gitLog = (script) => {
    const calls = [];
    return {
      calls,
      git: (args) => { calls.push(args.join(' ')); return script(args) ?? { ok: true, out: '', err: '' }; },
    };
  };
  const HEAD = '1234567890abcdef1234567890abcdef12345678';
  const TAGOBJ = 'fedcba0987654321fedcba0987654321fedcba09';
  const TAG = 'v9.9.9';

  // THE FAKE FILTERS THE WAY GIT DOES, and that is most of the fix. Through
  // v0.1.29 this returned the peeled line to ANY ls-remote, so it answered the
  // question the caller WISHED it had asked and could not tell a right query
  // from a wrong one. Real git filters `refs/tags/<tag>^{}` out of a query
  // patterned `refs/tags/<tag>`, so a correctly annotated tag read as
  // lightweight. That is the callee asserted and the INSTRUMENT assumed - one
  // layer down from 0.1.24's caller-never-asserted - and it is why 20b below
  // puts the same question to real git rather than to this model of it.
  const refMatch = (pattern, ref) => new RegExp('(^|/)'
    + pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    + '$').test(ref);
  const lsRemote = (refs) => (args) => {
    if (args[0] !== 'ls-remote') return { ok: true, out: '', err: '' };
    const patterns = args.slice(1).filter((a) => a[0] !== '-' && a !== 'origin');
    const hit = refs.filter(([name]) => !patterns.length || patterns.some((p) => refMatch(p, name)));
    return { ok: true, err: '',
      out: hit.map(([name, sha]) => `${sha}\t${name}`).join('\n') + (hit.length ? '\n' : '') };
  };
  const ANNOTATED = [[`refs/tags/${TAG}`, TAGOBJ], [`refs/tags/${TAG}^{}`, HEAD]];

  // 20. THE PUSH IS EXPLICIT. `git push` with no refspec, or --tags, is how a
  //     release comes to report "Everything up-to-date" and send nothing.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    const v = pushAndVerify({ tag: TAG, head: HEAD, git: g.git });
    const probe = (g.calls.find((c) => c.startsWith('ls-remote')) ?? '').split(' ');
    ok('the tag is pushed by explicit refspec and then read back from origin',
      v.status === 'ok'
        && g.calls[0] === `push origin refs/tags/${TAG}`
        && tagRefspecs(TAG).every((r) => probe.includes(r)),
      `status ${v.status}; calls: ${g.calls.join(' | ') || '(none)'}`);
  }

  // 20b. AND THE INSTRUMENT, against real git rather than against our model of
  //      it. THE SECOND BRACE, and it is load-bearing on its own: every fake in
  //      this file encodes what we BELIEVE ls-remote does, this defect IS that
  //      belief being wrong, and a fake can never catch its own author. So this
  //      builds a real repository with a real annotated tag and puts the same
  //      two questions to real git and to lsRemote above, requiring the SAME
  //      answer from each. Offline and hermetic - the "remote" is a directory on
  //      this machine - and the refspecs are tagRefspecs' own, not re-typed.
  //
  //      Two things, and they fail independently. The model must agree with git,
  //      which is what catches refMatch drifting from git's matching. And the
  //      finding itself must still be true ON REAL DATA: the gate's form returns
  //      the peeled ref, the single-pattern form does not. If that ever stops
  //      holding there was no defect here and every fake-driven assertion around
  //      it is decoration - so it is asserted rather than assumed.
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-lsremote-'));
    const id = ['-c', 'user.name=mavci', '-c', 'user.email=mavci@example.invalid'];
    const rg = (args) => execFileSync('git', args,
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
    const names = (out) => out.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean);
    const asked = [tagRefspecs(TAG), [`refs/tags/${TAG}`]];
    let real = [];
    let modelled = [];
    let err = '';
    try {
      rg(['init', '-q', tmp]);
      rg([...id, 'commit', '-q', '--allow-empty', '-m', 'base']);
      rg([...id, 'tag', '-a', TAG, '-m', 'annotated']);
      const all = rg(['ls-remote', '--tags', tmp]).split('\n').map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length === 2).map(([sha, name]) => [name, sha]);
      const model = lsRemote(all);
      real = asked.map((pats) => names(rg(['ls-remote', '--tags', tmp, ...pats])));
      modelled = asked.map((pats) => names(model(['ls-remote', '--tags', 'origin', ...pats]).out));
    } catch (e) {
      err = String(e.stderr || e.message || e).trim();
    }
    const peeled = `refs/tags/${TAG}^{}`;
    const agrees = real.length === 2 && modelled.length === 2
      && real.every((r, i) => r.join() === modelled[i].join());
    ok('real git and the fake answer alike, and only the gate\'s form returns the peeled ref',
      err === '' && agrees && real[0]?.includes(peeled) && !real[1]?.includes(peeled),
      err || `git -> ${JSON.stringify(real)}; fake -> ${JSON.stringify(modelled)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 21. a push that failed rolls the tag back, because there the gate KNOWS
  //     the tag did not go and the repository can be left as it was.
  {
    const g = gitLog((args) => (args[0] === 'push'
      ? { ok: false, out: '', err: 'remote: Write access to repository not granted.' }
      : { ok: true, out: '', err: '' }));
    const v = pushAndVerify({ tag: TAG, head: HEAD, git: g.git });
    ok('a failed push deletes the local tag and says the repository is as it was',
      v.status === 'push-failed' && g.calls.includes(`tag -d ${TAG}`)
        && /Write access/.test(v.text),
      `status ${v.status}; calls: ${g.calls.join(' | ')}`);
  }

  // 22. THE ASSERTION THIS RELEASE EXISTS FOR, and the atomicity that makes it
  //     survivable. The push reported success and origin does not have the tag,
  //     so the local tag is DELETED: a failure that leaves no tag is retryable,
  //     and one that leaves an unpushed tag makes the operator work out which of
  //     three places the tag is in before they can do anything at all.
  {
    const g = gitLog(lsRemote([]));
    const v = pushAndVerify({ tag: TAG, head: HEAD, git: g.git });
    ok('a push that reported success and sent nothing DELETES the tag, leaving a retryable state',
      v.status === 'absent'
        && g.calls.includes(`tag -d ${TAG}`)
        && /no tag now exists/i.test(v.text),
      `status ${v.status}; deleted: ${g.calls.includes(`tag -d ${TAG}`)}`);
  }

  // 23. invariant 5 at the last step: a probe that could not run is not a pass,
  //     and it is not an accusation either. The tag is still deleted - that is
  //     the only half the gate CAN make certain, and the state it leaves is
  //     "either on origin or nowhere", never the three-way one - but the text
  //     must not claim the push did nothing, because it has not established it.
  {
    const g = gitLog((args) => (args[0] === 'ls-remote'
      ? { ok: false, out: '', err: 'fatal: unable to access origin' }
      : { ok: true, out: '', err: '' }));
    const v = pushAndVerify({ tag: TAG, head: HEAD, git: g.git });
    ok('an unreadable origin after the push is UNKNOWN, deletes the local tag, and accuses nothing',
      v.status === 'unknown' && !/does not have it/i.test(v.text)
        && g.calls.includes(`tag -d ${TAG}`)
        // AND THE COMMAND IT HANDS OVER MUST BE THE HONEST ONE. Before finding
        // 27 this said `refs/tags/<tag>` and nothing else, so the gate refused,
        // told the operator to read the remote - which was right - and then gave
        // them the same query that had just lied to it. Requiring the substring
        // alone passes on that, because it is a prefix of the correct form.
        && tagRefspecs(TAG).every((r) => v.text.includes(r)),
      `status ${v.status}: ${v.text.split('\n')[0]}`);
  }

  // 24. the two ways origin can hold something that is not what was cut.
  {
    const other = '9999999999999999999999999999999999999999';
    const mism = gitLog(lsRemote([[`refs/tags/${TAG}`, TAGOBJ], [`refs/tags/${TAG}^{}`, other]]));
    const a = pushAndVerify({ tag: TAG, head: HEAD, git: mism.git });
    const light = gitLog(lsRemote([[`refs/tags/${TAG}`, HEAD]]));
    const b = pushAndVerify({ tag: TAG, head: HEAD, git: light.git });
    ok('a tag on origin at another commit, and a lightweight one, each refuse',
      a.status === 'mismatch' && a.text.includes(other.slice(0, 7))
        && b.status === 'unpeeled',
      `mismatch -> ${a.status}; lightweight -> ${b.status}`);
  }

  // 25. and a fully green cut names what it did NOT establish. A gate that
  //      stops asserting and does not say where it stopped is asserting more
  //      than it verified - and this list SHRANK in 0.1.29 when the watch took
  //      over two of its entries, which is exactly when a declaration like this
  //      goes stale unnoticed. The keys are read from the map rather than
  //      re-typed, so it cannot.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: true, out: '' }),
      watch: () => ({ status: 'passed', exit: 0, text: 'run passed' }) });
    const named = [...POST_PUSH_NOT_COVERED.keys()].every((k) => r.text.includes(k));
    ok('a green cut names the two manual links it does NOT cover',
      POST_PUSH_NOT_COVERED.size >= 2 && named && /PROPAGATION/.test(r.text),
      `${POST_PUSH_NOT_COVERED.size} declared; named: ${named}`);
  }

  // 25b. and a cut that did NOT end green does not print that block. The list
  //      describes what is owed after a release; printing it under a failure
  //      reads as a release that happened.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: true, out: '' }),
      watch: () => ({ status: 'failed', exit: 2, text: 'run failed' }) });
    ok('a cut that did not end green does not print the post-release block',
      r.exit === 2 && !r.text.includes([...POST_PUSH_NOT_COVERED.keys()][0]),
      r.text.split('\n').slice(-2).join(' | '));
  }

  // 26. WIRING FOR THE TAIL. The four steps in order, from one call, with every
  //     runner faked - because a correct pushAndVerify that the cut path never
  //     reaches is the shape this repository has now found a dozen times, and
  //     through v0.1.28 this sequence lived in the CLI where no test could see
  //     it at all.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    const watched = [];
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: true, out: '' }),
      watch: () => { watched.push(g.calls.length); return { status: 'passed', exit: 0, text: 'run passed' }; } });
    ok('--cut tags, judges, pushes, reads back, and only THEN watches',
      r.exit === 0 && r.status === 'passed'
        && g.calls[0].startsWith(`tag -a ${TAG}`)
        && g.calls[1] === `push origin refs/tags/${TAG}`
        && g.calls[2].startsWith('ls-remote')
        && watched.length === 1 && watched[0] === 3,
      `exit ${r.exit}/${r.status}; calls: ${g.calls.join(' | ')}; watched after ${watched[0]}`);
  }

  // 26b. and the watch is NOT reached when the tag did not arrive. Watching for
  //      a run of a tag that is not on origin would poll until its bound and
  //      report UNKNOWN, burying the one thing that IS known.
  {
    const g = gitLog(() => ({ ok: true, out: '', err: '' }));
    let watched = 0;
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: true, out: '' }),
      watch: () => { watched += 1; return { status: 'passed', exit: 0, text: '' }; } });
    ok('a tag that did not reach origin is reported, and never watched',
      r.exit === 2 && r.status === 'absent' && watched === 0,
      `exit ${r.exit}/${r.status}; watched ${watched} time(s)`);
  }

  // 26c. the watch's verdict is the run's verdict, carried out whole. A cut
  //      that pushed successfully and whose release run FAILED is not a pass,
  //      and the arm that decides that is the watch's, not this one's.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: true, out: '' }),
      watch: () => ({ status: 'unfinished', exit: 3, text: 'still running' }) });
    ok('the watch verdict is carried out whole, exit status included',
      r.exit === 3 && r.status === 'unfinished' && r.text.includes('still running')
        && !g.calls.includes(`tag -d ${TAG}`),
      `exit ${r.exit}/${r.status}`);
  }

  // 27. and the rollback arm fires BEFORE anything is pushed. Ordering is the
  //     whole property: a sequence that pushed first would still delete the
  //     local tag and would look identical in every other respect, while origin
  //     kept the tag it had already been sent.
  {
    const g = gitLog(lsRemote(ANNOTATED));
    let watched = 0;
    const r = cutTag({ tag: TAG, head: HEAD, git: g.git,
      checkTags: () => ({ ok: false, out: 'v9.9.9 is not the mainline' }),
      watch: () => { watched += 1; return { status: 'passed', exit: 0, text: '' }; } });
    ok('a tag check-tags.mjs rejects is deleted, NEVER pushed, and never watched',
      r.exit === 2 && r.status === 'check-tags-rejected'
        && g.calls.includes(`tag -d ${TAG}`)
        && !g.calls.some((c) => c.startsWith('push')) && watched === 0,
      `exit ${r.exit}; calls: ${g.calls.join(' | ')}; watched ${watched}`);
  }

  /* --- the watch, and its bound (v0.1.29) -------------------------------
   *
   * BROKEN BUILD THESE MUST CATCH: every version through 0.1.28, where the
   * release run was watched by an operator reading a `gh run watch` line
   * printed at the bottom of a passing gate - which is to say, sometimes.
   *
   * The bound is the part with no obvious right answer, so it is asserted
   * rather than left to whatever the loop happens to do: a watch that never
   * gives up hangs the release, and one that treats "still running" as either
   * verdict reports something it does not know.
   */
  const ghLog = (script) => {
    const calls = [];
    let t = 0;
    return {
      calls,
      clock: () => t,
      sleep: (ms) => { t += ms; },
      gh: (args) => {
        calls.push(args.join(' '));
        // A watch with no bound does not fail an assertion, it HANGS the suite -
        // and a self-test that never returns reports nothing at all. This makes
        // "no bound" a red assertion instead of a stalled run.
        if (calls.length > 500) throw new Error('UNBOUNDED: watchRelease polled 500 times');
        return script(calls.length, t);
      },
    };
  };
  const RUN = (status, conclusion) => ({ ok: true, err: '',
    out: JSON.stringify([{ databaseId: 42, status, conclusion,
      url: 'https://github.com/o/r/actions/runs/42' }]) });
  const NORUN = { ok: true, out: '[]', err: '' };
  const WT = { appearMs: 120000, totalMs: 600000, pollMs: 15000 };
  const runWatch = (h, cfg = WT) => {
    try { return watchRelease({ tag: TAG, gh: h.gh, sleep: h.sleep, now: h.clock, cfg }); }
    catch (e) { return { status: 'UNBOUNDED', exit: -1, text: e.message }; }
  };

  // 28. the run passed. The only arm that exits 0.
  {
    const h = ghLog(() => RUN('completed', 'success'));
    const v = runWatch(h);
    ok('a release run that passed is the only arm that exits 0',
      v.status === 'passed' && v.exit === 0 && v.text.includes('runs/42'),
      `${v.status}/${v.exit}: ${v.text.split('\n')[0]}`);
  }

  // 29. the run failed. The tag is on origin and immutable, so the gate must
  //     not offer to undo it - the fix is a new version, never a moved tag.
  {
    const h = ghLog(() => RUN('completed', 'failure'));
    const v = runWatch(h);
    ok('a release run that failed refuses, and offers a NEW version rather than moving the tag',
      v.status === 'failed' && v.exit === 2 && /NEW version/.test(v.text)
        && !/tag -d/.test(v.text) && !/--delete/.test(v.text),
      `${v.status}/${v.exit}: ${v.text.split('\n')[0]}`);
  }

  // 30. THE BOUND. Still running when the budget is spent is UNKNOWN - not a
  //     pass and not a failure - and it must name the bound it hit, because a
  //     timeout that does not say how long it waited is unactionable.
  {
    const h = ghLog(() => RUN('in_progress', null));
    const v = runWatch(h);
    ok('a run still going at the bound is UNKNOWN, names the bound, and exits neither 0 nor 2',
      v.status === 'unfinished' && v.exit === 3 && /UNKNOWN/.test(v.text)
        && /10 minutes/.test(v.text) && /gh run watch/.test(v.text),
      `${v.status}/${v.exit}: ${v.text.split('\n')[0]}`);
  }

  // 31. no run yet. Distinct from "still running" because the causes differ,
  //     and it must NOT assert that the workflow did not trigger - a queue can
  //     exceed this bound and the gate has not established which it is.
  {
    const h = ghLog(() => NORUN);
    const v = runWatch(h);
    ok('no run within the appearance bound is UNKNOWN, and does not accuse the workflow',
      v.status === 'no-run' && v.exit === 3 && /UNKNOWN/.test(v.text)
        && /NOT evidence that the workflow did not trigger/.test(v.text)
        && /queue can exceed this bound/.test(v.text),
      `${v.status}/${v.exit}: ${v.text.split('\n')[0]}`);
  }

  // 32. invariant 5 again, one step further out: gh unreadable is not a pass.
  {
    const h = ghLog(() => ({ ok: false, out: '', err: 'gh: not authenticated' }));
    const v = runWatch(h);
    ok('an unreadable gh after the push is UNKNOWN, not a pass',
      v.status === 'unavailable' && v.exit === 3 && /not authenticated/.test(v.text),
      `${v.status}/${v.exit}: ${v.text.split('\n')[0]}`);
  }

  // 33. THE LOOP TERMINATES, and it polls a number of times the bound explains.
  //     A watch with no bound is the release hanging; a bound nothing asserts
  //     is a number in a constant.
  {
    const h = ghLog(() => RUN('in_progress', null));
    const expected = Math.floor(WT.totalMs / WT.pollMs) + 1;
    const v = runWatch(h);
    ok('the poll loop is bounded, and polls the number of times the bound implies',
      v.status !== 'UNBOUNDED' && h.calls.length >= expected - 1 && h.calls.length <= expected + 1,
      v.status === 'UNBOUNDED' ? v.text : `polled ${h.calls.length} times, expected about ${expected}`);
  }

  // 34. EVERY arm that is not a pass leaves the tag on origin and says so.
  //     Un-pushing a released tag is worse than an unresolved watch, and this
  //     function is given no git at all - it could not delete one if it tried.
  {
    const arms = [
      ['unfinished', () => RUN('in_progress', null)],
      ['no-run', () => NORUN],
      ['unavailable', () => ({ ok: false, out: '', err: 'x' })],
      ['failed', () => RUN('completed', 'failure')],
    ];
    const silent = arms.filter(([, s]) => {
      const h = ghLog(s);
      const v = runWatch(h);
      return v.status === 'UNBOUNDED' || !/NOT deleted/.test(v.text);
    }).map(([n]) => n);
    ok('every non-passing watch arm says the tag stands on origin',
      silent.length === 0, `silent about the tag: ${silent.join(', ')}`);
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
  // --selftest is dispatched BEFORE the generated-state refusal, and the order
  // is deliberate. Mutating the predicate to fire on everything (P12) put the
  // refusal ahead of this line, and the gate then refused to run the very
  // self-test whose assertion 16 exists to catch an over-firing predicate: the
  // check that would have reported the defect was the first thing the defect
  // took offline. --selftest is the one mode that cannot report on a release or
  // create one, so it is the one mode the refusal must not reach. Everything
  // below it can, and does.
  if (argv.includes('--selftest')) { selftest(); return; }

  // A gate that reports on this tree while running in a copy of it that gets
  // reset is answering about the wrong repository - and the informational
  // no-argument path reads a plugin.json that is not the one being edited
  // either, so this sits ahead of that too.
  const generated = generatedStateVerdict({
    root: realpath(ROOT),
    pluginsDir: path.join(configDir(), 'plugins'),
    clone: realpath(clonePath()),
  });
  if (generated) {
    console.error(`
${generated.text}
`);
    process.exit(2);
  }

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

  // ONE pattern here, DELIBERATELY, and it is not the finding-27 form by
  // oversight. This arm asks only whether origin holds the name at all, and the
  // unpeeled ref answers that whether the tag is annotated or lightweight. It
  // is left narrow rather than widened to match, so that the next reader sees
  // the two questions are different: anything that needs to know the tag's FORM
  // must ask with tagRefspecs, because this pattern filters `^{}` out.
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
      // Prefer stderr: every check in this suite writes its authoritative
      // failure list there and uses stdout for the running commentary. Taking
      // the stdout tail threw the summary away and kept the chatter - which is
      // how a six-failure run was read as a three-failure one, with the three
      // that named the cause among the ones dropped.
      const err_ = String(err.stderr ?? '').trim();
      const out_ = String(err.stdout ?? '').trim();
      const body = err_ || out_;
      const lines = body ? body.split('\n') : [];
      const shown = lines.slice(-TAIL_LINES);
      const dropped = lines.length - shown.length;
      failures.push(`${path.basename(script)} FAILED (exit ${err.status}):\n`
        + (shown.length
          // A gate that truncates its own evidence must say that it did, or the
          // reader diagnoses the part that survived.
          ? (dropped > 0 ? `      [...${dropped} earlier line(s) not shown]\n` : '')
            + shown.map((l) => `      ${l}`).join('\n')
          : '      (no output)'));
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
    console.log(`\nNothing was created. To cut it - which creates the tag, pushes it, reads it back off
origin, and then watches the release run:\n  node scripts/ci/check-pretag.mjs ${wanted} --cut`);
    process.exit(0);
  }

  // v0.1.29. The push is the gate's, and so is the assertion after it. A second
  // runner because this one must REPORT a failure rather than throw: the push's
  // own stderr is the evidence, and `git()` above turns it into an exception
  // message. stdio is pinned - check-plugin.mjs fails any exec*Sync in
  // scripts/ci/ that does not, since a child's stderr forwarded into a green run
  // is what trained everyone to read past red marks (0.1.14).
  const runGit = (args) => {
    try {
      const out = execFileSync('git', args, {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
      });
      return { ok: true, out: String(out ?? ''), err: '' };
    } catch (err) {
      return { ok: false, out: String(err.stdout ?? ''), err: String(err.stderr ?? err.message ?? '').trim() };
    }
  };

  const runCheckTags = () => {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/ci/check-tags.mjs')],
        { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      return { ok: true, out: '' };
    } catch (err) {
      return { ok: false, out: String(err.stdout ?? '') + String(err.stderr ?? '') };
    }
  };

  // THE RESIDUAL, SAID OUT LOUD: cutTag's whole sequence is asserted by the
  // self-test with both runners faked, and what is left unasserted is this call
  // itself - a release gate cannot cut and push a real tag to prove it does.
  // That is one line, it is named here, and it is the honest boundary rather
  // than a check that appears to cover it.
  const runGh = (args) => {
    try {
      const out = execFileSync('gh', args, {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
      });
      return { ok: true, out: String(out ?? ''), err: '' };
    } catch (err) {
      return { ok: false, out: String(err.stdout ?? ''), err: String(err.stderr ?? err.message ?? '').trim() };
    }
  };

  console.log(`\nwatching the release run for ${wanted}, up to ${Math.round(WATCH.totalMs / 60000)} `
    + `minutes. Still running at that point is UNKNOWN, not a pass - the tag stays on origin.`);

  const result = cutTag({ tag: wanted, head, git: runGit, checkTags: runCheckTags,
    watch: () => watchRelease({ tag: wanted, gh: runGh }) });
  if (result.exit !== 0) {
    // exit 3 is UNKNOWN and exit 2 is a refusal, and they are different answers:
    // 3 means the tag IS released and this gate could not read the verdict, so
    // the operator finishes the watch. Collapsing them into 2 would report a
    // released version as a failed cut and invite the one repair that must never
    // happen, which is moving the tag.
    console.error(`\n--cut ${result.exit === 3 ? 'could not finish' : 'FAILED'} for ${wanted}:\n`);
    console.error('  - ' + result.text + '\n');
    process.exit(result.exit);
  }
  console.log(`\n${result.text}`);
}

// Basename, not endsWith. v0.1.13's finding: `scripts/ci/check-retro.mjs` ends
// with `retro.mjs`, so a suffix test ran retro's CLI when its own self-test
// imported it. This file previously had no guard at all and executed the entire
// gate on import, which is the same defect one step worse - it is why this
// script had no behavioural test until now.
if (process.argv[1] && path.basename(process.argv[1]) === 'check-pretag.mjs') main();

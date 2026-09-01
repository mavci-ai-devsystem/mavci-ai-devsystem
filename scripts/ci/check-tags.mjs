#!/usr/bin/env node
/**
 * Tag shape and tag/mainline agreement.
 *
 * Two defects this exists to catch, both of which produce a FALSE reading
 * rather than an error.
 *
 * 1. Mixed tag forms. `v0.1.4` was lightweight (a ref straight to a commit);
 *    `v0.1.5` and `v0.1.6` were annotated (a ref to a TAG OBJECT that points at
 *    a commit). `git rev-parse v0.1.6` returns the tag object's sha, NOT the
 *    commit's. Comparing that sha against a commit sha is correct for a
 *    lightweight tag and silently wrong for an annotated one: at Gate 4 it read
 *    `v0.1.6` = f74b163 against main = a5d782d and reported the release as two
 *    commits behind main. It was not. `v0.1.6^{commit}` IS a5d782d. Hours went
 *    into a drift that never existed. Every comparison below peels with
 *    `^{commit}`, and mixed forms are themselves a failure so the trap stops
 *    being re-laid.
 *
 * 2. A tag cut behind the mainline. Every project's CI clones the system at
 *    tag v<state.json.plugin_version> (blocker B4), so a tag that is not the
 *    tree that was tested ships untested code to every project at once.
 *    "Tag equals plugin.json version" in release.yml does NOT catch this: the
 *    manifest can agree with the tag while the tag trails main.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

/**
 * The annotated-tag rule binds from this version forward.
 *
 * v0.1.3 and v0.1.4 are lightweight and stay that way. Re-cutting them would
 * move two tags that machines have ALREADY FETCHED - the Gate 4 marketplace
 * clone holds v0.1.4 as a shallow graft point - and would do so for two
 * superseded versions no project should be pinned to anyway. Moving a fetched
 * tag is worse than the inconsistency it fixes: a clone that already holds the
 * old object keeps it, so one tag name would mean two different commits on two
 * machines. That is the exact class of confusion this check exists to prevent.
 *
 * The cutoff is deliberate history, not an unexplained exemption. Everything
 * from v0.1.7 forward must be annotated, so the two forms stop coexisting
 * going forward rather than being rewritten backwards.
 */
const ANNOTATED_FROM = '0.1.7';

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const gitOrNull = (...args) => {
  try { return git(...args); } catch { return null; }
};

const parts = (v) => v.replace(/^v/, '').split('.').map(Number);
const atLeast = (tag, floor) => {
  const [x, y, z] = parts(tag);
  const [i, j, k] = parts(floor);
  return x !== i ? x > i : y !== j ? y > j : z >= k;
};

/* --- the mainline ref ------------------------------------------------- */
// On a tag push the checkout is detached and refs/heads/main may not exist,
// so origin/main is the fallback. If NEITHER resolves the check cannot run,
// and a check that cannot run must fail rather than pass quietly - that is
// the 0.1.2 lesson (a green report from a validator that asserted nothing).

const mainline = ['refs/heads/main', 'refs/remotes/origin/main']
  .find((r) => gitOrNull('rev-parse', '--verify', '--quiet', r));

if (!mainline) {
  console.error('\ntag check FAILED:');
  console.error('  - neither refs/heads/main nor refs/remotes/origin/main resolves.');
  console.error('    actions/checkout defaults to a shallow single-ref fetch; this job');
  console.error("    needs `fetch-depth: 0`. Refusing to pass without comparing anything.");
  process.exit(2);
}

const mainSha = git('rev-parse', mainline + '^{commit}');

/* --- tags bound by the rule must be annotated ------------------------- */

const tags = git('tag', '-l').split('\n').map((t) => t.trim()).filter(Boolean);

if (!tags.length) {
  console.error('\ntag check FAILED:');
  console.error('  - no tags are present, so neither assertion below could be evaluated.');
  console.error('    `fetch-depth: 0` fetches tags; a bare checkout does not.');
  process.exit(2);
}

const bound = tags.filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && atLeast(t, ANNOTATED_FROM));
const grandfathered = tags.filter((t) => !bound.includes(t));

const lightweight = bound.filter((t) => gitOrNull('cat-file', '-t', t) !== 'tag');
if (lightweight.length) {
  failures.push(lightweight.length + ' tag(s) at or above v' + ANNOTATED_FROM
    + ' are lightweight, not annotated: ' + lightweight.join(', ') + '.'
    + '\n    A lightweight tag carries no tagger, date or message, and mixing the two forms is'
    + '\n    what makes `git rev-parse <tag>` mean different things for different tags: the tag'
    + '\n    OBJECT for an annotated tag, the COMMIT for a lightweight one. Re-cut with -a.');
}

/* --- the newest tag must BE the mainline ------------------------------ */
// This arm binds to every tag, grandfathered or not: an old tag form is
// tolerable, an untested release point is not.

const newest = gitOrNull('describe', '--tags', '--abbrev=0', mainline);
if (!newest) {
  failures.push('no tag is reachable from ' + mainline + ', so the release point could not be located.');
} else {
  const newestSha = git('rev-parse', newest + '^{commit}');
  if (newestSha !== mainSha) {
    const ahead = git('rev-list', '--count', newest + '^{commit}..' + mainline);
    failures.push(mainline + ' is ' + ahead + ' commit(s) ahead of the newest tag ' + newest + '.'
      + '\n    ' + newest + '^{commit} = ' + newestSha.slice(0, 7) + ', ' + mainline + ' = ' + mainSha.slice(0, 7)
      + '\n    Projects pin CI to a tag, so those ' + ahead + ' commit(s) would be absent from every'
      + "\n    project's toolchain while being present in yours. Tag the mainline, or revert it.");
  }
}

/* --- report ----------------------------------------------------------- */

if (grandfathered.length) {
  console.log('  note  ' + grandfathered.length + ' tag(s) predate the v' + ANNOTATED_FROM
    + ' annotated-tag rule and are exempt by design: ' + grandfathered.join(', '));
}
if (failures.length) {
  console.error('\ntag check FAILED (' + failures.length + '):');
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
// Until v0.1.7 exists the annotated arm has an empty subject. That is correct,
// but it must not READ as a pass - a validator that asserted nothing reporting
// green is the 0.1.2 failure, and this line is where that would hide.
const annotatedArm = bound.length
  ? bound.length + ' tag(s) bound by the rule, all annotated'
  : 'annotated-tag arm asserted NOTHING (no tag at or above v' + ANNOTATED_FROM + ' exists yet)';
console.log('tags ok: ' + annotatedArm + '; newest ' + newest + ' is ' + mainline
  + ' (' + mainSha.slice(0, 7) + ')');

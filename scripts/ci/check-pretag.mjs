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
 *
 * With no tag argument it reports the tag `plugin.json` currently authorises.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json');

const argv = process.argv.slice(2);
const cut = argv.includes('--cut');
const wanted = argv.find((a) => !a.startsWith('--')) ?? null;

const failures = [];
const notes = [];

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${String(err.stderr ?? err.message).trim()}`);
  }
}

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

/* --- 3. the tag must not already exist --------------------------------- */
// Moving a tag a machine has already fetched is worse than the mistake it fixes:
// the clone keeps the object it holds, so one tag name means two different
// commits on two machines. check-tags.mjs records that reasoning for v0.1.3/4.

const localTag = git(['tag', '--list', wanted]);
if (localTag) failures.push(`${wanted} already exists locally. A released tag is immutable - bump the version instead of re-cutting.`);

const remoteTag = git(['ls-remote', '--tags', 'origin', `refs/tags/${wanted}`], { allowFail: true });
if (remoteTag === null) {
  failures.push('could not reach origin to check whether the tag already exists.\n'
    + '    Refusing rather than cutting blind: a tag that already exists on the remote is the\n'
    + '    one case where proceeding is unrecoverable. Check the network and re-run.');
} else if (remoteTag !== '') {
  failures.push(`${wanted} already exists ON ORIGIN. It may have been fetched already; do not move it. Bump the version.`);
}

/* --- 4. the tree being tagged must be the tree that was tested --------- */

const dirty = git(['status', '--porcelain']);
if (dirty) {
  failures.push(`the working tree is dirty, so the tag would not name the tree you validated:\n`
    + dirty.split('\n').map((l) => `      ${l}`).join('\n'));
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  failures.push(`HEAD is on "${branch}", not main. Every project clones the release tag; it must be the mainline.`);
}

const head = git(['rev-parse', 'HEAD']);
const remoteMain = git(['ls-remote', 'origin', 'refs/heads/main'], { allowFail: true });
if (remoteMain === null) {
  notes.push('could not reach origin to compare HEAD with origin/main - unverified, not passing.');
} else {
  const remoteSha = remoteMain.split(/\s+/)[0];
  if (remoteSha !== head) {
    failures.push(`HEAD (${head.slice(0, 7)}) is not origin/main (${remoteSha.slice(0, 7)}).\n`
      + '    Push the commit BEFORE tagging it. A tag pointing at an unpushed commit resolves\n'
      + '    for nobody, and a tag pointing at a commit origin has moved past is not the mainline.');
  }
}

/* --- 5. everything release.yml would run, run now ---------------------- */
// Not a substitute for CI - it is the same suite, moved to before the irreversible
// step. CI still runs it after, and `--cut` deliberately does not push.

const SUITE = [
  ['plugins/mavci-core/scripts/build-agents.mjs', '--check'],
  ['scripts/ci/check-schemas.mjs'],
  ['scripts/ci/check-fixtures.mjs'],
  ['scripts/ci/check-risk-guard.mjs'],
  ['scripts/ci/check-gate.mjs'],
  ['scripts/ci/check-plugin.mjs'],
  ['scripts/ci/check-doctor.mjs'],
  ['scripts/ci/check-hooks-quiet.mjs'],
  ['scripts/ci/check-placeholders.mjs'],
  ['scripts/ci/check-skill-placeholders.mjs'],
  ['scripts/ci/check-packaging.mjs'],
  ['scripts/ci/check-tags.mjs'],
];

for (const [script, ...args] of SUITE) {
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

if (failures.length) {
  console.error(`\npre-tag check FAILED for ${wanted}:\n`);
  for (const f of failures) console.error('  - ' + f + '\n');
  console.error('No tag was created. Fix the above and re-run.');
  process.exit(2);
}

for (const n of notes) console.log(`  note  ${n}`);
console.log(`pre-tag: ${wanted} agrees with plugin.json, tag is unused, tree is clean `
  + `and equals origin/main, and ${SUITE.length} checks pass.`);

if (!cut) {
  console.log(`\nNothing was created. To cut it:\n  node scripts/ci/check-pretag.mjs ${wanted} --cut`);
  process.exit(0);
}

// Annotated, because check-tags.mjs requires it from v0.1.7 forward and a
// lightweight tag silently breaks every `^{commit}` comparison downstream.
git(['tag', '-a', wanted, '-m', `${wanted} - see docs/ROADMAP.md and docs/NATIVE-CAPABILITIES.md`]);
console.log(`\ncreated annotated tag ${wanted} at ${head.slice(0, 7)} (local only).`);
console.log(`Push it, then WATCH THE RELEASE JOB - it is the last gate and nothing downstream reads it:`);
console.log(`  git push origin ${wanted}`);
console.log(`  gh run watch "$(gh run list --workflow release.yml --branch ${wanted} --limit 1 --json databaseId --jq '.[0].databaseId')"`);

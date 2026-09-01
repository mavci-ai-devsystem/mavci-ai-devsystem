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
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST = path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json');
const RELEASE_YML = path.join(ROOT, '.github/workflows/release.yml');

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

// A floor, not a second list. A recogniser that silently matched nothing would
// otherwise report "0 checks pass" in the confident voice of a gate that ran.
const MIN_DERIVED = 8;

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
      const m = /^node\s+(\S+\.mjs)(?:\s+(.*))?$/.exec(command);
      if (!m) { undeclared.push({ step: step.name, command }); continue; }
      suite.push([m[1], ...(m[2] ?? '').split(/\s+/).filter(Boolean)]);
    }
  }

  const stale = [...EXCLUDED_STEPS.keys()].filter((k) => !seen.has(k));
  return { steps, suite, undeclared, stale };
}

/* --- the self-test ------------------------------------------------------ */
// v0.1.13 recorded the rule this obeys: a component that reports on others
// needs a test that EXERCISES it, not only checks that construct it. This gate
// is a reporter, and until now it had no behavioural test of any kind - which
// is the whole reason its suite could disagree with release.yml for four checks
// across several releases while every release run went green.

function selftest() {
  const failed = [];
  const ok = (name, cond, detail = '') => {
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

  if (failed.length) {
    console.error(`\ncheck-pretag --selftest FAILED (${failed.length}):\n`);
    for (const f of failed) console.error('  - ' + f + '\n');
    process.exit(2);
  }
  console.log(`\ncheck-pretag --selftest: 9 assertions pass; `
    + `the suite is derived from release.yml and ${EXCLUDED_STEPS.size} exclusions are declared.`);
}

/* --- the gate ----------------------------------------------------------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) { selftest(); return; }

  const cut = argv.includes('--cut');
  const wanted = argv.find((a) => !a.startsWith('--')) ?? null;

  const failures = [];
  const notes = [];

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
  // Not a substitute for CI - it is the same suite, DERIVED from the same file,
  // moved to before the irreversible step. CI still runs it after, and `--cut`
  // deliberately does not push.

  let derived;
  try {
    derived = deriveReleaseSuite(fs.readFileSync(RELEASE_YML, 'utf8'));
  } catch (err) {
    console.error(`check-pretag: could not read ${path.relative(ROOT, RELEASE_YML)}: ${err.message}`);
    console.error('The suite is derived from that file, so an unreadable workflow is a refusal, not an empty suite.');
    process.exit(2);
  }

  if (derived.undeclared.length) {
    failures.push('release.yml runs commands this gate neither runs nor declares:\n'
      + derived.undeclared.map((u) => `      [${u.step}]  ${u.command}`).join('\n')
      + '\n    Either it is a node <script>.mjs check (and is then run here automatically), or it\n'
      + '    belongs in EXCLUDED_STEPS with the reason. An exclusion implied by absence is\n'
      + '    indistinguishable from an omission - that is the defect this arm exists to stop.');
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

  if (failures.length) {
    console.error(`\npre-tag check FAILED for ${wanted}:\n`);
    for (const f of failures) console.error('  - ' + f + '\n');
    console.error('No tag was created. Fix the above and re-run.');
    process.exit(2);
  }

  for (const n of notes) console.log(`  note  ${n}`);
  console.log(`pre-tag: ${wanted} agrees with plugin.json, tag is unused, tree is clean `
    + `and equals origin/main, and ${derived.suite.length} checks derived from release.yml pass.`);
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

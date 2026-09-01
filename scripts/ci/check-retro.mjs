#!/usr/bin/env node
/**
 * Regression tests for the ESCALATION CHANNEL - `retro.mjs` and the one line in
 * `doctor` that points at it.
 *
 * 0.1.12 shipped the channel. Its first real use found two defects in it, both
 * the same shape as the eight before them: a mechanism that was present,
 * correct-looking, and never connected to the thing it claimed to cover.
 *
 * 1. THE QUEUE IS A DIRECTORY, and both readers read one fixed path inside it.
 *    `doctor` answered "is anything queued?" by testing a path it had chosen in
 *    advance, so a findings file under any other name was invisible - and
 *    `--clear` would have deleted the applied file and orphaned the open one
 *    along with the only pointer to it. The assertion is therefore NOT that
 *    doctor WARNs: it warns against the broken build too. It is that doctor's
 *    output NAMES the file that is actually there.
 *
 * 2. THE WRITER AND THE PARSER DISAGREED ON A CHARACTER. `record()` wrote
 *    `# Finding 3 - title` with U+002D; every hand-written heading in the queue
 *    used U+2014. The parser counted machine-written findings, missed human
 *    ones, reported zero, and would have appended a SECOND `# Finding 1`.
 *    Widening the regex would fix the count and leave the disagreement, so the
 *    assertion here is on the property, not on the character: whatever heading
 *    `findingHeading()` writes, the parser must find - and normalising on read
 *    must never rewrite what a human typed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const RETRO = path.join(SCRIPTS, 'retro.mjs');
const DOCTOR = path.join(SCRIPTS, 'doctor.mjs');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);
const retro = await import(pathToFileURL(RETRO).href);

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

const EM = '—';   // the character every hand-written heading in the queue uses


function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-retro-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  fs.mkdirSync(path.join(tmp, PATHS.lessons), { recursive: true });
  return tmp;
}

/** Run a script against a project. Never throws; returns stdout+stderr and status. */
function run(script, cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
    });
    return { out: stdout, status: 0 };
  } catch (err) {
    return { out: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? ''), status: err.status ?? -1 };
  }
}

const queuedPath = (root, name) => path.join(root, PATHS.lessons, name);

/** The file a human wrote by hand, under a name nobody's constant predicted. */
const HANDWRITTEN = 'pending-system-change-0.1.12.md';
const handwritten = [
  `# Queued for 0.1.12 ${EM} apply with \`/mavci-core:retro --apply\``,
  '',
  `# Finding 4 ${EM} \`/mavci-core:retro\` does not exist`,
  '',
  'The command the plugin names as its escalation channel is not implemented.',
  '',
  // A title that itself contains the character being normalised. Without one,
  // "the title comes back verbatim" is untestable: the first draft asserted it
  // against a title holding no dash at all.
  `# Finding 5 ${EM} risk-guard matches the command text ${EM} not the write target`,
  '',
  'Two false positives in one session.',
  '',
].join('\n');

const cleanup = [];
try {

/* --- 1. the queue is a directory, and doctor must name what is in it --- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(queuedPath(tmp, HANDWRITTEN), handwritten);

  const r = run(DOCTOR, tmp, []);
  // NOT an assertion on WARN. Against the broken build doctor is silent here,
  // but against a build that only counted files it would warn without saying
  // which - and "something is queued somewhere" is not a pointer.
  if (r.out.includes(HANDWRITTEN)) {
    ok(`doctor names ${HANDWRITTEN} - the file that is actually queued`);
  } else {
    bad(`doctor does not name ${HANDWRITTEN}. It answers "is anything queued?" by testing one `
      + 'path it chose in advance, so a findings file under any other name is invisible.');
  }

  const list = run(RETRO, tmp, ['--list']);
  if (list.out.includes(HANDWRITTEN)) {
    ok('--list names every queued file, not just the one --record writes');
  } else {
    bad(`--list does not name ${HANDWRITTEN}`);
  }
  // The needle is a title, not a word from the file's prose. The first draft
  // matched "does not exist" and went green against the broken build, on
  // `nothing queued (.mavci/lessons/pending-system-change.md does not exist)`.
  if (list.out.includes('risk-guard matches the command text')) {
    ok('--list reads the findings inside a hand-written queued file');
  } else {
    bad('--list found no findings in the hand-written file: the headings use U+2014 and the '
      + 'parser requires U+002D, so it reports zero for a file with two.');
  }
}

/* --- 2. --clear must not orphan the file it was not told about -------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(queuedPath(tmp, HANDWRITTEN), handwritten);
  run(RETRO, tmp, ['--record', 'a machine-filed one', '--finding', 'observed something']);

  const canonical = path.join(tmp, retro.PENDING);
  if (!fs.existsSync(canonical)) bad('--record did not write the canonical queued file');

  const cleared = run(RETRO, tmp, ['--clear']);
  const bothSurvive = fs.existsSync(canonical) && fs.existsSync(queuedPath(tmp, HANDWRITTEN));
  if (bothSurvive && cleared.out.includes(HANDWRITTEN)) {
    ok('a bare --clear against an ambiguous queue refuses, and names what it would have orphaned');
  } else {
    bad('a bare --clear deleted a file while another stayed queued. That is the deletion of the '
      + `record of an unfixed problem: ${HANDWRITTEN} survives with nothing left pointing at it.`);
  }

  const one = run(RETRO, tmp, ['--clear', HANDWRITTEN]);
  if (!fs.existsSync(queuedPath(tmp, HANDWRITTEN)) && fs.existsSync(canonical)) {
    ok('--clear <name> removes exactly the file it was told to remove');
  } else {
    bad(`--clear ${HANDWRITTEN} did not remove that file and leave the other (status ${one.status})`);
  }
}

/* --- 3. --apply carries every queued file ----------------------------- */
{
  const tmp = makeProject(); cleanup.push(tmp);
  fs.writeFileSync(queuedPath(tmp, HANDWRITTEN), handwritten);
  run(RETRO, tmp, ['--record', 'a machine-filed one', '--finding', 'observed something']);

  // Driven through `applyPlan` rather than the CLI, deliberately. `systemRepo()`
  // resolves to the checkout this file is running from - which is THIS
  // repository - so a CLI --apply in a test would write lessons into the real
  // docs/lessons/. The plan is the whole decision anyway: which files are
  // carried, and to what name.
  const plan = retro.applyPlan(tmp, { projectId: 'gate4c', stamp: '2026-09-01' });
  const sources = plan.map((x) => path.basename(x.src));
  if (sources.includes(HANDWRITTEN) && sources.includes(path.basename(retro.PENDING))) {
    ok('--apply carries every queued file, hand-written and machine-written alike');
  } else {
    bad(`--apply would carry ${JSON.stringify(sources)}. Anything missing from that list stays `
      + 'behind, and --clear then removes the only thing still pointing at it.');
  }
  const dests = new Set(plan.map((x) => x.destName));
  if (dests.size === plan.length) {
    ok('each queued file lands under a distinct name in the system repo');
  } else {
    bad(`two queued files from one project on one day collide: ${JSON.stringify([...dests])}`);
  }
}

/* --- 4. the writer and the parser agree BY CONSTRUCTION ---------------- */
{
  // The property, not the character. If `findingHeading` ever changes its
  // separator, spacing or prefix, this fails unless the parser changed with it.
  const heading = retro.findingHeading(7, 'a title that mentions a - hyphen');
  const parsed = retro.parseFindings(`intro\n\n${heading}\n\nbody\n`);
  if (parsed.length === 1 && parsed[0].n === 7 && parsed[0].title === 'a title that mentions a - hyphen') {
    ok('the parser finds exactly what findingHeading writes, number and title intact');
  } else {
    bad(`round trip failed: findingHeading -> ${JSON.stringify(heading)} parsed as ${JSON.stringify(parsed)}`);
  }
}

/* --- 5. a hand-written heading counts, and is not rewritten ------------ */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const p = path.join(tmp, retro.PENDING);
  fs.writeFileSync(p, handwritten);

  const found = retro.parseFindings(fs.readFileSync(p, 'utf8'));
  if (found.length === 2 && found.map((f) => f.n).join(',') === '4,5') {
    ok('a heading written with U+2014 is counted, and numbered as the human numbered it');
  } else {
    bad(`the parser found ${JSON.stringify(found.map((f) => f.n))} in a file holding findings 4 and 5. `
      + 'It counts machine-written findings and misses human ones.');
  }

  // Titles are returned verbatim. Normalising on read is a parsing device; if it
  // leaks into what is displayed, --list starts quietly rewriting the operator's
  // own words back at them.
  const verbatim = found.find((f) => f.n === 5);
  if (verbatim?.title === `risk-guard matches the command text ${EM} not the write target`) {
    ok('the title comes back exactly as it was written, dashes and all');
  } else {
    bad(`normalisation leaked into the parsed title: ${JSON.stringify(verbatim?.title)}`);
  }

  const r = run(RETRO, tmp, ['--record', 'filed after the human ones', '--finding', 'observed something']);
  const after = fs.readFileSync(p, 'utf8');

  if (/^# Finding 6\b/m.test(after)) {
    ok('the next finding is numbered 6, after the two the human wrote');
  } else {
    bad(`--record numbered the new finding wrongly (${r.out.trim()}). Against a parser that cannot `
      + 'see U+2014 headings it writes a SECOND "# Finding 1" into a file that already has one.');
  }

  const humanHeadings = (after.match(new RegExp(`^# Finding [45] ${EM}`, 'gm')) ?? []).length;
  if (humanHeadings === 2) {
    ok('appending did not rewrite the human headings - normalisation happens on read only');
  } else {
    bad('the em dashes a human typed were replaced on disk. Normalising on READ is a parsing '
      + 'device; normalising on WRITE edits evidence nobody asked to be edited.');
  }
}

/* --- 6. a queue that cannot be read is unknown, not empty ------------- */
{
  // A plain file where the lessons directory belongs: readdir fails with
  // ENOTDIR on every platform, which is the portable stand-in for a directory
  // doctor is not allowed to list. `catch { return []; }` would report an empty
  // queue here - the one answer that is certainly wrong.
  const tmp = makeProject(); cleanup.push(tmp);
  fs.rmSync(path.join(tmp, PATHS.lessons), { recursive: true, force: true });
  fs.writeFileSync(path.join(tmp, PATHS.lessons), 'not a directory');

  const r = run(DOCTOR, tmp, []);
  if (/queued system changes NOT CHECKED/.test(r.out)) {
    ok('an unreadable lessons directory is reported as unknown, never as an empty queue');
  } else {
    bad('doctor reported nothing for a queue it could not read. "Could not check" is never a '
      + 'pass (invariant 5), and here it silences the only standing reminder of an unfixed problem.');
  }
  if (!/doctor crashed/.test(r.out)) {
    ok('and the rest of the report still runs');
  } else {
    bad('an unreadable lessons directory took doctor down with it');
  }
}

} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nretro check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\nretro check passed: the queue is read as a directory, and the writer and the parser agree.');

#!/usr/bin/env node
/**
 * The corpus library fingerprint: the writer that measures it, and the reader that
 * acts on it, each demonstrated against the broken build it must catch.
 *
 * WHY THE FINGERPRINT EXISTS. `doctor` keyed a corpus result on `recorded_for`
 * equalling the running plugin version. That catches a result carried across a
 * release and cannot catch the thing that actually happens: THE LIBRARY IS EDITED
 * INSIDE A VERSION. On 0.1.18, guardian's answer showed `q3v7k`'s FIXTURE was wrong
 * and `lib/auth.ts` was rewritten - the version string did not move, so a result
 * recorded before that edit would have satisfied the equality and been reported as
 * current evidence about a library it had never been run against. A version is a
 * DECLARED value that moves when someone decides to move it; a fingerprint is a
 * MEASURED one that moves when the graded inputs move.
 *
 * WHY THE READER IS IN THE SAME FILE AS THE WRITER, and why this file exists at
 * all: 0.1.20's fingerprint was specified as two halves on purpose. A recorded
 * field that nothing reads is not a weaker version of this check, it is its own
 * anti-pattern - it looks like evidence in the record, changes no outcome, and the
 * next reader assumes something acted on it. So P3, N5 and N6 assert `doctor`'s
 * behaviour, not the record's contents, and they are the half that makes the
 * writer's field mean anything.
 *
 * WHAT EACH CASE CATCHES, and the broken build it is written against:
 *
 *   P1  the shipped library hashes, and hashes    a fingerprint seeded with time or
 *       the same way twice                        randomness: doctor would FAIL on a
 *                                                 correct result and the relief
 *                                                 would be deleting the check
 *   P2  the writer stamps the MEASURED value      a writer stamping a constant, or
 *                                                 nothing at all
 *   P3  doctor is OK when they agree              a reader that FAILs on everything,
 *                                                 which would satisfy N5 and N6
 *                                                 while proving nothing
 *   N1  a CASE edit moves it                      a digest over file NAMES only
 *   N2  an EXPECTATION edit moves it              a digest over `cases/` only - the
 *                                                 edit that turns a failing case
 *                                                 green without touching one line
 *                                                 guardian will ever read
 *   N3  a rename moves it                         a digest over content only, paths
 *                                                 dropped
 *   N4  line endings alone do NOT move it         a raw-byte digest: it changes on
 *                                                 every CRLF checkout, so doctor
 *                                                 cries wolf and gets switched off
 *   N4b a real edit still moves it                normalisation that bought its
 *                                                 stability by going blind
 *   N5  doctor FAILs on a MISMATCH                0.1.19's doctor, which read the
 *                                                 version and nothing else
 *   N6  doctor FAILs on an ABSENT fingerprint,    a reader that collapses "no
 *       in text distinct from the mismatch        fingerprint" into "wrong
 *                                                 fingerprint" - different facts
 *                                                 with the same remedy today and
 *                                                 different ones tomorrow
 *   N7  `--library-fingerprint` is REFUSED        the flag missing from the refusal
 *                                                 list, so it is silently ignored
 *                                                 and the operator reads back the
 *                                                 value they asked for
 *   N8  the schema rejects a record with no       a field left optional, validated
 *       fingerprint                               only by the writer that wrote it
 *
 * HOW A BROKEN BUILD IS PRODUCED HERE. Two ways, both real rather than described.
 * For the hash itself, the named broken variants are IMPLEMENTED in this file and
 * run over the same two trees the real one sees; the demonstration is that the
 * assertion which passes against `libraryFingerprint` FAILS against them. For the
 * reader and the writer, an isolated copy of the plugin is mutated at source and
 * run - `mutate()` asserts its own edit landed, because a mutation that silently
 * did not apply produces a "broken build" identical to the real one, and then the
 * demonstration is of nothing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');

const state = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'state.mjs')).href);
const corpus = await import(pathToFileURL(path.join(PLUGIN, 'scripts', 'corpus-stage.mjs')).href);
const { libraryFingerprint, listCases, EXPECTATIONS, CORPUS_HOME } = corpus;

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(PLUGIN, 'templates', 'fixtures', 'selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const cleanup = [];
const tmpdir = (tag) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `mavci-fp-${tag}-`));
  cleanup.push(d);
  return d;
};

const CASES = listCases();
const HEX = /^sha256:[0-9a-f]{64}$/;

console.log('corpus library fingerprint:');
console.log(`  library: ${CASES.join(', ')}`);

/* ------------------------------------------------------------ the harness */

/**
 * An isolated copy of the plugin subtree. Mutations are applied to the COPY, so a
 * broken build is a real tree that really runs, and the repository is never edited
 * to test it - a library mutated in place and restored afterwards leaves the
 * library edited if anything in between throws.
 */
function pluginCopy(tag) {
  const dir = path.join(tmpdir(tag), 'mavci-core');
  fs.cpSync(PLUGIN, dir, { recursive: true });
  return dir;
}

/** Replace `from` with `to` in a file, and assert the edit actually landed. */
function mutate(file, from, to) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes(from)) {
    throw new Error(`mutation target not found in ${path.basename(file)}: ${from.slice(0, 60)}...\n`
      + 'The broken build was never built, so nothing below it demonstrates anything.');
  }
  fs.writeFileSync(file, src.replace(from, to));
}

/** The fingerprint as computed by an isolated copy whose corpus has been mutated. */
async function fingerprintOfMutatedLibrary(tag, mutateCorpus) {
  const dir = pluginCopy(tag);
  mutateCorpus(path.join(dir, 'templates', 'corpus'));
  const mod = await import(pathToFileURL(path.join(dir, 'scripts', 'corpus-stage.mjs')).href);
  return { fingerprint: mod.libraryFingerprint(), home: path.join(dir, 'templates', 'corpus') };
}

/* --------------------------------------------------- the broken variants */

/** Walk a corpus home the way the real implementation does. */
function files(home) {
  const out = [];
  const walk = (dir, prefix, filter) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.posix.join(prefix, e.name);
      if (e.isDirectory()) { walk(full, rel, filter); continue; }
      if (filter && !filter(e.name)) continue;
      out.push({ full, rel });
    }
  };
  walk(path.join(home, 'cases'), 'cases', null);
  walk(path.join(home, 'expected'), 'expected', (n) => n.endsWith('.json'));
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const norm = (p) => fs.readFileSync(p, 'utf8').split('\r\n').join('\n');

/** BROKEN: hashes the file names and not their contents. */
const brokenNamesOnly = (home) => sha(files(home).map((f) => f.rel).join('\n'));

/** BROKEN: hashes `cases/` and ignores the expectations - what "correct" means. */
const brokenCasesOnly = (home) => sha(files(home)
  .filter((f) => f.rel.startsWith('cases/'))
  .map((f) => `${f.rel}::${sha(norm(f.full))}`).join('\n'));

/** BROKEN: hashes content and drops the paths, so a rename is invisible. */
const brokenContentOnly = (home) => sha(files(home)
  .map((f) => sha(norm(f.full))).sort().join('\n'));

/** BROKEN: hashes raw bytes, so a CRLF checkout is a library change. */
const brokenRawBytes = (home) => sha(files(home)
  .map((f) => `${f.rel}::${crypto.createHash('sha256')
    .update(fs.readFileSync(f.full)).digest('hex')}`).join('\n'));

/* ------------------------------------------------------ positive controls */

const BASE = libraryFingerprint();

check(typeof BASE === 'string' && HEX.test(BASE),
  `P1 the shipped library hashes to sha256:<64 hex> (${BASE})`);
check(BASE === libraryFingerprint(),
  'P1 two calls over an unchanged library agree - the value is measured, not generated');

/**
 * P2 - the writer. A run is synthesised from each expectation, the way
 * check-corpus-writer.mjs does it, so this needs no edit when a case changes.
 */
function recordableProject() {
  const tmp = tmpdir('writer');
  fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian', 'records'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian', 'records'), { recursive: true });

  const runs = [];
  for (const id of CASES) {
    const exp = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS, `${id}.json`), 'utf8'));
    const wlId = `wl-${id}`;
    const sid = (i) => `s${String(i + 1).padStart(3, '0')}`;
    fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian', `${wlId}.json`),
      JSON.stringify({
        schema_version: 1,
        worklist_id: wlId,
        sites_total: exp.sites_total,
        questions: exp.expected_answers.map((a, i) => ({
          site_id: sid(i), path: a.path, line: 10 + i, table: 'orgs', value_identifier: a.match,
        })),
      }));
    fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian', 'records', `${wlId}.json`),
      JSON.stringify({
        schema_version: 1,
        worklist_id: wlId,
        verdict: exp.expected_verdict,
        fail_reason: exp.expected_fail_reason,
        answers: exp.expected_answers.map((a, i) => ({ site_id: sid(i), origin: a.origin })),
      }));
    runs.push({ caseId: id, worklistId: wlId });
  }
  return { tmp, runs };
}

const written = await (async () => {
  const { tmp, runs } = recordableProject();
  const rec = await state.recordCorpus(tmp, runs);
  check(rec.library_fingerprint === BASE,
    `P2 the writer stamps the measured fingerprint (${rec.library_fingerprint === BASE ? 'matches' : `${rec.library_fingerprint} vs ${BASE}`})`);
  check(rec.result === 'pass', `P2 the synthesised run records pass (got ${rec.result})`);
  return { tmp, rec };
})();

/* ---------------------------------------------------- the hash, and its misses */

// N1 - broken build: a digest over file names only.
{
  const target = path.join(CORPUS_HOME, 'cases');
  const first = files(CORPUS_HOME).find((f) => f.rel.startsWith('cases/'));
  const rel = path.relative(target, first.full);
  const { fingerprint, home } = await fingerprintOfMutatedLibrary('case-edit', (h) => {
    const p = path.join(h, 'cases', rel);
    fs.writeFileSync(p, `${fs.readFileSync(p, 'utf8')}\n// edited by check-corpus-fingerprint\n`);
  });
  check(fingerprint !== BASE, `N1 editing a case source moves the fingerprint (${first.rel})`);
  check(brokenNamesOnly(home) === brokenNamesOnly(CORPUS_HOME),
    'N1 DEMONSTRATION: the names-only digest does NOT move on that edit, so the assertion fails against it');
}

// N2 - broken build: a digest over cases/ only. This is the edit that turns a
// failing case green without touching a line guardian will ever read.
{
  const id = CASES[0];
  const { fingerprint, home } = await fingerprintOfMutatedLibrary('expectation-edit', (h) => {
    const p = path.join(h, 'expected', `${id}.json`);
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    doc.expected_answers[0].origin = 'request_input';
    fs.writeFileSync(p, JSON.stringify(doc, null, 2));
  });
  check(fingerprint !== BASE,
    `N2 editing an EXPECTATION moves the fingerprint (${id}: the pass criterion changed)`);
  check(brokenCasesOnly(home) === brokenCasesOnly(CORPUS_HOME),
    'N2 DEMONSTRATION: the cases-only digest does NOT move on that edit, so the assertion fails against it');
}

// N3 - broken build: content hashed, paths dropped.
{
  const first = files(CORPUS_HOME).find((f) => f.rel.startsWith('cases/'));
  const rel = path.relative(path.join(CORPUS_HOME, 'cases'), first.full);
  const { fingerprint, home } = await fingerprintOfMutatedLibrary('rename', (h) => {
    const p = path.join(h, 'cases', rel);
    fs.renameSync(p, path.join(path.dirname(p), `renamed-${path.basename(p)}`));
  });
  check(fingerprint !== BASE, 'N3 renaming a case file moves the fingerprint');
  check(brokenContentOnly(home) === brokenContentOnly(CORPUS_HOME),
    'N3 DEMONSTRATION: the content-only digest does NOT move on a rename, so the assertion fails against it');
}

// N4 - broken build: a raw-byte digest. The cost of getting this wrong is not a
// missed change, it is a check that FAILs on every Windows checkout of a correct
// result - and the cheapest relief for a check that cries wolf is switching it off.
{
  const { fingerprint, home } = await fingerprintOfMutatedLibrary('crlf', (h) => {
    for (const f of files(h)) {
      fs.writeFileSync(f.full, fs.readFileSync(f.full, 'utf8').split('\r\n').join('\n').split('\n').join('\r\n'));
    }
  });
  check(fingerprint === BASE,
    'N4 a CRLF checkout of the same library produces the same fingerprint');
  check(brokenRawBytes(home) !== brokenRawBytes(CORPUS_HOME),
    'N4 DEMONSTRATION: the raw-byte digest DOES move on line endings alone, so the assertion fails against it');

  // N4b - and the normalisation must not have bought that stability by going blind.
  const edited = await fingerprintOfMutatedLibrary('crlf-and-edit', (h) => {
    for (const f of files(h)) {
      const text = fs.readFileSync(f.full, 'utf8').split('\r\n').join('\n');
      fs.writeFileSync(f.full, `${text}\n// edited\n`.split('\n').join('\r\n'));
    }
  });
  check(edited.fingerprint !== BASE,
    'N4b a real content change still moves the fingerprint after normalisation');
}

/* ------------------------------------------------------- the reader: doctor */

const DOCTOR_LINES = {
  absent: 'names no case library',
  mismatch: 'graded a DIFFERENT case library',
  passed: 'guardian corpus passed for plugin',
};

function runDoctor(doctorPath, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [doctorPath], {
      cwd, input: '', encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
    });
    return stdout;
  } catch (err) {
    return err.stdout?.toString() ?? '';
  }
}

/** A project carrying a corpus result, with the fingerprint under test. */
function projectWithResult(fingerprint) {
  const tmp = tmpdir('reader');
  fs.mkdirSync(path.join(tmp, '.mavci', 'control'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  const doc = { ...written.rec };
  if (fingerprint === null) delete doc.library_fingerprint;
  else doc.library_fingerprint = fingerprint;
  fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian-corpus.json'),
    JSON.stringify(doc, null, 2));
  return tmp;
}

const REAL_DOCTOR = path.join(PLUGIN, 'scripts', 'doctor.mjs');

// P3 - the control. A reader that FAILed on everything would pass N5 and N6 while
// establishing nothing, so the agreeing case is asserted first.
{
  const out = runDoctor(REAL_DOCTOR, projectWithResult(BASE));
  check(out.includes(DOCTOR_LINES.passed),
    'P3 doctor reports the corpus as passed when the recorded fingerprint matches the library');
  check(!out.includes(DOCTOR_LINES.mismatch) && !out.includes(DOCTOR_LINES.absent),
    'P3 and it raises neither fingerprint FAIL on the matching case');
}

// N5 - broken build: doctor with the mismatch branch removed, which is 0.1.19's
// reader exactly - it compared the version and nothing else.
{
  const wrong = `sha256:${'0'.repeat(64)}`;
  const proj = projectWithResult(wrong);
  const real = runDoctor(REAL_DOCTOR, proj);
  check(real.includes(DOCTOR_LINES.mismatch) && real.includes(wrong),
    'N5 doctor FAILs on a fingerprint that disagrees, and prints both values');
  check(!real.includes(DOCTOR_LINES.passed),
    'N5 and it does not also report the corpus as passed');

  const broken = pluginCopy('no-mismatch-branch');
  mutate(path.join(broken, 'scripts', 'doctor.mjs'),
    '  if (rec.library_fingerprint !== fingerprint) {',
    '  if (false) {');
  const out = runDoctor(path.join(broken, 'scripts', 'doctor.mjs'), proj);
  check(!out.includes(DOCTOR_LINES.mismatch),
    'N5 DEMONSTRATION: with the mismatch branch removed the assertion fails - a result from '
    + 'another library reads as evidence about this one');
}

// N6 - broken build: a reader that collapses "no fingerprint" into "wrong
// fingerprint". Both are FAIL today; they are different facts, and a report that
// cannot say which one it saw is the defect finding 17 recorded one level out.
{
  const proj = projectWithResult(null);
  const real = runDoctor(REAL_DOCTOR, proj);
  check(real.includes(DOCTOR_LINES.absent),
    'N6 doctor FAILs on a result carrying no fingerprint at all');
  check(!real.includes(DOCTOR_LINES.mismatch),
    'N6 and it names the ABSENCE, distinctly from a disagreement');

  const broken = pluginCopy('absent-collapsed');
  mutate(path.join(broken, 'scripts', 'doctor.mjs'),
    '  if (!rec.library_fingerprint) {',
    '  if (false) {');
  const out = runDoctor(path.join(broken, 'scripts', 'doctor.mjs'), proj);
  check(!out.includes(DOCTOR_LINES.absent) && out.includes(DOCTOR_LINES.mismatch),
    'N6 DEMONSTRATION: with the absent branch disabled the two states report identically, '
    + 'and the assertion on telling them apart fails');
}

/* -------------------------------------------------- the writer, and its flag */

// N7 - broken build: the flag missing from the refusal list, so it is IGNORED. A
// silently ignored flag is worse than a refused one: the operator reads the record
// afterwards, sees the value they asked for because it happened to match, and never
// learns the flag did nothing.
{
  const { tmp, runs } = recordableProject();
  const flags = runs.flatMap((r) => ['--run', `${r.caseId}=${r.worklistId}`]);
  const args = ['--record-corpus', ...flags, '--library-fingerprint', `sha256:${'1'.repeat(64)}`];
  const corpusFile = path.join(tmp, '.mavci', 'control', 'guardian-corpus.json');

  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'state.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  check(r.status !== 0, `N7 --library-fingerprint is refused outright (exit ${r.status})`);
  check(/does not accept/.test(r.stderr ?? '') && /fingerprint/.test(r.stderr ?? ''),
    'N7 the refusal SAYS the fingerprint is computed, rather than dropping the flag in silence');
  check(!fs.existsSync(corpusFile), 'N7 nothing was written on the refused invocation');

  const broken = pluginCopy('flag-ignored');
  mutate(path.join(broken, 'scripts', 'state.mjs'),
    "          '--library-fingerprint', '--fingerprint']",
    ']');
  const b = spawnSync(process.execPath, [path.join(broken, 'scripts', 'state.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  const after = fs.existsSync(corpusFile)
    ? JSON.parse(fs.readFileSync(corpusFile, 'utf8')) : null;
  check(b.status === 0 && after !== null,
    'N7 DEMONSTRATION: with the flag unclassified the run is ACCEPTED, so the refusal assertion fails');
  check(after !== null && after.library_fingerprint === BASE,
    'N7 DEMONSTRATION: and the ignored flag left no trace in the record - the operator cannot '
    + 'tell from the file that the value they passed was discarded');
}

// N8 - broken build: the field left optional, so the only thing checking it is the
// writer that wrote it. The malformed record here is written BY HAND, past the
// writer, which is the point.
{
  const tmp = tmpdir('schema');
  fs.mkdirSync(path.join(tmp, '.mavci', 'control'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  const doc = { ...written.rec };
  delete doc.library_fingerprint;
  fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian-corpus.json'),
    JSON.stringify(doc, null, 2));

  const errs = state.validateAll(tmp).filter((e) => e.includes('guardian-corpus.json'));
  check(errs.some((e) => /library_fingerprint/.test(e)),
    'N8 the schema sweep rejects a corpus record with no fingerprint');

  const broken = pluginCopy('optional-field');
  mutate(path.join(broken, 'templates', 'schemas', 'guardian-corpus.schema.json'),
    '"recorded_for", "library_fingerprint",', '"recorded_for",');
  const bstate = await import(pathToFileURL(path.join(broken, 'scripts', 'state.mjs')).href);
  const berrs = bstate.validateAll(tmp).filter((e) => e.includes('guardian-corpus.json'));
  check(!berrs.some((e) => /library_fingerprint/.test(e)),
    'N8 DEMONSTRATION: with the field optional the same record validates clean, so the assertion fails');
}

/* ------------------------------------------------------------------ report */

console.log('');
if (failures.length) {
  console.log(`${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('corpus fingerprint: writer and reader both demonstrated against their broken builds.');
}

for (const d of cleanup) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
}

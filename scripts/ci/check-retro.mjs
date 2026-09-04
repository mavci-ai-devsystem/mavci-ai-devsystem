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

/* --- 7. --apply must not carry a finding into generated state ----------
 * gate5, 2026-09-03. The operator ran --apply and it reported success. The
 * lesson landed in ~/.claude/plugins/marketplaces/mavci/docs/lessons/ - the
 * marketplace clone, which propagation resets. Nothing was lost only because
 * --clear had not run yet, and the documented workflow is apply THEN clear.
 *
 * The clone was an accepted fallback BY DESIGN - systemRepo() listed it as a
 * candidate - and docs/lessons/0.1.18-the-clone-is-generated-state.md was
 * sitting in the very directory being written into. A recorded lesson, a
 * refusal already written at the !repo branch, and a shipped defect, all in
 * one file.
 *
 * THE ASSERTION IS A ROUND TRIP, NOT AN EXIT CODE. --apply exited 0 on the
 * broken build and the file existed - just in a directory that gets reset.
 * Asserting either passes on the bug. The property is WHERE it landed.
 */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mavci-clone-"));
  cleanup.push(tmp);

  // Only the clone carries the marker; the running checkout does not. That is
  // the shape of an agent invoking the plugin from ~/.claude/plugins/cache/,
  // where resolve(HERE, "..", "..", "..") lands in the cache root.
  const fakeClone = path.join(tmp, "marketplaces", "mavci");
  fs.mkdirSync(path.join(fakeClone, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(fakeClone, ".claude-plugin", "marketplace.json"), "{}");
  const fakeHere = path.join(tmp, "cache", "mavci", "mavci-core", "0.1.24", "scripts");
  fs.mkdirSync(fakeHere, { recursive: true });

  const target = retro.systemRepo({ here: fakeHere, clone: fakeClone });

  if (target === null) {
    ok("--apply refuses when the only candidate is the marketplace clone");
  } else {
    bad("--apply resolved a write target inside generated state (" + target + "). A finding "
      + "carried there is discarded by the next propagation, and --clear then destroys the "
      + "only durable copy. Refusing is correct: writing to a clone that will be reset looks "
      + "like success and the loss is invisible until someone goes looking.");
  }
}

/* --- 8. --amend: a correction is attributable, and nothing filed is edited ---
 * gate6 finding 12, 2026-09-04. `retro.mjs` stamps every finding it writes with
 * `Filed by:`; nothing adds to a finding already queued; so every addendum is a
 * hand edit, TYPOGRAPHICALLY IDENTICAL to writer-stamped text. Twelve such
 * blocks now sit in one queue file, and the blocks most likely to need amending
 * are the ones carrying a correction.
 *
 * THE ADJACENT ASSERTION THAT ALREADY EXISTS AND DOES NOT CATCH IT is anything
 * checking that --record stamps provenance. It does, correctly, on every finding
 * it writes - which is exactly why the gap is invisible: the defect is text that
 * never went through --record at all. So these assertions compare blocks WITHIN
 * a queue file for stamp presence, and never ask whether the writer stamps its
 * own output.
 *
 * The design is docs/retro-amend-design.md. Its two load-bearing answers:
 *   Q1  an amendment APPENDS a dated block and never replaces a filed byte -
 *       A3 and A4 are a pair, because a tail-appender passes A3 alone.
 *   Q2  an amendment carries its OWN provenance, from the caller at amend time,
 *       never inherited from the finding - A2 fails an inheriting build.
 *
 * WHAT THIS SECTION CANNOT ESTABLISH, said here rather than discovered later:
 * `run()` uses execFileSync, which does not go through a shell, so no assertion
 * here can reproduce a shell eating backticked words - which is how finding 16
 * lost four of them on the way into --record. A7 asserts the door prose could
 * come through is SHUT; the loss itself happened upstream of retro.mjs and is
 * not observable from inside this repository.
 */
{
  const tmp = makeProject(); cleanup.push(tmp);
  const STAMP = 'Filed by: **main** (agent). Provenance enforced at the risk guard, not self-declared.';

  // A quotable sentence with awkward internal spacing, so that a --was quote
  // re-wrapped by whoever copied it still has to resolve against it.
  const QUOTABLE = 'the corpus can only be run on a project that has no service-role sites of its own';

  const queue = [
    '# Queued for the next system release',
    '',
    retro.findingHeading(1, 'the first one, filed by the writer'),
    '',
    'Filed: 2026-09-04T10:00:00Z, plugin 0.1.30.',
    '',
    STAMP,
    '',
    'Body of finding 1, and it must survive this section byte for byte.',
    '',
    // A HAND-WRITTEN addendum, positional form, carrying no stamp. This is the
    // broken build A8 must see: twelve of these are in the real queue and a
    // reader that only recognises what this writer writes reports none of them.
    '### Addendum ' + EM + ' written by hand, at the operator\'s direction',
    '',
    'Added 2026-09-04. No stamp, because there was no --amend.',
    '',
    retro.findingHeading(2, 'the one that gets amended'),
    '',
    'Filed: 2026-09-04T11:00:00Z, plugin 0.1.30.',
    '',
    STAMP,
    '',
    `MEASURED on gate6 today: ${QUOTABLE}, and that is the whole finding.`,
    '',
    retro.findingHeading(3, 'the one after it, which must not move or change'),
    '',
    'Filed: 2026-09-04T12:00:00Z, plugin 0.1.30.',
    '',
    STAMP,
    '',
    'Body of finding 3.',
    '',
  ].join('\n');

  const qp = path.join(tmp, retro.PENDING);
  fs.writeFileSync(qp, queue);
  const before = fs.readFileSync(qp, 'utf8');

  // The blocks that must survive verbatim, sliced from the fixture itself
  // rather than retyped: a retyped expectation goes green when the writer and
  // the expectation drift together, which is 0.1.13's shape.
  const block = (n) => {
    const start = before.indexOf(retro.findingHeading(n, '').replace(/\s+$/, ''));
    const next = before.indexOf('\n# Finding ', start + 1);
    return before.slice(start, next === -1 ? before.length : next);
  };
  const BLOCK1 = block(1);
  const BLOCK2 = block(2);
  const BLOCK3 = block(3);

  const textFile = path.join(tmp, 'amend-text.md');
  fs.writeFileSync(textFile,
    'THE BODY ABOVE IS TOO WIDE. There are two variants, not one, and only the\n'
    + 'second depends on the scanner blind spot.\n');

  // The same sentence, re-wrapped across lines the way anyone quoting it would
  // wrap it. A naive `includes` fails this; comparing on a whitespace-collapsed
  // COPY passes it, which is what the design specifies.
  const wasFile = path.join(tmp, 'amend-was.md');
  fs.writeFileSync(wasFile, QUOTABLE.replace(' project ', '\nproject\n'));

  const wrongWasFile = path.join(tmp, 'amend-was-wrong.md');
  fs.writeFileSync(wrongWasFile, 'words that appear nowhere in finding 2 at all');

  /* A1 - the verb exists and writes */
  const r1 = run(RETRO, tmp, ['--amend', '2', '--title', 'the filed claim was too wide',
    '--text', textFile, '--was', wasFile, '--agent', 'mavci-scribe']);
  const after = fs.readFileSync(qp, 'utf8');
  if (r1.status === 0 && after.length > before.length && /^###\s+Addendum to finding 2\b/mi.test(after)) {
    ok('--amend appends an addendum block to a queued finding');
  } else {
    bad('--amend did not append an addendum block (status ' + r1.status + '): ' + r1.out.trim().split('\n')[0]
      + '. Today retro.mjs has five commands and none of them adds to a finding already queued, so '
      + 'every addendum is a hand edit with no stamp - twelve of them in one queue.');
  }

  /* A2 - the amendment carries ITS OWN provenance, not the finding's.
   * The cheap fix finding 12 names by name is an --amend with no attribution;
   * the subtler wrong build inherits the finding's stamp, which would report
   * every operator-directed correction in the real queue as agent-authored. The
   * fixture separates them: finding 2 is filed by `main`, amended by
   * `mavci-scribe`, and only the amender may appear in the amendment block. */
  const amendBlock = (() => {
    const i = after.search(/^###\s+Addendum to finding 2\b/mi);
    if (i === -1) return null;
    const j = after.indexOf('\n# Finding ', i);
    return after.slice(i, j === -1 ? after.length : j);
  })();
  if (amendBlock && /amended by/i.test(amendBlock) && amendBlock.includes('mavci-scribe')) {
    ok('the amendment carries its own attribution, naming the caller that amended');
  } else {
    bad('the amendment block carries no attribution of its own: ' + JSON.stringify(amendBlock?.slice(0, 120) ?? null)
      + '. Adding --amend without the stamp satisfies the letter of finding 12 and leaves the queue '
      + 'exactly as unreadable; inheriting the finding\'s stamp reports an operator\'s correction of '
      + 'an agent\'s finding as agent-authored.');
  }

  /* A2b - and its own TIME and PLUGIN VERSION, which are the other half of it.
   *
   * Added because a mutation found the gap: stripping `Amended <iso>, plugin
   * <v>.` from the stamp and leaving `Amended by: **mavci-scribe**` behind left
   * A2 GREEN. Attribution alone is not the answer to "does an amendment carry
   * its own provenance" - finding 18 was filed on 0.1.28 and corrected minutes
   * later against evidence from the 0.1.27 run, and one stamp cannot carry two
   * versions. A build that inherits the finding's `Filed:` line would look
   * right on every same-day amendment and be wrong on exactly the ones that
   * matter. */
  const version = state.pluginVersion();
  if (amendBlock && /^Amended \d{4}-\d{2}-\d{2}T[\d:.]+Z, plugin /m.test(amendBlock)
      && amendBlock.includes(version)) {
    ok('and its own timestamp and plugin version, not the finding\'s');
  } else {
    bad('the amendment carries no time or plugin version of its own (expected plugin ' + version
      + '): ' + JSON.stringify(amendBlock?.slice(0, 160) ?? null)
      + '. A correction is a later measurement than the finding it corrects, and the pair is only '
      + 'readable if both stamps are there.');
  }

  /* A3 - nothing filed is edited. Every block from before appears verbatim.
   *
   * THE GROWTH CLAUSE IS NOT DECORATION. Written without it, this assertion went
   * GREEN against a build with no --amend at all: a file nothing wrote to has
   * every block intact, so it could not tell a writer that appends from one that
   * replaces from one that does nothing. That is the same shape as 0.1.23's M5 -
   * satisfied by the wrong arm - and it is caught here only because the
   * assertion was run against the broken build before the fix was written. */
  const survived = [BLOCK1, BLOCK2, BLOCK3].filter((b) => b && after.includes(b));
  if (survived.length === 3 && after.length > before.length) {
    ok('every filed block survives the amendment byte for byte - nothing was replaced');
  } else if (after.length <= before.length) {
    bad('nothing was written, so "nothing was replaced" establishes nothing. This assertion is '
      + 'paired with A1 on purpose: it discriminates a replacing writer from an appending one only '
      + 'once there IS a writer.');
  } else {
    bad('an amendment rewrote filed text: ' + (3 - survived.length) + ' of 3 blocks no longer appear '
      + 'verbatim. --apply copies the queue into docs/lessons/ as the permanent record, and a '
      + 'replacement leaves nothing saying the finding was ever filed at the wrong width.');
  }

  /* A4 - and it sits with what it amends. Paired with A3 deliberately: a build
   * that appends at the end of the FILE passes A3 and fails this. Four of the
   * twelve hand-written blocks did exactly that, and later findings were then
   * appended after them, so the addenda to findings 17, 20 and 22 now sit
   * buried inside other findings' blocks. */
  const iAmend = after.search(/^###\s+Addendum to finding 2\b/mi);
  const iF2 = after.indexOf(retro.findingHeading(2, 'the one that gets amended'));
  const iF3 = after.indexOf(retro.findingHeading(3, 'the one after it, which must not move or change'));
  if (iAmend > iF2 && iF3 > iAmend) {
    ok('the amendment is inserted inside its target finding\'s block, not at the end of the file');
  } else {
    bad(`the amendment landed outside finding 2's block (amend@${iAmend}, f2@${iF2}, f3@${iF3}). `
      + 'A tail-appended addendum drifts away from what it amends as later findings are filed, '
      + 'which is how three of the real queue\'s addenda ended up hundreds of lines from their target.');
  }

  /* A5b - a quote that DOES occur resolves, even re-wrapped. Written before A5a
   * and asserted separately, because a build that refuses every --was satisfies
   * the refusal alone. */
  if (amendBlock && /service-role sites of its own/.test(amendBlock)) {
    ok('a --was quote that occurs in the finding is accepted and reproduced, re-wrapping and all');
  } else {
    bad('a --was quote copied verbatim from the finding was not carried into the amendment. '
      + 'Comparing raw bytes rejects a quote anyone re-wrapped; the comparison belongs on a '
      + 'whitespace-collapsed copy, never on disk.');
  }

  /* A5a - and a quote that does not occur is refused, with nothing written.
   * Finding 17's shape: a citation that does not resolve is stored exactly like
   * one that does. */
  const beforeBad = fs.readFileSync(qp, 'utf8');
  const r5 = run(RETRO, tmp, ['--amend', '2', '--title', 'a quote that resolves to nothing',
    '--text', textFile, '--was', wrongWasFile]);
  // THE REASON, NOT ONLY THE DECISION. Without the second clause this passed
  // against a build with no --amend, which refuses everything by printing usage
  // and exiting 2 - refused by the wrong arm, with the wrong message, which is
  // 0.1.23's M5. Decision and reason are two facts and only the reason
  // discriminates a resolving citation check from a missing command.
  const refusedForTheQuote = /does not (appear|occur)|not found in finding|no such text/i.test(r5.out);
  if (r5.status !== 0 && refusedForTheQuote && fs.readFileSync(qp, 'utf8') === beforeBad) {
    ok('a --was quote that does not occur in the finding is refused, and the refusal says so');
  } else {
    bad(`--amend stored a superseded quote that appears nowhere in finding 2 (status ${r5.status}). `
      + 'A citation that does not resolve is then stored exactly like one that does, and no reader '
      + 'downstream can tell them apart.');
  }

  /* A5c - and it resolves against the finding's BODY, not against an earlier
   * amendment sitting in the same block.
   *
   * Added because a mutation found the gap: widening the search to the whole
   * block left every other assertion green, since A5b's quote is in the body and
   * A5a's is nowhere. The claim was in the design and asserted by nothing. It
   * matters because an amendment QUOTES the words it supersedes - so once one
   * amendment exists, a block-wide search resolves a second amendment's citation
   * against the first amendment's copy of it, and reports a quote as coming from
   * the body when the body may no longer be the place it occurs. */
  const onlyInAmendment = path.join(tmp, 'amend-was-echo.md');
  fs.writeFileSync(onlyInAmendment, 'THE BODY ABOVE IS TOO WIDE');   // written by A1's --text, not by the finding
  const beforeEcho = fs.readFileSync(qp, 'utf8');
  const r5c = run(RETRO, tmp, ['--amend', '2', '--title', 'quoting the previous amendment',
    '--text', textFile, '--was', onlyInAmendment]);
  if (r5c.status !== 0 && fs.readFileSync(qp, 'utf8') === beforeEcho) {
    ok('a --was quote that occurs only in an earlier amendment does not count as the body');
  } else {
    bad(`--amend resolved a superseded quote against an earlier amendment (status ${r5c.status}). `
      + 'The block says the words are quoted verbatim from the body above; a block-wide search makes '
      + 'that sentence false as soon as one amendment exists, and each amendment then vouches for '
      + 'the next.');
  }

  /* A6 - a provenance edit is refused BY NAME, with the reason.
   * Finding 23 is the live case: it is the one body in the real queue reading
   * `Filed by: not recorded`, and stamping it after the fact is a claim about
   * who wrote it, not a text correction. The refusal has to be findable, or the
   * next person reads the absence as a gap and builds it. */
  const beforeProv = fs.readFileSync(qp, 'utf8');
  const r6 = run(RETRO, tmp, ['--amend', '2', '--title', 'restamp it',
    '--text', textFile, '--filed-by', 'main']);
  const said = /authorship|who wrote|provenance|attribut/i.test(r6.out);
  if (r6.status !== 0 && said && fs.readFileSync(qp, 'utf8') === beforeProv) {
    ok('--amend refuses a provenance edit explicitly, and says why');
  } else {
    bad(`--amend did not refuse a retroactive attribution edit with a reason (status ${r6.status}): `
      + JSON.stringify(r6.out.trim().slice(0, 140))
      + '. Silently not supporting one leaves a gap the next person fills; the refusal IS the record '
      + 'of the decision that correcting text and asserting authorship are different acts.');
  }

  /* A7 - prose does not come in through an argument. */
  const beforeInline = fs.readFileSync(qp, 'utf8');
  const r7 = run(RETRO, tmp, ['--amend', '2', '--title', 'inline prose',
    '--text', 'this is prose, not a path, and it names `blocked` and `done`']);
  // Again the reason rather than the decision, and again because the loose form
  // went green against a build with no --amend: the usage banner contains the
  // words "file", "path" and every flag name, so "it refused and mentioned a
  // file" is satisfied by a command that does not exist.
  const explained = !/^usage: retro\.mjs/m.test(r7.out)
    && /--text/.test(r7.out) && /(file|stdin)/i.test(r7.out);
  if (r7.status !== 0 && explained && fs.readFileSync(qp, 'utf8') === beforeInline) {
    ok('--text takes a path or stdin and refuses inline prose, naming why');
  } else {
    bad(`--amend accepted prose as a --text argument (status ${r7.status}). On 2026-09-04 finding 16 `
      + 'reached the queue through --record having lost four backticked words to shell command '
      + 'substitution - `blocked` twice, `done` and `failed` once each, one of them the exact word '
      + 'the finding is about, and two of the gaps left grammatical sentences.');
  }

  /* A8 - the READER sees hand-written blocks too, and reports which carry no
   * stamp. This is finding 12's own demand: compare blocks WITHIN a file for
   * stamp presence, rather than verify the writer stamps what it writes. The
   * fixture holds one hand-written unstamped addendum and one this tool wrote. */
  if (typeof retro.parseAmendments === 'function') {
    const found = retro.parseAmendments(fs.readFileSync(qp, 'utf8'));
    const forOne = found.filter((a) => a.finding === 1);
    const forTwo = found.filter((a) => a.finding === 2);
    if (forOne.length === 1 && forOne[0].stamped === false && forTwo.length === 1 && forTwo[0].stamped === true) {
      ok('the reader finds hand-written and tool-written addenda alike, and says which carry no stamp');
    } else {
      // If one of the refusal arms above failed, it wrote an amendment it should
      // have refused, and this count moves with it. Read the reds in order: this
      // one is the reader's only when nothing above it is red.
      bad('the amendment reader mis-read the queue: ' + JSON.stringify(found.map((a) => [a.finding, a.stamped]))
        + '. Expected one unstamped block on finding 1 (hand-written, positional form) and one stamped '
        + 'on finding 2. A reader that only recognises what this writer writes reports none of the '
        + 'twelve real hand blocks, which is 0.1.13 exactly.');
    }
  } else {
    bad('retro.mjs exports no amendment reader, so nothing can compare blocks within a queue file for '
      + 'stamp presence - which is the assertion finding 12 asks for by name. A check that reimplemented '
      + 'the format would be the second reader that produced 0.1.13.');
  }
  const l8 = run(RETRO, tmp, ['--list']);
  // THE COUNT, NOT THE WORD. Matching /unstamped/i went green against a reader
  // blind to the hand-written form, because the per-finding line prints
  // "0 unstamped" for the block this writer had just stamped - the word was
  // there and the fact was not. Refused-by-the-wrong-arm, one more time, in an
  // assertion written in the same pass that named the pattern.
  if (/[1-9]\d* UNSTAMPED/.test(l8.out)) {
    ok('--list surfaces that a queued finding carries an unstamped addendum');
  } else {
    bad('--list does not report unstamped addenda. Appending rather than replacing means a reader who '
      + 'reads the body and stops acts on the uncorrected claim; the index is where that is closed, '
      + 'because nothing may write into the body to announce it.');
  }

  /* A9 - the queue is a directory, and --amend 2 can mean two things.
   * The --clear precedent: a name is required whenever more than one file could
   * be meant, and amending the wrong file's finding 2 is silent. */
  const second = queuedPath(tmp, 'pending-system-change-0.1.29.md');
  fs.writeFileSync(second, [
    '# Queued', '', retro.findingHeading(2, 'a different finding 2, in another queued file'),
    '', 'Filed: 2026-09-03T09:00:00Z, plugin 0.1.29.', '', STAMP, '', 'Body.', '',
  ].join('\n'));
  const beforeAmbig = fs.readFileSync(qp, 'utf8');
  const secondBefore = fs.readFileSync(second, 'utf8');
  const r9 = run(RETRO, tmp, ['--amend', '2', '--title', 'ambiguous', '--text', textFile]);
  const untouched = fs.readFileSync(qp, 'utf8') === beforeAmbig && fs.readFileSync(second, 'utf8') === secondBefore;
  if (r9.status !== 0 && untouched && r9.out.includes('pending-system-change-0.1.29.md')) {
    ok('--amend refuses when two queued files hold the finding, and names them both');
  } else {
    bad(`--amend picked one of two queued files holding finding 2 without being told which (status ${r9.status}). `
      + 'That is --clear\'s finding one verb along: the queue is a directory, and choosing silently puts '
      + 'the correction on the wrong finding.');
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

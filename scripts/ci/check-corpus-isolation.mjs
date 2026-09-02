#!/usr/bin/env node
/**
 * The corpus's isolation, asserted structurally rather than by convention.
 *
 * THE RULE THIS FILE EXISTS TO SATISFY: name the broken build the assertion must
 * catch, then confirm the assertion fails against it. The broken build here is not
 * hypothetical - it is the layout this repository shipped through 0.1.17, and it
 * failed on its first real run.
 *
 * WHAT WENT WRONG, so nobody reinstates it. `corpus/expected/` sat inside the
 * project, one directory away from the fixtures it graded, and that was filed as a
 * known compromise: "out of the way, not out of reach. No in-repo location is
 * unreadable." Scoring case t5w9d on 0.1.17, guardian traced the identifier
 * `scopeId`, grepped the project for it, and `corpus/expected/t5w9d.json` matched.
 * The matching line carried the expected `origin` on the same line as the search
 * term, and the line above it stated in prose which answers count as failures.
 * Guardian disclosed this unprompted and said its classification came from the
 * source files - which is the correct behaviour, and is also exactly the kind of
 * self-report this system refuses to trust anywhere else. t5w9d produced its
 * expected origin, and the run stopped being evidence of the only thing that case
 * exists to establish.
 *
 * So the assertion is not "the expectations are hard to find". It is:
 *
 *   THE EXPECTATIONS ARE NOT IN THE PROJECT AT ALL.
 *
 * A string search over a project that still contains them is the assertion to
 * avoid: it passes the moment someone rewords an expectation, and it would have
 * passed on 0.1.17 for any identifier other than the one guardian happened to
 * grep for. Structure is checkable; wording is not.
 *
 * THE THREE ASSERTIONS, and why none is covered by the one before it:
 *
 *   POSITIVE  a real stage happened            without it, every negative below is
 *                                              satisfied by staging nothing at all
 *   N1        no expectation document under    the structural property
 *             the project root
 *   N2        no identifier in an expectation  reproduces the RECORDED INCIDENT:
 *             reaches a file carrying an       `scopeId` -> t5w9d.json. Catches a
 *             origin, by grep from the         layout that moved the expectations
 *             project root                     somewhere N1 does not look
 *   N3        no marker names the staged case  the old staging wrote
 *                                              corpus/current-case.txt, which told
 *                                              a reader which case was running
 *
 * TWO DEFECTS IN THIS PROBE, both found after it had already reported green. They
 * are recorded here and not only beside the lines they touch, because the next
 * person to open this file will be someone shortening it.
 *
 *   1. IT STOPPED AT THE FIRST MATCH. `identifierLeaks` used to stop scanning a
 *      file once one identifier reached it. Against the recorded incident it
 *      reported `org_id -> corpus/expected/t5w9d.json` and never mentioned
 *      `scopeId` - the identifier guardian actually grepped for. The probe was
 *      green, the leak was real, and the report could not be checked against the
 *      incident it exists to reproduce. A PROBE THAT STOPS AT THE FIRST MATCH
 *      CANNOT REPRODUCE THE INCIDENT IT EXISTS FOR: naming an arbitrary one of the
 *      reaching identifiers asserts the SHAPE of a leak and not its IDENTITY,
 *      which is the same defect as asserting a process exited non-zero rather than
 *      asserting the reason it printed. This repository has now shipped that shape
 *      three times. Report every hit. Nothing here is hot enough to optimise, and
 *      the loop is not the place to save the time.
 *
 *   2. IT FLAGGED THE STAGE ITSELF. The staged tree is the input guardian is
 *      handed, not a leak. `corpus-run/lib/context.ts` carries `scopeId` on line 1
 *      and `as unknown as` on line 7, and the first version called that an
 *      identifier reaching an origin. The fix that suggests itself - a
 *      character-distance threshold, since those two sit about 300 apart and a real
 *      expectation pairs them within about 40 - is fitted to this one case and
 *      breaks the moment an expectation is printed differently. The fix is the
 *      principle, recorded at the line that implements it: a leak is something
 *      OUTSIDE the stage that associates an identifier with an origin.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const STAGE_MOD = path.join(ROOT, 'plugins/mavci-core/scripts/corpus-stage.mjs');

const { stageCase, listCases, EXPECTATIONS, STAGE_DIR } =
  await import(pathToFileURL(STAGE_MOD).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

/** The closed set of origin strings. A file carrying one is a file carrying an answer. */
const ORIGINS = ['verified_session', 'internal_constant', 'derived_verified', 'request_input', 'unknown'];

/** Every file under `root`, skipping only what is never authored content. */
function* walk(root) {
  const skip = new Set(['.git', 'node_modules', '.next']);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { yield* walk(full); continue; }
    yield full;
  }
}

function readTextOrNull(p) {
  try {
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) return null;          // binary
    return buf.toString('utf8');
  } catch { return null; }
}

/* -------------------------------------------------------- the three probes */

/** N1: is any file under `root` an expectation document? */
function expectationDocsUnder(root) {
  const hits = [];
  for (const f of walk(root)) {
    const text = readTextOrNull(f);
    if (text === null) continue;
    if (text.includes('expected_answers') || text.includes('expected_fail_reason')) {
      hits.push(path.relative(root, f));
    }
  }
  return hits;
}

/**
 * N2: the recorded incident. For each identifier an expectation quotes, grep the
 * project the way guardian did and report any hit in a file that also carries an
 * origin string - i.e. a file that would hand the reader the answer.
 */
function identifierLeaks(root, expectation) {
  const identifiers = new Set();
  for (const a of expectation.expected_answers ?? []) {
    for (const m of String(a.match ?? '').matchAll(/[A-Za-z_$][\w$.]{2,}/g)) identifiers.add(m[0]);
  }
  const leaks = [];
  for (const f of walk(root)) {
    // THE STAGED TREE IS NOT A LEAK. It is the input guardian is handed and meant to
    // read; a case source pairing an identifier with the word `unknown` is a
    // TypeScript type annotation, not an answer. The first version of this probe
    // flagged corpus-run/lib/context.ts for exactly that - `scopeId` on line 1 and
    // `as unknown as` on line 7 - and the fix is the principle, not a proximity
    // threshold tuned until the false positive stops. Character distance would have
    // separated those two by about 300 and separated a real expectation by about 40,
    // and a threshold in between would have been fitted to this one case and would
    // break the moment an expectation is pretty-printed differently. A leak is
    // something OUTSIDE the stage that associates an identifier with an origin.
    if (path.relative(root, f).split(path.sep)[0] === STAGE_DIR) continue;
    const text = readTextOrNull(f);
    if (text === null) continue;
    if (!ORIGINS.some((o) => text.includes(o))) continue;   // carries no answer
    // EVERY identifier that reaches the file, not the first one. Stopping at the
    // first hit reported `org_id` for the recorded incident and hid that `scopeId`
    // reached the same file - which is the identifier guardian actually grepped for.
    // A leak report that names an arbitrary one of the reaching identifiers cannot
    // be checked against the incident it is supposed to reproduce.
    for (const id of identifiers) {
      if (text.includes(id)) leaks.push({ file: path.relative(root, f), identifier: id });
    }
  }
  return leaks;
}

/** N3: does anything under `root` name the staged case? */
function markersNaming(root, caseId) {
  const hits = [];
  for (const f of walk(root)) {
    if (path.relative(root, f).split(path.sep)[0] === STAGE_DIR) continue;  // the stage itself is the run
    const text = readTextOrNull(f);
    if (text === null) continue;
    if (text.includes(caseId)) hits.push(path.relative(root, f));
  }
  return hits;
}

/* ------------------------------------------------------------------- setup */

const CASE_ID = 't5w9d';                       // the case the incident was recorded against
const cases = listCases();
check(cases.includes(CASE_ID),
  `the library still carries ${CASE_ID}, the case the recorded leak fired on (found: ${cases.join(', ') || 'none'})`);

const expectation = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS, `${CASE_ID}.json`), 'utf8'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-corpus-iso-'));
const project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });

const staged = stageCase(project, CASE_ID);

/* ------------------------------------------------------ POSITIVE, and first */

check(staged.length > 0,
  `POSITIVE: a real stage happened - ${staged.length} file(s) under ${STAGE_DIR}/. `
  + 'Without this, staging nothing would satisfy every negative below');
check(staged.every((p) => p.startsWith(`${STAGE_DIR}/`)),
  'POSITIVE: everything staged landed inside the staging directory and nowhere else');
check(fs.existsSync(path.join(project, STAGE_DIR, 'app/api/summary/route.ts')),
  'POSITIVE: the case source is present as a real .ts file, with the .txt suffix stripped');

/* ------------------------------------------------------------- N1, N2, N3 */

const docs = expectationDocsUnder(project);
check(docs.length === 0,
  `N1 no expectation document exists anywhere under the project root (found: ${docs.join(', ') || 'none'})`);

const leaks = identifierLeaks(project, expectation);
check(leaks.length === 0,
  'N2 no identifier an expectation quotes reaches a file carrying an origin string '
  + `(found: ${leaks.map((l) => `${l.identifier} -> ${l.file}`).join(', ') || 'none'})`);

const markers = markersNaming(project, CASE_ID);
check(markers.length === 0,
  `N3 nothing outside the stage names the staged case (found: ${markers.join(', ') || 'none'})`);

/* ---------------------------------------------- THE BROKEN BUILD, RUN HERE
 *
 * Reconstruct the 0.1.17 layout inside the same temp project and confirm each
 * assertion FAILS against it. An assertion that has only been seen passing is not
 * coverage, and this is the file whose whole subject is a probe that was green
 * while the thing it claimed to prove was compromised.                        */

const brokenExpected = path.join(project, 'corpus', 'expected');
fs.mkdirSync(brokenExpected, { recursive: true });
fs.writeFileSync(path.join(brokenExpected, `${CASE_ID}.json`), JSON.stringify(expectation, null, 2));
fs.mkdirSync(path.join(project, 'corpus'), { recursive: true });
fs.writeFileSync(path.join(project, 'corpus', 'current-case.txt'), `${CASE_ID}\n`);

const brokenDocs = expectationDocsUnder(project);
check(brokenDocs.length > 0,
  `N1 DEMONSTRATED FAILING against the 0.1.17 layout: ${brokenDocs.join(', ')}`);

const brokenLeaks = identifierLeaks(project, expectation);
check(brokenLeaks.some((l) => l.file.includes('expected')),
  'N2 DEMONSTRATED FAILING against the 0.1.17 layout, reproducing the recorded incident: '
  + `${brokenLeaks.map((l) => `${l.identifier} -> ${l.file}`).join(', ') || 'nothing found'}`);
check(brokenLeaks.some((l) => l.identifier === 'scopeId'),
  'N2 and the identifier that reaches it is scopeId - the exact one guardian grepped for on 0.1.17');

const brokenMarkers = markersNaming(project, CASE_ID);
check(brokenMarkers.some((m) => m.includes('current-case')),
  `N3 DEMONSTRATED FAILING against the 0.1.17 layout: ${brokenMarkers.join(', ')}`);

/* --------------------------------- N2 EARNS ITS PLACE, on a second broken build
 *
 * N1 finds an expectation by its key names. If that were the whole assertion, a
 * leak written in prose would pass it - and prose is the likelier accident: a note
 * left in a README while debugging a case, not a JSON document someone deliberately
 * moved. This build carries no `expected_*` key anywhere, so N1 accepts it, and N2
 * must not.                                                                     */

const secondBroken = path.join(tmp, 'project-prose');
fs.mkdirSync(path.join(secondBroken, 'notes'), { recursive: true });
for (const rel of staged) {
  const to = path.join(secondBroken, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(project, rel), to);
}
fs.writeFileSync(path.join(secondBroken, 'notes', 'corpus-hints.md'),
  '# scratch notes\n\nscopeId comes from the request store, so the origin is unknown.\n');

const proseDocs = expectationDocsUnder(secondBroken);
const proseLeaks = identifierLeaks(secondBroken, expectation);
check(proseDocs.length === 0,
  'N1 ACCEPTS the prose build - no expectation document, which is why N2 is a separate assertion');
check(proseLeaks.some((l) => l.file.includes('corpus-hints')),
  'N2 DEMONSTRATED FAILING on the prose build that N1 accepts: '
  + `${proseLeaks.map((l) => `${l.identifier} -> ${l.file}`).join(', ') || 'nothing found'}`);

/* ---------------------------------------------------------------- teardown */

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.log(`corpus isolation check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus isolation: the expectations are outside the project, and all three');
console.log('assertions were demonstrated failing against the layout that shipped in 0.1.17.');

#!/usr/bin/env node
/**
 * The corpus's DETERMINISTIC half.
 *
 * Whether guardian answers each case correctly needs a model and is an
 * operator-run acceptance test. But most of what can go wrong with a corpus needs
 * no model at all, and all of it is checkable here:
 *
 *   - the two controls exist. A corpus without a degenerate-pass case cannot tell a
 *     discriminating guardian from one that always finds something; a corpus without
 *     an `unknown` case never exercises the answer a real project produces most.
 *   - every case actually enumerates the sites its expected answers name. An
 *     expectation for a site the scan does not produce is an expectation guardian
 *     will never be asked about - it would sit in the file looking like coverage.
 *   - every expected origin is in the closed enum.
 *   - the externally-sourced case is still marked, and still the only one.
 *
 * That last assertion is deliberately awkward. It fails the moment someone adds a
 * second `external` case, which forces a conscious edit to `corpus/README.md`'s
 * claim rather than letting the corpus quietly grow more authoritative than it is.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CORPUS = path.join(ROOT, 'plugins/mavci-core/templates/corpus');
const CASES = path.join(CORPUS, 'cases');
const EXPECTED = path.join(CORPUS, 'expected');

const { scanProject, worklistFrom } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/sitescan.mjs')).href);
const { ORIGIN } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/coverage.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

function filesUnder(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

console.log('guardian acceptance corpus:');

const caseDirs = fs.readdirSync(CASES).filter((d) => fs.statSync(path.join(CASES, d)).isDirectory()).sort();
check(caseDirs.length >= 3, `corpus has at least the three required cases (${caseDirs.length})`);

/* THE EXPECTATION IS NO LONGER IN THE CASE DIRECTORY, and that is the point of the
 * move rather than a tidy-up. It used to sit beside the fixture it graded, so the
 * answer travelled with the case into whatever tree the case was staged into - and on
 * 0.1.17 guardian grepped an identifier and hit it. Expectations now live in a sibling
 * directory and staging copies only `*.txt` sources, so no expectation can reach a
 * project. scripts/ci/check-corpus-isolation.mjs asserts that structurally.
 *
 * The sources carry a `.txt` suffix and the expectations name paths under
 * `corpus-run/`, because that is what a STAGED case looks like. This check
 * reconstructs the staged shape rather than the library shape, so the paths it
 * validates are the paths a real run actually produces. */
const STAGE_PREFIX = 'corpus-run/';
const SUFFIX = '.txt';

const loaded = [];
for (const id of caseDirs) {
  const dir = path.join(CASES, id);
  const expPath = path.join(EXPECTED, `${id}.json`);
  if (!fs.existsSync(expPath)) {
    bad(`${id}: no expectation at templates/corpus/expected/${id}.json - a case with no expected `
      + 'answer scores nothing. A case directory left from the pre-0.1.18 layout, which kept '
      + 'expected.json inside the case, reports here until it is removed');
    continue;
  }
  const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));

  const sources = filesUnder(dir).filter((f) => f.endsWith(SUFFIX));
  if (!sources.length) { bad(`${id}: no *${SUFFIX} sources - staging it would copy nothing`); continue; }
  const staged = new Map();                        // staged path -> path in the library
  for (const f of sources) staged.set(STAGE_PREFIX + f.slice(0, -SUFFIX.length), f);

  const ctx = {
    manifest: { tenancy: { isolation: 'application-filters', tenant_column: 'org_id' } },
    files: [...staged.keys()],
    readOrNull: (p) => {
      const src = staged.get(p);
      if (!src) return null;
      try { return fs.readFileSync(path.join(dir, src), 'utf8'); } catch { return null; }
    },
  };
  const scan = scanProject(ctx, { tenantColumn: 'org_id' });
  // `read` is kept on the record so the assertions below resolve a staged path the
  // same way the scan did. Reading `CASES/<id>/<a.path>` directly worked only while
  // expected paths and library paths were the same string, and they no longer are.
  loaded.push({ id, exp, scan, read: ctx.readOrNull, worklist: worklistFrom(scan) });
}

/* ------------------------------------------------- the two required controls */

const degenerate = loaded.filter((c) => c.exp.expected_verdict === 'pass');
check(degenerate.length >= 1,
  `a DEGENERATE-PASS case exists - every site clears, nothing to find (${degenerate.map((c) => c.id).join(', ') || 'NONE'})`);
// RUN ORDER IS DECLARED, NOT SPELLED INTO THE DIRECTORY NAME. It used to be
// asserted as `id.startsWith('00')`, which made a filename load-bearing - the same
// shape the fixture class refuses on purpose ("declared in the manifest, never
// inferred from a directory name"). Case ids are now opaque so that a case cannot
// state its own expected answer through its path, and an opaque id cannot carry an
// ordering either; `run_order` in the expectation carries it instead, where the
// scorer and this check read the same field.
check(degenerate.some((c) => c.exp.run_order === 1),
  `and it declares run_order 1, so it runs before the interesting cases (${
    degenerate.map((c) => `${c.id}:${c.exp.run_order ?? 'unset'}`).join(', ') || 'NONE'})`);
check(loaded.every((c) => Number.isInteger(c.exp.run_order)),
  'and every case declares a run_order, so the sequence does not fall back to whatever the filesystem returns');

const unknowns = loaded.filter((c) => (c.exp.expected_answers ?? []).some((a) => a.origin === 'unknown'));
check(unknowns.length >= 1,
  `an UNKNOWN case exists - origin not determinable from the code available (${unknowns.map((c) => c.id).join(', ') || 'NONE'})`);
check(unknowns.every((c) => c.exp.expected_fail_reason === 'undetermined'),
  'and it expects `undetermined`, not a pass - the loosening the design named as the thing to refuse');

/* --------------------------------------------------- the external-source claim */

const external = loaded.filter((c) => c.exp.source === 'external');
check(external.length === 1,
  `exactly one case is externally sourced (${external.map((c) => c.id).join(', ') || 'NONE'}). `
  + 'If this now fails because a second real defect was added, that is good news - update '
  + 'corpus/README.md, which claims there is one, and then raise this number.');
check(external.every((c) => typeof c.exp._source_note === 'string' && c.exp._source_note.length > 80),
  'and it records where its answer came from, at length - the corpus\'s only independent evidence');
check(loaded.every((c) => ['external', 'authored'].includes(c.exp.source)),
  'every case declares its source as external or authored, with no third value to hide in');

/* ------------------------------------- the expectations match a real worklist */

for (const c of loaded) {
  const wl = c.worklist;
  const answers = c.exp.expected_answers ?? [];

  check(c.scan.residue === 0, `${c.id}: scan residue is 0 - every candidate site is enumerated or named`);
  check(answers.length === wl.sites_total,
    `${c.id}: ${answers.length} expected answer(s) for ${wl.sites_total} enumerated site(s)`);

  for (const a of answers) {
    const site = wl.questions.find((q) => q.path === a.path
      && (c.scan.sites.find((s) => s.path === q.path && s.line === q.line)));
    const src = c.read(a.path);
    check(src !== null,
      `${c.id}: the expectation names ${a.path}, and staging that case produces that file`);
    check(src !== null && src.includes(a.match),
      `${c.id}: expected answer anchors on a string that is actually in ${a.path} ("${a.match}")`);
    check(Boolean(site), `${c.id}: ${a.path} is enumerated as a worklist site`);
    check(ORIGIN.includes(a.origin), `${c.id}: expected origin "${a.origin}" is in the closed enum`);
  }
}

/* ---------------------------------------------------------- the README claim */

const readme = fs.readFileSync(path.join(CORPUS, 'README.md'), 'utf8');
check(/only case here with a known-correct answer sourced from outside/i.test(readme),
  'README states the corpus limit: one externally-sourced case, the rest authored by the process that built guardian');
check(/measures \*self-consistency\*|self-consistency/i.test(readme),
  'and names what that makes the corpus measure, rather than implying it measures correctness in the world');

console.log('');
if (failures.length) {
  console.log(`corpus check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus: both controls present, every expectation maps to a real enumerated site');

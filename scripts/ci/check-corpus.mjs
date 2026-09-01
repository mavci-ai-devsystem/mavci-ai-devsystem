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

const loaded = [];
for (const id of caseDirs) {
  const dir = path.join(CASES, id);
  const expPath = path.join(dir, 'expected.json');
  if (!fs.existsSync(expPath)) { bad(`${id}: no expected.json - a case with no expected answer scores nothing`); continue; }
  const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  const files = filesUnder(dir).filter((f) => f !== 'expected.json');
  const ctx = {
    manifest: { tenancy: { isolation: 'application-filters', tenant_column: 'org_id' } },
    files,
    readOrNull: (p) => { try { return fs.readFileSync(path.join(dir, p), 'utf8'); } catch { return null; } },
  };
  const scan = scanProject(ctx, { tenantColumn: 'org_id' });
  loaded.push({ id, exp, scan, worklist: worklistFrom(scan) });
}

/* ------------------------------------------------- the two required controls */

const degenerate = loaded.filter((c) => c.exp.expected_verdict === 'pass');
check(degenerate.length >= 1,
  `a DEGENERATE-PASS case exists - every site clears, nothing to find (${degenerate.map((c) => c.id).join(', ') || 'NONE'})`);
check(degenerate.some((c) => c.id.startsWith('00')),
  'and it sorts first, so it runs before the interesting cases');

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
    const line = (c.readOrNull ?? (() => null))();
    const src = fs.readFileSync(path.join(CASES, c.id, a.path), 'utf8');
    check(src.includes(a.match),
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

#!/usr/bin/env node
/**
 * Referential integrity for scribe documents.
 *
 * `agent-defs/scribe.json` promises this check BY NAME. Under this repository's own
 * rule that is a debt until the file exists - finding 8's shape, and
 * `check-command-refs.mjs` would have caught a dangling `/mavci-core:` reference but
 * not a dangling *check* name in a prose note.
 *
 * ------------------------------------------------- WHAT IT COVERS, AND WHAT NOT
 *
 * Nothing here checks whether a sentence is TRUE. That is stated in scribe's def as
 * the accepted cost of the tier, and this header exists so the promise the def makes
 * is bounded by what the code actually does.
 *
 *   task id        COVERED, both ways. The task must exist AND, when the document
 *                  quotes a title beside it, the title must match the task record.
 *                  A citation of task 0003 carrying task 0007's title resolves and
 *                  is still a false record.
 *   commit sha     COVERED, both ways. The object must exist AND be an ancestor of
 *                  HEAD. A sha that exists only on another branch resolves against
 *                  the object database and is not part of this history.
 *   verdict file   PARTIALLY COVERED. Existence is checked, and when a task id is
 *                  cited in the same document the verdict's `task_id` must agree
 *                  with it. A verdict cited with no task nearby is checked for
 *                  existence only - the document gives nothing to cross-check.
 *   file path      EXISTENCE ONLY, and this is the honest gap. Whether the path is
 *                  the RIGHT file for the claim being made is a question about the
 *                  sentence, and the sentence is what nothing checks.
 *
 * ------------------------------------------------------ THE ZERO-CITATION RULE
 *
 * A document that cites nothing passes referential integrity trivially, and it is
 * exactly the fabricated-prose case the tier accepts as its exposure: a changelog
 * with no task ids, no shas and no paths has nothing to be wrong about and nothing
 * to check. So it FAILS.
 *
 * This cannot make the prose true. It can require that the document be CHECKABLE -
 * a scribe document with zero citations is not a transcription, whatever it says at
 * the top, and the def instructs scribe to cite what it rendered from precisely so
 * that this rule can be enforced rather than hoped for.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FX = path.join(ROOT, 'plugins/mavci-core/templates/fixtures/scribe-refs');

/* ------------------------------------------------------------- extraction */

const TASK_RE = /\btask\s+(\d{4})\b(?:\s*[-–—:]\s*["“]?([^"”\n]{3,80})["”]?)?/gi;
const SHA_RE = /\b([0-9a-f]{7,40})\b/g;
const VERDICT_RE = /\.mavci\/control\/verdicts\/([A-Za-z0-9_.-]+)\.json/g;
const PATH_RE = /(?:^|[\s(`])((?:app|lib|docs|scripts|supabase|plugins)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,5})/g;

export function citationsIn(text) {
  const out = { tasks: [], shas: [], verdicts: [], paths: [] };
  for (const m of text.matchAll(TASK_RE)) out.tasks.push({ id: m[1], title: m[2]?.trim() ?? null });
  for (const m of text.matchAll(VERDICT_RE)) out.verdicts.push(m[1]);
  for (const m of text.matchAll(PATH_RE)) out.paths.push(m[1]);
  // Shas last, and never inside a path we already claimed - a hex-looking directory
  // segment is not a commit.
  const consumed = out.paths.join(' ') + ' ' + out.verdicts.join(' ');
  for (const m of text.matchAll(SHA_RE)) {
    if (!consumed.includes(m[1]) && /[a-f]/.test(m[1])) out.shas.push(m[1]);
  }
  return out;
}

export function total(c) { return c.tasks.length + c.shas.length + c.verdicts.length + c.paths.length; }

/* -------------------------------------------------------------- resolution */

export function verify(root, rel, text, { git = true } = {}) {
  const problems = [];
  const c = citationsIn(text);

  // THE ZERO-CITATION RULE.
  if (total(c) === 0) {
    problems.push(`${rel}: cites nothing. A document with no task id, sha, verdict or path passes `
      + 'referential integrity trivially and is the fabricated-prose case the tier accepts as its '
      + 'exposure. A scribe document with zero citations is not a transcription.');
    return problems;
  }

  for (const t of c.tasks) {
    const p = path.join(root, '.mavci', 'control', 'tasks', `${t.id}.json`);
    if (!fs.existsSync(p)) { problems.push(`${rel}: cites task ${t.id}, which does not exist`); continue; }
    if (!t.title) continue;
    let rec; try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { rec = null; }
    const actual = rec?.title ?? '';
    // Wrong KIND of resolution: the id resolves and names something else.
    if (actual && actual.toLowerCase() !== t.title.toLowerCase()) {
      problems.push(`${rel}: cites task ${t.id} as "${t.title}", but task ${t.id} is "${actual}". `
        + 'The id resolves and the citation is still false.');
    }
  }

  for (const v of c.verdicts) {
    const p = path.join(root, '.mavci', 'control', 'verdicts', `${v}.json`);
    if (!fs.existsSync(p)) { problems.push(`${rel}: cites verdict ${v}, which does not exist`); continue; }
    if (c.tasks.length !== 1) continue;   // nothing to cross-check against
    let rec; try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { rec = null; }
    if (rec && rec.task_id && rec.task_id !== c.tasks[0].id) {
      problems.push(`${rel}: cites verdict ${v} beside task ${c.tasks[0].id}, but that verdict is `
        + `for task ${rec.task_id}. It resolves, and it is the wrong run.`);
    }
  }

  for (const f of c.paths) {
    if (!fs.existsSync(path.join(root, f))) problems.push(`${rel}: cites ${f}, which does not exist`);
  }

  if (git) {
    for (const sha of c.shas) {
      try {
        execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'ignore' });
      } catch {
        problems.push(`${rel}: cites commit ${sha}, which is not a commit in this repository`);
        continue;
      }
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root, stdio: 'ignore' });
      } catch {
        problems.push(`${rel}: cites commit ${sha}, which exists but is NOT an ancestor of HEAD - `
          + 'it resolves against the object database and is not part of this history.');
      }
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ selftest */

function selftest() {
  const failures = [];
  const ok = (m) => console.log(`  ok   ${m}`);
  const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
  const check = (c, m) => (c ? ok(m) : bad(m));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-scribe-'));
  fs.mkdirSync(path.join(tmp, '.mavci/control/tasks'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.mavci/control/verdicts'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci/control/tasks/0001.json'), JSON.stringify({ id: '0001', title: 'Add billing page' }));
  fs.writeFileSync(path.join(tmp, '.mavci/control/tasks/0002.json'), JSON.stringify({ id: '0002', title: 'Fix RLS on orgs' }));
  fs.writeFileSync(path.join(tmp, '.mavci/control/verdicts/v1.json'), JSON.stringify({ task_id: '0002' }));
  fs.writeFileSync(path.join(tmp, 'docs/real.md'), '# doc\n');

  console.log('scribe referential integrity:');

  const V = (t) => verify(tmp, 'doc.md', t, { git: false });

  check(V('Task 0001 - "Add billing page" landed. See docs/real.md.').length === 0,
    'a document whose citations all resolve, correctly, passes');

  check(V('Nothing to see here. The release went well and the team is pleased.').some((p) => /cites nothing/.test(p)),
    'ZERO CITATIONS FAILS - the fabricated-prose case, which referential integrity would otherwise pass trivially');

  check(V('Task 0009 - "Ghost" was completed.').some((p) => /task 0009, which does not exist/.test(p)),
    'a task id that resolves to nothing fails');

  check(V('Task 0001 - "Fix RLS on orgs" was completed.').some((p) => /resolves and the citation is still false/.test(p)),
    'WRONG KIND: task 0001 exists, and the title cited belongs to task 0002 - it resolves and is false');

  check(V('Task 0001 shipped, see .mavci/control/verdicts/v1.json').some((p) => /wrong run/.test(p)),
    'WRONG KIND: the verdict exists and is for a different task than the one cited beside it');

  check(V('See docs/missing-file.md for detail.').some((p) => /docs\/missing-file\.md, which does not exist/.test(p)),
    'a path that resolves to nothing fails');

  // The gap, asserted as a gap so the def's promise stays bounded.
  check(V('Task 0001 - "Add billing page". Detail in docs/real.md.').length === 0,
    'a path that EXISTS but may be the wrong file passes - existence only, and the header says so');

  // git-backed half, against this repository.
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 12);
  check(verify(ROOT, 'doc.md', `Shipped in ${head}, see docs/ARCHITECTURE.md.`).length === 0,
    'a real ancestor sha and a real path pass together');
  check(verify(ROOT, 'doc.md', 'Shipped in deadbeefdead, see docs/ARCHITECTURE.md.')
    .some((p) => /not a commit in this repository/.test(p)),
    'a sha that is not a commit fails');

  console.log('');
  if (failures.length) {
    console.log(`scribe refs check FAILED (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('scribe refs: citations resolve to the right thing, and a document that cites nothing fails');
}

if (path.basename(process.argv[1] ?? '') === 'check-scribe-refs.mjs') {
  if (process.argv.includes('--selftest') || !fs.existsSync(path.join(process.cwd(), '.mavci'))) selftest();
  else {
    const root = process.cwd();
    const all = [];
    for (const dir of ['docs', '.mavci/decisions']) {
      const d = path.join(root, dir);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        if (!f.endsWith('.md')) continue;
        all.push(...verify(root, `${dir}/${f}`, fs.readFileSync(path.join(d, f), 'utf8')));
      }
    }
    if (all.length) { for (const p of all) console.log(`::error::${p}`); process.exit(1); }
    console.log('scribe refs: every citation resolves');
  }
}

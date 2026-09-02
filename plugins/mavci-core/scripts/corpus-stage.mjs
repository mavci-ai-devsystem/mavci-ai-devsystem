#!/usr/bin/env node
/**
 * Mavci Core - stage exactly one guardian acceptance corpus case into a project.
 *
 * WHY THIS LIVES IN THE PLUGIN AND NOT IN THE PROJECT. The corpus measures whether
 * guardian ANSWERS correctly. It measures nothing if guardian can read the answer,
 * and guardian holds `Read`, `Grep` and `Glob` over the project with no path scope.
 * The previous staging kept the case library at `corpus/cases/` and the answers at
 * `corpus/expected/` INSIDE the project and called that "out of the way". It was
 * out of the way and not out of reach, and it failed on first contact: scoring case
 * t5w9d on 0.1.17, guardian traced the identifier `scopeId`, grepped the project for
 * it, and `corpus/expected/t5w9d.json` matched - on a line carrying the expected
 * origin, one line below a prose field stating which answers count as failures.
 *
 * So the library and the expectations are HERE, in the plugin, outside every scanned
 * project tree. That makes the isolation structural instead of a naming convention:
 * a grep from inside the project cannot reach a file that is not in the project.
 *
 * Two things that used to be load-bearing and no longer are, recorded so nobody
 * reinstates them thinking they still matter:
 *
 *   - `.txt` SUFFIXES. Un-staged cases had to be invisible to `walk()`, and the only
 *     mechanism a project had was keeping sources at an extension outside
 *     `SCANNABLE_EXT`. That was a scanner blind spot doing real work - the same shape
 *     as misses this system has already recorded. The library is now outside the
 *     scanned root entirely, so nothing depends on it. The suffix is kept only so the
 *     sources stay inert inside the SYSTEM repo's own tooling, and stripping it is
 *     this script's job.
 *
 *   - THE `current-case.txt` MARKER. The old staging wrote the staged case id into
 *     the project. Nothing read it, and it named the case inside the tree guardian
 *     reads. It is not written any more. Mis-staging is caught where it should be:
 *     `corpus-score.mjs` refuses when the expectation's `sites_total` disagrees with
 *     the worklist's, which is a fact about the run rather than a note left behind.
 *
 * ONE CASE AT A TIME, because `worklist.mjs --emit` has no path scope and emits one
 * worklist for the whole tree. With every case staged there is one worklist, one
 * record and one verdict; and since `assessCoverage` reports `undetermined` ahead of
 * `findings`, a merged run can never surface the external case's expected `findings`
 * and can never surface the degenerate-pass control's expected `pass` at all. The
 * control is the reason a green corpus means anything, and merging makes it the one
 * thing unobservable.
 *
 * Usage:
 *   node "$PLUGIN/scripts/corpus-stage.mjs" --case <case-id> [--project <root>]
 *   node "$PLUGIN/scripts/corpus-stage.mjs" --list
 *   node "$PLUGIN/scripts/corpus-stage.mjs" --clear [--project <root>]
 *
 * exit 0 = staged   exit 2 = could not stage (never a silent partial stage)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_STAGE_DIR } from './rules/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The plugin-side corpus, outside every project. */
export const CORPUS_HOME = path.resolve(HERE, '..', 'templates', 'corpus');
export const CASE_LIBRARY = path.join(CORPUS_HOME, 'cases');
export const EXPECTATIONS = path.join(CORPUS_HOME, 'expected');

/**
 * The only directory a stage ever writes, relative to the project root.
 *
 * The name is the CHECKER's, not this script's, and it is imported rather than
 * repeated. `corpus-run/` carries a fixture exemption that no project declares -
 * every case reads `SUPABASE_SERVICE_ROLE_KEY` on purpose, and a manifest entry
 * naming this directory was the second corpus leak (see constraint 5 in
 * rules/index.mjs). Two copies of the string would let the stager write somewhere
 * the exemption does not reach, and the failure would look like a checker bug
 * during a corpus run rather than like a typo.
 */
export const STAGE_DIR = CORPUS_STAGE_DIR;

/** Files in the staging directory that a clear leaves alone. */
const KEEP = new Set(['.gitkeep']);

const SUFFIX = '.txt';

class CannotStage extends Error {}
const cannot = (msg) => { throw new CannotStage(msg); };

/** Case ids present in the library, sorted by their declared run order. */
export function listCases() {
  if (!fs.existsSync(CASE_LIBRARY)) return [];
  const ids = fs.readdirSync(CASE_LIBRARY, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  const order = (id) => {
    const p = path.join(EXPECTATIONS, `${id}.json`);
    if (!fs.existsSync(p)) return Number.MAX_SAFE_INTEGER;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')).run_order ?? Number.MAX_SAFE_INTEGER; }
    catch { return Number.MAX_SAFE_INTEGER; }
  };
  return ids.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

/**
 * Refuse any target that is not strictly inside the staging directory.
 * Checked per path rather than once for the tree, because the guard has to hold
 * for every write and a case directory is authored input like any other.
 */
function insideStage(stage, p) {
  const rel = path.relative(stage, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Empty the staging directory. Returns the number of entries removed. */
export function clearStage(root) {
  const stage = path.join(root, STAGE_DIR);
  if (!fs.existsSync(stage)) { fs.mkdirSync(stage, { recursive: true }); return 0; }
  let removed = 0;
  for (const entry of fs.readdirSync(stage)) {
    if (KEEP.has(entry)) continue;
    const full = path.join(stage, entry);
    if (!insideStage(stage, full)) cannot(`refusing to remove ${full}: outside ${stage}`);
    fs.rmSync(full, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/**
 * Stage one case. Clears first, so a stage is never a merge of two cases -
 * the failure mode that makes the degenerate-pass control unobservable.
 *
 * @returns {string[]} the staged paths, project-relative, sorted
 */
export function stageCase(root, caseId) {
  if (!caseId || typeof caseId !== 'string') cannot('no case id given');
  if (!/^[A-Za-z0-9_-]+$/.test(caseId)) {
    cannot(`case id "${caseId}" is not a plain name - it must not contain a path separator`);
  }
  const src = path.join(CASE_LIBRARY, caseId);
  if (!fs.existsSync(src)) {
    cannot(`no case "${caseId}" in the library at ${CASE_LIBRARY}. Known: ${listCases().join(', ') || '(none)'}`);
  }
  if (!fs.existsSync(path.join(EXPECTATIONS, `${caseId}.json`))) {
    cannot(`case "${caseId}" has no expectation at ${path.join(EXPECTATIONS, `${caseId}.json`)}. `
      + 'A case with no expected answer cannot be scored, so staging it would produce a run '
      + 'that looks complete and grades nothing.');
  }

  const stage = path.join(root, STAGE_DIR);
  clearStage(root);

  const staged = [];
  const walk = (dir, relDir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(from, path.posix.join(relDir, entry.name)); continue; }
      if (!entry.name.endsWith(SUFFIX)) continue;
      const rel = path.posix.join(relDir, entry.name.slice(0, -SUFFIX.length));
      const to = path.join(stage, rel);
      if (!insideStage(stage, to)) cannot(`refusing to write ${to}: outside ${stage}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      staged.push(path.posix.join(STAGE_DIR, rel));
    }
  };
  walk(src, '');
  if (!staged.length) cannot(`case "${caseId}" contains no *${SUFFIX} sources`);
  return staged.sort();
}

/* ------------------------------------------------------------ fingerprint */

/**
 * A content fingerprint over the whole case library AND its expectations.
 *
 * WHY A VERSION IS NOT ENOUGH, which is the only reason this exists. `doctor`
 * keys a corpus result on `recorded_for` equalling the running plugin version,
 * and that catches a result carried across a release. It cannot catch the case
 * that actually happens: the library is EDITED INSIDE A VERSION. That is not
 * hypothetical - `q3v7k`'s `lib/auth.ts` was rewritten mid-0.1.18 after guardian
 * showed the fixture, not the expectation, was wrong. The version string did not
 * move, so a result recorded before that edit read as current evidence about a
 * library it had never seen. A version is a DECLARED value that changes when
 * someone decides to change it; this is a MEASURED one that changes when the
 * graded inputs change, and the two fail in different directions.
 *
 * BOTH HALVES ARE IN THE HASH, and leaving either out is the obvious mistake.
 * The cases are what guardian reads; the expectations are what "correct" means.
 * Editing an expectation changes the pass criterion just as completely as editing
 * a fixture - it is the move that turns a failing case green without touching a
 * line guardian will ever see - so a fingerprint over `cases/` alone would be
 * blind to exactly the edit most worth catching.
 *
 * LINE ENDINGS ARE NORMALISED, and that is a deliberate loss of sensitivity. The
 * sources are checked out through git on Windows and Linux alike; a raw byte hash
 * changes on every CRLF checkout, so `doctor` would FAIL on a correctly recorded
 * result for a reason that has nothing to do with the corpus, and the cheapest
 * relief for a check that cries wolf is switching it off. What is given up is
 * detection of a change that is ONLY line endings, which changes neither what
 * guardian reads nor what is expected of it.
 *
 * PATHS ARE HASHED WITH THE CONTENT, so adding, removing or renaming a case moves
 * the fingerprint even when no file's content differs. `README.md` is excluded: it
 * is prose about the corpus, not an input to a run, and a fingerprint that moves
 * when the documentation is edited would be re-recorded so often it would stop
 * meaning anything.
 *
 * @returns {string|null} `sha256:<hex>`, or null when there is nothing to hash -
 *   which is not a fingerprint of an empty library, it is the absence of one, and
 *   every caller must treat it as "could not establish" rather than as a value.
 */
export function libraryFingerprint() {
  const parts = [];

  const collect = (dir, prefix, filter) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) { collect(full, rel, filter); continue; }
      if (filter && !filter(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
      const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
      parts.push(`${rel}::${digest}`);
    }
  };

  collect(CASE_LIBRARY, 'cases', null);
  collect(EXPECTATIONS, 'expected', (name) => name.endsWith('.json'));

  if (!parts.length) return null;
  parts.sort();
  return `sha256:${crypto.createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex')}`;
}

/* -------------------------------------------------------------------- CLI */

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

function main() {
  const argv = process.argv.slice(2);
  const root = arg(argv, '--project') || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  try {
    if (argv.includes('--list')) {
      const ids = listCases();
      if (!ids.length) { console.log(`no cases in ${CASE_LIBRARY}`); return; }
      console.log(`corpus cases (run in this order), from ${CASE_LIBRARY}:`);
      for (const id of ids) console.log(`  ${id}`);
      return;
    }

    if (argv.includes('--clear')) {
      const n = clearStage(root);
      console.log(`staging cleared (${n} entr${n === 1 ? 'y' : 'ies'} removed from ${STAGE_DIR}/)`);
      return;
    }

    const caseId = arg(argv, '--case');
    if (!caseId) {
      console.error('usage: corpus-stage.mjs --case <case-id> [--project <root>] | --list | --clear');
      process.exit(2);
    }

    const staged = stageCase(root, caseId);
    console.log(`staged case ${caseId} -> ${STAGE_DIR}/ (${staged.length} file(s))`);
    for (const f of staged) console.log(`  ${f}`);
    console.log('');
    console.log('Next, as the operator, with the project in the verify phase:');
    console.log('  node "$PLUGIN/scripts/worklist.mjs" --emit');
    console.log('  node "$PLUGIN/scripts/worklist.mjs" --open-ticket <worklist-id>');
    console.log('  dispatch mavci-guardian with the worklist PATH, never its contents');
    console.log(`  node "$PLUGIN/scripts/corpus-score.mjs" --case ${caseId} --worklist <worklist-id>`);
  } catch (err) {
    if (err instanceof CannotStage) {
      console.error(`::cannot-stage:: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
}

if (path.basename(process.argv[1] ?? '') === 'corpus-stage.mjs') main();

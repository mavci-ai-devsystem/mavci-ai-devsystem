#!/usr/bin/env node
/**
 * Mavci Core - worklist emission and the guardian ticket.
 *
 * `sites_total` is fixed HERE, before guardian is invoked. Guardian never chooses
 * what to read and never adds to the list, which is what makes coverage decidable
 * by subtraction with no judgement involved.
 *
 * The worklist is delivered to guardian BY PATH, never by payload. Guardian holds
 * `Read`, and the deny list carries only `Edit(./.mavci/control/**)` - the control
 * plane is readable. Handing over a path means a sixty-site worklist is the same
 * shape as a one-site worklist and nothing can be truncated on the way; a run that
 * cannot finish it comes back as `coverage_incomplete`, which fails closed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { CORPUS_STAGE_DIR, under } from './rules/index.mjs';
import { abs, exists, readJson, writeJsonAtomic, nowIso, walk, readTextOrNull } from './lib/fsx.mjs';
import { scanProject, worklistFrom } from './lib/sitescan.mjs';
import { projectRoot } from './state.mjs';

const DIR = '.mavci/control/guardian';
const TICKET = `${DIR}/ticket.json`;

/**
 * The scan's file list, and THE ONE PLACE THE ENUMERATION IS SCOPED.
 *
 * `scopeToStage` is not a parameter a caller decides. It is `stageIsActive(root)`,
 * derived once in `emitWorklist` from the same fact `openTicket` derives `source`
 * from - see the long note above `stageIsActive` for why that fact is derived and
 * never declared. A `--scope` flag would be a SECOND answer to "is this a corpus
 * run", held by the dispatcher, and the two can disagree in both directions: a
 * scope passed with an empty stage emits an empty worklist and records it
 * `source: real`, and a scope omitted with a case staged is gate6 finding 10
 * unchanged. Full reasoning: `docs/corpus-scope-design.md` sections 1-3.
 *
 * FILTERED, NEVER RE-ROOTED. `emitWorklist(abs(root, CORPUS_STAGE_DIR))` would
 * emit `app/api/workspaces/route.ts` where the expectations declare
 * `corpus-run/app/api/workspaces/route.ts`, and would move `readOrNull`'s base.
 * Paths stay project-relative POSIX; only membership changes.
 *
 * EXPORTED so the scoping can be asserted on the list itself rather than inferred
 * from a worklist's contents. 0.1.29 extracted `cutTag` out of a CLI for the same
 * reason: a seam that only exists inside a function nothing can call is a seam
 * nothing can test, and rebuilding the list inside the check to look at it would
 * be the check asking a question of its own construction (0.1.30).
 *
 * ONE FILTER SCOPES BOTH HALVES OF THE SCAN, and that is required rather than
 * convenient. `scanProject` and `discoverAdminFactories` both iterate `ctx.files`.
 * Leaving factory discovery project-wide would let the host's own factory - the
 * scaffold's `createAdminClient`, say - decide whether a staged fixture's client
 * is service-role, which is gate6 finding 6 contaminating the corpus through the
 * other half of the scan, and harder to see because the site count would look
 * right. The cases need nothing from the host: each ships its own `lib/supabase.ts`.
 */
export function ctxFor(root, manifest, scopeToStage = false) {
  const all = [...walk(root)];
  const files = scopeToStage ? all.filter((rel) => under(rel, CORPUS_STAGE_DIR)) : all;
  const cache = new Map();
  return {
    root, manifest, files,
    readOrNull(rel) {
      if (cache.has(rel)) return cache.get(rel);
      const t = readTextOrNull(abs(root, rel));
      cache.set(rel, t);
      return t;
    },
  };
}

export function emitWorklist(root = projectRoot()) {
  const manifest = readJson(abs(root, PATHS.manifest));
  if (manifest?.tenancy?.isolation !== 'application-filters') {
    throw new Error(`tenancy.isolation is "${manifest?.tenancy?.isolation ?? '(unset)'}", not `
      + '"application-filters". Guardian answers a question about application-code filters; on '
      + 'any other isolation it would be asking about a mechanism this project does not use.');
  }
  // Derived here, once, from the tree's actual state. See ctxFor.
  const scopedToStage = stageIsActive(root);
  const scan = scanProject(ctxFor(root, manifest, scopedToStage),
    { tenantColumn: manifest.tenancy?.tenant_column ?? null });

  // A residue means the scan found a candidate it could neither enumerate nor name.
  // The worklist would then understate what exists, and a worklist answered
  // completely is worth nothing if it was the wrong list.
  if (scan.residue !== 0) {
    throw new Error(`scan residue is ${scan.residue}: ${scan.coarse} candidate site(s), `
      + `${scan.sites.length} enumerated, ${scan.excluded.length} excluded with a stated reason. `
      + 'The remainder is a shape the scanner does not recognise. Refusing to emit a worklist '
      + 'that understates the sites. File it with /mavci-core:retro.');
  }

  const wl = worklistFrom(scan);
  const id = `wl-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
  const doc = {
    schema_version: 1,
    worklist_id: id,
    project_id: manifest.project_id,
    emitted_at: nowIso(),
    sites_total: wl.sites_total,
    questions: wl.questions,
    excluded: scan.excluded,
  };
  fs.mkdirSync(abs(root, DIR), { recursive: true });
  const rel = `${DIR}/${id}.json`;
  writeJsonAtomic(abs(root, rel), doc);
  // `scope` is a fact about the RUN and is returned for the caller to print. It is
  // deliberately NOT a field on `doc`: recording the host tree's state in the
  // artefact is gate6 finding 18's second half, which wants the host's own
  // sites_total per case rather than a scope label, and `additionalProperties:
  // false` makes every new field a propagation-window cost. One field, once, when
  // that finding is built - not a partial version of it now.
  return {
    path: rel, id, sites_total: wl.sites_total, excluded: scan.excluded.length,
    scope: scopedToStage ? CORPUS_STAGE_DIR : '.',
  };
}

/**
 * TICKET FIRST, DISPATCH SECOND. Written before guardian is invoked, never after.
 *
 * The ticket is what tells the SubagentStop writer that a run was dispatched and
 * which worklist to score it against. Written after a successful dispatch, a crash
 * in between leaves guardian having run with nothing to score it - the writer then
 * correctly declines to record anything, and the run is silently lost. Writing it
 * first makes the worst case a stale ticket, which the gate sees and reports.
 */
/**
 * Is a corpus case staged in this project right now?
 *
 * THE ONE PLACE THIS IS DECIDED, and it is derived rather than declared. An
 * argument the dispatcher has to remember to pass is an argument the dispatcher
 * will one day forget, and the failure would be silent in the direction that
 * matters - a corpus record counted as project evidence. The staging directory's
 * contents ARE the fact: if a fixture is staged, the tree guardian is about to
 * read is not this project's own source.
 *
 * It is deliberately coarse. A run over a tree that merely CONTAINS staged
 * fixtures is not clean evidence about the project either, even if nobody
 * intended it as a corpus run, so marking it `corpus` is the honest answer in
 * both cases. Erring the other way would let a dirty stage produce a record the
 * release gate trusts.
 *
 * NOT a marker file inside the project. 0.1.18 removed `current-case.txt` for
 * naming the staged case inside the tree guardian reads; this reads the stage
 * that already exists and writes its answer into the ticket, which lives under
 * `.mavci/` where guardian's read scope refuses to follow.
 */
export function stageIsActive(root) {
  const stage = abs(root, CORPUS_STAGE_DIR);
  if (!exists(stage)) return false;
  try {
    return fs.readdirSync(stage).some((e) => e !== '.gitkeep');
  } catch {
    // Unreadable stage: cannot establish that this is a clean tree, so do not
    // claim it is one.
    return true;
  }
}

export function openTicket(root, worklistId, { trigger = 'manual', reviewedRef = null, treeState = null } = {}) {
  const manifest = readJson(abs(root, PATHS.manifest));
  const wlRel = `${DIR}/${worklistId}.json`;
  if (!exists(abs(root, wlRel))) throw new Error(`no worklist at ${wlRel}`);
  const doc = {
    schema_version: 1,
    project_id: manifest.project_id,
    worklist_id: worklistId,
    worklist_path: wlRel,
    opened_at: nowIso(),
    // What the record produced from this ticket will be evidence ABOUT. Decided
    // here, once, from the tree's actual state - see stageIsActive. The
    // SubagentStop writer copies it and does not re-derive it, so there is one
    // answer per run and no way for two derivations to disagree.
    source: stageIsActive(root) ? 'corpus' : 'real',
    trigger,
    reviewed_ref: reviewedRef,
    tree_state: treeState,
  };
  fs.mkdirSync(abs(root, DIR), { recursive: true });
  writeJsonAtomic(abs(root, TICKET), doc);
  return { path: TICKET, worklist_path: wlRel, source: doc.source };
}

function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
  try {
    if (argv.includes('--emit')) {
      const r = emitWorklist(root);
      const staged = r.scope !== '.';
      console.log(`worklist ${r.id}: ${r.sites_total} site(s), ${r.excluded} excluded`);
      console.log(`  ${r.path}`);
      // NAMED ON EVERY RUN, pass or fail. An emit that does not say which tree it
      // enumerated asserts more than it verified (0.1.14), and the two trees give
      // different meanings to the same numbers below.
      console.log(staged
        ? `  scope: ${r.scope}/ ONLY - a corpus case is staged, so this project's own`
          + ' sources were not enumerated.'
        : "  scope: the whole project - no corpus case is staged.");
      if (r.sites_total === 0) {
        // Two causes, two messages. One explanation for both is the `--reseal` trap
        // (0.1.21 finding 24): a remedy that cannot apply costs an action and
        // teaches the reader that the message is unreliable.
        console.log('  sites_total is 0. That is NOT a pass - it is not_checked.');
        console.log(staged
          ? `  A case is staged, so this means ${r.scope}/ is empty or the case did not copy.`
            + ' Re-stage it with corpus-stage.mjs --case <id> and emit again.'
          : '  It is more likely to mean the scan is not seeing sites than that the project'
            + ' has none.');
      }
      return;
    }
    const ti = argv.indexOf('--open-ticket');
    if (ti !== -1) {
      const r = openTicket(root, argv[ti + 1]);
      console.log(`ticket open for ${argv[ti + 1]} -> ${r.worklist_path}` + ` [source: ${r.source}]`);
      console.log('  Dispatch guardian with the PATH. Never inline the worklist into the prompt.');
      return;
    }
    console.error('usage: worklist.mjs --emit | --open-ticket <worklist-id>');
    process.exit(2);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }
}

if (path.basename(process.argv[1] ?? '') === 'worklist.mjs') main();

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
import { abs, exists, readJson, writeJsonAtomic, nowIso, walk, readTextOrNull } from './lib/fsx.mjs';
import { scanProject, worklistFrom } from './lib/sitescan.mjs';
import { projectRoot } from './state.mjs';

const DIR = '.mavci/control/guardian';
const TICKET = `${DIR}/ticket.json`;

function ctxFor(root, manifest) {
  const files = [...walk(root)];
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
  const scan = scanProject(ctxFor(root, manifest), { tenantColumn: manifest.tenancy?.tenant_column ?? null });

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
  return { path: rel, id, sites_total: wl.sites_total, excluded: scan.excluded.length };
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
    trigger,
    reviewed_ref: reviewedRef,
    tree_state: treeState,
  };
  fs.mkdirSync(abs(root, DIR), { recursive: true });
  writeJsonAtomic(abs(root, TICKET), doc);
  return { path: TICKET, worklist_path: wlRel };
}

function main() {
  const argv = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
  try {
    if (argv.includes('--emit')) {
      const r = emitWorklist(root);
      console.log(`worklist ${r.id}: ${r.sites_total} site(s), ${r.excluded} excluded`);
      console.log(`  ${r.path}`);
      if (r.sites_total === 0) {
        console.log('  sites_total is 0. That is NOT a pass - it is not_checked, and it is more');
        console.log('  likely to mean the scan is not seeing sites than that the project has none.');
      }
      return;
    }
    const ti = argv.indexOf('--open-ticket');
    if (ti !== -1) {
      const r = openTicket(root, argv[ti + 1]);
      console.log(`ticket open for ${argv[ti + 1]} -> ${r.worklist_path}`);
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

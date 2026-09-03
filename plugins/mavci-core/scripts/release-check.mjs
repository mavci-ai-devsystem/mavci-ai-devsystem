#!/usr/bin/env node
/**
 * The CLI for the release precondition gate. The DECISION lives in
 * `lib/release-gate.mjs`, which is asserted deterministically by
 * `check-release-gate.mjs`; this file only gathers the inputs and prints.
 *
 * Split that way on purpose: a gate whose only exercise is running a release is a
 * gate tested once per release, by the operator, at the worst possible moment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { abs, exists, readJsonOrNull } from './lib/fsx.mjs';
import { assessReleaseReadiness, isolationOf, selectProjectRecord, UNREADABLE } from './lib/release-gate.mjs';
import { pluginVersion, projectRoot } from './state.mjs';

/**
 * Every guardian record on disk, ascending by filename.
 *
 * `UNREADABLE` marks a file that is there and cannot be parsed. Collapsing that
 * into "absent" would let a corrupt record be reported as no record, which is a
 * different problem with a different fix - the gate gives them the same VERDICT
 * while keeping them distinguishable in the message.
 *
 * THIS FUNCTION USED TO CHOOSE, AND CHOOSING WAS THE BUG. It read the directory,
 * took the last file and called it the project's record. The corpus writes into
 * the same directory through the same writer, its last case is an expected-`fail`
 * control, and so a PASSING corpus left this gate holding a failing record about a
 * staged fixture and reporting it as a finding about the project (finding 25).
 * Selection now lives in `selectProjectRecord`, which is pure and asserted by
 * `check-release-gate.mjs`; this only gathers. An input selection that no test can
 * reach is the untested half of every gate built on it.
 */
function guardianRecords(root) {
  const dir = abs(root, PATHS.guardianRecords);
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((id) => {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, id), 'utf8'));
      return { id, doc: doc && typeof doc === 'object' ? doc : UNREADABLE };
    } catch { return { id, doc: UNREADABLE }; }
  });
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
  if (!exists(abs(root, PATHS.manifest))) {
    console.error('::error::not a Mavci project - no .mavci/project.json');
    process.exit(2);
  }

  const { record, counts } = selectProjectRecord(guardianRecords(root));
  const result = assessReleaseReadiness({
    runningVersion: pluginVersion(),
    unverified: readJsonOrNull(abs(root, PATHS.unverified)),
    guardianRecord: record,
    recordCounts: counts,
    // Derived from the manifest, never asserted. `isolationOf` returns null for
    // anything that is not a non-empty string, so an unreadable manifest refuses
    // as before rather than becoming an exemption.
    isolation: isolationOf(readJsonOrNull(abs(root, PATHS.manifest))),
  });

  // Say what was skipped even on the happy path. A gate that silently discards
  // most of its input directory and then reports "all hold" is telling the
  // operator less than it knows, and finding 25 is precisely what that costs.
  if (counts.corpus || counts.undeclared) {
    console.log('(' + counts.total + ' guardian record(s) on disk: ' + counts.corpus
      + ' corpus fixture(s), ' + counts.undeclared
      + ' declaring no source, both skipped as project evidence.)');
    console.log('');
  }

  // An arm that was SKIPPED is printed before the verdict, on a pass and on a
  // failure alike. A gate that quietly does not check something and then says
  // "all hold" is asserting more than it verified - the same argument the
  // declared exclusions above are printed for.
  for (const n of result.notes ?? []) {
    console.log(`(${n})`);
    console.log('');
  }

  if (result.ok) {
    console.log('release preconditions: all hold.');
    console.log('');
    console.log('That means the preconditions hold, NOT that the release is done. The version in');
    console.log('plugin.json IS the release action; nothing propagates until it changes:');
    console.log('');
    console.log('  edit -> build-agents.mjs if a def changed -> bump plugin.json -> commit ->');
    console.log('  push -> tag vX.Y.Z -> push tag');
    process.exit(0);
  }

  // Every refusal, not the first. One run tells the operator everything that is
  // blocking rather than one thing per attempt.
  console.log(`release REFUSED - ${result.refusals.length} precondition(s) not met:`);
  for (const r of result.refusals) {
    console.log('');
    console.log(`  [${r.code}]`);
    console.log(`  ${r.message}`);
  }
  console.log('');
  console.log('Report these verbatim. Do not re-score them, and do not clear one by re-running');
  console.log('guardian or by resealing: clearing the evidence is not fixing the problem.');
  process.exit(1);
}

if (path.basename(process.argv[1] ?? '') === 'release-check.mjs') main();

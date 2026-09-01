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
import { assessReleaseReadiness, UNREADABLE } from './lib/release-gate.mjs';
import { pluginVersion, projectRoot } from './state.mjs';

/**
 * The newest guardian record, or a sentinel.
 *
 * `null` means absent; `UNREADABLE` means a file is there and cannot be parsed.
 * Collapsing those two would let a corrupt record be reported as no record, which
 * is a different problem with a different fix - and the gate deliberately gives
 * them the same VERDICT while keeping them distinguishable in the message.
 */
function latestGuardianRecord(root) {
  const dir = abs(root, PATHS.guardianRecords);
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return null;
  const p = path.join(dir, files[files.length - 1]);
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    return doc && typeof doc === 'object' ? doc : UNREADABLE;
  } catch { return UNREADABLE; }
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
  if (!exists(abs(root, PATHS.manifest))) {
    console.error('::error::not a Mavci project - no .mavci/project.json');
    process.exit(2);
  }

  const result = assessReleaseReadiness({
    runningVersion: pluginVersion(),
    unverified: readJsonOrNull(abs(root, PATHS.unverified)),
    guardianRecord: latestGuardianRecord(root),
  });

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

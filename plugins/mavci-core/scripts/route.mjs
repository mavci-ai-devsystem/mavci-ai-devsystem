#!/usr/bin/env node
/**
 * Mavci Core - the router CLI. Gathers, prints, decides nothing.
 *
 * The DECISION lives in `lib/route.mjs`, which is pure and asserted by
 * `check-route.mjs`. This file reads the control plane and renders. Same split as
 * `release-check.mjs` over `lib/release-gate.mjs`, and for the reason written
 * there: a decision whose only exercise is running the real thing is a decision
 * tested once per run, by the operator, at the worst possible moment.
 *
 *   node route.mjs                     what happens next, for a human
 *   node route.mjs --json              the same answer, for /mavci-core:ship
 *   node route.mjs --request "<text>"  route as if this request had just arrived
 *
 * EXIT STATUS IS PART OF THE ANSWER, because the caller is a model reading a
 * transcript and an exit code is the one channel it cannot mis-summarise:
 *
 *   0  an agent may be dispatched          (plan, build, rework, verify, document)
 *   1  the operator owns the next step     (release_gate, blocked, unverified, idle)
 *   2  this is not a Mavci project, or the control plane could not be read
 *
 * A GATHERER MUST NOT SILENTLY GATHER NOTHING. An unreadable verdict, task or state
 * file exits 2 naming the file rather than routing over the remainder: routing over
 * a partial control plane produces a confident answer from incomplete evidence,
 * which is worse than no answer and is invariant 5 restated for this file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { abs, exists, readJsonOrNull, readTextOrNull } from './lib/fsx.mjs';
import { route, OWNER } from './lib/route.mjs';
import { projectRoot } from './state.mjs';

function readJsonStrict(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`could not read ${label} at ${file}: ${err.message}`);
    console.error('Refusing to route over a control plane that is only partly readable: the answer '
      + 'would look exactly like an answer from a complete one.');
    process.exit(2);
  }
  return null;
}

function gather(root) {
  const connected = exists(abs(root, PATHS.manifest));
  if (!connected) return { connected: false, state: null, tasks: [], verdicts: [], unverified: null };

  const state = readJsonOrNull(abs(root, PATHS.state));

  const controlDir = abs(root, PATHS.controlTasks);
  const surfaceDir = abs(root, PATHS.tasks);
  const ids = exists(controlDir)
    ? fs.readdirSync(controlDir).filter((f) => /^[0-9]{4}\.json$/.test(f)).map((f) => f.slice(0, 4)).sort()
    : [];
  const tasks = ids.map((id) => {
    const control = readJsonStrict(path.join(controlDir, `${id}.json`), `control task ${id}`);
    const surfaceFile = path.join(surfaceDir, `${id}.json`);
    const surface = exists(surfaceFile) ? readJsonStrict(surfaceFile, `task ${id}`) : {};
    // The control copy wins on every field they share - ARCHITECTURE 4.1. The
    // surface half contributes only `title` and `spec`, which the control half
    // does not carry at all.
    return { title: surface.title ?? null, spec: surface.spec ?? null, ...control };
  });

  const verdictDir = abs(root, PATHS.verdicts);
  const verdicts = exists(verdictDir)
    ? fs.readdirSync(verdictDir).filter((f) => f.endsWith('.json'))
      .map((f) => readJsonStrict(path.join(verdictDir, f), `verdict ${f}`))
    : [];

  return {
    connected: true,
    state,
    tasks,
    verdicts,
    unverified: readJsonOrNull(abs(root, PATHS.unverified)),
  };
}

function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
  const argv = process.argv.slice(2);
  const ri = argv.indexOf('--request');
  const request = ri === -1 ? null : (argv[ri + 1] ?? null);

  const input = gather(root);

  // The spec text belongs to the task the router is about to select, so selection
  // has to happen before it can be read. Routing twice is cheap and pure; guessing
  // which task the spec belongs to is not.
  const first = route({ ...input, request });
  let specText = null;
  if (first.task_id) {
    const t = input.tasks.find((x) => x.id === first.task_id);
    if (t?.spec) specText = readTextOrNull(abs(root, t.spec));
  }
  const decision = route({ ...input, request, specText });

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...decision, phase: input.state?.phase ?? null }, null, 2));
  } else {
    const owner = decision.dispatch ?? 'the operator';
    console.log(`next: ${decision.action}  ->  ${owner}`
      + (decision.task_id ? `   (task ${decision.task_id})` : ''));
    console.log('');
    console.log(decision.why);
    if (decision.steps.length) {
      console.log('');
      for (const s of decision.steps) console.log(`  ${s.run}\n      ${s.why}`);
    }
    if (input.state && decision.task_id) {
      const t = input.tasks.find((x) => x.id === decision.task_id);
      if (t && t.phase !== input.state.phase) {
        console.log('');
        console.log(`note: state.json says phase=${input.state.phase} and task ${t.id} says phase=${t.phase}. `
          + 'The control task wins (ARCHITECTURE 4.1) and the steps above reconcile them.');
      }
    }
  }

  if (decision.action === 'not_connected') process.exit(2);
  process.exit(OWNER[decision.action] ? 0 : 1);
}

// basename, not endsWith: a file named check-route.mjs ends with this script's
// name, and the endsWith form ran the CLI the moment a self-test imported it.
if (path.basename(process.argv[1] ?? '') === 'route.mjs') main();

/**
 * The acceptance criteria, read out of the approved spec and EXECUTED.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * cartoonify finding 6. The spec defines what "done" means for a task - the
 * operator reads those criteria and approves them by content hash. The verdict
 * defines what the router and the release gate believe. Between 0.1.2 and 0.1.32
 * the two had NO CONNECTION: a verdict's `checks[]` are standards-checker
 * findings, and a verdict covering a strict subset of the criteria is always
 * MORE OPTIMISTIC than the truth and never less. Task 0001 recorded `pass` with
 * criterion 4 reproducibly failing.
 *
 * 0.1.33 gave the verdict a `criteria[]` and made its absence read as
 * `incomplete`. It gave the system nothing that PRODUCES the field, so the only
 * exit that moved was the operator's `--task-status done` override - a
 * fail-closed gate with no key, which is a gate that has been turned off while
 * still reporting that it is on.
 *
 * ------------------------------------------ WHY A PROGRAM AND NOT AN AGENT
 *
 * Finding 6's fix 3 asks that the verifier be able to record its judgement, and
 * taken literally that is a criteria file written by an agent out of its own
 * prose. That does not close the loop; it launders it. An unverified claim
 * becomes an artefact that reads as verification, and the artefact is what every
 * later reader trusts instead of looking.
 *
 * `state.mjs`'s `--record-corpus` settled this question for guardian and its
 * sentence is the one that governs here: a writer that accepts the answer "would
 * put the model back in the chair corpus-score.mjs was written to take it out
 * of." The agent interprets; the program records.
 *
 * The measurement that makes it possible: across 47 acceptance criteria on two
 * real projects, the number needing an agent's JUDGEMENT is zero. What varies is
 * CAPABILITY, and finding 4 already wrote the vocabulary down.
 *
 * -------------------------------------- WHY EXECUTING SPEC BYTES IS LEGITIMATE
 *
 * A spec is written by an agent, so executing commands out of it is, on its
 * face, handing an agent an execution channel the risk guard cannot see - the
 * guard is a PreToolUse hook and sees `node verify.mjs …` as ONE call, never its
 * children.
 *
 * What makes it legitimate is a mechanism that already exists and is the most
 * carefully built thing in this system: `spec_approved` content-hashes the spec,
 * `--advance-phase` refuses on drift, `--approve-spec` keeps the approved bytes,
 * and 0.1.26's class control denies EVERY agent a write to a spec that carries a
 * recorded approval. So the runner executes operator-approved bytes and nothing
 * else, and it refuses rather than proceeding when it cannot establish that.
 *
 * Finding 6's addendum: "the system is rigorous about consent and silent about
 * outcome." Running the criteria is what makes the existing rigour pay for
 * something. It also RAISES what an approval means - from "I read these claims"
 * to "I authorised this" - which is why `needs` is declared per criterion and
 * printed in aggregate at the approval gate. Approving a document you cannot
 * evaluate was finding 4; approving a document you cannot evaluate that a
 * program will then run is finding 4 with the stakes raised, and the two ship
 * together or neither should.
 *
 * ----------------------------------------------------------------- THE FORMAT
 *
 * ONE fenced block, info string `mavci-criteria`, holding a JSON array, INSIDE
 * `.mavci/tasks/<id>.md`. Never the `.mavci/tasks/<id>.json` sidecar: that file
 * is in the architect's write scope and OUTSIDE `spec_approved.spec_sha256`, so
 * criteria placed there could be rewritten after approval - and the hash is the
 * entire authority under which any of this runs.
 *
 *     { "id": "4",                     the number as it appears in the prose
 *       "needs": ["shell"],            optional; defaults to ["shell"]
 *       "run": "npm run typecheck",    executed at the project root
 *       "expect_exit": 0,              optional; defaults to 0
 *       "timeout_ms": 120000 }         optional; defaults to CRITERION_TIMEOUT_MS
 *
 * Zero dependencies, Node builtins only (invariant 1).
 */

import { execFileSync } from 'node:child_process';
import {
  CRITERION_NEEDS, CRITERION_TIMEOUT_MS, CRITERION_TIMEOUT_CEILING_MS, EVIDENCE_MAX_CHARS,
} from '../config.mjs';
import { legible } from './shell.mjs';

export const CRITERIA_FENCE = 'mavci-criteria';

/**
 * `mode` ON A `not_run`, AND WHY IT IS DEFINED RATHER THAN CHOSEN.
 *
 * The schema requires `mode` and its enum is closed at `executed|inspected`. A
 * criterion that never produced a result was neither, so neither value is a true
 * answer to "how was the result obtained" - there is no result. Two exits were
 * available and both are worse than defining the field: adding a third enum
 * member is a locked-format change to a closed enum, and making `mode`
 * conditionally optional cannot be expressed at all, because `lib/schema.mjs`
 * has no conditional construct (cartoonify finding 1).
 *
 * SO `mode` IS DEFINED AS THE PATH THAT WAS ATTEMPTED, not the path that
 * succeeded, and every `not_run` this module writes carries `executed`. That is
 * true of both cases it can produce: a command that ran and never answered, and
 * a command whose declared capability was not available, which is a decision
 * about the EXECUTED path and not a reading of the code.
 *
 * THE DEFINITION IS ONLY SAFE BECAUSE THE ONE READER WAS FIXED IN THE SAME
 * CHANGE. `criteriaSummary` counted `mode === 'executed'` and would have
 * reported "15 of 15 criteria executed" for a run in which six never started -
 * which is reporting non-execution as execution, the exact inversion `mode` was
 * added to prevent. It now counts only criteria that actually produced a result.
 */
const ATTEMPTED_EXECUTION = 'executed';

/** Every criterion can be assumed to need this much; declaring it is optional. */
const DEFAULT_NEEDS = ['shell'];

/**
 * Find the block in a spec. Pure: it reads no files and spawns nothing.
 *
 * Returns `{ ok: true, criteria }` where `criteria` is the entries or NULL for a
 * spec that declares none - absence is not an error, because every spec written
 * before this existed is in that state and a project full of them is exactly the
 * condition the `incomplete` arm already describes.
 */
export function parseCriteriaBlock(specText) {
  if (typeof specText !== 'string') {
    return { ok: false, error: 'the spec could not be read as text' };
  }
  const fence = '`'.repeat(3);
  const re = new RegExp(`^[ \\t]*${fence}[ \\t]*${CRITERIA_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)^[ \\t]*${fence}[ \\t]*$`, 'gm');
  const blocks = [];
  let m = re.exec(specText);
  while (m) {
    blocks.push(m[1]);
    m = re.exec(specText);
  }

  if (blocks.length === 0) return { ok: true, criteria: null };
  if (blocks.length > 1) {
    /* A SECOND BLOCK IS A SECOND LIST. Whichever one loses is invisible to the
     * operator, who read and approved both - and "last one wins" would make the
     * losing half a set of criteria that were approved and never run. */
    return {
      ok: false,
      error: `the spec carries ${blocks.length} \`${CRITERIA_FENCE}\` blocks. There must be exactly `
        + 'one: a second block is a second list of the same thing, and whichever one loses is a set '
        + 'of criteria the operator approved and nothing ran.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(blocks[0]);
  } catch (err) {
    return { ok: false, error: `the \`${CRITERIA_FENCE}\` block is not valid JSON: ${err.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: `the \`${CRITERIA_FENCE}\` block must be a JSON array, got ${typeof parsed}` };
  }

  const seen = new Set();
  const criteria = [];
  for (const [i, raw] of parsed.entries()) {
    const where = `entry ${i + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: `${where} is not an object` };
    }
    const id = raw.id;
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, error: `${where} has no \`id\`. The id is what joins a result to the criterion the operator read.` };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        error: `criterion id ${JSON.stringify(id)} appears twice. Two results for one id means one `
          + 'of them silently replaces the other, and the record cannot say which ran.',
      };
    }
    seen.add(id);

    if (typeof raw.run !== 'string' || !raw.run.trim()) {
      return {
        ok: false,
        error: `criterion ${id} has no \`run\`. There is nothing to execute, so its result could only `
          + 'ever be supplied - which is the thing this format exists to prevent.',
      };
    }

    let needs = DEFAULT_NEEDS;
    if (raw.needs !== undefined) {
      if (!Array.isArray(raw.needs) || raw.needs.length === 0) {
        return { ok: false, error: `criterion ${id}: \`needs\` must be a non-empty array` };
      }
      const bad = raw.needs.filter((n) => !CRITERION_NEEDS.includes(n));
      if (bad.length) {
        /* CLOSED, AND REFUSED RATHER THAN IGNORED. An unrecognised capability is
         * indistinguishable from a satisfied one to every reader downstream, so
         * accepting it would let a criterion declare its way out of running. */
        return {
          ok: false,
          error: `criterion ${id} declares unrecognised capability ${bad.map((b) => JSON.stringify(b)).join(', ')}. `
            + `The vocabulary is closed: ${CRITERION_NEEDS.join(', ')}.`,
        };
      }
      needs = [...raw.needs];
    }

    let timeout = CRITERION_TIMEOUT_MS;
    if (raw.timeout_ms !== undefined) {
      if (!Number.isInteger(raw.timeout_ms) || raw.timeout_ms <= 0 || raw.timeout_ms > CRITERION_TIMEOUT_CEILING_MS) {
        return {
          ok: false,
          error: `criterion ${id}: \`timeout_ms\` must be an integer in 1..${CRITERION_TIMEOUT_CEILING_MS}`,
        };
      }
      timeout = raw.timeout_ms;
    }

    const expect = raw.expect_exit === undefined ? 0 : raw.expect_exit;
    if (!Number.isInteger(expect) || expect < 0 || expect > 255) {
      return { ok: false, error: `criterion ${id}: \`expect_exit\` must be an integer in 0..255` };
    }

    criteria.push({ id, needs, run: raw.run, expect_exit: expect, timeout_ms: timeout });
  }

  if (!criteria.length) {
    return {
      ok: false,
      error: `the \`${CRITERIA_FENCE}\` block is empty. An empty block asserts that the criteria were `
        + 'examined and there were none; a spec with no block says the run did not answer. Those are '
        + 'different states and only one of them is honest here.',
    };
  }
  return { ok: true, criteria };
}

/**
 * Can this criterion be executed here? `have` is what the CALLER declares the
 * environment provides - a statement about the world, never about the result.
 */
export function canRun(criterion, have) {
  const provided = new Set(['shell', ...(have ?? [])]);
  const missing = criterion.needs.filter((n) => !provided.has(n));
  return { run: missing.length === 0, missing };
}

/**
 * What the operator is about to authorise, in one sentence, BEFORE they decide.
 *
 * cartoonify finding 4. Pure, and it takes the spec text rather than a parsed
 * block so the caller need not have parsed one - a spec that declares nothing
 * gets the sentence that says so, which is the answer that matters most.
 */
export function approvalPreconditions(specText) {
  const parsed = parseCriteriaBlock(specText ?? '');
  if (!parsed.ok) {
    return `Its \`${CRITERIA_FENCE}\` block cannot be read (${parsed.error}), so nothing can state `
      + 'what these criteria require, and nothing will be able to run them.';
  }
  if (!parsed.criteria) {
    return `It declares no \`${CRITERIA_FENCE}\` block, so NOTHING WILL EXECUTE THESE CRITERIA: the `
      + 'verdict can only carry what somebody reports having read, and the chain will stop at '
      + '`incomplete` after verify. That is the honest state for a spec written before the block '
      + 'existed; on a new task, ask the architect for one.';
  }

  const counts = new Map();
  for (const c of parsed.criteria) {
    const key = [...c.needs].sort().join(' + ');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  const beyond = parsed.criteria.filter((c) => !isShellOnly(c));

  return `WHAT THEY REQUIRE, WHICH THEIR TEXT DOES NOT SAY: ${parsed.criteria.length} criteria - `
    + `${lines}. `
    + (beyond.length
      ? `${beyond.length} of them need something beyond a shell in this repository `
        + `(${beyond.map((c) => c.id).join(', ')}); each is \`not_run\` unless that capability is `
        + 'declared available at verify time, and one `not_run` makes the whole verdict '
        + '`incomplete`. '
      : 'All of them run as ordinary commands in this repository. ')
    + 'Approving this authorises a program to EXECUTE those commands, so read them as a script.';
}

/** Only `shell` - so the runner could have run it, and reading it instead is a substitution. */
export function isShellOnly(criterion) {
  return Array.isArray(criterion?.needs)
    && criterion.needs.length === 1
    && criterion.needs[0] === 'shell';
}

function clip(s) {
  const t = legible(s).replace(/\s+/g, ' ').trim();
  return t.length > EVIDENCE_MAX_CHARS ? `${t.slice(0, EVIDENCE_MAX_CHARS - 3)}...` : t;
}

/**
 * Execute one criterion and report what was observed. Never throws.
 *
 * THE THREE OUTCOMES ARE NOT TWO. A command that answered with the wrong exit
 * code is `fail`; a command that never answered - it timed out, or the
 * interpreter could not start it - is `not_run`, because a probe that produced
 * no answer reported as an answer is invariant 5 broken inside the thing that
 * enforces it. And `not_run`, never `skipped`: skipped is a decision recorded in
 * advance, and nothing here decided anything.
 */
export function runOne(criterion, bash, cwd) {
  const t0 = Date.now();
  let status;
  let out = '';
  let timedOut = false;
  try {
    out = execFileSync(bash.path, ['-c', criterion.run], {
      cwd, encoding: 'utf8', timeout: criterion.timeout_ms, stdio: ['ignore', 'pipe', 'pipe'],
    });
    status = 0;
  } catch (err) {
    out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    // execFileSync surfaces a timeout as a killing SIGNAL, not as an exit status.
    timedOut = err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
    status = typeof err.status === 'number' ? err.status : null;
  }
  const ms = Date.now() - t0;

  if (timedOut || status === null) {
    return {
      id: criterion.id,
      status: 'not_run',
      mode: ATTEMPTED_EXECUTION,
      evidence: clip(timedOut
        ? `timed out after ${criterion.timeout_ms} ms, so it never answered: ${out}`
        : `the interpreter could not run it, so it never answered: ${out}`),
    };
  }

  const passed = status === criterion.expect_exit;
  return {
    id: criterion.id,
    status: passed ? 'pass' : 'fail',
    mode: 'executed',
    evidence: clip(passed
      ? `exit ${status} in ${ms} ms: ${criterion.run}`
      : `exit ${status}, expected ${criterion.expect_exit}, in ${ms} ms: ${criterion.run} -- ${out}`),
  };
}

/**
 * Run every criterion the environment can satisfy, and record the rest as
 * `not_run`. `exec` is injected so the decision is testable without spawning.
 */
export function runCriteria(criteria, { bash, cwd, have = [], exec = runOne } = {}) {
  return criteria.map((c) => {
    const { run, missing } = canRun(c, have);
    if (run) return exec(c, bash, cwd);
    return {
      id: c.id,
      status: 'not_run',
      mode: ATTEMPTED_EXECUTION,
      evidence: clip(`not run here: this criterion declares ${c.needs.join(', ')} and `
        + `${missing.join(', ')} was not declared available. Nobody decided to skip it.`),
    };
  });
}

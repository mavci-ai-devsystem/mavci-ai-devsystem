/**
 * Mavci Core - the router. What is the next step, and who owns it.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * Until now nothing carried a task from one agent to the next. `/mavci-core:plan`
 * ended by telling the operator to type `/mavci-core:build <id>`; `/mavci-core:build`
 * ended by telling them to type `/mavci-core:verify <id>`; and a FAILED verify ended
 * by saying "stop - do not fix it here" and naming nothing at all. The builder
 * refuses to start unless the phase is `build`, and a failed verify leaves the phase
 * at `verify`, so the rework loop the retry ceiling was written for was not merely
 * unautomated - it was unreachable without a privileged phase move. Three agents
 * were reachable; `mavci-verifier` was named by no skill and `mavci-scribe` by
 * nothing at all.
 *
 * ------------------------------------------------------ WHY IT IS NOT A FRAMEWORK
 *
 * ROADMAP forbids an orchestration framework, a message bus and an agent registry,
 * and it is right to: native delegation already dispatches, the main session already
 * IS the orchestrator, and `SubagentStop` already fires. What was missing is not a
 * mechanism for dispatching - it is THE DECISION OF WHAT TO DISPATCH, and that
 * decision was living in prose, recalled by a model, in five separate files that
 * each knew one edge of the graph.
 *
 * So this is a pure function of the control plane. It reads no files, spawns
 * nothing, and dispatches nothing. It answers one question - what happens next -
 * from state that is already on disk, and `route.mjs` gathers the inputs while
 * `skills/ship/` carries the answer out. Same split as `lib/release-gate.mjs`, for
 * the same reason: a decision whose only exercise is running the real thing is a
 * decision tested once, by the operator, at the worst possible moment.
 *
 * ------------------------------------------------------------- THE GATES STAND
 *
 * The router routes around nothing. Every step it names is a command the caller
 * still has to run, every one of them still passes through `risk-guard.mjs`, and
 * three actions are terminal-for-the-operator by construction: `release_gate`,
 * `blocked` and `unverified`. `dispatch: null` on those is not an omission - it is
 * the statement that no agent may proceed, and the caller asserts on it.
 *
 * ---------------------------------------------------- ONE FACT, ONE WRITER
 *
 * The task's own `phase` is what routing reads, not `state.json.phase`. They are
 * required to agree (ARCHITECTURE 4.1: the control copy wins, and doctor reports
 * the divergence), and on the first real project they did not - `state.json` said
 * `verify` while `control/tasks/0001.json` said `plan`, produced entirely by
 * sanctioned commands. Reading the task and emitting the `--set-phase` that
 * reconciles the project means the normal path repairs the divergence instead of
 * accumulating it.
 */

import { createHash } from 'node:crypto';

/** Every action carries a code, so callers assert on the code and not the prose. */
export const ACTIONS = [
  'not_connected',   // no manifest - nothing to route
  'unverified',      // enforcement did not run; nothing may proceed on unchecked code
  'plan',            // architect: turn a request into a spec with checkable criteria
  'build',           // builder: implement the spec
  'rework',          // builder again, starting from the failing verdict
  'verify',          // verifier: run the checker and the build against the criteria
  'document',        // scribe: render what happened from sources that already exist
  'awaiting_approval', // the spec is written and the operator has not approved it. Operator.
  'blocked',         // the ceiling, or a declared blocker. Operator.
  'release_gate',    // everything a task can prove is proved. Operator.
  'idle',            // connected, nothing open, no request given
];

/** The agent that owns each dispatchable action. Anything absent is the operator's. */
export const OWNER = {
  plan: 'mavci-architect',
  build: 'mavci-builder',
  rework: 'mavci-builder',
  verify: 'mavci-verifier',
  document: 'mavci-scribe',
};

/** A task whose status is one of these is finished with, one way or another. */
const CLOSED = new Set(['done', 'failed']);

/**
 * The spec pointer `createTask` writes when it has nothing better, plus the
 * watermark convention the scaffold legal pages use. A task pointing at either is
 * a task with no spec, and the architect is what fills it.
 */
const STUB_SPEC = '.mavci/tasks/pending.md';
export const REVIEW_MARKER = 'REVIEW REQUIRED';

const step = (run, why) => ({ run, why });

/**
 * Is the recorded approval about the spec that is on disk NOW?
 *
 * `createHash` is a Node builtin, so hashing here costs no dependency and keeps
 * the decision in the decision module. Hashing a string is pure; this function
 * reads no files - `specText` was gathered for it.
 *
 * THE ROUTER HAS TO ASK THIS, not just leave it to `--advance-phase`. The command
 * refuses on a missing or stale approval, which is correct - but a router that
 * emits a step it knows will be refused sends the orchestrator into a loop it
 * cannot fix, burning its iteration ceiling on the same refusal. Worse, the
 * ceiling is what would eventually stop it, so the symptom would be "the
 * orchestrator gave up" rather than "nobody approved the spec".
 */
export function approvalCurrent(task, specText) {
  const a = task?.spec_approved;
  if (!a || typeof a.spec_sha256 !== 'string') return false;
  if (typeof specText !== 'string') return false;
  if (a.spec_path && task.spec && a.spec_path !== task.spec) return false;
  return createHash('sha256').update(specText).digest('hex') === a.spec_sha256;
}

/**
 * The verdict that is ABOUT the current attempt.
 *
 * Attempt-attributed verdicts only. A per-turn gate verdict is written on every
 * dirty turn with no task id, and reading "the newest file" would let one of those
 * decide the rework loop - which is finding 25 exactly, one directory over: the
 * corpus and the project sharing `guardian/records/`, and a PASSING corpus leaving
 * a failing record as the release gate's input.
 */
export function verdictForAttempt(verdicts, taskId, attempt) {
  if (!Array.isArray(verdicts) || !attempt) return null;
  const mine = verdicts.filter((v) => v && v.task_id === taskId && v.attempt === attempt);
  if (!mine.length) return null;
  // Newest by run_at, falling back to array order for equal or missing stamps.
  return mine.reduce((a, b) => ((b.run_at ?? '') >= (a.run_at ?? '') ? b : a));
}

/** Is this task's spec a real one, or the placeholder `createTask` writes? */
export function hasSpec(task, specText) {
  if (!task?.spec || task.spec === STUB_SPEC) return false;
  if (specText === null || specText === undefined) return false;   // pointer to nothing
  if (String(specText).includes(REVIEW_MARKER)) return false;      // watermarked, not written
  return String(specText).trim().length > 0;
}

/**
 * The one task the chain is about.
 *
 * `in_progress` wins, and there is at most one because `assertSoleInProgress`
 * enforces it at the transition. Otherwise the lowest open id, so a backlog is
 * worked in the order it was allocated rather than in whatever order a directory
 * listing happens to produce.
 */
export function selectTask(tasks) {
  const open = (tasks ?? []).filter((t) => t && !CLOSED.has(t.status));
  const running = open.filter((t) => t.status === 'in_progress');
  if (running.length > 1) {
    return { task: null, conflict: running.map((t) => t.id).sort() };
  }
  if (running.length === 1) return { task: running[0], conflict: null };
  const blocked = open.filter((t) => t.status === 'blocked').sort((a, b) => a.id.localeCompare(b.id));
  const pending = open.filter((t) => t.status === 'pending').sort((a, b) => a.id.localeCompare(b.id));
  return { task: pending[0] ?? blocked[0] ?? null, conflict: null };
}

/**
 * THE DECISION.
 *
 * @param {object} input
 * @param {boolean} input.connected      a manifest exists
 * @param {object|null} input.state      control/state.json
 * @param {object[]} input.tasks         every control task, each merged with its surface half
 * @param {object[]} input.verdicts      every verdict document on disk
 * @param {object|null} input.unverified control/unverified.json
 * @param {string|null} input.specText   the text of the selected task's spec, or null
 * @param {string|null} input.request    a fresh operator request, if one was given
 * @returns {{action:string, dispatch:string|null, task_id:string|null,
 *            why:string, steps:{run:string,why:string}[], operator:boolean}}
 */
export function route(input) {
  const {
    connected = false, state = null, tasks = [], verdicts = [],
    unverified = null, specText = null, request = null,
  } = input ?? {};

  const out = (action, extra) => ({
    action,
    dispatch: OWNER[action] ?? null,
    task_id: null,
    steps: [],
    operator: !OWNER[action],
    ...extra,
  });

  if (!connected) {
    return out('not_connected', {
      why: 'No .mavci/project.json. Nothing here is a Mavci project, so there is no chain to run.',
      steps: [step('/mavci-core:connect', 'onboard this repository first')],
    });
  }

  /* UNVERIFIED STANDS. 0.1.12 built the marker and wrote down, in ROADMAP Phase 2,
   * that the half of fail-closed which moves off the gate has to land on the ship
   * gate. This is the other half of that: enforcement did not run, so the code the
   * chain would build on has not been checked, and dispatching another agent onto
   * it manufactures evidence rather than gathering it. */
  if (unverified) {
    return out('unverified', {
      why: 'control/unverified.json stands: the standards checker faulted and a turn was allowed '
        + 'to end without enforcement. Nothing may be built or verified on unchecked code, because '
        + 'the result would be indistinguishable from a checked one.',
      steps: [
        step('/mavci-core:doctor', 'diagnose the fault - it names the signature'),
        step('/mavci-core:retro', 'file it: a checker fault is a defect in the system, not in this project'),
      ],
    });
  }

  const { task, conflict } = selectTask(tasks);

  if (conflict) {
    return out('blocked', {
      why: `tasks ${conflict.join(' and ')} are both in_progress. Two answers to "what is being `
        + 'built" and one phase gate. This state cannot be produced by the sanctioned commands, '
        + 'so something wrote a control task another way.',
      steps: [
        step('/mavci-core:doctor', 'the seal will say whether the control plane was written outside state.mjs'),
        step(`state.mjs --task-status <id> --status <done|failed|blocked>`, 'close all but one'),
      ],
    });
  }

  if (!task) {
    /* COMPLETED AND UNRELEASED IS NOT THE SAME AS IDLE, and the first version of
     * this router could not tell them apart: `selectTask` correctly excludes a
     * `done` task, so the release branch sat behind a selection that could never
     * return one and `release_gate` was unreachable. Found by the assertion that
     * every action in ACTIONS is reached by some case - an enum entry nothing
     * returns is a state the router claims to handle and does not.
     *
     * The marker is `state.json.phase`, which `--set-phase release` already sets
     * on the passing path and `--begin-plan` already clears on the next task.
     * Inventing a `released` field would be a new state format for a fact two
     * existing writers already carry. */
    if (!request && state?.phase === 'release') {
      return out('release_gate', {
        why: 'No task is open and the project is in the release phase: there is completed work that '
          + 'has not been released. The release gate is the operator’s, and so is the deploy behind it.',
        steps: [
          step('/mavci-core:guardian', 'provenance over the enumerated sites, if isolation is application-filters'),
          step('/mavci-core:release', 'it decides whether a release may be cut; it does not cut one'),
          step('/mavci-core:ship "<next request>"', 'or start the next task, which leaves the release phase'),
        ],
      });
    }
    if (!request) {
      return out('idle', {
        why: 'Connected, and no task is open. Give a request and the chain starts at the architect.',
        steps: [step('/mavci-core:ship "<what you want built>"', 'start a new task')],
      });
    }
    return out('plan', {
      task_id: null,
      why: 'No task is open and a request was given. The architect turns it into a spec with '
        + 'acceptance criteria something can actually check.',
      steps: [
        step(`state.mjs --begin-plan "<title>"`, 'allocate the task and enter the plan phase in one write'),
        step('dispatch mavci-architect', 'it writes the spec; it never writes application code'),
      ],
    });
  }

  const id = task.id;

  /* TWO COUNTERS, TWO USES, AND CONFLATING THEM IS WHAT BROKE THE WALK.
   *
   * `attempts` is the retry POLICY counter - tries against the current ceiling,
   * zeroed by `--reset-attempts`. It answers "may this be retried".
   *
   * `attempts_total` is the verdict IDENTITY counter - tries ever, never reset. It
   * answers "which verdict is about the try that just happened", because that is
   * what a verdict is named and tagged from.
   *
   * This router keyed BOTH off `attempts`, which is correct right up until a
   * reset: after one, `attempts` is 1 while the newest verdict is tagged 4, the
   * lookup misses, and the router sends the builder back over work that had
   * already been verified. Every pure-function case passed while this was broken,
   * because none of them had been through a reset; the end-to-end walk caught it,
   * and R-RESET asserts it so it no longer depends on the walk resetting.
   */
  const attempts = task.attempts ?? 0;
  const tries = typeof task.attempts_total === 'number' ? task.attempts_total : attempts;
  const max = task.max_attempts ?? 3;
  const verdict = verdictForAttempt(verdicts, id, tries);
  const failed = verdict && verdict.verdict !== 'pass';
  const passed = verdict && verdict.verdict === 'pass';
  const exhausted = attempts >= max;

  if (task.status === 'blocked') {
    return out('blocked', {
      task_id: id,
      why: `task ${id} is blocked on ${task.blocked_by ?? '(no reason recorded)'}. A blocked task is `
        + 'a planning problem; a further build attempt is how loops start.',
      steps: [
        step(`/mavci-core:retro`, 'if the blocker is a defect in the system'),
        step(`/mavci-core:waive <check_id> <path>`, 'if the check is wrong about this file'),
        step(`state.mjs --reset-attempts ${id}`, 'after you have changed something'),
      ],
    });
  }

  /* ---- plan ------------------------------------------------------------- */
  if (task.phase === 'plan') {
    if (!hasSpec(task, specText)) {
      /* NEVER NAME THE STUB AS THE DESTINATION. `createTask` writes
       * `.mavci/tasks/pending.md` as the spec pointer when it has nothing better,
       * and it is one shared path: telling the architect to write there would have
       * every task in the project overwrite one file, and would make a stale spec
       * indistinguishable from the current one. The destination is always the
       * task's own file. Caught on the first real project, where task 0001 still
       * carries the stub pointer. */
      const dest = (!task.spec || task.spec === STUB_SPEC) ? `.mavci/tasks/${id}.md` : task.spec;
      return out('plan', {
        task_id: id,
        why: `task ${id} has no spec${task.spec === STUB_SPEC ? ` (it still points at the shared ${STUB_SPEC} stub)` : ` at ${task.spec ?? '(no pointer)'}`}. `
          + 'The builder cannot start from a title, and a spec with no checkable criteria is what '
          + 'makes a verdict arguable.',
        steps: [
          step('dispatch mavci-architect', `it writes ${dest}`),
          ...(task.spec === STUB_SPEC
            ? [step(`update .mavci/tasks/${id}.json spec -> ${dest}`,
              'the surface half is agent-writable; the architect repoints it as part of writing the spec')]
            : []),
        ],
      });
    }
    /* THE OPERATOR GATE THE CHAIN DID NOT HAVE.
     *
     * A spec exists and nobody has approved it, or it changed after approval.
     * `--advance-phase` refuses either way, so the router stops HERE instead of
     * emitting a step that cannot succeed. This is the gate that makes the
     * orchestrator an executor of decisions rather than a maker of them, and it
     * is the one place in the chain where a written spec waits on a person. */
    if (!approvalCurrent(task, specText)) {
      const stale = !!task.spec_approved;
      return out('awaiting_approval', {
        task_id: id,
        why: `task ${id} has a spec at ${task.spec} and `
          + (stale
            ? 'the recorded approval is for a different version of it - the spec changed after it '
              + 'was approved, so the approval no longer describes the document the builder would '
              + 'implement.'
            : 'no recorded operator approval. The orchestrator carries a decision forward; it does '
              + 'not make one, and there is no decision on record yet.')
          + ' Read the acceptance criteria before approving: a wrong spec is the most expensive '
          + 'thing in this system to discover late.',
        steps: [
          step(`state.mjs --approve-spec ${id}`, 'records YOUR decision, together with the hash of the spec it is about'),
          step(`/mavci-core:ship`, 'then the chain continues from here on its own'),
        ],
      });
    }

    return out('build', {
      task_id: id,
      why: `task ${id} has an approved spec and no attempt yet.`,
      steps: [
        step(`state.mjs --advance-phase ${id} --from plan --to build`,
          'the SCOPED transition, not a free --set-phase: it refuses unless the spec is approved '
          + 'and the task is where this says it is. App code is not writable in any other phase'),
        step(`state.mjs --attempt ${id} --agent mavci-builder`, 'consume an attempt before the work, not after'),
        step('dispatch mavci-builder', `it implements ${task.spec}`),
      ],
    });
  }

  /* ---- build ------------------------------------------------------------ */
  if (task.phase === 'build') {
    if (attempts === 0) {
      return out('build', {
        task_id: id,
        why: `task ${id} is in the build phase with no attempt consumed.`,
        steps: [
          step(`state.mjs --attempt ${id} --agent mavci-builder`, 'the counter that ends the loop moves first'),
          step('dispatch mavci-builder', `it implements ${task.spec}`),
        ],
      });
    }
    if (!verdict) {
      return out('verify', {
        task_id: id,
        why: `attempt ${attempts} of task ${id} has been built and no verdict names it.`,
        steps: [
          step(`state.mjs --advance-phase ${id} --from build --to verify`,
            'this also freezes application code, which is the point'),
          step('dispatch mavci-verifier', `it runs verify.mjs --record --task ${id}`),
        ],
      });
    }
    // A verdict exists while still in the build phase: the verifier ran and the
    // phase was not advanced. Route on the verdict, which is the evidence.
  }

  /* ---- the verdict decides ---------------------------------------------- */
  if (failed && exhausted) {
    return out('blocked', {
      task_id: id,
      why: `task ${id} failed attempt ${attempts} of ${max}. The ceiling is reached, and a fourth `
        + 'attempt is how a loop starts rather than how it ends.',
      steps: [
        step(`state.mjs --block ${id} --reason "<dominant check_id or error class>"`,
          'a terminal state with no reason is a future mystery'),
        step('/mavci-core:retro', 'three failures on one spec is usually a system finding, not a code one'),
      ],
    });
  }

  if (failed) {
    return out('rework', {
      task_id: id,
      why: `attempt ${attempts} of task ${id} FAILED with ${verdict.summary?.blockers ?? '?'} blocker(s). `
        + `${max - attempts} attempt(s) remain. THIS IS THE STEP THAT DID NOT EXIST: a failed verify `
        + 'left the phase at `verify`, which the builder refuses, so the loop the ceiling was written '
        + 'for could not be entered without a privileged phase move.',
      steps: [
        step(`state.mjs --advance-phase ${id} --from verify --to build`,
          'the rework redispatch moves the phase back through the SAME gate as every other move, '
          + 'not through a free set - operator, this turn'),
        step(`state.mjs --attempt ${id} --agent mavci-builder`, 'attempt ' + (attempts + 1) + ` of ${max}`),
        step('dispatch mavci-builder',
          `pass the failing verdict's checks[] VERBATIM - file paths and line numbers. `
          + 'Re-deriving them spends the attempt that is left.'),
      ],
    });
  }

  if (passed) {
    // `selectTask` never returns a `done` task, so this branch is only ever
    // reached while the task is still open - which is exactly when the record
    // has not been written. The release gate is handled where a done task
    // actually lands: the no-open-task path above.
    return out('document', {
      task_id: id,
      why: `task ${id} passed attempt ${attempts}. What is left is the record: a changelog entry and `
        + 'a task summary, rendered from the verdict and the diff, which both already exist.',
      /* ORDER MATTERS HERE, and the first version had it backwards.
       * `--set-phase` carries the IN_PROGRESS task with it, so closing the task
       * first left the task frozen at `verify` while the project moved to
       * `release` - reproducing, through the close path, exactly the divergence
       * `--set-phase` was fixed to prevent. Observed on gate5: `state.phase =
       * release` over `task 0001 phase = verify`, on a task that had passed.
       * Phase first, close second, and the two halves agree at rest. */
      steps: [
        step('dispatch mavci-scribe', 'it transcribes from named sources; it does not reconstruct'),
        step(`state.mjs --advance-phase ${id} --from verify --to release`,
          'FIRST: the scoped transition moves this task and the project together, and a task '
          + 'closed beforehand is left behind'),
        step(`state.mjs --task-status ${id} --status done`, 'then close it - that is what marks the record written'),
      ],
    });
  }

  /* ---- verify ----------------------------------------------------------- */
  if (task.phase === 'verify') {
    return out('verify', {
      task_id: id,
      why: `task ${id} is in the verify phase and no verdict names attempt ${attempts}.`,
      steps: [step('dispatch mavci-verifier', `it runs verify.mjs --record --task ${id}`)],
    });
  }

  if (task.phase === 'release') {
    return out('release_gate', {
      task_id: id,
      why: `task ${id} is in the release phase.`,
      steps: [step('/mavci-core:release', 'the gate decides; the operator cuts')],
    });
  }

  /* Unreachable via the sanctioned commands - and therefore reported rather than
   * guessed at. A router that invents a next step for a state it does not
   * recognise is a router that will invent one for a corrupted control plane. */
  return out('blocked', {
    task_id: id,
    why: `task ${id} is in a state this router does not recognise: phase=${task.phase} `
      + `status=${task.status} attempts=${attempts} verdict=${verdict ? verdict.verdict : 'none'}. `
      + 'No sanctioned command produces it.',
    steps: [step('/mavci-core:doctor', 'start with the seal and the schema'),
      step('/mavci-core:retro', 'then file it - an unroutable state is a defect in the model')],
  });
}

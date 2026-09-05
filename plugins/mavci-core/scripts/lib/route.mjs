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
  'incomplete',      // a verdict that does not say what the acceptance criteria returned. Operator.
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
/**
 * What a verdict actually says: `pass`, `fail`, `incomplete`, or null for none.
 *
 * cartoonify finding 6. `verdict.verdict === 'pass'` was the whole test, and it
 * is true of a verdict that examined none of the acceptance criteria - which is
 * every verdict written before 0.1.33, because the field did not exist. Task
 * 0001 recorded `pass` with criterion 4 reproducibly failing and the router
 * answered `document`.
 *
 * FAIL-CLOSED ON ABSENCE, and that is the load-bearing line. An old verdict with
 * no `criteria[]` decides nothing rather than deciding wrongly. It means every
 * project on disk today stops here instead of closing tasks, which is the
 * intended cost: the alternative is that they all silently become passes.
 *
 * FAIL BEATS INCOMPLETE. A criterion that failed is actionable - the builder has
 * somewhere to go - while `incomplete` is a question for a person. A verdict
 * holding both is reported as the one that can be worked on.
 */
export function verdictOutcome(verdict) {
  if (!verdict) return null;
  const criteria = Array.isArray(verdict.criteria) ? verdict.criteria : null;
  if (verdict.verdict === 'fail') return 'fail';
  if (criteria && criteria.some((c) => c && c.status === 'fail')) return 'fail';
  if (verdict.verdict === 'incomplete') return 'incomplete';
  if (!criteria || criteria.length === 0) return 'incomplete';
  if (criteria.some((c) => !c || c.status === 'not_run')) return 'incomplete';
  return verdict.verdict === 'pass' ? 'pass' : 'incomplete';
}

/** `29 of 32 criteria executed, 2 inspected, 1 skipped` - the sentence the gate can say. */
export function criteriaSummary(verdict) {
  const c = Array.isArray(verdict?.criteria) ? verdict.criteria : [];
  if (!c.length) return 'no acceptance criteria recorded';
  const executed = c.filter((x) => x?.mode === 'executed' && x.status !== 'skipped').length;
  const inspected = c.filter((x) => x?.mode === 'inspected' && x.status !== 'skipped').length;
  const skipped = c.filter((x) => x?.status === 'skipped').length;
  const parts = [`${executed} of ${c.length} criteria executed`];
  if (inspected) parts.push(`${inspected} inspected (READ, not run)`);
  if (skipped) parts.push(`${skipped} skipped by decision`);
  return parts.join(', ');
}

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
 * The one task the chain is about, and separately the ones parked.
 *
 * `in_progress` wins, and there is at most one because `assertSoleInProgress`
 * enforces it at the transition. Otherwise the lowest open id, so a backlog is
 * worked in the order it was allocated rather than in whatever order a directory
 * listing happens to produce.
 *
 * ------------------------------------------- PARKED IS OPEN AND NOT SELECTABLE
 *
 * 0.1.28. This used to fall back to `blocked[0]`, so a parked task became the
 * task the chain was about and stayed that way forever. Two questions were being
 * answered by one selection - "what is the chain working on" and "what still
 * exists and needs the operator" - and `status` was carrying both.
 *
 * THE TRAP THAT PRODUCED WAS THAT THE HONEST STATUS NEVER CLEARED. Measured on
 * gate6: a task with 23 of 25 acceptance criteria passing, whose two remaining
 * blockers were both outside its own scope - one needing a file the builder is
 * denied, one a checker defect - was parked with `--block`, which is exactly what
 * `blocked` means. The router then kept routing on it and kept discarding the
 * operator's new request, and the only two statuses that would free it assert
 * work that is not complete (`done`) or a failure on the merits that did not
 * happen (`failed`). An operator wanting to start new work was offered a
 * permanently occupied chain or a false record.
 *
 * NEITHER CHEAP FIX IS TAKEN, and both were considered. Adding `blocked` to
 * `CLOSED` makes parked work vanish like finished work, which is worse than the
 * trap. Telling operators to use `failed` writes something untrue into the
 * control plane to unblock a tool. The lever is SELECTABILITY, not closure: a
 * parked task's lifecycle stage is "not finished" and its routing role is "not
 * current", and those are different axes.
 *
 * So parked tasks come back in their own field. Every caller that has nothing
 * else to route on reports them - see the `blocked` arm in `decide` - which is
 * what keeps parking visible rather than silent, and no new status enters the
 * enum for readers to learn.
 *
 * @returns {{task: object|null, parked: object[], conflict: string[]|null}}
 */
export function selectTask(tasks) {
  const open = (tasks ?? []).filter((t) => t && !CLOSED.has(t.status));
  const parked = open.filter((t) => t.status === 'blocked').sort((a, b) => a.id.localeCompare(b.id));
  const running = open.filter((t) => t.status === 'in_progress');
  if (running.length > 1) {
    return { task: null, parked, conflict: running.map((t) => t.id).sort() };
  }
  if (running.length === 1) return { task: running[0], parked, conflict: null };
  const pending = open.filter((t) => t.status === 'pending').sort((a, b) => a.id.localeCompare(b.id));
  return { task: pending[0] ?? null, parked, conflict: null };
}

/** One line per parked task, for a `why` that names them rather than counting them. */
function parkedSummary(parked) {
  return parked.map((t) => `${t.id} (${t.blocked_by ?? 'no reason recorded'})`).join('; ');
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

  const { task, parked, conflict } = selectTask(tasks);

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
    /* NOTHING ACTIONABLE AND NOTHING ASKED FOR, BUT SOMETHING IS PARKED. This is
     * the one place a parked task is reported, and it is why `selectTask` no
     * longer returns one as the subject: parked work must stay visible without
     * occupying the chain. Named, not counted - an operator deciding whether to
     * resume needs the reason, and `blocked_by` is where the honest one was put. */
    if (!request && parked.length) {
      return out('blocked', {
        task_id: parked[0].id,
        why: `No task is actionable. ${parked.length} parked: ${parkedSummary(parked)}. A parked task `
          + 'is a planning problem, and a further build attempt is how loops start - but it does not '
          + 'hold the chain: give a request and the architect starts a new task beside it.',
        steps: [
          step('/mavci-core:ship "<what you want built>"', 'start new work - a parked task does not block it'),
          step('/mavci-core:retro', 'if the blocker is a defect in the system'),
          step(`/mavci-core:waive <check_id> <path>`, 'if the check is wrong about this file'),
          step(`state.mjs --reset-attempts ${parked[0].id}`, 'then resume it, after you have changed something'),
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
        + 'acceptance criteria something can actually check.'
        + (parked.length ? ` ${parked.length} parked task(s) stay parked: ${parkedSummary(parked)}.` : ''),
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
  const outcome = verdictOutcome(verdict);
  const failed = outcome === 'fail';
  const passed = outcome === 'pass';
  const incomplete = outcome === 'incomplete';
  const exhausted = attempts >= max;

  /* A `blocked` arm stood here until 0.1.28 and has moved UP, into the
   * no-actionable-task branch. It is not deleted behaviour, it is the same
   * report from the only place that can now produce it: `selectTask` no longer
   * returns a parked task as the subject, so `task.status === 'blocked'` is
   * unreachable here. Leaving the old arm in place would have been a second
   * writer for one fact, and the one that could never fire. */

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

  /* ---- the verdict does not answer -------------------------------------
   * Ahead of `passed`, and that ordering is the finding. On the broken build
   * this state WAS `passed`: `verdict.verdict === 'pass'` is true of a verdict
   * that examined none of the acceptance criteria, so the router said
   * `document` and the task would have closed. Placing this arm after `passed`
   * would leave it unreachable and look exactly like a fix.
   */
  if (incomplete) {
    const missing = !Array.isArray(verdict.criteria) || verdict.criteria.length === 0;
    const notRun = missing ? [] : verdict.criteria.filter((c) => c && c.status === 'not_run');
    return out('incomplete', {
      task_id: id,
      why: `attempt ${attempts} of task ${id} has a verdict that does not say whether the acceptance `
        + `criteria were met: ${missing
          ? 'it records no `criteria[]` at all'
          : `${notRun.length} of ${verdict.criteria.length} criteria are not_run (${notRun.slice(0, 6).map((c) => c.id).join(', ')})`}. `
        + 'A criterion nobody ran is not a criterion that passed, and the spec is what the operator '
        + 'approved by hash. This is NOT a failure of the code: nothing here says the work is wrong, '
        + 'only that the record does not answer.',
      steps: [
        step(`/mavci-core:verify ${id}`,
          're-run it once the verifier can record per-criterion results. Until that lands nothing '
          + 'populates `criteria[]`, and this arm will keep reporting - which is the intended '
          + 'fail-closed state, not a malfunction'),
        step('/mavci-core:retro',
          'if the verdict is empty because the system cannot record criteria yet, the finding is in '
          + 'the system and not in this project'),
        step(`state.mjs --task-status ${id} --status done`,
          'THE OPERATOR\'S OVERRIDE, and it is named rather than hidden because leaving the only '
          + 'exit unwritten is how a fail-closed gate becomes a deadlock. It closes the task on '
          + 'evidence the control plane does not hold, and the verdict on disk will still say the '
          + 'criteria were never examined'),
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
      /* THE SPLIT IS IN THE `why`, NOT ONLY IN THE FILE. A criterion that was
       * read rather than run is a legitimate result and a weaker one, and on
       * both projects that fact survived only in a subagent's prose - gate6 task
       * 0002's "execution evidence exists only from the builder agent",
       * cartoonify's criteria 20 and 29 needing a browser the verifier does not
       * have. Recording `mode` and then not reporting it would move the fact
       * from prose into a file nobody opens. */
      why: `task ${id} passed attempt ${attempts} - ${criteriaSummary(verdict)}. What is left is the `
        + 'record: a changelog entry and a task summary, rendered from the verdict and the diff, '
        + 'which both already exist.',
      /* ORDER MATTERS HERE, and the first version had it backwards.
       * `--set-phase` carries the IN_PROGRESS task with it, so closing the task
       * first left the task frozen at `verify` while the project moved to
       * `release` - reproducing, through the close path, exactly the divergence
       * `--set-phase` was fixed to prevent. Observed on gate5: `state.phase =
       * release` over `task 0001 phase = verify`, on a task that had passed.
       *
       * THIRD ORDERING DEFECT AT THIS STEP LIST, AND THE ORDER IS NOT WHAT
       * CHANGED. Finding 7: the scribe, dispatched by step 1, wrote the approved
       * spec, and step 2 - `--advance-phase` - refuses on a changed approval
       * hash. The sequence broke itself.
       *
       * Two fixes were available and both are wrong, so the reasoning is written
       * here rather than left to be re-derived on the fourth occasion.
       *
       * REORDERING - advance first, dispatch second - makes the sequence exit 0
       * and leaves the approved document mutated AFTER the last thing that checks
       * it. The refusal never fires, the damage still happens, and nothing
       * reports it. That is a working control made silent, which is worse than
       * the deadlock: the deadlock was loud.
       *
       * MAKING THE DEPENDENCIES EXPLICIT - steps carrying preconditions, ordered
       * by a solver - encodes "advance-phase needs the hash intact" as a
       * SCHEDULING constraint. It is not one. The invariant is "the approved
       * document does not change", full stop, and expressing it as an ordering
       * asserts the opposite: that changing it is fine if you sequence around it.
       * It is also machinery ROADMAP forbids, added to a pure decision function,
       * to hold a hazard rather than remove it.
       *
       * So the writer that could break the precondition no longer can:
       * `risk-guard.mjs` denies every agent a write to an APPROVED spec, and the
       * scribe's edit scope no longer names `.mavci/tasks/**` at all. What is
       * left below is the ONE real dependency - phase before close - which was
       * already right, and is now right because nothing can invalidate it rather
       * than because the order was guessed a third time.
       * Phase first, close second, and the two halves agree at rest. */
      steps: [
        step('dispatch mavci-scribe',
          'it transcribes from named sources; it does not reconstruct. The task summary goes in '
          + `.mavci/tasks/${id}.summary.md - NOT the spec, which is the document the operator `
          + 'approved and which the very next step hashes'),
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

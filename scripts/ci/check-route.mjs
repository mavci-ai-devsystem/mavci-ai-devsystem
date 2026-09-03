#!/usr/bin/env node
/**
 * The router answers the question the chain was missing, and refuses the states
 * where nobody may proceed.
 *
 * -------------------------------------------------------------- WHY THIS EXISTS
 *
 * Nothing carried a task from one agent to the next. Each skill ended by telling
 * the operator which slash command to type, and a FAILED verify ended by saying
 * "stop - do not fix it here" and naming nothing. Since the builder refuses to
 * start unless the phase is `build`, and a failed verify leaves the phase at
 * `verify`, THE REWORK LOOP WAS NOT MERELY UNAUTOMATED - IT WAS UNREACHABLE
 * without a privileged phase move nobody was told to make. `max_attempts: 3` was
 * being tracked for a loop that had no entrance.
 *
 * ------------------------------------------------------------ THE FOUR THAT BITE
 *
 * Most of the table below is the happy path and most of it would pass against a
 * router that simply advanced a counter. Four assertions discriminate, and each
 * corresponds to a defect this repository has already paid for once:
 *
 *   R-REWORK   a failing verdict under the ceiling routes BACK TO THE BUILDER and
 *              the steps include the phase move. This is the missing edge itself.
 *
 *   R-CEILING  a failing verdict AT the ceiling routes to `blocked` with
 *              `dispatch: null`. A router that reworks forever is worse than one
 *              that never reworks: the ceiling is the only thing that ends a loop
 *              with a decision instead of exhausted patience.
 *
 *   R-ADHOC    a per-turn gate verdict - `task_id: null`, written on every dirty
 *              turn - must decide NOTHING. Finding 25 is exactly this one
 *              directory over: the corpus and the project shared
 *              `guardian/records/`, the release gate read "the newest file", and a
 *              PASSING corpus left a failing record as the gate's input.
 *
 *   R-ATTEMPT  a verdict about attempt 1 must not settle attempt 2. Same shape,
 *              one axis over, and the reason attribution had to land before the
 *              router could be written at all.
 *
 * R-UNVERIFIED is the fifth, and it is tested MID-BUILD rather than at idle: a
 * router that consults `unverified.json` only when it has nothing else to say
 * passes an idle-state test and lets the chain run on unchecked code, which is the
 * half of fail-closed ROADMAP Phase 2 says must move to the ship gate.
 *
 * ------------------------------------------------------- WHAT THIS CANNOT SEE
 *
 * It asserts what the router DECIDES. It cannot assert that `skills/ship/` obeys
 * the decision - a skill is prose read by a model, and the only thing standing
 * behind it is that every step the router names is a command that still passes
 * through risk-guard. That gap is real and named here rather than papered over.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const VERIFY = path.join(SCRIPTS, 'verify.mjs');
const ROUTE_CLI = path.join(SCRIPTS, 'route.mjs');
const AGENTS = path.join(ROOT, 'plugins', 'mavci-core', 'agents');

const { route, ACTIONS, OWNER, verdictForAttempt, selectTask, hasSpec } =
  await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'route.mjs')).href);
const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

/* ------------------------------------------------------------- fixtures */

const task = (over = {}) => ({
  id: '0001', phase: 'build', status: 'in_progress',
  attempts: 1, max_attempts: 3, owner_agent: 'mavci-builder',
  blocked_by: null, verdicts: [], title: 't', spec: '.mavci/tasks/0001.md',
  spec_approved: approvalFor(), ...over,
});
const verdict = (over = {}) => ({
  task_id: '0001', attempt: 1, verdict: 'fail', run_at: '2026-09-03T00:00:00Z',
  summary: { blockers: 2 }, ...over,
});
/* The spec text, and an approval helper whose hash MATCHES it. Every case that
 * expects the chain to move past `plan` needs one, because an unapproved spec is
 * now an operator gate rather than a green light - which is the point. */
const SPEC_TEXT = '# spec\n\nreal content';
const SPEC_SHA = createHash('sha256').update(SPEC_TEXT).digest('hex');
const approvalFor = (sha = SPEC_SHA, spec = '.mavci/tasks/0001.md') => ({
  at: '2026-09-03T00:00:00Z', by: 'operator', spec_path: spec, spec_sha256: sha,
});
const base = (over = {}) => ({
  connected: true, state: { phase: 'build' }, tasks: [task()], verdicts: [],
  unverified: null, specText: SPEC_TEXT, request: null, ...over,
});

/* ================================================== A. THE ROUTING TABLE */

console.log('\nA. the routing table:');

{
  const r = route({ connected: false });
  check(r.action === 'not_connected' && r.dispatch === null && r.operator,
    `A1 no manifest routes to not_connected with no dispatch - got ${r.action}/${r.dispatch}`);
}
{
  const r = route(base({ tasks: [], request: null }));
  check(r.action === 'idle' && r.dispatch === null,
    `A2 connected with no task and no request is idle - got ${r.action}`);
}
{
  const r = route(base({ tasks: [], request: 'add a billing portal' }));
  check(r.action === 'plan' && r.dispatch === 'mavci-architect',
    `A3 a request with no open task starts at the architect - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((s) => /--begin-plan/.test(s.run)),
    'A3b and the steps allocate the task with --begin-plan, the one-write transition');
}
{
  const r = route(base({
    tasks: [task({ phase: 'plan', status: 'pending', attempts: 0, spec: '.mavci/tasks/pending.md' })],
    specText: null,
  }));
  check(r.action === 'plan' && r.dispatch === 'mavci-architect',
    `A4 a task pointing at the pending.md stub still needs the architect - got ${r.action}`);
  // The stub is ONE SHARED PATH. Naming it as the destination would have every
  // task in the project overwrite one file and make a stale spec
  // indistinguishable from the current one. Found on the first real project,
  // whose task 0001 still carries the stub pointer.
  check(r.steps.some((s) => /writes \.mavci\/tasks\/0001\.md/.test(s.run + s.why))
    && !r.steps.some((s) => /writes .*pending\.md/.test(s.run + s.why)),
    'A4b and it names the task\'s OWN file as the destination, never the shared stub - '
    + `steps: ${r.steps.map((s) => s.why).join(' | ').slice(0, 160)}`);
}
{
  const PLAN = { phase: 'plan', status: 'pending', attempts: 0, attempts_total: 0 };

  /* A5-GATE: A WRITTEN SPEC IS NOT A GREEN LIGHT.
   *
   * Operator, this turn: "The approval that unlocks it is the operator's,
   * recorded in the task record, so the orchestrator is executing a decision
   * rather than making one."
   *
   * A5-GATE and A5 must BOTH be here, and the operator named the reason in the
   * same turn: an --advance-phase that refuses every time "would have refused
   * every time and looked like a working gate". A gate that always says no is
   * indistinguishable from one that works until someone has a legitimate
   * transition to make, so the refusal and the permission are asserted together.
   */
  const unapproved = route(base({ tasks: [task({ ...PLAN, spec_approved: null })] }));
  check(unapproved.action === 'awaiting_approval' && unapproved.dispatch === null,
    `A5-GATE a written but UNAPPROVED spec stops at the operator, dispatching nobody - `
    + `got ${unapproved.action}/${unapproved.dispatch}`);
  check(unapproved.steps.some((x) => /--approve-spec 0001/.test(x.run)),
    'A5-GATE-b and it names the command that records the decision');

  const stale = route(base({
    tasks: [task({ ...PLAN, spec_approved: approvalFor('f'.repeat(64)) })],
  }));
  check(stale.action === 'awaiting_approval' && /changed after it was approved/.test(stale.why),
    `A5-GATE-c an approval whose hash no longer matches the spec is STALE, not valid - `
    + `got ${stale.action}. Without this the approval is a permanent unlock and the spec `
    + `can be rewritten after it.`);

  const r = route(base({ tasks: [task(PLAN)] }));
  check(r.action === 'build' && r.dispatch === 'mavci-builder',
    `A5 and an APPROVED spec goes to the builder - got ${r.action}`);
  check(r.steps.some((x) => /--advance-phase 0001 --from plan --to build/.test(x.run))
    && r.steps.some((x) => /--attempt 0001/.test(x.run))
    && !r.steps.some((x) => /--set-phase/.test(x.run)),
    'A5b and it names the SCOPED transition, never a free --set-phase - '
    + `steps: ${r.steps.map((x) => x.run).join(' | ')}`);
}
{
  const r = route(base({ tasks: [task({ attempts: 0, status: 'pending' })] }));
  check(r.action === 'build', `A6 build phase with no attempt consumed routes to build - got ${r.action}`);
}
{
  const r = route(base({ tasks: [task({ attempts: 1 })], verdicts: [] }));
  check(r.action === 'verify' && r.dispatch === 'mavci-verifier',
    `A7 a built attempt with no verdict routes to the VERIFIER - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((x) => /--advance-phase 0001 --from build --to verify/.test(x.run)),
    'A7b and freezes application code first, through the scoped transition');
}

console.log('\nB. the four that discriminate:');
{
  const r = route(base({ tasks: [task({ attempts: 1 })], verdicts: [verdict()] }));
  check(r.action === 'rework' && r.dispatch === 'mavci-builder',
    `R-REWORK a failing verdict under the ceiling routes BACK to the builder - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((x) => /--advance-phase 0001 --from verify --to build/.test(x.run)),
    'R-REWORK-b and the phase move back to build goes through the SAME gate as every other move '
    + '- operator, this turn - so the rework edge is not a free --set-phase either');
  check(r.steps.some((s) => /VERBATIM/.test(s.why)),
    'R-REWORK-c and the retry carries the failing verdict rather than a fresh start');
}
{
  const r = route(base({ tasks: [task({ attempts: 3, max_attempts: 3 })], verdicts: [verdict({ attempt: 3 })] }));
  check(r.action === 'blocked' && r.dispatch === null,
    `R-CEILING a failing verdict AT the ceiling blocks and dispatches nobody - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((s) => /--block 0001/.test(s.run)),
    'R-CEILING-b and it names --block, which records WHY as well as that');
}
{
  // A per-turn gate verdict: no task id, failing, newer than anything else.
  const gateTurn = { task_id: null, attempt: null, verdict: 'fail', run_at: '2999-01-01T00:00:00Z', summary: { blockers: 9 } };
  const r = route(base({ tasks: [task({ attempts: 1 })], verdicts: [gateTurn] }));
  check(r.action === 'verify',
    `R-ADHOC an unattributed per-turn verdict decides NOTHING - got ${r.action} (must be verify)`);
}
{
  const r = route(base({
    tasks: [task({ attempts: 2 })],
    verdicts: [verdict({ attempt: 1, verdict: 'pass' })],
  }));
  check(r.action === 'verify',
    `R-ATTEMPT a verdict about attempt 1 does not settle attempt 2 - got ${r.action} (must be verify)`);
}
{
  /* R-RESET: after --reset-attempts the two counters DISAGREE, and the router
   * must key the verdict lookup on the identity counter, not the ceiling one.
   *
   * `attempts` is 1 (one try against the new ceiling) while the newest verdict is
   * tagged 4 (the fourth try ever, which is what it is named from). A router
   * reading `attempts` misses the lookup and sends the builder back over work
   * that has already been verified - silently, and only ever after a reset, which
   * is why every pure-function case above passed while this was broken. It was
   * caught by the end-to-end walk, and is asserted here so it does not depend on
   * the walk happening to reset. */
  const r = route(base({
    tasks: [task({ attempts: 1, attempts_total: 4 })],
    verdicts: [verdict({ attempt: 4, verdict: 'pass' })],
  }));
  check(r.action === 'document',
    `R-RESET a verdict tagged with the IDENTITY counter is found when the ceiling counter `
    + `disagrees - got ${r.action} (must be document)`);
  const stale = route(base({
    tasks: [task({ attempts: 1, attempts_total: 4 })],
    verdicts: [verdict({ attempt: 1, verdict: 'pass' })],
  }));
  check(stale.action === 'verify',
    `R-RESET-b and a PRE-RESET verdict tagged 1 does not settle the fourth try - `
    + `got ${stale.action} (must be verify)`);
}
{
  // MID-BUILD, deliberately. A router that only consults unverified when idle
  // passes an idle-state test and lets the chain run on unchecked code.
  const r = route(base({
    tasks: [task({ attempts: 1 })],
    verdicts: [verdict()],
    unverified: { schema_version: 1, signature: 'crash', project_id: 'x' },
  }));
  check(r.action === 'unverified' && r.dispatch === null,
    `R-UNVERIFIED an unverified session stops the chain MID-REWORK - got ${r.action}/${r.dispatch}`);
}

console.log('\nC. completion and the operator gates:');
{
  const r = route(base({ tasks: [task({ attempts: 1 })], verdicts: [verdict({ verdict: 'pass' })] }));
  check(r.action === 'document' && r.dispatch === 'mavci-scribe',
    `C1 a passing verdict routes to the SCRIBE - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((s) => /--task-status 0001 --status done/.test(s.run)),
    'C1b and closing the task is what marks the record written - there is no second marker');
  // ORDER. `--set-phase` carries the in_progress task with it, so a task closed
  // first is left behind at `verify` while the project moves to `release` -
  // reproducing, through the close path, the divergence --set-phase was fixed to
  // prevent. Observed on gate5 before this was ordered.
  const iPhase = r.steps.findIndex((s) => /--advance-phase 0001 --from verify --to release/.test(s.run));
  const iClose = r.steps.findIndex((s) => /--task-status 0001 --status done/.test(s.run));
  check(iPhase !== -1 && iClose !== -1 && iPhase < iClose,
    `C1c and the phase move comes BEFORE the close, or the task is left behind - `
    + `--set-phase at step ${iPhase}, close at step ${iClose}`);
}
{
  const r = route(base({
    state: { phase: 'release' },
    tasks: [task({ attempts: 1, status: 'done' })],
    verdicts: [verdict({ verdict: 'pass' })],
  }));
  check(r.action === 'release_gate' && r.dispatch === null && r.operator,
    `C2 a done task hands off to the operator at the release gate - got ${r.action}/${r.dispatch}`);
  check(r.steps.some((s) => /\/mavci-core:release/.test(s.run)),
    'C2b and names /mavci-core:release, which decides but does not cut');
}
{
  const r = route(base({ tasks: [task({ status: 'blocked', blocked_by: 'legal.pages_present' })] }));
  check(r.action === 'blocked' && r.dispatch === null && /legal\.pages_present/.test(r.why),
    `C3 a blocked task blocks and names its blocker - got ${r.action}`);
}
{
  const r = route(base({ tasks: [task({ id: '0001' }), task({ id: '0002' })] }));
  check(r.action === 'blocked' && /0001 and 0002/.test(r.why),
    `C4 two tasks in_progress is unroutable and says which two - got ${r.action}`);
}
{
  const r = route(base({ tasks: [task({ phase: 'release', attempts: 0, status: 'pending' })] }));
  check(r.action === 'release_gate', `C5 the release phase is the operator's - got ${r.action}`);
}
{
  const r = route(base({ tasks: [task({ phase: 'nonsense', attempts: 5, status: 'pending' })] }));
  check(r.action === 'blocked' && /does not recognise/.test(r.why),
    `C6 an unrecognised state is REPORTED, not guessed at - got ${r.action}`);
}

/* ============================================ D. THE SHAPE OF THE ANSWER */

console.log('\nD. the answer is well formed, and the owners exist:');
{
  const seen = new Set();
  const cases = [
    route({ connected: false }),
    route(base({ tasks: [] })),
    route(base({ tasks: [], request: 'x' })),
    route(base({ tasks: [task({ phase: 'plan', attempts: 0, status: 'pending' })], specText: null })),
    route(base({ tasks: [task({ phase: 'plan', attempts: 0, status: 'pending' })] })),
    route(base({ tasks: [task({ attempts: 1 })] })),
    route(base({ tasks: [task({ attempts: 1 })], verdicts: [verdict()] })),
    route(base({ tasks: [task({ attempts: 3 })], verdicts: [verdict({ attempt: 3 })] })),
    route(base({ tasks: [task({ attempts: 1 })], verdicts: [verdict({ verdict: 'pass' })] })),
    route(base({ state: { phase: 'release' }, tasks: [task({ attempts: 1, status: 'done' })], verdicts: [verdict({ verdict: 'pass' })] })),
    route(base({ unverified: { x: 1 } })),
    route(base({ tasks: [task({ phase: 'plan', attempts: 0, status: 'pending', spec_approved: null })] })),
  ];
  let wellFormed = true;
  for (const r of cases) {
    seen.add(r.action);
    if (!ACTIONS.includes(r.action)) { bad(`D1 route returned action "${r.action}", which is not in ACTIONS`); wellFormed = false; }
    if (typeof r.why !== 'string' || r.why.length < 20) { bad(`D1 action ${r.action} carries no usable reason`); wellFormed = false; }
    if (!Array.isArray(r.steps) || !r.steps.length) { bad(`D1 action ${r.action} names no next step`); wellFormed = false; }
    if (r.operator !== !OWNER[r.action]) { bad(`D1 action ${r.action}: operator=${r.operator} disagrees with OWNER`); wellFormed = false; }
  }
  if (wellFormed) ok(`D1 ${cases.length} decisions are all in ACTIONS, all carry a reason and a next step, `
    + 'and `operator` agrees with OWNER in every one');

  const missing = ACTIONS.filter((a) => !seen.has(a));
  check(missing.length === 0,
    `D2 every action in ACTIONS is REACHED by a case above${missing.length ? ` - unreached: ${missing.join(', ')}` : ''}`);

  // An owner that does not exist on disk is a dispatch that fails at the moment
  // it matters. This is check-command-refs' argument, for agents.
  const ghosts = Object.values(OWNER).filter((a) => !fs.existsSync(path.join(AGENTS, `${a}.md`)));
  check(ghosts.length === 0,
    `D3 every agent OWNER names exists in agents/${ghosts.length ? ` - MISSING: ${ghosts.join(', ')}` : ''}`);

  const roster = fs.readdirSync(AGENTS).filter((f) => f.startsWith('mavci-') && f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  const unrouted = roster.filter((a) => !Object.values(OWNER).includes(a) && a !== 'mavci-guardian');
  check(unrouted.length === 0,
    'D4 every agent in the roster except guardian is reachable from the router'
    + `${unrouted.length ? ` - UNREACHABLE: ${unrouted.join(', ')}` : ''}`
    + ' (guardian is dispatched by /mavci-core:guardian, which is disable-model-invocation)');
}

/* ======================================== E. THE HELPERS, ON THEIR OWN */

console.log('\nE. the helpers the table is built on:');
check(verdictForAttempt([{ task_id: null, attempt: null, verdict: 'fail' }], '0001', 1) === null,
  'E1 verdictForAttempt ignores an unattributed verdict - the R-ADHOC property at its source');
check(verdictForAttempt([verdict({ attempt: 1 })], '0001', 2) === null,
  'E2 and one about another attempt');
check(verdictForAttempt([verdict({ attempt: 1, run_at: '2026-01-01T00:00:00Z' }),
  verdict({ attempt: 1, verdict: 'pass', run_at: '2026-06-01T00:00:00Z' })], '0001', 1)?.verdict === 'pass',
  'E3 and takes the newest of several about the same attempt');
check(!hasSpec({ spec: '.mavci/tasks/pending.md' }, 'anything'),
  'E4 hasSpec rejects the pending.md pointer createTask writes when it has nothing better');
check(!hasSpec({ spec: '.mavci/tasks/0001.md' }, 'REVIEW REQUIRED - this is a placeholder'),
  'E5 and rejects a watermarked stub, the same convention the scaffold legal pages use');
check(!hasSpec({ spec: '.mavci/tasks/0001.md' }, null),
  'E6 and a pointer to a file that does not exist');
check(hasSpec({ spec: '.mavci/tasks/0001.md' }, '# real spec'),
  'E7 and accepts a real one');
check(selectTask([task({ id: '0003', status: 'pending' }), task({ id: '0002', status: 'pending' })]).task.id === '0002',
  'E8 selectTask works a backlog in allocation order, not directory order');
check(selectTask([task({ id: '0003', status: 'pending' }), task({ id: '0009', status: 'in_progress' })]).task.id === '0009',
  'E9 and an in_progress task outranks a pending one');
check(selectTask([task({ id: '0001', status: 'done' })]).task === null,
  'E10 and a done task is not open');

/* ============================================= F. THE CLI, END TO END */

console.log('\nF. the CLI over a real control plane:');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-route-'));
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));

  const run = (script, args) => {
    try {
      const out = execFileSync(process.execPath, [script, ...args], {
        cwd: tmp, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
      });
      return { out, err: '', status: 0 };
    } catch (err) {
      return { out: err.stdout?.toString() ?? '', err: err.stderr?.toString() ?? '', status: err.status ?? -1 };
    }
  };
  const decide = (extra = []) => {
    const r = run(ROUTE_CLI, ['--json', ...extra]);
    try { return { ...JSON.parse(r.out), _status: r.status }; } catch { return { action: `(unparseable: ${(r.out + r.err).trim().slice(0, 200)})`, _status: r.status }; }
  };

  // Before --init there is a manifest and no state. The gatherer must not crash.
  let d = decide();
  check(d.action === 'idle' || d.action === 'plan' || d.action === 'not_connected',
    `F0 the CLI survives a manifest with no control plane - got ${d.action}`);

  state.init(tmp, MANIFEST);

  d = decide();
  check(d.action === 'idle' && d._status === 1,
    `F1 a fresh project is idle, and exits 1 because the operator owns the next move - got ${d.action}/${d._status}`);

  d = decide(['--request', 'add a health endpoint']);
  check(d.action === 'plan' && d.dispatch === 'mavci-architect' && d._status === 0,
    `F2 with a request it routes to the architect and exits 0 - got ${d.action}/${d._status}`);

  run(STATE, ['--begin-plan', 'add a health endpoint', '--spec', '.mavci/tasks/0001.md']);
  d = decide();
  check(d.action === 'plan' && d.task_id === '0001',
    `F3 an allocated task with no spec on disk still needs the architect - got ${d.action}`);

  fs.mkdirSync(path.join(tmp, '.mavci', 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'tasks', '0001.md'), '# 0001\n\nAcceptance: /api/health returns 200.\n');
  d = decide();
  check(d.action === 'awaiting_approval' && d.dispatch === null,
    `F4 with the spec on disk and unapproved, the chain stops at the OPERATOR - got `
    + `${d.action}/${d.dispatch}. This is the one place a written spec waits on a person.`);

  const appr = run(STATE, ['--approve-spec', '0001']);
  check(appr.status === 0, `F4b the operator records the decision - exit ${appr.status}`);

  d = decide();
  check(d.action === 'build' && d.dispatch === 'mavci-builder',
    `F4c and ONLY THEN does it route to the builder - got ${d.action}`);

  run(STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  run(STATE, ['--set-phase', 'build']);
  d = decide();
  check(d.action === 'verify' && d.dispatch === 'mavci-verifier',
    `F5 an attempt with no verdict routes to the verifier - got ${d.action}`);

  run(STATE, ['--set-phase', 'verify']);
  // state.json and the task must have moved together - the divergence the live
  // project accumulated came from --set-phase moving only one of them.
  const st = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.state), 'utf8'));
  const ct = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.controlTasks, '0001.json'), 'utf8'));
  check(st.phase === 'verify' && ct.phase === 'verify',
    `F6 --set-phase moved BOTH halves - state=${st.phase} task=${ct.phase}`);

  // A real failing verdict, written by the real verifier over the real checker.
  fs.mkdirSync(path.join(tmp, 'app', 'api', 'bad'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app', 'api', 'bad', 'route.ts'),
    "import { createClient } from '@supabase/supabase-js';\n"
    + "export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);\n"
    + 'export async function GET() { return Response.json({ ok: true }); }\n');
  const v = run(VERIFY, ['--record', '--task', '0001', '--format=human']);
  const wrote = fs.existsSync(path.join(tmp, PATHS.verdicts, '0001-attempt-01.json'));
  check(wrote, `F7 the verifier wrote an attributed verdict (verify exit ${v.status})`);

  d = decide();
  check(d.action === 'rework' && d.dispatch === 'mavci-builder',
    `F8 THE REWORK EDGE, end to end over real files - got ${d.action}/${d.dispatch}`);
  check(d._status === 0, `F8b and it exits 0, because an agent may proceed - got ${d._status}`);

  // The ceiling, walked to.
  fs.rmSync(path.join(tmp, 'app'), { recursive: true, force: true });
  for (let i = 2; i <= 3; i += 1) {
    run(STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
    run(STATE, ['--set-phase', 'build']);
    fs.mkdirSync(path.join(tmp, 'app', 'api', 'bad'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'app', 'api', 'bad', 'route.ts'),
      "import { createClient } from '@supabase/supabase-js';\n"
      + "export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);\n"
      + 'export async function GET() { return Response.json({ ok: true }); }\n');
    run(STATE, ['--set-phase', 'verify']);
    run(VERIFY, ['--record', '--task', '0001']);
  }
  d = decide();
  check(d.action === 'blocked' && d.dispatch === null && d._status === 1,
    `F9 at the third failure it BLOCKS and hands to the operator - got ${d.action}/${d.dispatch}/${d._status}`);

  // And the clean path: reset, fix the code, verify, and the chain completes.
  fs.rmSync(path.join(tmp, 'app'), { recursive: true, force: true });
  run(STATE, ['--reset-attempts', '0001']);
  run(STATE, ['--attempt', '0001', '--agent', 'mavci-builder']);
  run(STATE, ['--set-phase', 'verify']);
  const clean = run(VERIFY, ['--record', '--task', '0001']);
  d = decide();
  check(d.action === 'document' && d.dispatch === 'mavci-scribe',
    `F10 a passing verdict routes to the scribe - got ${d.action} (verify exit ${clean.status})`);

  /* EXECUTE THE ROUTER'S OWN STEPS, IN THE ROUTER'S OWN ORDER.
   *
   * The first version of this walk ran a hardcoded `--set-phase` then
   * `--task-status`, and stayed GREEN when the router's steps were reordered to
   * the broken sequence - it was asserting that MY order works, which was never
   * in question. The step list is the router's actual instruction to the caller,
   * so obeying it verbatim is the only way this walk says anything about the
   * router. It is also the closest this file gets to testing that `skills/ship/`
   * obeys the decision; it tests that the decision is obeyable and correct when
   * obeyed, which is the half a check can reach. */
  const executed = [];
  for (const s of d.steps) {
    const m = /^state\.mjs\s+(.+)$/.exec(s.run);
    if (!m) continue;
    const args = m[1].match(/"[^"]*"|\S+/g).map((a) => a.replace(/^"|"$/g, ''));
    executed.push(args.join(' '));
    run(STATE, args);
  }
  check(executed.length === 2 && /--advance-phase 0001 --from verify --to release/.test(executed[0])
    && /--status done/.test(executed[1]),
    `F10a the document steps were executed in the router's order - ran: ${executed.join(' THEN ') || '(none)'}`);
  const doneTask = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.controlTasks, '0001.json'), 'utf8'));
  const doneState = JSON.parse(fs.readFileSync(path.join(tmp, PATHS.state), 'utf8'));
  check(doneTask.phase === 'release' && doneState.phase === 'release',
    `F10b closing in the router's order leaves both halves agreeing - task=${doneTask.phase} state=${doneState.phase}`);
  check(doneState.active_task === null,
    `F10c and the closed task is no longer the active one - active_task=${JSON.stringify(doneState.active_task)}`);
  d = decide();
  check(d.action === 'release_gate' && d._status === 1,
    `F11 and a closed task ends at the operator's release gate - got ${d.action}/${d._status}`);

  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failures.length) {
  console.error(`route check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('route: the chain has every edge including the rework loop, the ceiling ends it,');
console.log('       an unattributed verdict decides nothing, and three actions dispatch nobody');

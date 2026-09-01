#!/usr/bin/env node
/**
 * Guardian's DETERMINISTIC half, asserted in CI. Design prediction 2a.
 *
 * Guardian has two properties and only one of them needs a model. Whether it
 * ANSWERS correctly is an operator-run corpus and cannot live here. Whether its
 * machinery works - the worklist, the coverage subtraction, the floor - is `node`
 * code with no model in the loop, it runs with Claude Code absent, and it is where
 * the failure modes this system keeps finding actually live.
 *
 * The specific shape being guarded: **a writer that records `sites_answered`
 * without comparing it against `sites_total`.** A mechanism present,
 * correct-looking, and never connected to the thing it claims to cover. That is the
 * defect this repository has now recorded fifteen times, and it would be invisible
 * from guardian's own output.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const COV = path.join(ROOT, 'plugins/mavci-core/scripts/lib/coverage.mjs');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

async function loadCoverage(mutate) {
  if (!mutate) return import(pathToFileURL(COV).href);
  const src = fs.readFileSync(COV, 'utf8');
  const out = mutate(src);
  if (out === src) throw new Error('mutation was a no-op - the control proves nothing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-cov-'));
  const dest = path.join(dir, 'coverage.mjs');
  fs.writeFileSync(dest, out, 'utf8');
  return import(pathToFileURL(dest).href);
}

const { assessCoverage, GUARDIAN_VERDICT, GUARDIAN_FAIL_REASON } = await loadCoverage(null);
const wl = (n) => ({ sites_total: n, questions: Array.from({ length: n }, (_, i) => ({ site_id: `s${i + 1}` })) });
/** An answer that CLEARS its site. Origins are a closed enum; a missing one is malformed. */
const ans = (id, origin = 'verified_session') => ({ site_id: id, origin });

console.log('guardian coverage arithmetic:');

/* ------------------------------------------------------------- the floor */

// The degenerate case, and it is not hypothetical: check-service-role-sites.mjs's
// N2 control produces exactly this by widening one exclusion.
const emptyClean = assessCoverage(wl(0), { answers: [], findings: [] });
const emptyEager = assessCoverage(wl(0), { answers: [ans('s1')], findings: [] });
check(emptyClean.verdict === 'not_checked',
  `empty worklist + a perfect report -> not_checked (got ${emptyClean.verdict})`);
check(emptyEager.verdict === 'not_checked',
  `empty worklist -> not_checked REGARDLESS of what guardian returned (got ${emptyEager.verdict})`);
check(emptyClean.fail_reason === 'empty_worklist' && /scan/.test(emptyClean.detail ?? ''),
  'the empty-worklist detail points at the scan, not at guardian - it names where to look');

/* -------------------------------------------------- the subtraction itself */

const cases = [
  ['no report at all', wl(2), null, 'fail', 'no_report'],
  ['prose instead of JSON', wl(2), {}, 'fail', 'no_report'],
  ['1 of 2 answered', wl(2), { answers: [ans('s1')] }, 'fail', 'coverage_incomplete'],
  ['same site twice', wl(2), { answers: [ans('s1'), ans('s1')] }, 'fail', 'duplicate_answers'],
  ['an unenumerated site', wl(2), { answers: [ans('s1'), ans('s2'), ans('s9')] }, 'fail', 'unknown_sites'],
  ['a site whose value is request_input', wl(2), { answers: [ans('s1'), ans('s2', 'request_input')] }, 'fail', 'findings'],
  ['request_input and guardian FILED NO finding', wl(2), { answers: [ans('s1'), ans('s2', 'request_input')], findings: [] }, 'fail', 'findings'],
  ['one site answered unknown', wl(2), { answers: [ans('s1'), ans('s2', 'unknown')] }, 'fail', 'undetermined'],
  ['an origin outside the enum', wl(2), { answers: [ans('s1'), ans('s2', 'banana')] }, 'fail', 'malformed_answer'],
  ['an answer with no origin at all', wl(2), { answers: [ans('s1'), { site_id: 's2' }] }, 'fail', 'malformed_answer'],
  ['every site cleared', wl(2), { answers: [ans('s1'), ans('s2', 'internal_constant')] }, 'pass', null],
];
for (const [label, w, r, verdict, reason] of cases) {
  const c = assessCoverage(w, r);
  check(c.verdict === verdict && c.fail_reason === reason,
    `${label} -> ${verdict}/${reason} (got ${c.verdict}/${c.fail_reason})`);
}

// Exactly one shape is a pass. Without this, a mutation that returns `pass`
// everywhere satisfies every individual assertion above that expects a pass.
const all = [wl(0), wl(2)].flatMap((w) => [null, {}, { answers: [] }, { answers: [ans('s1'), ans('s2')], findings: [] }]
  .map((r) => assessCoverage(w, r).verdict));
check(all.filter((v) => v === 'pass').length === 1,
  `exactly one of ${all.length} probe shapes is a pass (got ${all.filter((v) => v === 'pass').length})`);

/* ------------------------------------------------------------ closed enums */

check(GUARDIAN_VERDICT.includes('not_checked') && !GUARDIAN_VERDICT.includes('skipped'),
  'the verdict enum has not_checked and no third soft value to drift into');
check(GUARDIAN_FAIL_REASON.includes('empty_worklist'),
  'empty_worklist is a declared fail_reason, not an ad-hoc string');

/* --------------------------------------------- negative control: the floor */

{
  // Remove the floor. The empty worklist then falls through to the subtraction,
  // where 0 answered of 0 total is complete coverage and the verdict is `pass`.
  const m = await loadCoverage((s) => s.replace('  if (sitesTotal === 0) {', '  if (false) {'));
  const r = m.assessCoverage(wl(0), { answers: [], findings: [] });
  check(r.verdict === 'pass',
    `NEGATIVE CONTROL: with the floor removed, an empty worklist returns "${r.verdict}" - `
    + 'confirming the floor is what stops it, and that the subtraction alone reports perfect coverage of nothing');
}

/* ------------------------- negative control: count instead of set (the shape) */

{
  // THE FIFTEEN-TIMES DEFECT, written as a mutation: a writer that records
  // `sites_answered` as a COUNT and compares it against `sites_total`, instead of
  // checking which sites were actually answered. Two lines, both of them the kind
  // of thing that reads as a simplification in review.
  //
  // A retry loop that answers one site twice then satisfies a two-site worklist,
  // with no bad intent anywhere. The mechanism is present, it looks correct, and
  // it is not connected to the thing it claims to cover.
  const m = await loadCoverage((s) => s
    .replace('    if (seen.has(id)) { duplicates.push(id); continue; }', '')
    .replace('  const unanswered = [...expected].filter((id) => !seen.has(id));',
      '  const unanswered = report.answers.length >= sitesTotal ? [] : [...expected];'));
  const r = m.assessCoverage(wl(2), { answers: [ans('s1'), ans('s1')], findings: [] });
  check(r.verdict === 'pass',
    `NEGATIVE CONTROL: a writer comparing COUNTS lets one site answered twice satisfy a `
    + `two-site worklist (got "${r.verdict}") - which is why sites_answered is a Set and why `
    + 'the duplicate branch exists');
  // And the real module must reject exactly that input.
  const t = assessCoverage(wl(2), { answers: [ans('s1'), ans('s1')], findings: [] });
  check(t.verdict === 'fail' && t.fail_reason === 'duplicate_answers',
    'and the real module rejects that same input as duplicate_answers');
}

/* ------------------------------- the corpus must be invisible to guardian */

// The acceptance corpus is the ONLY evidence that guardian's judgement works, and it
// measures nothing if guardian can recognise a corpus run. The constraint is recorded
// in a `_`-prefixed note in the def - somewhere guardian cannot read - and this
// asserts the note stayed there.
{
  const agent = fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/agents/mavci-guardian.md'), 'utf8');
  const leaks = ['corpus', 'acceptance test', 'being tested', 'evaluation', 'evaluated', 'fixture']
    .filter((w) => new RegExp(w, 'i').test(agent));
  check(leaks.length === 0,
    `the generated guardian agent mentions nothing about being tested (leaked: ${JSON.stringify(leaks)})`);

  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-defs/guardian.json'), 'utf8'));
  check(typeof def._note_corpus === 'string' && /must not be able to tell/i.test(def._note_corpus),
    'and the constraint IS recorded, in a _-prefixed note the generator does not emit');
  check(!def.tools.includes('Bash'),
    `guardian holds no Bash (tools: ${def.tools.join(', ')}) - fully natively contained`);
  check(/BOUNDED ANSWERER, NOT AN ASSESSOR/.test(def.role),
    "the role opens by saying what guardian is: a bounded answerer, not an assessor");
  check(/unknown` IS A REAL ANSWER/i.test(def.role) || /IS A REAL ANSWER/.test(def.role),
    'the role makes `unknown` a first-class answer rather than a failure mode');
}

console.log('');
if (failures.length) {
  console.log(`guardian coverage check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('guardian coverage: the floor holds, the subtraction discriminates, and both negative controls fire');

/* ==================================================================== */
/* THE WRITER. Design 4.3 / 4.3a - the three ways it manufactures a pass. */
/* ==================================================================== */

{
  const os = await import('node:os');
  const { handleSubagentStop, parseReport } = await import(
    pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/guardian-record.mjs')).href);
  const state = await import(pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/state.mjs')).href);

  const BASE = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8'));

  /** A connected project with one open guardian ticket over a two-site worklist. */
  function project() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-gw-'));
    fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(BASE, null, 2));
    state.init(tmp, BASE);
    fs.mkdirSync(path.join(tmp, '.mavci', 'control', 'guardian'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian', 'wl-1.json'),
      JSON.stringify({ sites_total: 2, questions: [{ site_id: 's001' }, { site_id: 's002' }] }));
    fs.writeFileSync(path.join(tmp, '.mavci', 'control', 'guardian', 'ticket.json'),
      JSON.stringify({ project_id: BASE.project_id, worklist_id: 'wl-1',
        worklist_path: '.mavci/control/guardian/wl-1.json', trigger: 'manual' }));
    return tmp;
  }
  const records = (t) => {
    const d = path.join(t, '.mavci', 'control', 'guardian', 'records');
    return fs.existsSync(d) ? fs.readdirSync(d) : [];
  };
  /** The worklist must survive the run that was scored against it. */
  const worklistIntact = (t) => fs.existsSync(path.join(t, '.mavci', 'control', 'guardian', 'wl-1.json'));
  const ticketOpen = (t) => fs.existsSync(path.join(t, '.mavci', 'control', 'guardian', 'ticket.json'));
  const msg = (o) => JSON.stringify(o);

  // --- 1. a stop from any other subagent writes NOTHING ---------------------
  for (const other of ['Explore', 'general-purpose', 'mavci-builder', 'mavci-core:mavci-verifier', undefined]) {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: other, last_assistant_message: msg({ answers: [] }) });
    check(r.action === 'ignored' && records(t).length === 0 && ticketOpen(t),
      `writer: a stop from ${String(other)} writes NO file and leaves the ticket open `
      + `(action=${r.action}, files=${records(t).length})`);
  }
  {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: 'mavci-core:mavci-guardian',
      last_assistant_message: msg({ answers: [{ site_id: 's001', origin: 'verified_session' },
        { site_id: 's002', origin: 'verified_session' }] }) });
    check(r.action === 'recorded', 'writer: the qualified name mavci-core:mavci-guardian IS recognised (6.24)');
  }

  // --- 2. missing or unparseable report leaves the TICKET OPEN --------------
  for (const [label, m] of [['absent', undefined], ['empty', ''], ['prose', 'I reviewed the sites and they look fine.'],
    ['broken JSON', '{ "answers": [ '], ['JSON with no answers array', msg({ verdict: 'pass' })]]) {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian', last_assistant_message: m });
    check(r.action === 'ticket_open' && records(t).length === 0 && ticketOpen(t),
      `writer: a ${label} report leaves the ticket OPEN and writes no record (action=${r.action})`);
  }

  // --- 3. clearing is derived from ORIGIN, never from what guardian claims ---
  {
    const t = project();
    // Guardian asserts a pass and files no findings, while one site's own origin is
    // request_input - the untrusted case. The writer must ignore both claims.
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian', last_assistant_message: msg({
      verdict: 'pass', findings: [],
      answers: [{ site_id: 's001', origin: 'verified_session' },
        { site_id: 's002', origin: 'request_input' }] }) });
    check(r.action === 'recorded' && r.record.verdict === 'fail' && r.record.fail_reason === 'findings',
      `writer: report CLAIMS pass with no findings, but origin request_input decides -> `
      + `${r.record?.verdict}/${r.record?.fail_reason}`);
    check(!ticketOpen(t), 'writer: and the ticket closes only because a record was written');
  }
  {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian', last_assistant_message: msg({
      verdict: 'pass', answers: [{ site_id: 's001', origin: 'verified_session' },
        { site_id: 's002', origin: 'unknown', reason_if_unknown: 'value crosses into middleware' }] }) });
    check(r.record.verdict === 'fail' && r.record.fail_reason === 'undetermined',
      `writer: an \`unknown\` answer is answered-but-not-cleared -> ${r.record?.fail_reason}`);
  }
  {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian', last_assistant_message: msg({
      answers: [{ site_id: 's001', origin: 'verified_session' }] }) });
    check(r.record.verdict === 'fail' && r.record.fail_reason === 'coverage_incomplete',
      `writer: one answer for a two-site worklist -> ${r.record?.fail_reason}`);
  }
  {
    const t = project();
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian',
      last_assistant_message: '```json\n' + msg({ answers: [{ site_id: 's001', origin: 'verified_session' },
        { site_id: 's002', origin: 'internal_constant' }] }) + '\n```' });
    check(r.record.verdict === 'pass' && r.record.fail_reason === null,
      `writer: a fenced, complete, all-clearing report is the ONE path to pass -> ${r.record?.verdict}`);
    check(records(t).length === 1 && !ticketOpen(t),
      `writer: exactly one record written and the ticket closed (files=${records(t).length})`);
    check(worklistIntact(t),
      'writer: and the WORKLIST survives - the record must not overwrite the evidence it was scored against');
  }
  // No ticket => nothing dispatched it => no record, even from guardian itself.
  {
    const t = project();
    fs.unlinkSync(path.join(t, '.mavci', 'control', 'guardian', 'ticket.json'));
    const r = handleSubagentStop(t, { agent_type: 'mavci-guardian', last_assistant_message: msg({
      answers: [{ site_id: 's001', origin: 'verified_session' }, { site_id: 's002', origin: 'verified_session' }] }) });
    check(r.action === 'ignored' && records(t).length === 0,
      'writer: guardian stopping with NO open ticket writes nothing - there is no worklist to score against');
  }
}

/* ==================================================================== */
/* THE SKILL TEXT. Two constraints that are only enforceable in prose,   */
/* so they are asserted on the shipped words rather than on behaviour.   */
/* ==================================================================== */

{
  const raw = fs.readFileSync(
    path.join(ROOT, 'plugins/mavci-core/skills/guardian/SKILL.md'), 'utf8');
  // Prose reflows. Assert on whitespace-normalised text, or a line wrap silently
  // turns a passing assertion into a failing one and someone "fixes" the sentence.
  const skill = raw.replace(/\s+/g, ' ');

  // 1. NEVER INLINE THE WORKLIST. This is the single thing that reintroduces
  //    truncation, and no behavioural test can catch a skill that decides to inline
  //    "just this once" - the instruction is the enforcement, so the instruction is
  //    what gets asserted.
  check(/NEVER INLINE THE WORKLIST/i.test(skill),
    'skill forbids inlining the worklist, in capitals, as its own instruction');
  check(/not when the file write fails/i.test(skill) && /one-site worklist/i.test(skill),
    'and it closes the three excuses by name: write failure, awkward path, a worklist small enough that inlining looks harmless');
  check(/cannot be written, \*\*stop\*\*/i.test(skill),
    'and it says to STOP rather than route around a failed write - the fallback IS the defect');
  check(/truncat/i.test(skill),
    'and it states the reason, so the rule is not obeyed only while someone remembers it');

  // 2. TICKET BEFORE DISPATCH. The window is small and the failure is silent.
  const ticketStep = skill.indexOf('Write the ticket');
  const dispatchStep = skill.indexOf('Dispatch guardian');
  check(ticketStep !== -1 && dispatchStep !== -1 && ticketStep < dispatchStep,
    'skill writes the ticket BEFORE dispatching guardian, in that order in the document');
  check(/BEFORE dispatching, never after/i.test(skill),
    'and says so explicitly in the step heading, not only by ordering');
  check(/crash in between leaves guardian having run with nothing to score it/i.test(skill),
    'and states the failure the order prevents: a crash between the two loses the run silently');

  // 3. The skill refuses the two states that would produce a meaningless worklist.
  check(/residue/i.test(skill) && /sites_total` is 0|sites_total\b[^.]*is 0/i.test(skill),
    'skill stops on a non-zero scan residue and on an empty worklist, rather than dispatching either');
}

/* ---- the writer's hot path does no I/O before deciding it is not guardian ---- */

{
  const src = fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/scripts/guardian-record.mjs'), 'utf8');
  const body = src.slice(src.indexOf('function main()'));
  const gate = body.indexOf('isGuardian(input?.agent_type)');
  const firstIo = Math.min(...['exists(', 'readJsonOrNull(', 'readFileSync(', 'projectRoot()']
    .map((t) => { const i = body.indexOf(t); return i === -1 ? Number.MAX_SAFE_INTEGER : i; }));
  check(gate !== -1 && gate < firstIo,
    'writer: the agent_type gate precedes every filesystem call in main() - this hook fires for '
    + 'EVERY subagent stop in EVERY repo on the machine, so the free discriminator goes first');
}

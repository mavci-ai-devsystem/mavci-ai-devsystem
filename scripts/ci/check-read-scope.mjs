#!/usr/bin/env node
/**
 * Guardian's read scope: that it is enforced, that it refuses with a reason, and
 * that it did not take the thing it protects with it.
 *
 * WHY THIS FILE IS THE CAREFUL ONE. Narrowing an agent's read grant is the change
 * most likely to break the capability the grant exists for. Guardian answers one
 * question - where does this filter value come from - and answering it means
 * following an identifier out of the file it appears in. A scope that stops the
 * trace does not make guardian wrong loudly; it makes guardian answer `unknown`,
 * which is a legitimate value, so the run still completes and still records a
 * verdict. THE FAILURE IS SILENT AND IT LOOKS LIKE AN ANSWER.
 *
 * THE SCOPE THAT WAS REJECTED, and part 1 is the demonstration of why. The obvious
 * scope is "the paths on the worklist" - guardian is told which sites to answer, so
 * let it read those. Against the corpus:
 *
 *   q3v7k  `session.orgId`  <- `lib/auth.ts`      NOT a worklist path
 *   m8f2r  `body.companyId` <- same file          traceable in place
 *   t5w9d  `scopeId`        <- `lib/context.ts`   NOT a worklist path
 *
 * The worklist enumerates QUERY SITES. `lib/auth.ts` and `lib/context.ts` contain
 * no query, so neither is ever on it. Under that scope q3v7k - the degenerate-pass
 * control, the case that makes a green corpus mean anything - fails, because
 * `verified_session` becomes unreachable. And t5w9d PASSES, because it expects
 * `unknown` and guardian was prevented from looking rather than having looked and
 * failed. One case broken, one case green for the wrong reason, and the only case
 * left grading correctly is the one whose answer never leaves its own file. That is
 * a corpus that measures in-file reasoning while claiming to measure provenance.
 *
 * So the scope is allow-everything with a deny list over the run-describing surface.
 *
 * THE ASSERTIONS, and the broken build each must catch:
 *
 *   P1..P3  POSITIVE, and first. Every file each corpus case's trace needs is
 *           readable, and a search rooted where guardian actually works is allowed.
 *           Without these, every negative below is satisfied by denying everything.
 *   P4      DEMONSTRATED FAILING against the worklist-paths scope: it denies the
 *           files q3v7k and t5w9d need, and would leave only m8f2r gradeable.
 *   N1      the manifest is refused, with a reason
 *   N2      the rest of `.mavci/` is refused - records, verdicts, other worklists
 *   N3      a search rooted at the project root is refused, and the reason says it
 *           was refused RATHER THAN NARROWED
 *   N4      the ticket exception is exactly one path: the open ticket's worklist is
 *           readable and a sibling `wl-*.json` is not
 *           broken build: allowing the directory, or a `wl-*.json` glob
 *   N5      with no ticket open, no worklist is readable - which makes the skill's
 *           "ticket first, dispatch second" a rule rather than a request
 *   N6      `..` and absolute paths outside the project are refused, in the path
 *           operand and in a Glob pattern
 *   N7      the OTHER agents are unaffected and still read the manifest
 *           without it, scoping everyone satisfies N1 and breaks the roster
 *   N8      the main session is unaffected
 *           without it, the operator is locked out of their own project
 *   N9      an unreadable scopes file REFUSES rather than falling open
 *   N10     no refusal reason discloses the corpus. The reasons are the one text
 *           guardian can make the system emit at will, so a word in them is a
 *           disclosure channel that no amount of care in the prompt closes.
 *
 * Every assertion here is on the DECISION AND THE REASON TEXT. A check on the
 * decision alone passes against a guard that refuses with an empty string, and this
 * repository has shipped that exact shape more than once.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const GUARD = path.join(SCRIPTS, 'risk-guard.mjs');
const SCOPES = path.join(ROOT, 'plugins', 'mavci-core', 'agents', 'agent-scopes.json');
const load = (...seg) => import(pathToFileURL(path.join(SCRIPTS, ...seg)).href);

const { within } = await load('risk-guard.mjs');
const { stageCase, listCases, EXPECTATIONS, STAGE_DIR } = await load('corpus-stage.mjs');
const state = await load('state.mjs');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const GUARDIAN_SCOPE = JSON.parse(fs.readFileSync(SCOPES, 'utf8'))['mavci-guardian']?.read_scope;
check(!!GUARDIAN_SCOPE, 'POSITIVE: mavci-guardian has a read_scope in agents/agent-scopes.json');

/* ============================================ part 1: which scope SHAPE works
 *
 * A question about the predicate, answered against the predicate. Part 2 drives the
 * real hook; a scope shape that is right in a build that never runs proves nothing,
 * and a hook that runs while enforcing the wrong shape proves nothing either.
 */

const MANIFEST = {
  schema_version: 2, project_id: 'scope', display_name: 'Scope', created: '2026-01-01T00:00:00Z',
  stack: { framework: 'nextjs-14-app-router', language: 'typescript', db: 'supabase-postgres', auth: 'supabase-auth', payments: 'stripe', email: 'resend', ai: 'anthropic', package_manager: 'npm' },
  tenancy: { model: 'shared-schema', isolation: 'application-filters', tenant_column: 'org_id' },
  deploy: { target: 'vercel', prod_branch: 'main', site_url: 'https://scope.example.com' },
  environments: { prod: { supabase_ref: 'scopeprod', protected: true } },
  env_sources: { runtime: 'vercel-project-env', required_keys: ['STRIPE_SECRET_KEY'], never_read_by_agents: true },
  risk_tier: 'standard',
  compliance: {
    jurisdictions: ['TR'], required_pages: ['kvkk'], locales: ['tr'],
    entity: { legal_name: 'Ornek Yazilim Anonim Sirketi', address: 'Ornek Mahallesi Ornek Caddesi No 1 Kadikoy Istanbul', email: 'destek@example.com', mersis: '0000000000000000', kep: 'ornek@hs01.kep.tr' },
  },
  agents: { enabled: ['mavci-guardian'] },
  standards: { packs: ['nextjs-app-router', 'supabase-multitenant-rls'] },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-scope-'));
const project = path.join(tmp, 'project');
fs.mkdirSync(path.join(project, '.mavci'), { recursive: true });
fs.writeFileSync(path.join(project, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules\n.env*\n');
state.init(project, MANIFEST);
state.seal(project);

/**
 * For one case: the worklist paths (the query sites, from the expectation), the other
 * files it ships, and the subset of those a trace actually has to reach. All derived
 * from the artefacts rather than restated here, so a case gaining a helper is covered
 * without anyone remembering to update this file.
 */
function caseShape(caseId) {
  const staged = stageCase(project, caseId);
  const expectation = JSON.parse(fs.readFileSync(path.join(EXPECTATIONS, `${caseId}.json`), 'utf8'));
  const sites = new Set((expectation.expected_answers ?? []).map((a) => a.path));
  const offSite = staged.filter((p) => !sites.has(p));

  // THE TRACE-NEEDED SET IS NOT "everything the case ships", and the difference is
  // the whole of P4. The first version of this used offSite, and every case failed:
  // all three ship `lib/supabase.ts`, the client factory, which no trace ever opens.
  // P4 then reported that the rejected scope broke m8f2r too - which is false, and a
  // demonstration that over-reports is not evidence about the thing it names.
  //
  // A file is trace-needed when it carries an identifier the expectation's `match`
  // quotes. Quoted segments are stripped first so a column name is not mistaken for
  // an identifier, and anything under four characters is dropped: `eq` matches
  // everywhere and would put every file back in the set.
  const identifiers = new Set();
  for (const a of expectation.expected_answers ?? []) {
    const bare = String(a.match ?? '').replace(/"[^"]*"/g, ' ').replace(/'[^']*'/g, ' ');
    for (const m of bare.matchAll(/[A-Za-z_$][\w$]{3,}/g)) identifiers.add(m[0]);
  }
  const traceNeeded = offSite.filter((rel) => {
    const text = fs.readFileSync(path.join(project, rel), 'utf8');
    return [...identifiers].some((id) => text.includes(id));
  });

  return { staged, sites: [...sites], offSite, identifiers: [...identifiers], traceNeeded };
}

const shapes = Object.fromEntries(listCases().map((id) => [id, caseShape(id)]));

const chosenAllow = GUARDIAN_SCOPE.allow ?? ['**'];
const chosenDeny = GUARDIAN_SCOPE.deny ?? [];
const readable = (rel) => within(rel, chosenAllow) && !within(rel, chosenDeny);

for (const [id, s] of Object.entries(shapes)) {
  const unreachable = [...s.sites, ...s.offSite].filter((p) => !readable(p));
  check(unreachable.length === 0,
    `P1 case ${id}: every file its trace needs is readable under the chosen scope - `
    + `${s.sites.length} site(s) plus ${s.offSite.length} file(s) off the worklist `
    + `(unreachable: ${unreachable.join(', ') || 'none'})`);
}

check(within('lib', chosenAllow) && !within('lib', chosenDeny),
  'P2 a search rooted at lib/ is in scope - guardian traces by following imports out of a site, '
  + 'and lib/ is where they go');
check(readable(`${STAGE_DIR}/lib/supabase.ts`),
  'P3 the staging root is readable without being named in the scope: it is allowed by not being '
  + 'denied, so no message the scope can emit ever names it');

/* P4: the rejected scope, reconstructed and run against the same cases. */
const WORKLIST_ONLY = Object.values(shapes).flatMap((s) => s.sites);
const brokenBy = Object.entries(shapes)
  .filter(([, s]) => s.traceNeeded.some((p) => !within(p, WORKLIST_ONLY)))
  .map(([id]) => id);

check(brokenBy.length >= 2 && brokenBy.includes('q3v7k') && brokenBy.includes('t5w9d'),
  'P4 DEMONSTRATED FAILING against the worklist-paths scope: it makes the trace unreachable for '
  + `${brokenBy.join(', ')} - including q3v7k, the degenerate-pass control. Only `
  + `${Object.keys(shapes).filter((id) => !brokenBy.includes(id)).join(', ')} would still grade, `
  + 'and that is the case whose answer never leaves its own file');

check(!brokenBy.includes('m8f2r'),
  'P4 and m8f2r is NOT broken by it - its value never leaves its own file, so P4 reports a real '
  + 'difference between the cases rather than a scope that denies everything');

check(shapes.q3v7k.traceNeeded.some((p) => p.includes('auth'))
  && shapes.t5w9d.traceNeeded.some((p) => p.includes('context'))
  && shapes.m8f2r.traceNeeded.length === 0,
  'P4 and the trace-needed sets are the right ones, not merely non-empty: '
  + Object.entries(shapes).map(([id, s]) => `${id} -> ${s.traceNeeded.join(' ') || '(in-file)'}`).join(', '));

/* ================================================= part 2: the hook, end to end */

function ask(input) {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ ...input, cwd: project }), encoding: 'utf8', timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) { stdout = err.stdout?.toString() ?? ''; }
  if (!stdout.trim()) return { decision: 'allow', reason: '' };
  const o = JSON.parse(stdout).hookSpecificOutput ?? {};
  return { decision: o.permissionDecision ?? 'allow', reason: String(o.permissionDecisionReason ?? '') };
}

const read = (file_path, agent_type) => ({ tool_name: 'Read', tool_input: { file_path }, agent_type });
const grep = (p, agent_type) => ({ tool_name: 'Grep', tool_input: { pattern: 'scopeId', ...(p === null ? {} : { path: p }) }, agent_type });
const glob = (pattern, p, agent_type) => ({ tool_name: 'Glob', tool_input: { pattern, ...(p === null ? {} : { path: p }) }, agent_type });
const G = 'mavci-guardian';

const reasons = [];
/** Assert a decision AND that the reason says something. An empty reason is a refusal
 *  the agent cannot act on, which this repository has shipped and does not accept. */
function expect(label, input, want, mustSay) {
  const r = ask(input);
  reasons.push(r.reason);
  const decisionOk = r.decision === want;
  const reasonOk = want !== 'deny' || (r.reason.length > 40 && mustSay.every((m) => r.reason.includes(m)));
  check(decisionOk && reasonOk,
    `${label} -> ${r.decision}${want === 'deny' ? ` with a reason naming ${mustSay.join(' + ')}` : ''} `
    + `(reason: ${r.reason ? `"${r.reason.slice(0, 90)}..."` : 'EMPTY'})`);
}

const site = shapes.t5w9d.sites[0];
const helper = shapes.t5w9d.offSite.find((p) => p.includes('context')) ?? shapes.t5w9d.offSite[0];

expect('P5 guardian reads its site file', read(site, G), 'allow', []);
expect('P6 guardian reads the helper the trace leaves into', read(helper, G), 'allow', []);
expect('P7 guardian greps lib/', grep(`${STAGE_DIR}/lib`, G), 'allow', []);

expect('N1 the manifest', read('.mavci/project.json', G), 'deny', ['.mavci/project.json', '.mavci/**']);
expect('N2 a guardian record', read('.mavci/control/guardian/records/r1.json', G), 'deny', ['.mavci/**']);
expect('N2 a task spec', read('.mavci/tasks/0001.md', G), 'deny', ['.mavci/**']);
expect('N2 the lessons queue', read('.mavci/lessons/pending-system-change.md', G), 'deny', ['.mavci/**']);
expect('N3 a grep rooted at the project root', grep(null, G), 'deny', ['refused rather than narrowed']);
expect('N3 a glob rooted at the project root', glob('**/*.json', null, G), 'deny', ['refused rather than narrowed']);

/* N4/N5: the ticket exception. */
const wlDir = path.join(project, '.mavci', 'control', 'guardian');
fs.mkdirSync(wlDir, { recursive: true });
fs.writeFileSync(path.join(wlDir, 'wl-mine.json'), '{"questions":[]}');
fs.writeFileSync(path.join(wlDir, 'wl-other.json'), '{"questions":[]}');

expect('N5 no ticket open: even the right worklist is refused',
  read('.mavci/control/guardian/wl-mine.json', G), 'deny', ['.mavci/**']);

fs.writeFileSync(path.join(wlDir, 'ticket.json'),
  JSON.stringify({ worklist_path: '.mavci/control/guardian/wl-mine.json' }));

expect('N4 ticket open: the worklist it names', read('.mavci/control/guardian/wl-mine.json', G), 'allow', []);
expect('N4 ticket open: a SIBLING worklist is still refused - the exception is one path, not the directory',
  read('.mavci/control/guardian/wl-other.json', G), 'deny', ['.mavci/**']);
expect('N4 ticket open: the ticket itself is not readable',
  read('.mavci/control/guardian/ticket.json', G), 'deny', ['.mavci/**']);

expect('N6 a relative escape', read('../elsewhere/secrets.ts', G), 'deny', ['outside it']);
expect('N6 a glob pattern that climbs out', glob('../*.json', `${STAGE_DIR}/lib`, G), 'deny', ['climbs out']);

expect('N7 the builder still reads the manifest', read('.mavci/project.json', 'mavci-builder'), 'allow', []);
expect('N7 the verifier still reads the manifest', read('.mavci/project.json', 'mavci-verifier'), 'allow', []);
expect('N7 the architect still greps the project root', grep(null, 'mavci-architect'), 'allow', []);
expect('N8 the main session reads the manifest', read('.mavci/project.json', undefined), 'allow', []);
expect('N8 the main session greps the project root', grep(null, undefined), 'allow', []);

/* N9: fail closed. The scopes file is moved aside, not edited, and restored in a
 * finally - an assertion that leaves the repository altered when it throws is worse
 * than the assertion is worth. */
const backup = fs.readFileSync(SCOPES, 'utf8');
try {
  fs.rmSync(SCOPES);
  expect('N9 an unreadable scopes file refuses instead of falling open',
    read(`${STAGE_DIR}/lib/supabase.ts`, G), 'deny', ['read scope cannot be', 'Refusing']);
} finally {
  fs.writeFileSync(SCOPES, backup, 'utf8');
}
check(fs.readFileSync(SCOPES, 'utf8') === backup, 'N9 agents/agent-scopes.json was restored byte for byte');

/* N11: THE READ PATH IS SILENT, and this asserts the ordering rather than the code.
 *
 * `Read`, `Grep` and `Glob` now go through this hook, which means it runs on nearly
 * every tool call in every session in every connected project - and the guard also
 * carries two NOTICES that deliberately repeat on every call: an unverified session,
 * and a gate that started and never finished. Attached to reads, either one would
 * print dozens of times a turn and be trained out within a session, which destroys
 * the notice for the Bash calls it was written for.
 *
 * So the read block sits ABOVE both notices in main() and exits before they are
 * computed. That is a line-ordering decision, and a line-ordering decision is exactly
 * the kind that a later refactor tidies away without noticing. The assertion is
 * therefore differential: with the marker on disk, a Bash call must still carry the
 * notice and a Read must not. Asserting only that reads are quiet would pass against
 * a build where the notice had stopped working entirely.                          */

fs.writeFileSync(path.join(project, '.mavci', 'control', 'unverified.json'),
  JSON.stringify({ consecutive: 3, fault: 'checker crash' }));

function rawOut(input) {
  try {
    return execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ ...input, cwd: project }), encoding: 'utf8', timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) { return err.stdout?.toString() ?? ''; }
}

const bashOut = rawOut({ tool_name: 'Bash', tool_input: { command: 'ls' } });
const readOut = rawOut(read(`${STAGE_DIR}/lib/supabase.ts`, G));
const mainReadOut = rawOut(read(`${STAGE_DIR}/lib/supabase.ts`, undefined));

check(bashOut.includes('UNVERIFIED'),
  'N11 CONTROL: a Bash call still carries the unverified-session notice - without this, the two '
  + 'assertions below pass against a build where the notice is simply broken');
check(readOut.trim() === '' && mainReadOut.trim() === '',
  `N11 an allowed read emits nothing at all, for guardian and for the main session, with the same `
  + `marker on disk (guardian: ${readOut.length} bytes, main session: ${mainReadOut.length} bytes)`);

fs.rmSync(path.join(project, '.mavci', 'control', 'unverified.json'), { force: true });

/* N10: the reasons are a channel. Anything guardian can make the system say is
 * something guardian can read, and it can trigger a refusal whenever it likes. */
const TELLS = ['corpus', 'fixture', 'acceptance', 'evaluat', 'staged', 'being tested', 'benchmark', 'graded'];
const leaked = [...new Set(reasons.flatMap((r) => TELLS.filter((t) => r.toLowerCase().includes(t))))];
check(leaked.length === 0,
  `N10 no refusal reason discloses the corpus across ${reasons.length} decisions (found: ${leaked.join(', ') || 'none'})`);

/* N10's broken build: the reason text this scope was NOT written with. A positive
 * allow-list has to name the staging root to let a staged case be read, and the
 * refusal enumerating it hands guardian the name. */
const positiveListReason = 'mavci-guardian may only read app/**, src/**, lib/**, corpus-run/**, '
  + 'and the worklist it was given.';
check(TELLS.some((t) => positiveListReason.toLowerCase().includes(t)),
  'N10 DEMONSTRATED FAILING against the positive allow-list this scope rejected: its refusal '
  + 'message enumerates the roots, which names the staging directory in a string guardian can '
  + 'make the system emit at will');

/* ---------------------------------------------------------------- teardown */

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.log(`read scope check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('read scope: every corpus case is still traceable, the run-describing surface is');
console.log('refused with a reason the agent can act on, searches are refused rather than');
console.log('narrowed, the ticket exception is one path, and no refusal names the corpus.');

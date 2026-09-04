#!/usr/bin/env node
/**
 * The risk guard must actually block. Asserted by running it, not by reading config.
 *
 * This is the check that survives a Claude Code upgrade. If the hook output
 * schema changes, every hard block becomes a silent no-op and nothing else in
 * the system would notice - a permission decision that is ignored looks exactly
 * like a permission decision that was never needed.
 *
 * The evasion cases matter as much as the obvious ones: the docs are explicit
 * that Bash prefix rules are defeated by wrappers and option reordering (5.6),
 * which is the entire reason this hook exists alongside the deny rules.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GUARD = path.join(ROOT, 'plugins/mavci-core/scripts/risk-guard.mjs');
const FIXTURE = path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const edit = (file_path) => ({ tool_name: 'Edit', tool_input: { file_path } });

const CASES = [
  // tier 3, plain forms
  ['deny', bash('rm -rf /'), 'recursive delete'],
  ['deny', bash('git push --force origin main'), 'force push'],
  ['deny', bash('git reset --hard HEAD~5'), 'hard reset'],
  ['deny', bash('gh repo delete acme/app'), 'repo delete'],
  ['deny', bash('vercel deploy --prod'), 'prod deploy'],
  ['deny', bash('railway up'), 'prod deploy'],
  ['deny', bash('cat .env.local'), 'secret read'],
  ['deny', bash("psql -c 'DROP TABLE users'"), 'destructive SQL'],
  ['deny', bash("psql -c 'TRUNCATE orders'"), 'destructive SQL'],

  // tier 3, wrapper and compound evasion - the forms prefix rules cannot cover
  ['deny', bash('timeout 5 rm -rf x'), 'timeout wrapper'],
  ['deny', bash('timeout -k 1 5s rm -rf x'), 'timeout with flag+value'],
  ['deny', bash('nice -n 10 rm -rf x'), 'nice wrapper'],
  ['deny', bash('nohup vercel --prod'), 'nohup wrapper'],
  ['deny', bash('FOO=bar rm -rf x'), 'env assignment prefix'],
  ['deny', bash('echo ok && rm -rf x'), 'compound command'],
  ['deny', bash('watch rm -rf x'), 'exec wrapper not in the strip list'],
  ['deny', bash('setsid vercel --prod'), 'exec wrapper not in the strip list'],
  ['deny', bash('docker exec c rm -rf /'), 'environment runner'],

  // control plane (B1)
  ['deny', edit('.mavci/control/state.json'), 'control-plane edit'],
  ['deny', edit('.mavci/control/tasks/0001.json'), 'control-plane edit'],
  ['deny', bash("node -e \"require('fs').writeFileSync('.mavci/control/state.json','{}')\""), 'control-plane write via subprocess'],

  // Control plane matched on INTENT, per segment, not on the raw string.
  // The deny must survive chaining, quoting and redirection ...
  ['deny', bash('rm -rf .mavci/control'), 'control-plane recursive delete'],
  ['deny', bash('echo hi; rm -rf .mavci/control'), 'control-plane delete chained behind a read'],
  ['deny', bash('rm -rf ".mavci/control"'), 'quoted path is still a target'],
  ['deny', bash('echo x > .mavci/control/state.json'), 'redirect write'],
  ['deny', bash('sed -i s/a/b/ .mavci/control/state.json'), 'in-place edit'],
  ['deny', bash('cat .mavci/control/state.json; rm -rf .mavci/control'), 'a write hidden after a real read'],
  // ... and must NOT fire on text that only DESCRIBES the control plane.
  // A commit message mentioning it was denied as a write, which blocked the
  // commit documenting this guard. People route around a guard like that, and a
  // routed-around guard is off for good - strictly worse than one slightly loose.
  ['allow', bash('git commit -m "fix the .mavci/control seal"'), 'commit message naming the path'],
  ['allow', bash('git commit -F - <<EOF\nrisk-guard: .mavci/control/ wording\nEOF'), 'heredoc body naming the path'],
  ['allow', bash('echo ===; cat .mavci/control/integrity.json'), 'a read chained after another command'],
  ['allow', bash('grep -rn phase .mavci/control/'), 'grepping the control plane'],

  /* --- THE WRITE TARGET, NOT THE COMMAND TEXT. Gate 4c, finding 5. -------
   *
   * The guard matched a regex against the whole command string, so any command
   * that so much as NAMED `.mavci/control/` was refused as a write to it. Two
   * false positives in one session, both on commands that wrote nothing there:
   *
   *   node -e "... assertValid(v, s, '.mavci/control/verdicts/adhoc-X.json') ..."
   *   printf '%s' '... without opening `.mavci/control/verdicts/`.' >> .mavci/lessons/x.md
   *
   * The first was pure in-memory validation whose only mention of the control
   * plane was a COSMETIC LABEL. The second was an append to `.mavci/lessons/` -
   * agent-writable, explicitly allowed - whose only offence was quoting a
   * control-plane path in English prose.
   *
   * The literal consequence is that THE CONTROL PLANE CANNOT BE DOCUMENTED FROM
   * BASH: every lesson file describing how it fails trips the guard by naming
   * the thing it describes. The system is hardest to write about exactly where
   * writing about it matters most.
   *
   * The real cost is behavioural, and it is why this ranks above its severity. A
   * guard that fires wrongly and often teaches everyone that its refusals are
   * noise, and the documented escape is a bypass flag. THE FAILURE MODE OF A
   * NOISY GUARD IS NOT THAT IT BLOCKS TOO MUCH; IT IS THAT IT TRAINS EVERYONE TO
   * TURN IT OFF. In gate4c the agent reworded and re-ran twice instead - which
   * is politeness, not a control, and not something to design around.
   *
   * BOTH HALVES ARE ASSERTED, and the ordering is the point. A test that only
   * checked "a control-plane write is refused" passes against the broken build,
   * because that half always worked. The half that fails against 0.1.11 is the
   * `allow` group directly below.
   */
  ['allow', bash("printf '%s' 'see .mavci/control/verdicts/ for the record' >> .mavci/lessons/note.md"),
    'writing to lessons/ while QUOTING a control path'],
  ['allow', bash("echo 'the .mavci/control/ seal is recomputed' > notes.md"),
    'writing elsewhere while naming the control plane'],
  ['allow', bash("git commit -am 'describe .mavci/control/state.json handling'"),
    'a commit whose message names the control plane'],
  ['allow', bash("jq '.phase' .mavci/control/state.json > /tmp/phase.txt"),
    'reading the control plane and writing the result elsewhere'],
  ['allow', bash("echo 'checking .mavci/control/'"), 'merely printing the path'],

  // ... and the half that must not weaken while the half above is fixed.
  ['deny', bash("echo 'hello' >> .mavci/control/state.json"), 'append into the control plane'],
  ['deny', bash('cp /tmp/x.json .mavci/control/state.json'), 'copy INTO the control plane'],
  ['deny', bash('mv .mavci/control/state.json /tmp/'), 'move the control plane away'],
  ['deny', bash('tee .mavci/control/state.json < /tmp/x'), 'tee into the control plane'],
  ['deny', bash('touch .mavci/control/unverified.json'), 'create a control file by hand'],
  ['deny', bash('chmod 777 .mavci/control/state.json'), 'change control-plane permissions'],
  ['deny', bash('sudo rm -rf .mavci/control'), 'sudo is a prefix, not the command'],
  ['allow', bash('sudo cat .mavci/control/state.json'), 'sudo before a read is still a read'],

  // Undeterminable is still refused - but the guard must say WHICH it is. The
  // old message claimed "this command targets .mavci/control/", which was a
  // claim it had not established and which was false both times in gate4c.
  ['deny', bash("python -c \"open('.mavci/control/state.json','w').write('{}')\""), 'arbitrary interpreter I/O'],

  // MCP
  ['deny', { tool_name: 'mcp__claude_ai_Supabase__execute_sql', tool_input: { project_id: 'selftestprod', query: 'select 1' } }, 'protected env'],
  ['deny', { tool_name: 'mcp__claude_ai_Supabase__execute_sql', tool_input: { project_id: 'other', query: 'DROP TABLE x' } }, 'destructive SQL anywhere'],
  ['deny', { tool_name: 'mcp__claude_ai_Vercel__buy_domain', tool_input: {} }, 'spends money'],

  // tier 2
  ['deferToUser', bash('npm install lodash'), 'dependency'],
  ['deferToUser', edit('.env.local'), 'env write'],
  ['deferToUser', edit('.claude/settings.json'), 'risk policy edit'],

  // state.mjs is the PRIVILEGED CHANNEL (Q1). The Edit deny and the seal do
  // nothing about an agent running the writer itself over Bash: it would mutate
  // the control plane and reseal it correctly, so the seal would call the
  // tampered state valid. Authorisation is by CALLER, and these cases are the
  // proof. `agent_type` present = subagent; absent = main session.
  ['deny', { ...bash('node .claude/plugins/mavci-core/scripts/state.mjs --reset-attempts 0001'), agent_type: 'mavci-builder' }, 'builder resets the retry ceiling'],
  ['deny', { ...bash('node scripts/state.mjs --set-phase build'), agent_type: 'mavci-builder' }, 'builder changes the phase'],
  ['deny', { ...bash('node scripts/state.mjs --set-phase build'), agent_type: 'mavci-architect' }, 'architect changes the phase'],
  ['deny', { ...bash('node scripts/state.mjs --waive next.route_force_dynamic --path a.ts --reason "aaaaaaaaaaaaaaaaaaaaaa"'), agent_type: 'mavci-builder' }, 'builder waives a check'],
  ['deny', { ...bash('node scripts/state.mjs --reseal'), agent_type: 'mavci-builder' }, 'builder launders a tamper by resealing'],
  ['deny', { ...bash('node scripts/state.mjs --baseline-init'), agent_type: 'mavci-builder' }, 'builder re-baselines everything'],
  ['deny', { ...bash('node scripts/state.mjs --init'), agent_type: 'mavci-builder' }, 'builder re-initialises the control plane'],
  ['deny', { ...bash('node scripts/state.mjs --migrate-manifest'), agent_type: 'mavci-builder' }, 'builder rewrites the manifest whose isolation value decides which tenant rules run'],
  ['deny', { ...bash('node scripts/state.mjs --migrate-manifest'), agent_type: 'mavci-guardian' }, 'guardian rewrites the manifest it is judged against'],
  // PROVENANCE MUST NEVER COST THE CHANNEL (0.1.12 item 1). An agent that omits
  // --agent is filing unattributed, which is allowed; an agent that names a
  // DIFFERENT caller is producing a wrong record, which is not.

  /* THE SPEC IS A SOURCE, NOT A DESTINATION - and this fixture has NO recorded
   * approval, which is the whole point of asserting it here.
   *
   * Two mechanisms guard the approved spec and they cover different failures.
   * `risk-guard`'s approved-spec rule reads `spec_approved` from the control
   * tasks, so it is silent on a project with no approvals - and it fails open by
   * design when that directory cannot be read, because a rule that denies every
   * write under `.mavci/tasks/` on an unreadable control plane would block the
   * architect from authoring a spec at all. The scribe's EDIT SCOPE is what holds
   * in both of those cases, and it holds unconditionally.
   *
   * Asserted here rather than left to the end-to-end walk in check-route.mjs,
   * because that walk runs against an APPROVED spec, where the dynamic rule
   * answers first: deleting the scope narrowing leaves it green. Two braces, two
   * assertions - 0.1.11's rule, applied to the pair that shipped together. */
  ['deny', { ...edit('.mavci/tasks/0001.md'), agent_type: 'mavci-scribe' },
    'scribe edits a SPEC on a project with no approval recorded - the scope holds where the '
    + 'approval rule is silent'],
  ['allow', { ...edit('.mavci/tasks/0001.summary.md'), agent_type: 'mavci-scribe' },
    'and the completion summary it was given instead IS writable - a scope that denies '
    + 'everything satisfies the case above on its own'],
  ['deny', { ...edit('.mavci/tasks/0001.md'), agent_type: 'mavci-verifier' },
    'the verifier writes nothing at all, spec included'],
  ['deny', { ...bash('node scripts/retro.mjs --record "x" --finding "y" --agent mavci-builder'), agent_type: 'mavci-scribe' }, 'scribe files a finding AS the builder'],
  ['allow', { ...bash('node scripts/retro.mjs --record "x" --finding "y" --agent mavci-scribe'), agent_type: 'mavci-scribe' }, 'scribe files a finding as ITSELF'],
  ['allow', { ...bash('node scripts/retro.mjs --record "x" --finding "y"'), agent_type: 'mavci-guardian' }, 'guardian files unattributed - never blocked from reporting'],
  /* --amend carries the same provenance arm as --record, and it must, or the
   * stamp is only ever the operator's. gate6 finding 12's own guard against the
   * cheap fix is that an --amend with no attribution leaves the queue exactly as
   * unreadable - and an arm keyed on --record alone satisfies it for every call
   * an operator makes and none an agent makes. Three cases, because the third is
   * the one the channel depends on: misdeclaring is refused, declaring itself is
   * allowed, and omitting is ALLOWED - reporting is never blocked. */
  ['deny', { ...bash('node scripts/retro.mjs --amend 3 --title "t" --text a.md --agent mavci-builder'), agent_type: 'mavci-scribe' },
    'scribe amends a finding AS the builder'],
  ['allow', { ...bash('node scripts/retro.mjs --amend 3 --title "t" --text a.md --agent mavci-scribe'), agent_type: 'mavci-scribe' },
    'scribe amends as ITSELF - a guard that denied every --amend satisfies the case above alone'],
  ['allow', { ...bash('node scripts/retro.mjs --amend 3 --title "t" --text a.md'), agent_type: 'mavci-guardian' },
    'guardian amends unattributed - correcting a report is still reporting, and never blocked'],
  ['deny', { ...bash('timeout 5 node scripts/state.mjs --reset-attempts 0001'), agent_type: 'mavci-builder' }, 'wrapper does not launder it'],
  ['deny', { ...bash('echo hi && node scripts/state.mjs --set-phase build'), agent_type: 'mavci-builder' }, 'compound does not launder it'],
  ['deny', { ...bash('node scripts/state.mjs --some-future-flag'), agent_type: 'mavci-builder' }, 'unrecognised subcommand fails closed'],
  ['allow', { ...bash('node scripts/state.mjs --show'), agent_type: 'mavci-builder' }, 'agent reads state'],
  ['allow', { ...bash('node scripts/state.mjs --validate'), agent_type: 'mavci-verifier' }, 'verifier validates state'],
  ['allow', { ...bash('node scripts/state.mjs --baseline-prune'), agent_type: 'mavci-builder' }, 'pruning only retires fixed debt'],
  /* THIS CASE REVERSED, AND THE REVERSAL IS THE POINT OF IT.
   *
   * It asserted `allow`: `--set-phase` was the one privileged flag exempt from
   * the operator confirm, "because slash commands run it routinely". That was
   * true when the slash commands were the only caller. It stopped being true when
   * an orchestrator held it, because a free phase set - any phase, any time, no
   * precondition, no task - is not a transition, it is the absence of a phase gate.
   *
   * The operator's ruling: "not a flat grant... The orchestrator can advance a
   * task it is driving; it cannot set an arbitrary phase. Free --set-phase stays
   * operator-only."
   *
   * So the routine caller is now `--advance-phase`, which is scoped to one task,
   * directional, and refuses without a recorded spec approval - asserted in
   * check-provenance.mjs section D. `--set-phase` keeps only the override role and
   * confirms like every other privileged flag. A reader finding `allow` here again
   * should look for an orchestrator that has been handed the override.
   */
  ['deferToUser', bash('node scripts/state.mjs --set-phase build'),
    'MAIN SESSION free phase set is the OVERRIDE and confirms - the routine path is --advance-phase'],
  ['allow', bash('node scripts/state.mjs --advance-phase 0007 --from plan --to build'),
    'MAIN SESSION scoped transition is the routine one, and is exempt because it carries four refusals'],
  // Tier-2 confirm, not allow: --set-phase is the ONLY privileged flag exempted from the
  // operator confirm, because slash commands run it routinely. Rewriting the manifest is not
  // routine. NOTE: this is the 6th case asserting the literal 'deferToUser', a value Claude Code
  // REJECTS (carried-forward item 7) - it asserts what the guard emits, not that the decision is
  // applied. Real containment here rests on the deny rules, not on this confirm.
  ['deferToUser', bash('node scripts/state.mjs --migrate-manifest'), 'MAIN SESSION migrates the manifest (operator, per doctor)'],
  ['deferToUser', bash('node scripts/state.mjs --reset-attempts 0001'), 'main session resets the ceiling - deliberate act'],
  ['deferToUser', bash('node scripts/state.mjs --reseal'), 'main session reseals - deliberate act'],

  /* --- retro.mjs, the escalation channel (Gate 4c, finding 4) ----------
   * Filing must be reachable by an agent or the channel does not exist - that
   * is the entire finding. Applying and clearing must not be: one changes the
   * system repository, the other deletes the record of an unfixed problem.
   * The `allow` case is the load-bearing one here, and it is the one a
   * deny-only test would never have.
   */
  ['allow', { ...bash('node scripts/retro.mjs --record "x" --finding "y"'), agent_type: 'mavci-builder' }, 'an AGENT files a finding'],
  ['allow', { ...bash('node scripts/retro.mjs --list'), agent_type: 'mavci-builder' }, 'an agent lists queued findings'],
  ['deny', { ...bash('node scripts/retro.mjs --apply'), agent_type: 'mavci-builder' }, 'an agent applies into the system repo'],
  ['deny', { ...bash('node scripts/retro.mjs --clear'), agent_type: 'mavci-verifier' }, 'an agent deletes the queued findings'],
  ['allow', bash('node scripts/retro.mjs --apply'), 'the OPERATOR applies'],
  ['deferToUser', bash('node scripts/retro.mjs --clear'), 'the operator clears - deliberate act'],
  // 0.1.13 gave --clear an argument, because the queue is a directory and a bare
  // --clear could delete one file while another stayed queued with nothing left
  // pointing at it. The authority is unchanged, and these two say so: a flag
  // matcher that stopped recognising the flag once it took an operand would hand
  // an agent the one deletion it must never make.
  ['deny', { ...bash('node scripts/retro.mjs --clear pending-system-change-0.1.12.md'), agent_type: 'mavci-verifier' },
    'an agent deletes a NAMED queued file'],
  ['deferToUser', bash('node scripts/retro.mjs --clear pending-system-change-0.1.12.md'),
    'the operator clears a named file'],

  // must NOT be blocked - a guard that blocks everything is useless
  ['allow', bash('npm run build'), 'ordinary build'],
  ['allow', bash('npm test'), 'tests'],
  ['allow', bash('timeout 30 npm test'), 'wrapped ordinary command'],
  ['allow', bash('git status'), 'read-only git'],
  ['allow', bash('git commit -m "x"'), 'commit'],
  ['allow', bash('cat .mavci/control/state.json'), 'reading the control plane'],
  ['allow', edit('app/page.tsx'), 'ordinary source edit'],
  ['allow', edit('.mavci/tasks/0001.json'), 'agent-writable surface'],
  ['allow', { tool_name: 'mcp__claude_ai_Supabase__execute_sql', tool_input: { project_id: 'stagingref', query: 'select 1' } }, 'unprotected env'],
];

/* --- the agent namespace ---------------------------------------------
 *
 * `agent_type` arrives PLUGIN-QUALIFIED for an agent that ships in a plugin
 * (`mavci-core:mavci-architect`); `agent-scopes.json` and `agent-defs/` key on
 * the BARE name. Every case above passes `agent_type` bare, so all 62 of them
 * exercised a form the hook never actually receives in production. The real
 * qualified form missed the scopes lookup, matched the `startsWith('mavci-')`
 * fallback, and denied every edit by every agent - on a real install, at 0.1.8,
 * with CI green. NATIVE-CAPABILITIES 6.24.
 *
 * So this block is roster-driven rather than a list: an agent added to
 * agent-scopes.json is covered the day it is added, with nobody remembering to
 * write a case. It asserts two things, and the second is the load-bearing one:
 *
 *   1. the qualified form and the bare form reach the SAME decision - the
 *      plugin prefix must not change the outcome; and
 *   2. neither reaches it through the undefined-scope denial.
 *
 * Decision alone is not sufficient, and that is the whole lesson here.
 * `mavci-verifier` is `"allow": []`, so an edit is denied whether its scope
 * resolved or not; a check comparing only verdicts would have gone green on the
 * broken build. The reason string is what separates "scoped, and refused" from
 * "not scoped, so refused blindly".
 */
const SCOPES = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/agents/agent-scopes.json'), 'utf8'));
const PLUGIN_NAME = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins/mavci-core/.claude-plugin/plugin.json'), 'utf8')).name;

// The marker the guard prints when scopes[agent] misses. Substring, not equality:
// the message carries the agent name and wraps.
const UNSCOPED = 'has no entry in agents/agent-scopes.json';

// A concrete path inside a scope glob: `.mavci/tasks/**` -> `.mavci/tasks/probe.md`.
// An agent with an empty allow list still needs a probe path; any path serves,
// because what is asserted is the reason rather than the verdict.
function probePath(scope) {
  const glob = scope.allow?.[0];
  if (!glob) return '.mavci/tasks/probe.md';
  const base = glob.replace(/\/?\*+$/, '').replace(/\*/g, '').replace(/\/$/, '');
  if (!base || base.includes('.')) return '.mavci/tasks/probe.md';
  return `${base}/probe.${/^(app|src|lib|components)/.test(base) ? 'ts' : 'md'}`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-guard-'));
fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
fs.copyFileSync(FIXTURE, path.join(tmp, '.mavci', 'project.json'));

const failures = [];

function runGuard(input) {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ ...input, cwd: tmp }), encoding: 'utf8', timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) { stdout = err.stdout?.toString() ?? ''; }
  if (!stdout.trim()) return { decision: 'allow', reason: '' };
  const o = JSON.parse(stdout).hookSpecificOutput ?? {};
  return { decision: o.permissionDecision ?? 'allow', reason: String(o.permissionDecisionReason ?? '') };
}

try {
  for (const [expected, input, label] of CASES) {
    let actual;
    try { actual = runGuard(input).decision; }
    catch { failures.push(`${label}: guard emitted unparseable output`); continue; }
    const desc = input.tool_input?.command ?? input.tool_input?.file_path ?? input.tool_name;
    if (actual !== expected) failures.push(`${label} [${desc}]: expected ${expected}, got ${actual}`);
  }

  /* --- a refusal must not assert more than the guard established --------
   *
   * The second half of finding 5, and the one that is not about the decision.
   * When the target genuinely cannot be determined - `node -e`, `python -c`,
   * arbitrary interpreter I/O - refusing is right. Saying "this command targets
   * .mavci/control/" is not: that is a claim the guard has not made and could
   * not make, and it was FALSE both times it fired in gate4c.
   *
   * A guard that misstates why it refused sends the reader looking for a write
   * that is not there. The honest message is the one that says the target could
   * not be read, and the guard's own advice ("run a read as its own command")
   * only makes sense once the reader knows which case they are in.
   */
  {
    const undeterminable = runGuard(bash("node -e \"const p='.mavci/control/state.json'; console.log(p)\""));
    if (undeterminable.decision !== 'deny') {
      failures.push('an interpreter doing arbitrary I/O near the control plane must still be refused; '
        + `got ${undeterminable.decision}`);
    } else if (!/undeterminable|cannot be determined|could not be determined/i.test(undeterminable.reason)) {
      failures.push('the refusal for an undeterminable target does not say the target is '
        + `undeterminable - it says: "${undeterminable.reason.trim().slice(0, 140)}". `
        + 'Claiming the command targets the control plane is a claim the guard has not established, '
        + 'and it was false both times this fired in gate4c.');
    }
  }

  for (const [name, scope] of Object.entries(SCOPES)) {
    const file_path = probePath(scope);
    const qualified = `${PLUGIN_NAME}:${name}`;
    let bare, qual;
    try {
      bare = runGuard({ tool_name: 'Edit', tool_input: { file_path }, agent_type: name });
      qual = runGuard({ tool_name: 'Edit', tool_input: { file_path }, agent_type: qualified });
    } catch { failures.push(`agent scope [${qualified}]: guard emitted unparseable output`); continue; }

    if (qual.reason.includes(UNSCOPED)) {
      failures.push(`agent scope [${qualified} -> ${file_path}]: scope did NOT resolve for the `
        + `qualified name - guard said "${qual.reason.trim().slice(0, 90)}". `
        + `agent-scopes.json keys on "${name}"; strip the plugin prefix before the lookup.`);
    }
    if (bare.reason.includes(UNSCOPED)) {
      failures.push(`agent scope [${name} -> ${file_path}]: scope did not resolve for the bare `
        + `name either - "${name}" is missing from agent-scopes.json.`);
    }
    if (bare.decision !== qual.decision) {
      failures.push(`agent scope [${file_path}]: the plugin prefix changed the decision - `
        + `"${name}" got ${bare.decision}, "${qualified}" got ${qual.decision}. `
        + 'The two forms name the same agent and must be governed identically.');
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failures.length) {
  console.error('\nrisk guard check FAILED:');
  for (const f of failures) console.error('  - ' + f);
  console.error('\nEnforcement is not working as specified. Do not release.');
  process.exit(2);
}
const roster = Object.keys(SCOPES);
console.log(`risk guard: ${CASES.length} cases behave as specified `
  + `(${CASES.filter((c) => c[0] === 'deny').length} deny, `
  + `${CASES.filter((c) => c[0] === 'deferToUser').length} confirm, `
  + `${CASES.filter((c) => c[0] === 'allow').length} allow)`);
// Reported separately and by name. The count above stayed at 62 through the
// whole 6.22 defect, so a total that silently absorbs the roster cases would
// hide exactly the coverage this block exists to prove.
console.log(`risk guard: agent scope resolves for ${roster.length} agent(s), bare and `
  + `${PLUGIN_NAME}:-qualified (${roster.join(', ')})`);

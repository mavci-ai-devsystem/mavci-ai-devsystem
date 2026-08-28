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
const FIXTURE = path.join(ROOT, 'templates/fixtures/selftest-project.json');

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
  ['deny', { ...bash('timeout 5 node scripts/state.mjs --reset-attempts 0001'), agent_type: 'mavci-builder' }, 'wrapper does not launder it'],
  ['deny', { ...bash('echo hi && node scripts/state.mjs --set-phase build'), agent_type: 'mavci-builder' }, 'compound does not launder it'],
  ['deny', { ...bash('node scripts/state.mjs --some-future-flag'), agent_type: 'mavci-builder' }, 'unrecognised subcommand fails closed'],
  ['allow', { ...bash('node scripts/state.mjs --show'), agent_type: 'mavci-builder' }, 'agent reads state'],
  ['allow', { ...bash('node scripts/state.mjs --validate'), agent_type: 'mavci-verifier' }, 'verifier validates state'],
  ['allow', { ...bash('node scripts/state.mjs --baseline-prune'), agent_type: 'mavci-builder' }, 'pruning only retires fixed debt'],
  ['allow', bash('node scripts/state.mjs --set-phase build'), 'MAIN SESSION changes the phase (slash commands do this)'],
  ['deferToUser', bash('node scripts/state.mjs --reset-attempts 0001'), 'main session resets the ceiling - deliberate act'],
  ['deferToUser', bash('node scripts/state.mjs --reseal'), 'main session reseals - deliberate act'],

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-guard-'));
fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
fs.copyFileSync(FIXTURE, path.join(tmp, '.mavci', 'project.json'));

const failures = [];
try {
  for (const [expected, input, label] of CASES) {
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [GUARD], {
        input: JSON.stringify({ ...input, cwd: tmp }), encoding: 'utf8', timeout: 15000,
      });
    } catch (err) { stdout = err.stdout?.toString() ?? ''; }

    let actual = 'allow';
    if (stdout.trim()) {
      try { actual = JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? 'allow'; }
      catch { failures.push(`${label}: guard emitted unparseable output: ${stdout.slice(0, 120)}`); continue; }
    }
    const desc = input.tool_input?.command ?? input.tool_input?.file_path ?? input.tool_name;
    if (actual !== expected) failures.push(`${label} [${desc}]: expected ${expected}, got ${actual}`);
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
console.log(`risk guard: ${CASES.length} cases behave as specified `
  + `(${CASES.filter((c) => c[0] === 'deny').length} deny, `
  + `${CASES.filter((c) => c[0] === 'deferToUser').length} confirm, `
  + `${CASES.filter((c) => c[0] === 'allow').length} allow)`);

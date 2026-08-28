#!/usr/bin/env node
/**
 * Plugin structure. Catches the mistakes that make a plugin load silently wrong.
 *
 * The expensive failure mode here is a plugin that INSTALLS without error and
 * then does nothing: a hook file in the wrong directory, a skill with no
 * description, a hook whose script does not exist. None of those raise an error
 * at install time, and the operator's only symptom is that enforcement stopped
 * happening - which looks exactly like enforcement having nothing to report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');
const failures = [];
const warn = [];

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

/* --- manifests ------------------------------------------------------- */

const mkPath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const plPath = path.join(PLUGIN, '.claude-plugin', 'plugin.json');
if (!exists(mkPath)) failures.push('.claude-plugin/marketplace.json missing');
if (!exists(plPath)) failures.push('plugins/mavci-core/.claude-plugin/plugin.json missing');

let plugin = null;
if (exists(plPath)) {
  plugin = JSON.parse(read(plPath));
  if (!plugin.name) failures.push('plugin.json has no name');
  if (!/^\d+\.\d+\.\d+$/.test(plugin.version ?? '')) {
    failures.push(`plugin.json version "${plugin.version}" is not semver. Projects pin CI to tag v<version>.`);
  }
}
if (exists(mkPath)) {
  const mk = JSON.parse(read(mkPath));
  if (!mk.plugins?.length) failures.push('marketplace.json lists no plugins - the loop below would assert nothing');
  if (!mk.name) failures.push('marketplace.json has no name');
  if (!mk.owner?.name) failures.push('marketplace.json has no owner.name');
  for (const p of mk.plugins ?? []) {
    const src = path.join(ROOT, p.source);
    if (!exists(src)) failures.push(`marketplace plugin "${p.name}" source ${p.source} does not exist`);
  }
}

/* --- the classic layout mistake -------------------------------------- */
// "Don't put commands/, agents/, skills/ or hooks/ inside .claude-plugin/."
for (const d of ['agents', 'skills', 'commands', 'hooks', 'scripts']) {
  if (exists(path.join(PLUGIN, '.claude-plugin', d))) {
    failures.push(`${d}/ is inside .claude-plugin/ - it must be at the plugin root or it is silently ignored`);
  }
}

/* --- hooks ------------------------------------------------------------ */

const hooksPath = path.join(PLUGIN, 'hooks', 'hooks.json');
if (!exists(hooksPath)) {
  failures.push('hooks/hooks.json missing - no enforcement would run');
} else {
  const hooks = JSON.parse(read(hooksPath)).hooks ?? {};
  const KNOWN = new Set(['SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
    'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
    'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
    'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged',
    'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact',
    'Elicitation', 'ElicitationResult', 'SessionEnd']);

  for (const [event, groups] of Object.entries(hooks)) {
    if (!KNOWN.has(event)) failures.push(`hooks.json declares unknown event "${event}"`);
    for (const g of groups) {
      for (const h of g.hooks ?? []) {
        // Every referenced script must exist. A missing script means the hook
        // fails, and a failed hook FAILS OPEN (NATIVE-CAPABILITIES 4.18).
        const cmd = Array.isArray(h.command) ? h.command : [h.command];
        for (const part of cmd) {
          if (typeof part !== 'string' || !part.includes('${CLAUDE_PLUGIN_ROOT}')) continue;
          const rel = part.replace('${CLAUDE_PLUGIN_ROOT}/', '');
          if (!exists(path.join(PLUGIN, rel))) failures.push(`${event}: hook script ${rel} does not exist`);
        }
        if (h.timeout === undefined) {
          warn.push(`${event}: no explicit timeout; the 600s default hides a hung hook for ten minutes`);
        }
        // A gate that runs async cannot render a decision, so it cannot block.
        if ((event === 'Stop' || event === 'SubagentStop') && h.async) {
          failures.push(`${event}: async:true on a gate - an async hook renders no decision and cannot block`);
        }
      }
    }
  }

  // `?.length`, not truthiness: `"Stop": []` is an empty array, which is truthy in
  // JS, so a declared-but-empty event passed as "core enforcement point present"
  // while registering zero hooks.
  for (const required of ['PreToolUse', 'Stop', 'SubagentStop']) {
    if (!hooks[required]?.length) {
      failures.push(`hooks.json has no ${required} hooks - a core enforcement point registers nothing`);
    }
  }
}

/* --- skills ----------------------------------------------------------- */

const skillsDir = path.join(PLUGIN, 'skills');
const skills = exists(skillsDir) ? fs.readdirSync(skillsDir) : [];
if (!skills.length) failures.push('no skills found');

for (const s of skills) {
  const f = path.join(skillsDir, s, 'SKILL.md');
  if (!exists(f)) { failures.push(`skills/${s}/SKILL.md missing`); continue; }
  const text = read(f);
  if (!text.startsWith('---')) { failures.push(`skills/${s}: no YAML frontmatter`); continue; }
  const fm = text.slice(3, text.indexOf('\n---', 3));
  if (!/^description:/m.test(fm)) failures.push(`skills/${s}: no description - Claude cannot tell when to use it`);

  // A standards pack must NOT set disable-model-invocation: it would also stop
  // the skill being preloaded into a subagent (NATIVE-CAPABILITIES 2.4), which
  // is exactly how the knowledge layer reaches an agent.
  if (s.startsWith('standards-') && /^disable-model-invocation:\s*true/m.test(fm)) {
    failures.push(`skills/${s}: standards packs must not set disable-model-invocation - it blocks subagent preloading`);
  }
  // waive must be operator-only: an agent that can waive its own blockers is unconstrained.
  if (s === 'waive' && !/^disable-model-invocation:\s*true/m.test(fm)) {
    failures.push('skills/waive: MUST set disable-model-invocation: true, or an agent can waive its own blockers');
  }
}

/* --- agents ----------------------------------------------------------- */

const agentsDir = path.join(PLUGIN, 'agents');
const agentFiles = exists(agentsDir) ? fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')) : [];
if (!agentFiles.length) failures.push('no agent definitions found');
for (const a of agentFiles) {
  const text = read(path.join(agentsDir, a));
  if (!/^name:\s*\S+/m.test(text)) failures.push(`agents/${a}: no name field`);
  if (!/^description:\s*\S+/m.test(text)) failures.push(`agents/${a}: no description field`);
}
if (!exists(path.join(agentsDir, 'agent-scopes.json'))) {
  failures.push('agents/agent-scopes.json missing - risk-guard cannot enforce per-agent edit scope');
}

/* --- text-only source tree -------------------------------------------- */
/*
 * No file under plugins/ or scripts/ may contain a NUL byte.
 *
 * A single NUL flips git and grep into binary mode for the whole file: git
 * renders "Binary files differ" instead of a patch, and `grep -r` skips it
 * without saying so. Both properties are actively harmful here - these
 * directories hold the control-plane write channel and the enforcement
 * scripts, the code that most needs to be reviewable in a diff and reachable
 * by an audit sweep. ROADMAP already requires UTF-8/LF and no binary formats;
 * this check is that constraint applied to the system's own source.
 *
 * It regressed once already: state.mjs used a literal NUL as the delimiter in
 * a composite key, which silently defeated a `grep -r` audit of this repo.
 */
const NUL = 0x00;
const NL = String.fromCharCode(10);
const nulFiles = [];

function scanForNul(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // An unreadable directory is not "clean". Report it rather than pass silently.
    failures.push(`cannot read ${rel(dir)} to scan it for NUL bytes`);
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      scanForNul(full);
      continue;
    }
    if (!e.isFile()) continue;
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      failures.push(`cannot read ${rel(full)} to scan it for NUL bytes`);
      continue;
    }
    const at = buf.indexOf(NUL);
    if (at !== -1) {
      const lineNo = buf.subarray(0, at).toString('utf8').split(NL).length;
      nulFiles.push(`${rel(full)} (first NUL at byte ${at}, line ${lineNo})`);
    }
  }
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

for (const dir of [path.join(ROOT, 'plugins'), path.join(ROOT, 'scripts')]) {
  if (exists(dir)) scanForNul(dir);
  else failures.push(`${rel(dir)}/ does not exist, so it could not be scanned for NUL bytes`);
}

if (nulFiles.length) {
  failures.push(`${nulFiles.length} file(s) under plugins/ or scripts/ contain a NUL byte, so git`
    + ` shows no diff for them and grep -r skips them silently:` + NL + '      - '
    + nulFiles.join(NL + '      - ')
    + NL + `    Use a printable delimiter instead - '::' or U+001F.`);
}

/* --- report ----------------------------------------------------------- */

for (const w of warn) console.log(`  warn  ${w}`);
if (failures.length) {
  console.error('\nplugin structure check FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log(`plugin structure ok: ${agentFiles.length} agents, ${skills.length} skills, `
  + `plugin ${plugin?.version ?? '?'}`);

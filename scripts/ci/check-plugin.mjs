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

/* --- hooks ------------------------------------------------------------
 * hooks.json is validated against the DOCUMENTED SCHEMA, key by key, not just
 * checked for presence.
 *
 * Why this exists: v0.1.2 shipped `"command": ["node", "..."]`. Claude Code's
 * plugin loader rejects that with `expected "string", received "array"` and
 * drops EVERY entry in the file. The plugin then installs cleanly, reports no
 * error, and registers ZERO hooks - no risk guard, no standards gate, no phase
 * gate. The old version of this block asserted the hooks were PRESENT and that
 * their scripts existed, both of which were true, so CI stayed green throughout.
 *
 * Neither `--plugin-dir` nor doctor's hook self-test goes through the loader's
 * schema validation, so a real installed plugin was the only thing that could
 * catch it. That is too late. This validator is the local authority; the
 * `plugin-validate` job in validate.yml runs Claude Code's own validator as the
 * upstream authority. Both must pass.
 */

const HOOK_EVENTS = new Set(['SessionStart', 'Setup', 'UserPromptSubmit', 'UserPromptExpansion', 'PreToolUse',
  'PermissionRequest', 'PermissionDenied', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'Notification', 'MessageDisplay', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted',
  'Stop', 'StopFailure', 'TeammateIdle', 'InstructionsLoaded', 'ConfigChange', 'CwdChanged',
  'DirectoryAdded', 'FileChanged', 'WorktreeCreate', 'WorktreeRemove', 'PreCompact', 'PostCompact',
  'Elicitation', 'ElicitationResult', 'SessionEnd']);

// NATIVE-CAPABILITIES 4.10 / 4.12 / 4.19. Unknown keys are rejected rather than
// ignored: a mistyped key name is exactly the kind of thing that "works" until
// it silently does nothing. A trailing "!" marks a required field.
const HOOK_COMMON = { if: 'string', timeout: 'number', statusMessage: 'string', once: 'boolean' };
const HOOK_TYPES = {
  command:  { command: 'string!', args: 'string[]', async: 'boolean', asyncRewake: 'boolean', shell: 'string' },
  http:     { url: 'string!', headers: 'object', allowedEnvVars: 'string[]' },
  mcp_tool: { server: 'string!', tool: 'string!', input: 'object' },
  prompt:   { prompt: 'string!', model: 'string' },
  agent:    { prompt: 'string!' },
};

/** Validate a parsed hooks.json against the documented schema. Returns error strings. */
export function validateHooksDoc(doc, where = 'hooks.json') {
  const errs = [];
  const at = (p) => where + p;
  const kindOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

  if (kindOf(doc) !== 'object') return [where + ': not a JSON object'];
  for (const k of Object.keys(doc)) {
    if (k !== 'hooks') errs.push(at('') + ': unknown top-level key "' + k + '" - only "hooks" is read');
  }
  const hooks = doc.hooks;
  if (hooks === undefined) return [where + ': no "hooks" key'];
  if (kindOf(hooks) !== 'object') return [at('.hooks') + ': must be an object keyed by event name'];

  for (const [event, groups] of Object.entries(hooks)) {
    const ep = '.hooks.' + event;
    if (!HOOK_EVENTS.has(event)) errs.push(at(ep) + ': unknown event name');
    if (!Array.isArray(groups)) { errs.push(at(ep) + ': must be an array of matcher groups'); continue; }
    if (!groups.length) errs.push(at(ep) + ': empty array registers nothing');

    groups.forEach((g, gi) => {
      const gp = ep + '[' + gi + ']';
      if (kindOf(g) !== 'object') { errs.push(at(gp) + ': must be an object'); return; }
      for (const k of Object.keys(g)) {
        if (k !== 'matcher' && k !== 'hooks') errs.push(at(gp) + ': unknown key "' + k + '"');
      }
      if ('matcher' in g && typeof g.matcher !== 'string') {
        errs.push(at(gp + '.matcher') + ': expected "string", received "' + kindOf(g.matcher) + '"');
      }
      if (!Array.isArray(g.hooks)) { errs.push(at(gp + '.hooks') + ': expected an array of hook handlers'); return; }
      if (!g.hooks.length) errs.push(at(gp + '.hooks') + ': empty array registers nothing');

      g.hooks.forEach((h, hi) => {
        const hp = gp + '.hooks[' + hi + ']';
        if (kindOf(h) !== 'object') { errs.push(at(hp) + ': must be an object'); return; }
        const spec = HOOK_TYPES[h.type];
        if (!spec) {
          errs.push(at(hp + '.type') + ': '
            + (h.type === undefined ? 'missing' : 'unknown type "' + h.type + '"')
            + ' - expected one of ' + Object.keys(HOOK_TYPES).join(', '));
          return;
        }
        const allowed = { ...HOOK_COMMON, ...spec };
        for (const [k, v] of Object.entries(h)) {
          if (k === 'type') continue;
          const want = allowed[k];
          if (!want) { errs.push(at(hp + '.' + k) + ': unknown key for a "' + h.type + '" hook - it would be ignored'); continue; }
          const base = want.replace('!', '');
          const got = kindOf(v);
          if (base === 'string[]') {
            if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
              errs.push(at(hp + '.' + k) + ': expected an array of strings, received "' + got + '"');
            }
          } else if (got !== base) {
            errs.push(at(hp + '.' + k) + ': expected "' + base + '", received "' + got + '"');
          }
        }
        for (const [k, want] of Object.entries(spec)) {
          if (want.endsWith('!') && h[k] === undefined) errs.push(at(hp + '.' + k) + ': required for a "' + h.type + '" hook');
        }
        if (h.shell !== undefined && h.shell !== 'bash' && h.shell !== 'powershell') {
          errs.push(at(hp + '.shell') + ': must be "bash" or "powershell"');
        }
      });
    });
  }
  return errs;
}

const hooksPath = path.join(PLUGIN, 'hooks', 'hooks.json');
if (!exists(hooksPath)) {
  failures.push('hooks/hooks.json missing - no enforcement would run');
} else {
  let doc = null;
  try { doc = JSON.parse(read(hooksPath)); }
  catch (err) { failures.push('hooks/hooks.json is not valid JSON: ' + err.message); }

  if (doc) {
    for (const e of validateHooksDoc(doc, 'hooks/hooks.json')) {
      failures.push(e + '\n     Claude Code rejects the whole file on this, and the plugin then '
        + 'registers ZERO hooks with no visible error.');
    }

    const hooks = doc.hooks ?? {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of g?.hooks ?? []) {
          // Every referenced script must exist. A missing script means the hook
          // fails, and a failed hook FAILS OPEN (NATIVE-CAPABILITIES 4.18).
          for (const part of [h.command, ...(Array.isArray(h.args) ? h.args : [])]) {
            if (typeof part !== 'string' || !part.includes('${CLAUDE_PLUGIN_ROOT}')) continue;
            const rel = part.replace('${CLAUDE_PLUGIN_ROOT}/', '');
            if (!exists(path.join(PLUGIN, rel))) failures.push(event + ': hook script ' + rel + ' does not exist');
          }
          if (h.timeout === undefined) {
            warn.push(event + ': no explicit timeout; the 600s default hides a hung hook for ten minutes');
          }
          // A gate that runs async cannot render a decision, so it cannot block.
          if ((event === 'Stop' || event === 'SubagentStop') && h.async) {
            failures.push(event + ': async:true on a gate - an async hook renders no decision and cannot block');
          }
        }
      }
    }

    // `?.length`, not truthiness: `"Stop": []` is an empty array, which is truthy in
    // JS, so a declared-but-empty event passed as "core enforcement point present"
    // while registering zero hooks.
    for (const required of ['PreToolUse', 'Stop', 'SubagentStop']) {
      if (!hooks[required]?.length) {
        failures.push('hooks.json has no ' + required + ' hooks - a core enforcement point registers nothing');
      }
    }
  }
}

/* --- negative control: the hooks validator must actually reject --------
 * A check that has never failed is not evidence of anything. These feed it the
 * exact shape v0.1.2 shipped, plus the neighbouring mistakes, and assert the
 * rejection - so the validator cannot decay into a function returning [].
 */
{
  const nc = [
    [{ hooks: { Stop: [{ hooks: [{ type: 'command', command: ['node', 'x.mjs'], timeout: 30 }] }] } },
      /\.command: expected "string", received "array"/, 'the v0.1.2 array-form command'],
    [{ hooks: { Stop: [{ hooks: [{ type: 'command' }] }] } }, /\.command: required/, 'a command hook with no command'],
    [{ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', arg: [] }] }] } }, /unknown key/, 'a mistyped key name'],
    [{ hooks: { Stopp: [{ hooks: [] }] } }, /unknown event name/, 'a mistyped event name'],
    [{ hooks: { Stop: [{ hooks: [{ type: 'shell', command: 'x' }] }] } }, /unknown type/, 'an unknown handler type'],
    [{ hooks: { Stop: [] } }, /empty array registers nothing/, 'an event declared with no groups'],
  ];
  for (const [bad, re, label] of nc) {
    if (!validateHooksDoc(bad, 'nc').some((e) => re.test(e))) {
      failures.push('NEGATIVE CONTROL FAILED: ' + label + ' was accepted by validateHooksDoc. '
        + 'The hooks validator does not work, so every hooks assertion above is meaningless.');
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

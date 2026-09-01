#!/usr/bin/env node
/**
 * Mavci Core - the PreToolUse risk guard. ARCHITECTURE section 7.
 *
 * Every tier-3 operation is enforced TWICE: a `permissions.deny` rule in the
 * project's settings, and this hook. Neither is redundant:
 *   - deny rules cannot ship in a plugin (5.15), so they can drift per project
 *   - hooks ship and auto-propagate, but die with `disableAllHooks` (4.16)
 *   - Bash argument patterns are documented as defeatable by option reordering,
 *     redirects and variables (5.6) - this hook parses the real command
 *   - MCP permission rules cannot carry parameters in a settings file (5.9), so
 *     "block prod but allow staging" is only expressible here
 *
 * Decisions: `deny` (tier 3) and `deferToUser` (tier 2). Anything else falls
 * through to the normal permission flow.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, CONTROL_DIR, MAVCI_DIR } from './config.mjs';
import { abs, exists, readJsonOrNull, toPosix, matchesAny } from './lib/fsx.mjs';
import { buildRedactor } from './redact.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');

/* --------------------------------------------- control-plane targeting */

const CONTROL_PATH_RE = /\.mavci[/\\]control/;

/** The plugin's own entry points, which own the control plane. */
const PLUGIN_SCRIPT_RE = /scripts[/\\](state|gate|verify|doctor)\.mjs/;

/**
 * Remove the two text classes that are DATA rather than a command target.
 *
 * A heredoc body is content being fed to a program, and a quoted message operand
 * is a string being recorded. Neither can act on a path. Everything else is left
 * intact - in particular an ordinary quoted path stays matchable, so
 * `rm -rf ".mavci/control"` is still caught.
 *
 * This runs on the WHOLE command line, before it is split into subcommands: a
 * heredoc body spans the newlines that subcommands() splits on, so stripping it
 * afterwards is too late - the body has already become its own "command".
 *
 * If a heredoc has no terminator the pattern does not match and the body stays
 * in the string, so an unparseable command fails CLOSED.
 */
function stripDataOperands(cmd) {
  return cmd
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^[\t ]*\2[\t ]*$/gm, '<<DATA')
    .replace(/(^|\s)(-m|--message)(\s+)(['"])[\s\S]*?\4/g, '$1$2$3DATA');
}

/* ------------------------------------------- what does this command WRITE?
 *
 * Gate 4c, finding 5. The guard used to ask "does the command STRING contain
 * `.mavci/control`", which is a question about text, not about targets. It
 * refused two commands in one session that wrote nothing there:
 *
 *   node -e "... assertValid(v, s, '.mavci/control/verdicts/adhoc-X.json') ..."
 *   printf '%s' '... without opening `.mavci/control/verdicts/`.' >> .mavci/lessons/x.md
 *
 * The first mentioned the control plane only in a COSMETIC LABEL passed to a
 * pure in-memory function. The second appended to `.mavci/lessons/` - explicitly
 * agent-writable - and its only offence was quoting a control-plane path in
 * English prose. The guard's own advice, "a read is allowed, run it as its own
 * command", did not cover either case, because the matcher was looking at the
 * wrong thing.
 *
 * The literal consequence: THE CONTROL PLANE CANNOT BE DOCUMENTED FROM BASH.
 * Every lesson file describing how it fails trips the guard by naming the thing
 * it describes.
 *
 * The real cost is behavioural, and it is why this was fixed rather than lived
 * with. A guard that fires wrongly and often teaches everyone that its refusals
 * are noise, and the documented escape is a bypass flag. The failure mode of a
 * noisy guard is not that it blocks too much; it is that it trains everyone to
 * turn it off. In gate4c the agent reworded and re-ran twice instead. That is
 * politeness, not a control, and nothing should be designed around it.
 *
 * SO THE QUESTION IS NOW ABOUT POSITION, AND THE ANSWER HAS THREE VALUES:
 *
 *   'write'         a control-plane path is the target of a redirection or of a
 *                   known writing command. Refuse, and say what it writes.
 *   'undetermined'  the command can do arbitrary I/O (`node -e`, `python -c`) or
 *                   is not recognised at all, and a control path appears
 *                   UNQUOTED where an operand would be. Refuse - but say the
 *                   target could not be read, which is the truth. Claiming it
 *                   "targets .mavci/control/" is a claim the guard has not
 *                   established, and it was false both times in gate4c.
 *   'none'          the path appears only as data: inside a quoted operand of a
 *                   command that does not write, or as the argument of a read.
 *
 * Fail-closed is preserved, and this is the part not to weaken: an UNRECOGNISED
 * command with an unquoted control path is 'undetermined', not 'none'. What
 * changed is that quoted prose is data, which is what the four false positives
 * all were.
 */

/** Reads. Their operands are safe even unquoted; a redirect is checked separately. */
const READ_HEADS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'type', 'grep', 'rg', 'jq', 'ls', 'dir',
  'stat', 'wc', 'file', 'find', 'cmp', 'diff', 'md5sum', 'sha256sum', 'sort', 'uniq',
  'get-content', 'select-string',
]);

/** Every operand is a write target. `mv` included: moving a file away deletes it. */
const WRITE_ALL_OPERANDS = new Set([
  'rm', 'unlink', 'shred', 'truncate', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown',
  'chgrp', 'ln', 'mv', 'rsync', 'install', 'tee', 'sed', 'perl', 'awk',
  'remove-item', 'new-item', 'set-content', 'add-content', 'clear-content', 'out-file',
  'move-item', 'copy-item',
]);

/** Only the LAST operand is written. Copying OUT of the control plane is a read. */
const WRITE_LAST_OPERAND = new Set(['cp']);

/** Arbitrary I/O: the target cannot be read from the command line at all. */
const INTERPRETERS = new Set([
  'node', 'deno', 'bun', 'python', 'python3', 'py', 'perl', 'ruby', 'php', 'lua',
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd',
  'eval', 'source', 'osascript', 'docker', 'ssh',
]);

/** `git <sub>` that can overwrite or delete working-tree paths. */
const GIT_WRITE_SUBCOMMANDS = new Set(['checkout', 'restore', 'rm', 'clean', 'apply', 'mv']);

/**
 * Split one subcommand into tokens, remembering which were quoted and which
 * redirection each follows. Quoting is the whole distinction between a path
 * being a target and a path being prose.
 */
function tokenize(cmd) {
  const tokens = [];
  let cur = '';
  let quoted = false;
  let started = false;
  let q = null;
  const push = () => {
    if (started) tokens.push({ text: cur, quoted });
    cur = ''; quoted = false; started = false;
  };
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i];
    if (q) {
      if (c === q) { q = null; continue; }
      cur += c; started = true;
      continue;
    }
    if (c === '"' || c === "'") { q = c; quoted = true; started = true; continue; }
    if (/\s/.test(c)) { push(); continue; }
    // Redirection operators are shell syntax and only when UNQUOTED. `>file`
    // with no space is one token in the shell's eyes and two here.
    if (c === '>' || c === '<') {
      push();
      let op = c;
      if (cmd[i + 1] === '>') { op += '>'; i += 1; }
      tokens.push({ text: op, redirect: true });
      continue;
    }
    if (c === '&' && cmd[i + 1] === '>') { push(); tokens.push({ text: '&>', redirect: true }); i += 1; continue; }
    cur += c; started = true;
  }
  push();
  // `2>` and `1>>` arrive as a digit token immediately before a redirect.
  return tokens.filter((t, i) => !(/^\d$/.test(t.text) && tokens[i + 1]?.redirect));
}

const isFlag = (t) => !t.redirect && t.text.startsWith('-');

/**
 * @returns {{kind: 'write'|'undetermined'|'none', target?: string}}
 */
function controlPlaneTarget(cmd) {
  // The sanctioned channel owns the control plane. It is authorised by CALLER
  // further down, not here.
  if (PLUGIN_SCRIPT_RE.test(cmd)) return { kind: 'none' };
  if (!CONTROL_PATH_RE.test(cmd)) return { kind: 'none' };

  const tokens = tokenize(cmd);
  if (!tokens.length) return { kind: 'none' };

  // 1. Redirection targets. Always a write, quoted or not: `> ".mavci/control/x"`
  //    is a write to that path and the quotes are the shell's business.
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i].redirect && tokens[i].text.includes('>')) {
      const t = tokens[i + 1].text;
      if (CONTROL_PATH_RE.test(t)) return { kind: 'write', target: t };
    }
  }

  // `sudo` is a prefix, not the command. Dropping it here rather than blanking
  // the head keeps `sudo rm -rf .mavci/control` classified as the `rm` it is:
  // it was still refused without this, but as an UNDETERMINED target, which is
  // the wrong reason - and a refusal that misstates its reason is the defect
  // this whole function exists to fix.
  let rest = tokens.filter((t) => t.redirect || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t.text));
  while (rest[0] && !rest[0].redirect && /^(sudo|doas)$/i.test(rest[0].text)) rest = rest.slice(1);

  const headToken = rest.find((t) => !t.redirect);
  const head = (headToken?.text ?? '').toLowerCase();
  const base = head.split(/[/\\]/).pop().replace(/\.(exe|cmd|ps1)$/, '');
  const operands = rest.filter((t, i) => t !== headToken && !t.redirect && !isFlag(t)
    && !(rest[i - 1]?.redirect));

  // 2. Known writers: their operands are targets whatever the quoting.
  if (WRITE_ALL_OPERANDS.has(base)) {
    const hit = operands.find((t) => CONTROL_PATH_RE.test(t.text));
    if (hit) return { kind: 'write', target: hit.text };
    return { kind: 'none' };
  }
  if (WRITE_LAST_OPERAND.has(base)) {
    const last = operands.at(-1);
    if (last && CONTROL_PATH_RE.test(last.text)) return { kind: 'write', target: last.text };
    return { kind: 'none' };
  }
  if (base === 'git') {
    const sub = operands[0]?.text;
    if (GIT_WRITE_SUBCOMMANDS.has(sub)) {
      const hit = operands.slice(1).find((t) => CONTROL_PATH_RE.test(t.text));
      if (hit) return { kind: 'write', target: hit.text };
    }
    // `git commit -m "... .mavci/control/ ..."` and every other read-shaped git
    // subcommand: the message is prose, not a target. This exact case blocked
    // the commit that documented this guard.
    return { kind: 'none' };
  }

  // 3. Arbitrary I/O. Refuse, but do not claim to know what it writes.
  if (INTERPRETERS.has(base)) return { kind: 'undetermined' };

  // 4. Reads: operands are safe. A redirect was already checked at step 1.
  if (READ_HEADS.has(base)) return { kind: 'none' };

  // 5. Unrecognised command. FAIL CLOSED on an unquoted operand that looks like
  //    a control path - this is the branch that keeps the guard a guard - but a
  //    path that appears ONLY inside quotes is data, which is what all four
  //    gate4c false positives were.
  const unquotedHit = operands.find((t) => !t.quoted && CONTROL_PATH_RE.test(t.text));
  if (unquotedHit) return { kind: 'undetermined', target: unquotedHit.text };
  return { kind: 'none' };
}

/* ------------------------------------------------------------ decisions */

/**
 * A hook writes ONE JSON object to stdout. Notices therefore cannot be printed
 * as they are discovered - a notice followed by a deny would emit two objects
 * and the whole output would be unparseable, which fails open. Notices queue
 * here and ride along with whatever decision is finally made.
 */
let pendingNotice = null;
const notice = (text) => { pendingNotice = pendingNotice ? `${pendingNotice}\n${text}` : text; };

function decide(decision, reason) {
  const out = {
    hookEventName: 'PreToolUse',
    permissionDecision: decision,
    permissionDecisionReason: reason,
  };
  if (pendingNotice) out.systemMessage = pendingNotice;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
  process.exit(0);
}

const deny = (reason) => decide('deny', `mavci risk policy: ${reason}`);
const confirm = (reason) => decide('deferToUser', `mavci risk policy (tier 2): ${reason}`);

/** No opinion on the call itself, but still deliver any queued notice. */
function allow() {
  if (pendingNotice) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', systemMessage: pendingNotice },
    }));
  }
  process.exit(0);
}

/* -------------------------------------------------------------- helpers */

/**
 * Malformed input is not swallowed here either. Returning `{}` would make every
 * branch below fall through to allow() - a fail-open on the layer whose entire
 * job is to deny. If we cannot read the tool call, we cannot judge it, so the
 * honest answer is to ask the operator.
 */
function readStdin() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { return {}; }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    confirm(`the tool call could not be read (${err.message}), so the risk policy could not be `
      + 'applied to it. Approve only if you know what this call does. Run /mavci-core:doctor.');
  }
}

/** Split on the shell operators Claude Code itself recognises (5.5). */
function subcommands(cmd) {
  return cmd.split(/&&|\|\||;|\||&|\n/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Strip the wrapper list Claude Code strips (5.5), so `timeout 5 rm -rf /` is
 * still seen as `rm`. Each wrapper is matched separately: a single combined
 * alternation backtracks into eating the wrapped command's own name, which
 * silently let `timeout 5 rm -rf x` through in testing.
 */
const WRAPPERS = [
  // timeout [flags, some taking a value] DURATION cmd -- e.g. `timeout -k 1 5s rm -rf x`
  /^timeout(?:\s+(?:-\S+|--\S+)(?:\s+[0-9]+[smhd]?)?)*\s+[0-9]+(?:[.][0-9]+)?[smhd]?\s+(.*)$/,
  /^nice(?:\s+-n\s*-?\d+)?\s+(.*)$/,
  /^stdbuf(?:\s+-\S+)+\s+(.*)$/,
  /^(?:time|nohup|command|builtin|noglob)\s+(.*)$/,
  /^xargs\s+(.*)$/,                                                // stripped only when bare (5.5)
];

function unwrap(sub) {
  let s = sub.trim();
  for (let i = 0; i < 5; i++) {
    let matched = false;
    for (const re of WRAPPERS) {
      const m = s.match(re);
      if (m) { s = m[1].trim(); matched = true; break; }
    }
    if (!matched) break;
  }
  // leading VAR=value assignments; a deny rule matches past any of them (5.5)
  s = s.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '');
  return s;
}

function fileTargets(toolName, input) {
  const out = [];
  if (input?.file_path) out.push(input.file_path);
  if (input?.notebook_path) out.push(input.notebook_path);
  if (Array.isArray(input?.edits)) for (const e of input.edits) if (e?.file_path) out.push(e.file_path);
  return out.map((p) => toPosix(p));
}

function relTo(root, p) {
  const r = path.isAbsolute(p) ? path.relative(root, p) : p;
  return toPosix(r);
}

// `agent_type` arrives PLUGIN-QUALIFIED for an agent that ships in a plugin
// (`mavci-core:mavci-architect`) and bare for a project-local one
// (`mavci-architect`). `agents/agent-scopes.json` and `agent-defs/` both key on
// the BARE name - that is the vocabulary the contract uses - so the prefix is
// stripped here, ONCE, before any lookup or name comparison downstream. Strip
// the prefix; do not re-key the scopes file.
//
// Getting this wrong fails CLOSED, which is why it reached a real install
// looking like a policy decision: `scopes[agent]` misses on the qualified name,
// the `startsWith('mavci-')` fallback below matches the qualified name too, and
// every edit by every plugin agent is denied with "has no entry in
// agents/agent-scopes.json". Observed on the 0.1.8 install, 2026-08-29;
// NATIVE-CAPABILITIES 6.24. The behaviour was right and the lookup was wrong.
//
// Third namespace defect of the same root (6.4's marketplace `source` form and
// 0.1.5's command prefix are the other two): a name that arrives qualified,
// compared against one written bare.
function bareAgentName(agentType) {
  if (typeof agentType !== 'string' || agentType === '') return null;
  const colon = agentType.indexOf(':');
  return colon === -1 ? agentType : agentType.slice(colon + 1);
}

/* ------------------------------------------------------ tier-3 patterns */

const HARD_BLOCK = [
  { re: /^rm\s+(-[A-Za-z]*r[A-Za-z]*f|-[A-Za-z]*f[A-Za-z]*r|-r\s+-f|-f\s+-r)\b/, why: 'recursive force delete' },
  { re: /^rm\s+-[A-Za-z]*r\b/, why: 'recursive delete' },
  { re: /^git\s+push\s+.*(--force|-f)\b/, why: 'force push rewrites published history' },
  { re: /^git\s+push\s+.*--delete\b/, why: 'remote branch delete' },
  { re: /^git\s+reset\s+--hard\b/, why: 'hard reset discards uncommitted work irrecoverably' },
  { re: /^git\s+branch\s+-D\b/, why: 'force branch delete' },
  { re: /^git\s+clean\s+-[A-Za-z]*[fd]/, why: 'git clean deletes untracked files' },
  { re: /^gh\s+repo\s+(delete|edit)\b/, why: 'repository delete or visibility change' },
  { re: /^vercel\s+(deploy\s+)?.*--prod\b/, why: 'production deploy' },
  { re: /^vercel\s+--prod\b/, why: 'production deploy' },
  { re: /^railway\s+up\b/, why: 'production deploy' },
  { re: /^npm\s+publish\b/, why: 'publishing a package' },
  { re: /^supabase\s+db\s+push\b/, why: 'pushing migrations to a remote database' },
  { re: /^supabase\s+projects?\s+delete\b/, why: 'deleting a Supabase project' },
];

/** Destructive SQL, blocked in EVERY environment including local: a destructive
 *  migration written locally is a destructive migration that reaches prod later. */
const DESTRUCTIVE_SQL = [
  { re: /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i, why: 'DROP TABLE/SCHEMA/DATABASE' },
  { re: /\bTRUNCATE\s+/i, why: 'TRUNCATE' },
  { re: /\bDELETE\s+FROM\s+[\w."]+\s*(;|$)/i, why: 'DELETE with no WHERE clause' },
  { re: /\bUPDATE\s+[\w."]+\s+SET\b(?![\s\S]*\bWHERE\b)/i, why: 'UPDATE with no WHERE clause' },
];

/* ------------------------------------------------------------ the guard */

function main() {
  const input = readStdin();
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  // Bare name, always. See bareAgentName: agent_type arrives qualified for a
  // plugin agent, and every downstream comparison is written against the bare form.
  const agent = bareAgentName(input.agent_type);
  const root = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Not a Mavci project: this hook has no opinion.
  if (!exists(abs(root, PATHS.manifest))) allow();

  const manifest = readJsonOrNull(abs(root, PATHS.manifest));
  const state = readJsonOrNull(abs(root, PATHS.state));
  const tier = manifest?.risk_tier ?? 'standard';
  const sandbox = tier === 'sandbox';

  /* ---- report an incomplete previous gate (config.mjs "gate", point 2) ----
   * A hook that Claude Code cancelled cannot report its own death: no further
   * code runs. So gate.mjs announces intent before starting, and this is where
   * an unfinished announcement surfaces. Detection, not prevention - the tool
   * call is allowed to proceed - but the operator is told, every time, until a
   * gate completes. Silence would be indistinguishable from a clean run.
   */
  /* ---- report a session the gate gave up on (Gate 4c, finding 3) --------
   * `gate.mjs` blocks once on a checker fault, then lets the turn end and
   * leaves a marker. Something outside the gate has to keep saying so, or
   * ending the turn is a fail-open with a file nobody opens. `doctor` FAILs on
   * it once a session; this repeats it on every tool call, because the turns it
   * describes are the turns being written right now.
   *
   * Notice, not deny. The condition is that enforcement is BROKEN, and denying
   * every tool call would re-create the trap the marker exists to end.
   */
  const unver = readJsonOrNull(abs(root, PATHS.unverified));
  if (unver) {
    notice(`mavci: THIS SESSION IS UNVERIFIED. The standards gate failed to run `
      + `${unver.consecutive} turn(s) in a row (fault: ${unver.fault}) and stopped blocking so work `
      + 'could continue. Nothing written since has been checked. The fault is in the checker, not in '
      + `your code, and you may not repair it: file it with /mavci-core:retro, quoting `
      + `${PATHS.unverified}. This clears only when a gate run passes.`);
  }

  const run = readJsonOrNull(abs(root, PATHS.gateRun));
  if (run && run.completed === null && run.prompt_id !== (input.prompt_id ?? null)) {
    const age = Math.round((Date.now() - Date.parse(run.started)) / 1000);
    notice(`mavci: the standards gate started ${age}s ago on the previous turn and never finished `
      + `(prompt ${run.prompt_id ?? 'unknown'}). Claude Code cancels a hook that exceeds its timeout, and `
      + 'a cancelled hook renders no decision - so that turn was NOT verified, and the pass you saw was '
      + 'silence rather than a result. Re-run /mavci-core:verify over the previous turn, and '
      + '/mavci-core:doctor if it keeps happening.');
  }

  /* =============================================== MCP: protected envs */
  if (tool.startsWith('mcp__')) {
    const protectedRefs = new Set(
      Object.values(manifest?.environments ?? {})
        .filter((e) => e?.protected)
        .map((e) => e.supabase_ref)
        .filter(Boolean),
    );
    const payload = JSON.stringify(ti);

    // Money and account-shape changes are never an agent's call.
    if (/__buy_|__create_project|__delete_branch|__pause_project|__restore_project|update_project_deployment_protection|deploy_to_vercel/.test(tool)) {
      deny(`${tool} changes an external account, spends money or deploys. Tier 3: operator only. `
        + 'Ask the operator to run it and say exactly what you need done.');
    }

    if (/Supabase__(execute_sql|apply_migration)/.test(tool)) {
      for (const sql of [ti.query, ti.sql, ti.migration_sql, payload]) {
        if (typeof sql !== 'string') continue;
        for (const d of DESTRUCTIVE_SQL) {
          if (d.re.test(sql)) deny(`${d.why} is tier 3 and is blocked in every environment, including local. `
            + 'Write a reversible migration instead, and have the operator apply it.');
        }
      }
      const ref = ti.project_id ?? ti.project_ref ?? null;
      if (ref && protectedRefs.has(ref)) {
        deny(`this call targets Supabase project "${ref}", which .mavci/project.json marks as protected. `
          + 'Writing to a protected environment is tier 3: the operator does it, not you.');
      }
      if (!ref && protectedRefs.size) {
        confirm('this SQL call does not name a project ref, and this project has a protected environment. '
          + 'Confirm which environment it targets.');
      }
    }
    allow();
  }

  /* ================================================ Edit / Write paths */
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
    const targets = fileTargets(tool, ti).map((p) => relTo(root, p));

    for (const rel of targets) {
      /* --- control plane (B1). Second mechanism after the deny rule. ---- */
      if (rel.startsWith(CONTROL_DIR + '/') || rel === CONTROL_DIR) {
        deny('.mavci/control/ is the control plane. It holds the phase, the retry ceiling, the '
          + 'baseline and the waivers - the values that govern you. It is written only by state.mjs, '
          + 'and edits are also refused by a permission rule. If you are stuck, that is what '
          + '`escalate: true` in your report is for.');
      }

      /* --- manifest: operator surface, denied to agents ----------------- */
      if (rel === PATHS.manifest) {
        if (agent) {
          deny('.mavci/project.json declares the risk tier, protected environments and standards packs. '
            + 'An agent may not edit it. Report what needs to change and let the operator decide.');
        }
        confirm('editing the project manifest changes which checks run and which environments are protected.');
      }

      /* --- secrets must never reach .mavci/ (B5, prevention) ------------ */
      if (rel.startsWith(MAVCI_DIR + '/')) {
        const body = [ti.content, ti.new_string, ti.new_source].filter((x) => typeof x === 'string').join('\n');
        if (body) {
          const r = buildRedactor(root, manifest);
          const found = r.findings(body);
          if (found.length) {
            const names = [...new Set(found.map((f) => f.label))].join(', ');
            deny(`this write puts a secret (${names}) into ${rel}, which is committed to the repository. `
              + 'Name the key instead of pasting its value - for example "STRIPE_SECRET_KEY is missing", '
              + 'never the key itself.');
          }
        }
      }

      /* --- secrets and settings ----------------------------------------- */
      if (/^\.env(\.|$)/.test(path.basename(rel)) || /^\.env/.test(rel)) {
        confirm(`writing ${rel}. Confirm the key names being changed - values are never shown here.`);
      }
      if (rel === '.claude/settings.json' || rel === '.claude/settings.local.json') {
        confirm(`${rel} carries the risk policy. Review the diff before allowing it.`);
      }

      /* --- phase gate + per-agent edit scope (hook-only, ARCHITECTURE 1.1) */
      if (agent) {
        const scopes = readJsonOrNull(path.join(PLUGIN_ROOT, 'agents', 'agent-scopes.json'));
        // An unreadable scopes file means per-agent edit scope CANNOT be enforced.
        // Falling through silently let any agent edit anything with no notice, so
        // deleting or renaming one file disabled the control. Refuse instead.
        if (!scopes) {
          deny('agents/agent-scopes.json could not be read, so per-agent edit scope cannot be '
            + 'enforced. Refusing the edit rather than allowing it unchecked. Reinstall the plugin.');
        }
        const scope = scopes[agent];
        // A mavci agent with no entry is a packaging bug, not an unscoped agent.
        // Third-party agents are not ours to scope, so they pass through.
        if (!scope && agent.startsWith('mavci-')) {
          deny(`${agent} has no entry in agents/agent-scopes.json, so its edit scope is undefined. `
            + 'Refusing the edit rather than allowing it unchecked.');
        }
        if (scope) {
          if (scope.deny?.length && matchesAny(rel, scope.deny)) {
            deny(`${agent} may not edit ${rel}. Its scope is limited to: ${(scope.allow ?? []).join(', ') || '(nothing)'}. `
              + 'If this file genuinely needs to change, say so in `suggested_next` and stop.');
          }
          // `scope.allow` present, NOT `.length`. An empty allow list means "may
          // edit nothing" - mavci-verifier really is `"allow": []` - but `?.length`
          // made that falsy and skipped the check entirely. The verifier was
          // constrained only by its separate `deny: ["**"]`; remove that line and
          // it could have edited anything.
          if (scope.allow && !matchesAny(rel, scope.allow)) {
            deny(`${agent} may only edit ${scope.allow.join(', ') || '(nothing)'}. ${rel} is outside that scope.`);
          }
        }

        const APP_PATHS = ['app/**', 'src/**', 'lib/**', 'components/**', 'supabase/**'];
        if (matchesAny(rel, APP_PATHS)) {
          // An unreadable control plane is not permission to write. `state &&`
          // meant a missing or corrupt state.json silently lifted the phase
          // freeze, which is the one moment it most needs to hold.
          if (!state) {
            deny('the control plane could not be read, so the build-phase freeze on application '
              + 'code cannot be evaluated. Refusing the edit. Run /mavci-core:doctor.');
          }
          if (state.phase !== 'build') {
            deny(`the project is in the "${state.phase}" phase, so application code is frozen. `
              + 'Move to the build phase with /mavci-core:build before changing app code. '
              + 'Planning and verification do not edit code - that separation is what keeps a verifier honest.');
          }
        }
      }
    }
    allow();
  }

  /* ============================================================== Bash */
  if (tool !== 'Bash' && tool !== 'PowerShell') allow();

  const raw = String(ti.command ?? '');
  if (!raw) allow();

  // Data operands are stripped from the WHOLE line first: a heredoc body spans
  // the newlines subcommands() splits on, so it must go before the split, not after.
  for (const sub of subcommands(stripDataOperands(raw))) {
    const cmd = unwrap(sub);

    /* --- state.mjs is the PRIVILEGED CHANNEL, so gate it by caller -----
     *
     * The Edit deny and the SHA-256 seal stop hand-editing. They do nothing
     * about the legitimate door: state.mjs writes as a subprocess, so an agent
     * running `node scripts/state.mjs --set-phase build` mutates the control
     * plane AND reseals it correctly. The seal would hash the tampered state as
     * valid, because from its point of view nothing was tampered with.
     *
     * Authorisation is therefore by CALLER, not by file path. Phase transitions,
     * ceiling resets, waivers and reseals belong to the operator and to the
     * slash commands that run in the main session, where a human is present.
     * `agent_type` is set for a subagent and absent for the main session
     * (NATIVE-CAPABILITIES 4.9), which is exactly the distinction needed.
     */
    if (/\bstate\.mjs\b/.test(cmd)) {
      const READ_ONLY = ['--show', '--validate', '--verify-integrity'];
      const AGENT_OK = [...READ_ONLY, '--baseline-prune', '--new-task'];
      const PRIVILEGED = {
        '--set-phase': 'change the workflow phase, which is the gate deciding whether app code is writable at all',
        '--reset-attempts': 'clear the retry ceiling, which is the mechanism that ends a failing loop',
        '--waive': 'grant an exception to a standards check',
        '--reseal': 're-seal the control plane, which launders any tampering that preceded it',
        '--init': 're-initialise the control plane',
        '--baseline-init': 'record a new baseline, which retires every current violation at once',
        '--migrate-manifest': 'rewrite the project manifest, whose tenancy.isolation value decides which tenant-isolation rules run at all',
      };

      const flags = cmd.match(/--[a-z-]+/g) ?? [];
      const privileged = flags.filter((f) => f in PRIVILEGED);
      const known = flags.filter((f) => AGENT_OK.includes(f) || f in PRIVILEGED);

      if (agent) {
        if (privileged.length) {
          const f = privileged[0];
          deny(`${agent} may not run \`state.mjs ${f}\`. That would ${PRIVILEGED[f]}. `
            + 'The control plane is not editable by the agent it governs - that is the whole point of it, '
            + 'and running the writer over Bash is the same act as editing the file. '
            + 'If you are blocked, return `escalate: true` with the reason and stop.');
        }
        if (!known.length || flags.some((f) => !AGENT_OK.includes(f))) {
          // Fail closed on anything unrecognised: a subcommand added later must
          // be classified deliberately, not inherit permission by omission.
          deny(`${agent} may only run state.mjs with ${AGENT_OK.join(', ')}. `
            + `This invocation uses ${flags.join(' ') || '(no recognised flag)'}, which is not classified as agent-safe.`);
        }
      } else {
        // Main session: a human is present, but these are still deliberate acts.
        const f = privileged.find((x) => x !== '--set-phase');
        if (f) confirm(`this will ${PRIVILEGED[f]}. Confirm you intend it.`);
      }
    }

    /* --- retro.mjs: filing is an agent's, applying is not ---------------
     *
     * The escalation channel has to be REACHABLE by an agent or it is not a
     * channel - that is the whole of Gate 4c finding 4, where seven messages
     * told an agent to run a command that did not exist. So `--record` is
     * deliberately open: an agent that is blocked must always be able to say so.
     *
     * `--apply` carries a finding into the SYSTEM REPOSITORY, where it changes
     * how every downstream project is built - the one place an agent must never
     * reach on its own, and the rule it held to for three trapped turns in
     * gate4c rather than make a four-character fix it could see.
     *
     * `--clear` deletes the record of an unfixed problem. That is the same shape
     * as deleting a REVIEW REQUIRED marker: an act the agent is physically able
     * to perform and must not, because doing it files the problem away instead
     * of resolving it.
     *
     * Authorised by CALLER, exactly like state.mjs above: `agent_type` is set
     * for a subagent and absent in the main session (4.9).
     */
    if (/\bretro\.mjs\b/.test(cmd)) {
      const RETRO_PRIVILEGED = {
        '--apply': 'carry a finding into the system repository, which governs every project',
        '--clear': 'delete the record of a problem that has not been fixed',
      };
      const flags = cmd.match(/--[a-z-]+/g) ?? [];
      const privileged = flags.filter((f) => f in RETRO_PRIVILEGED);

      /* --- PROVENANCE, AND IT IS ENFORCED RATHER THAN SELF-DECLARED ---------
       *
       * A queue an operator is about to apply mixes findings written by the main
       * session with findings written by an agent, and until now nothing told them
       * apart - retro's own header said "by whoever hit it". Those are different
       * evidence: a finding a human hit and wrote up, and a finding a haiku agent
       * produced, warrant different scrutiny before they change how every
       * downstream project is built.
       *
       * The guard is the only place this is CHECKABLE. `retro.mjs` cannot know who
       * ran it (its own header says so), so a self-declared `--agent` flag would be
       * provenance an agent could simply omit. Here, `agent_type` is in the hook
       * payload: an agent filing a finding must declare itself, and must declare
       * ITSELF - the flag is compared against the caller. An agent cannot file
       * anonymously and cannot file as the operator or as another agent.
       */
      if (agent && flags.includes('--record')) {
        const m = cmd.match(/--agent[= ]+([A-Za-z0-9:_-]+)/);
        const declared = m ? m[1] : null;
        const bare = declared && declared.includes(':') ? declared.slice(declared.indexOf(':') + 1) : declared;
        // NEVER DENY AN OMITTED FLAG. Caught by check-risk-guard.mjs, which already
        // asserted that an agent can always file: 0.1.12 item 1 exists because seven
        // messages told a trapped agent to run a command that did not exist, and a
        // channel an agent cannot reach is the trap. A provenance requirement that
        // can refuse a report reintroduces it - an agent that is blocked, and forgets
        // one flag, is blocked from saying so.
        //
        // PROVENANCE MUST NEVER COST THE CHANNEL. So an omission is a NOTICE and the
        // call proceeds; only an active misdeclaration is refused, because an agent
        // naming a different caller is not a trapped agent, it is a wrong record.
        if (!declared) {
          notice(`mavci: file findings with \`--agent ${agent}\` so the queue records who wrote `
            + 'them. This one is being filed unattributed, which is allowed - reporting is never '
            + 'blocked - but an operator applying it will not know an agent authored it.');
        }
        if (declared && bare !== agent) {
          deny(`${agent} declared \`--agent ${declared}\`, which is not itself. Provenance on a `
            + 'finding is evidence about who produced it; declaring another caller would make it '
            + 'evidence about nobody.');
        }
      }

      if (agent && privileged.length) {
        deny(`${agent} may not run \`retro.mjs ${privileged[0]}\`. That would `
          + `${RETRO_PRIVILEGED[privileged[0]]}. File the finding with \`--record\` and stop - `
          + 'that is the whole of your authority here, and it is enough: doctor reports an '
          + 'unapplied finding on every run until an operator acts on it.');
      }
      if (!agent && privileged.includes('--clear')) {
        confirm('this deletes the queued system findings. Do it after applying them, not instead: '
          + 'the file is the record of what is still unfixed.');
      }
    }

    /* --- control-plane writes through a subprocess (B1 mitigation 2) ---
     *
     * Matched on INTENT, per command, not on the raw string.
     *
     * The string test denied any command containing the path anywhere - which
     * includes a `git commit` whose MESSAGE describes the control plane. That
     * blocked a commit documenting this very guard. A guard people cannot commit
     * around is a guard people route around, and routing around is strictly worse
     * than a guard that is slightly loose: the loose guard still fires on the next
     * command, the routed-around one is switched off for good.
     *
     * Two narrow classes of text are DATA and never a target: heredoc bodies, and
     * the operand of a message flag. Both are stripped before matching. Everything
     * else is matched exactly as before, per segment, so `rm -rf` on the control
     * directory is denied whether or not something is chained in front of it.
     *
     * Segmenting also fixes the old anchoring bug in the other direction: a read
     * chained after another command (`echo x; cat state.json`) is now recognised
     * as the read it is, instead of being reported as a write.
     */
    const cp = controlPlaneTarget(cmd);
    if (cp.kind === 'write') {
      deny(`this command writes to ${cp.target}, inside .mavci/control/, outside state.mjs. `
        + 'The control plane holds the phase, retry ceiling, baseline and waivers; writing it '
        + 'directly bypasses validation, redaction and the integrity seal. The seal will detect '
        + 'it anyway. Use state.mjs. Reading it is allowed and needs no workaround.');
    }
    if (cp.kind === 'undetermined') {
      // Say what is true. The old message asserted "this command targets
      // .mavci/control/" for every command that merely NAMED the path, which was
      // a claim the guard had not established and was false both times it fired
      // in gate4c - once on a pure in-memory validation, once on an append to
      // .mavci/lessons/. A refusal that misstates its reason sends the reader
      // hunting for a write that is not there.
      deny('the write target of this command could not be determined, and it names a path inside '
        + `.mavci/control/ (\`${cmd.slice(0, 160)}\`). This is not a claim that it writes there - it `
        + 'is that the guard cannot tell, so it refuses rather than guess. Run it as a plain '
        + 'command whose target is visible (cat, jq, cp ... ), or use state.mjs if it really does '
        + 'need to write. Quoting a control-plane path inside a message or a string operand is '
        + 'fine and is not what this is about.');
    }

    /* --- reading secrets through a subprocess (5.8 mitigation) --------- */
    if (/^(cat|head|tail|type|less|more|strings|xxd|od)\b[^|;]*\.env\b/.test(cmd)
      || /\.env(\.\w+)?\s*(\||>|>>)/.test(cmd)) {
      deny('reading a .env file is tier 3. Secrets are never shown to an agent. '
        + 'lib/env.ts is the only place environment values are read, and it validates them at boot.');
    }

    /* --- destructive SQL in any shell form ---------------------------- */
    for (const d of DESTRUCTIVE_SQL) {
      if (d.re.test(cmd) && /(psql|supabase|pg_|mysql)/i.test(cmd)) {
        deny(`${d.why} is tier 3 and is blocked in every environment, including local. `
          + 'A destructive migration written locally is a destructive migration that reaches production later.');
      }
    }

    /* --- the tier-3 command list --------------------------------------
     * Two passes. The anchored pass runs against the unwrapped command and is
     * precise. The backstop pass runs unanchored against the raw subcommand, so
     * a wrapper form this parser does not know about still gets caught.
     * Wrapper parsing must never be the only thing standing between an agent
     * and `rm -rf`; the docs are explicit that argument patterns are defeatable
     * (5.6), and every wrapper list is a list of the forms someone thought of.
     * The cost is denying a command that merely mentions one of these verbs,
     * which is a good trade. */
    for (const h of HARD_BLOCK) {
      const backstop = new RegExp(h.re.source.replace(/^\^/, '(?:^|[\\s"\'])'));
      if (!h.re.test(cmd) && !backstop.test(sub)) continue;
      // sandbox projects may deploy and reset their own database
      if (sandbox && /(deploy|--prod|railway up|db push)/.test(cmd)) {
        confirm(`${h.why} - allowed in a sandbox project, but confirm it.`);
      }
      deny(`${h.why} is tier 3: hard-blocked for agents. `
        + (/(--prod|railway up|deploy)/.test(cmd)
          ? 'A deploy belongs to the operator: print the exact command for them and stop.'
          : 'If this is genuinely needed, the operator must run it.'));
    }

    /* --- push to the production branch -------------------------------- */
    const prodBranch = manifest?.deploy?.prod_branch;
    if (prodBranch && new RegExp(`^git\\s+push\\b[^|;]*\\b${prodBranch}\\b`).test(cmd)) {
      confirm(`pushing directly to "${prodBranch}", the production branch. Confirm this is intended.`);
    }

    /* --- tier 2 ------------------------------------------------------- */
    if (/^npm\s+(i|install|add)\s+\S/.test(cmd) || /^(pnpm|yarn|bun)\s+add\s+\S/.test(cmd)) {
      confirm('adding a dependency changes the supply chain and the licence surface.');
    }
  }

  allow();
}

try {
  main();
} catch (err) {
  // A guard that crashes must not block ordinary work, but it must say so:
  // silence here would look exactly like "allowed".
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      systemMessage: `mavci risk guard failed to run (${err.message}). Tier-3 permission deny rules in `
        + '.claude/settings.json still apply, but the hook layer is down. Run /mavci-core:doctor.',
    },
  }));
  process.exit(0);
}

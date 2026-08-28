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
  const agent = input.agent_type ?? null;
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
        + 'Ask the operator to do this, or use /mavci-core:release for a deploy.');
    }

    if (/Supabase__(execute_sql|apply_migration)/.test(tool)) {
      for (const sql of [ti.query, ti.sql, ti.migration_sql, payload]) {
        if (typeof sql !== 'string') continue;
        for (const d of DESTRUCTIVE_SQL) {
          if (d.re.test(sql)) deny(`${d.why} is tier 3 and is blocked in every environment, including local. `
            + 'Write a reversible migration instead, and have the operator apply it through /mavci-core:release.');
        }
      }
      const ref = ti.project_id ?? ti.project_ref ?? null;
      if (ref && protectedRefs.has(ref)) {
        deny(`this call targets Supabase project "${ref}", which .mavci/project.json marks as protected. `
          + 'Writing to a protected environment is tier 3: operator only, via /mavci-core:release.');
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

  for (const sub of subcommands(raw)) {
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

    /* --- control-plane writes through a subprocess (B1 mitigation 2) --- */
    if (/\.mavci[/\\]control/.test(cmd)) {
      const viaPlugin = cmd.includes('scripts/state.mjs') || cmd.includes('scripts\\state.mjs')
        || cmd.includes('scripts/gate.mjs') || cmd.includes('scripts/verify.mjs')
        || cmd.includes('scripts/doctor.mjs');
      const readOnly = /^(cat|head|tail|less|type|grep|rg|jq|ls|dir|stat|wc|git\s+diff|git\s+status|git\s+log)\b/.test(cmd);
      if (!viaPlugin && !readOnly) {
        // Says "not recognised as", not "writes to". The readOnly test is anchored
        // at ^, so a chained or wrapped read - `echo x; cat state.json`, or a
        // `node -e` that only reads - lands here too. Denying those is correct:
        // this guard cannot see inside a subprocess, and fail-closed is the point.
        // Reporting a read as a write is not correct, because it sends the operator
        // hunting for a write that never happened.
        deny('this command touches .mavci/control/ and is not recognised as either a plugin '
          + 'script or a plain read, so it is treated as a write. The control plane holds the '
          + 'phase, retry ceiling, baseline and waivers; writing it directly bypasses validation, '
          + 'redaction and the integrity seal. The seal will detect it anyway. Use state.mjs. '
          + 'If this WAS a read, run it as a single unchained command (cat, head, grep, jq ...): '
          + 'a read wrapped in `node -e` or chained after another command cannot be told apart '
          + 'from a write from here.');
      }
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
          ? 'Deploys go through /mavci-core:release, which prints the command for the operator to run.'
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

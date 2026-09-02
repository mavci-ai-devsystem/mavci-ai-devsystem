#!/usr/bin/env node
/**
 * Every command's dynamic context must actually RUN.
 *
 * This is the check that would have caught the bare-`$CLAUDE_PLUGIN_ROOT` defect
 * on 0.1.0 instead of 0.1.7. Nothing else in CI invokes anything: `claude plugin
 * validate --strict` reads manifests, `check-plugin.mjs` reads SKILL.md
 * frontmatter and never the body, every other `check-*.mjs` calls the scripts
 * directly with `node` - which is the path that works - and 6.20's evidence for
 * "the plugin loaded" is `/context` counting agents and skills. All of those pass
 * on a plugin whose every command is broken, because they test RESOLUTION AND
 * LISTING, NEVER INVOCATION. See NATIVE-CAPABILITIES 6.21.
 *
 * WHAT IT DOES
 * Three steps, in the loader's own order:
 *
 *   1. extract each inline `!` block from the skill body,
 *   2. substitute the placeholders the way `k4` does - braced only, backslashes
 *      normalised to `/` - plus `$ARGUMENTS` and the skill-mode placeholders,
 *   3. run the result through bash, in a real scaffolded Mavci project.
 *
 * ------------------------------------------------------------------------
 * WHAT A GREEN RUN HERE DOES *NOT* PROVE. READ THIS BEFORE TRUSTING IT.
 * ------------------------------------------------------------------------
 * This is NOT a loader simulation, and green here is NOT proof that the commands
 * work in every mode. It models substitution and execution, because that is what
 * broke. It does not model, and cannot speak for:
 *
 *   - frontmatter `allowed-tools` and the permission check that gates each
 *     block. A command can substitute and run here and still be DENIED in a real
 *     session, which surfaces as "Shell command permission check failed for
 *     pattern".
 *   - `shell: powershell`. Everything below goes through bash. A skill that
 *     declares PowerShell - or any Windows machine with no Git Bash, where the
 *     host falls back to PowerShell - runs a different interpreter with different
 *     quoting, and this check would not notice.
 *   - `context: fork` and `agent:`, which change where the block's output lands.
 *   - the three no-execute paths of 2.11 (`disableSkillShellExecution`, Cowork,
 *     a read-only skill load on a coordinator). Those are properties of the HOST,
 *     not of the skill: nothing in the repository can make them fire or not fire,
 *     so no CI check can cover them. They are why a safety-critical probe must
 *     never live only in dynamic context, however green this file is.
 *
 * The one thing it does prove is the one thing that had never been tested: that
 * each block substitutes to a real path and executes. Do not extend the claim.
 *
 * ON EXIT CODES - WHY 0 IS NOT THE ASSERTION
 * "Assert exit 0" would be a FALSE assertion, and asserting something false is
 * worse than asserting nothing. `doctor` exits 1 when it reports failures, and in
 * a bare CI checkout it legitimately does - no install record, no registered
 * hooks. A command that ran and reported a problem is a RESULT, and a check that
 * failed on it would be measuring the CI environment, not the plugin.
 *
 * So the assertion is that the block RAN: no `Cannot find module`, no `command
 * not found`, no module-resolution or shell-resolution error, no stack trace -
 * the signatures of a command that never started. Exit 0 is required only of the
 * scripts specified to return it in a healthy project (`state.mjs`, `verify.mjs`,
 * `gate.mjs`); `doctor` is deliberately exempt from that half and is still held
 * to the "it ran" half.
 *
 * CONTROLS, AND WHY THEY RUN FIRST
 * A negative control runs the exact form shipped from 0.1.0 to 0.1.7 and requires
 * it to be caught, and a positive control requires the fixed form to pass - so
 * this file can disagree in both directions. Verified against a worktree of the
 * v0.1.7 tag: it exits 2 and names all four broken dynamic contexts.
 *
 * They used to run LAST, and that cost a release cycle. Launched from PowerShell
 * instead of Git Bash, `bash` resolved to the WSL app-execution alias on a
 * machine with no distribution: it exited 1 without running anything. Every
 * block was scored against an interpreter that executed nothing, 18 of the 22
 * were scored `ok` because `neverRan`'s English signatures do not match a
 * Turkish WSL error, and the run printed `invoked 22 inline block(s)` - a false
 * sentence - before the controls objected underneath it. The gate held, because
 * both controls did fail and the process exits 2. But the report described 22
 * invocations that never happened and said nothing about the one thing that
 * mattered, which is which shell it had been handed.
 *
 * So: the interpreter is resolved deliberately rather than taken from PATH, it
 * is proven to execute before a single block is scored, and it is NAMED on every
 * run, pass or fail. A check whose verdict depends on which shell the operator
 * launched it from is measuring the operator, not the tree.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');
const SKILLS = path.join(PLUGIN, 'skills');
const SCRIPTS = path.join(PLUGIN, 'scripts');

const render = await import(pathToFileURL(path.join(SCRIPTS, 'render.mjs')).href);
const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(PLUGIN, 'templates', 'fixtures', 'selftest-project.json'), 'utf8'));

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/** The loader's own shape: `!` immediately followed by a backticked command. */
const INLINE = /!`([^`]+)`/g;

/** Forward slashes, the way k4 normalises a plugin path. */
const fwd = (p) => p.replace(/\\/g, '/');

/**
 * Substitute exactly what Claude Code substitutes before the shell sees it.
 * Braced only - that asymmetry IS the bug this file exists to catch.
 */
function substitute(cmd, { pluginRoot, skillDir, projectDir, sessionId, args }) {
  return cmd
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, () => fwd(pluginRoot))
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, () => fwd(skillDir))
    .replace(/\$\{CLAUDE_PROJECT_DIR\}/g, () => fwd(projectDir))
    .replace(/\$\{CLAUDE_SESSION_ID\}/g, () => sessionId)
    .replace(/\$ARGUMENTS/g, () => args);
}

/**
 * WHICH `bash`. This is not a detail - it decided the answer once already.
 *
 * This check used to spawn a bare "bash" and trust PATH. On Windows, PATH
 * resolution
 * depends on WHICH SHELL LAUNCHED THIS CHECK: from Git Bash, `bash` is Git
 * Bash and everything below is real; from PowerShell, `bash` is
 * `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`, the WSL app-execution alias,
 * which on a machine with no distribution installed prints an error and exits 1
 * WITHOUT RUNNING ANYTHING. Same tree, same commit, two different verdicts.
 *
 * A check whose result depends on the operator's shell is not a check. So the
 * interpreter is resolved deliberately, reported on every run, and - this is the
 * half that matters - PROVEN to execute before one block is scored. See the
 * preflight below and the note on `neverRan`.
 */
function resolveBash() {
  const tried = [];
  const usable = (p, how) => {
    tried.push(`${how}: ${p}`);
    try {
      const out = execFileSync(p, ['-c', 'echo mavci-bash-probe'],
        { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
      return out.includes('mavci-bash-probe') ? { path: p, how, tried } : null;
    } catch { return null; }
  };

  if (process.env.MAVCI_BASH) {
    // An explicit pin is honoured even if it does not work: a pin that silently
    // fell back to something else would hide exactly the substitution this
    // function exists to prevent. It is preflighted like any other choice.
    return { path: process.env.MAVCI_BASH, how: 'MAVCI_BASH', tried: ['MAVCI_BASH'] };
  }

  if (process.platform === 'win32') {
    // Git Bash is the interpreter Claude Code's Bash tool uses on Windows, so it
    // is the one this check must model. The WindowsApps alias is never a
    // candidate - it is a launcher for a different operating system.
    const candidates = [
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'bin', 'bash.exe'),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        const hit = usable(c, 'Git Bash');
        if (hit) return hit;
      }
    }
  }

  return usable('bash', 'PATH') ?? { path: 'bash', how: 'PATH (unproven)', tried };
}

const BASH = resolveBash();

/** Run a command the way the Bash tool would. Never throws. */
function runBash(cmd, cwd) {
  try {
    const stdout = execFileSync(BASH.path, ['-c', cmd],
      { cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      status: typeof err.status === 'number' ? err.status : -1,
    };
  }
}

/**
 * Make an interpreter's complaint readable. The WSL stub answers in UTF-16LE and
 * in the machine's display language, so read as utf8 it arrives as text
 * interleaved with NULs. Stripping them is the difference between a diagnosable
 * failure and a wall of mojibake.
 */
const legible = (s) => s.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();

/**
 * The signatures of a command that never ran, as opposed to one that ran and
 * reported something. The first entry is the exact shape of the 0.1.0 defect.
 *
 * THIS LIST FAILS OPEN, AND THE PREFLIGHT IS WHY THAT IS TOLERABLE.
 * Every entry is an ENGLISH error string, so it answers "did this run?" by
 * matching prose. An interpreter that fails in another language - or fails
 * before reaching a shell at all - produces no match and is scored as HAVING
 * RUN. That is not hypothetical: with `bash` resolved to the WSL alias on a
 * Turkish-locale machine, 18 of the 22 blocks below reported `ok` while
 * executing nothing, and the run still printed `invoked 22 inline block(s)`.
 *
 * The fix is not a longer list of strings in more languages - that is the same
 * assertion with more ways to be almost right. It is to prove the interpreter
 * executes AT ALL before trusting any per-block verdict from it, which is what
 * the preflight does. This list is then only ever asked to discriminate between
 * two commands run by an interpreter already known to work.
 */
const NEVER_RAN = [
  /Cannot find module/i,
  /command not found/i,
  /No such file or directory/i,
  /is not recognized as an internal or external command/i,
  /ERR_MODULE_NOT_FOUND/,
  /SyntaxError|ReferenceError|TypeError:/,
];

function neverRan(text) {
  return NEVER_RAN.find((re) => re.test(text)) ?? null;
}

/** Blocks that call one of the plugin's own scripts. These must not merely run. */
const isPluginBlock = (cmd) => /\/scripts\/[a-z-]+\.mjs/.test(cmd);

/** Scripts specified to exit 0 in a healthy project. doctor is excluded: see header. */
const MUST_EXIT_ZERO = /\/scripts\/(state|verify|gate)\.mjs/;

/* --- build a real project to run the commands in ---------------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-invoke-'));
const sessionId = 'ci-invocation-session';
let blocks = 0;
let pluginBlocks = 0;

/**
 * The two controls, so this file can disagree in BOTH directions.
 *
 * The negative one runs the exact form shipped from 0.1.0 to 0.1.7 and requires
 * it to be caught. The positive one requires the fixed form to pass, so a
 * harness that has simply stopped working cannot masquerade as a clean tree.
 * Verified against a worktree of the v0.1.7 tag: it exits 2 and names all four
 * broken dynamic contexts.
 *
 * They are called from the preflight, ahead of the loop. Both of them failing at
 * once has only ever meant one thing - the harness stopped exercising anything -
 * and that is a statement about the interpreter, not about the tree.
 */
function preflightControls() {
  {
    const shipped = 'node "$CLAUDE_PLUGIN_ROOT/scripts/doctor.mjs" $ARGUMENTS';
    const cmd = substitute(shipped, {
      pluginRoot: PLUGIN, skillDir: path.join(SKILLS, 'doctor'), projectDir: tmp, sessionId, args: '',
    });
    const leftover = cmd.match(/\$(?!\{)CLAUDE_[A-Z_]+/);
    const r = runBash(cmd, tmp);
    const sig = neverRan(`${r.stdout}\n${r.stderr}`);
    if (leftover && sig) {
      ok(`negative control: the shipped v0.1.7 form is caught twice over - survives substitution as ${leftover[0]}, and fails to run (${sig})`);
    } else {
      bad('negative control FAILED: the bare $CLAUDE_PLUGIN_ROOT form was NOT caught '
        + `(leftover=${leftover?.[0] ?? 'none'}, ranError=${sig ?? 'none'}). `
        + 'This check cannot detect the defect it exists for, so nothing it reports means anything.\n'
        + `      interpreter : ${BASH.path} (resolved by ${BASH.how})\n`
        + `      it said     : ${legible(r.stdout + r.stderr).slice(0, 200) || '(nothing)'}`);
    }
  }

  {
    const fixed = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --show';
    const cmd = substitute(fixed, {
      pluginRoot: PLUGIN, skillDir: path.join(SKILLS, 'plan'), projectDir: tmp, sessionId, args: '',
    });
    const r = runBash(cmd, tmp);
    if (r.status === 0 && !neverRan(`${r.stdout}\n${r.stderr}`) && r.stdout.trim()) {
      ok('positive control: the braced form runs and reports, so the harness is not simply failing everything');
    } else {
      bad(`positive control FAILED: the correct form did not run (status=${r.status}). `
        + 'This check would block every correct tree.\n'
        + `      interpreter : ${BASH.path} (resolved by ${BASH.how})\n`
        + `      it said     : ${legible(r.stdout + r.stderr).slice(0, 200) || '(nothing)'}`);
    }
  }
}

try {
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  render.renderScaffold(tmp, MANIFEST);
  render.renderSharedConfig(tmp, MANIFEST);
  state.init(tmp, MANIFEST);
  execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'ignore' });

  /* --- PREFLIGHT: prove the interpreter before scoring anything with it ---
   *
   * These three probes used to run AFTER the loop, as a postscript. That order
   * was the defect: on a broken interpreter the loop still printed `ok invoked
   * 22 inline block(s)` - a sentence that was false - and the controls objected
   * only underneath it. The run was refused, so the gate held; but the report
   * named 22 successful invocations that had not happened, and named nothing
   * about the interpreter that was the entire cause.
   *
   * A control that can invalidate every line above it belongs above them.
   */
  console.log(`  ..   interpreter: ${BASH.path}  (resolved by ${BASH.how})`);

  {
    // 1. The interpreter executes at all. Deliberately the dumbest possible
    //    command: if THIS cannot round-trip, no verdict below means anything.
    const probe = runBash('echo mavci-preflight-ok', tmp);
    if (probe.status !== 0 || !probe.stdout.includes('mavci-preflight-ok')) {
      bad('PREFLIGHT: the shell does not execute commands, so nothing below could be tested.\n'
        + `      interpreter : ${BASH.path} (resolved by ${BASH.how})\n`
        + `      probe       : echo mavci-preflight-ok -> exit ${probe.status}\n`
        + `      it said     : ${legible(probe.stdout + probe.stderr).slice(0, 240) || '(nothing)'}\n`
        + (BASH.tried?.length ? `      tried       : ${BASH.tried.join(' | ')}\n` : '')
        + '      On Windows this is almost always PATH resolving `bash` to the WSL\n'
        + '      app-execution alias (%LOCALAPPDATA%\\Microsoft\\WindowsApps\\bash.exe)\n'
        + '      on a machine with no distribution installed. That launcher exits 1\n'
        + '      without running the command, which is indistinguishable from a\n'
        + '      command that ran and failed unless something asks it to echo.\n'
        + '      Fix: run this from Git Bash, or set MAVCI_BASH to a working bash.');
    }
  }

  // 2 and 3. The two controls, unchanged in substance and moved ahead of the
  //    loop. The negative one requires the 0.1.0 defect to be CAUGHT; the
  //    positive one requires a correct command to RUN, so this file can
  //    disagree in both directions rather than only failing everything.
  if (!failures.length) preflightControls();

  if (failures.length) {
    console.log('  ..   preflight failed - no block was invoked, and no claim is made about any');
  }

  const skills = failures.length
    ? []
    : fs.readdirSync(SKILLS).filter((s) => fs.existsSync(path.join(SKILLS, s, 'SKILL.md')));
  if (!failures.length && !skills.length) bad('no skills found - this check inspected nothing');

  for (const skill of skills) {
    const skillDir = path.join(SKILLS, skill);
    const body = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');

    for (const m of body.matchAll(INLINE)) {
      blocks++;
      const raw = m[1];
      const cmd = substitute(raw, {
        pluginRoot: PLUGIN, skillDir, projectDir: tmp, sessionId, args: '',
      });

      // 1. nothing may survive substitution. A leftover placeholder or a bare
      //    $CLAUDE_* reaches the shell as an empty string - the original bug.
      const leftover = cmd.match(/\$\{[A-Za-z_][A-Za-z0-9_.]*\}|\$(?!\{)CLAUDE_[A-Z_]+/);
      if (leftover) {
        bad(`${skill}: "${raw.slice(0, 60)}" still contains ${leftover[0]} after substitution`);
        continue;
      }

      const r = runBash(cmd, tmp);
      const combined = `${r.stdout}\n${r.stderr}`;

      // 2. it must have RUN. This is the assertion that fails on the 0.1.0 tree.
      const sig = neverRan(combined);
      if (sig) {
        bad(`${skill}: the block did not run - matched ${sig} :: ${cmd.slice(0, 90)} :: ${combined.trim().slice(0, 160)}`);
        continue;
      }

      // 3. plugin scripts specified to exit 0 in a healthy project must do so.
      if (isPluginBlock(cmd)) {
        pluginBlocks++;
        if (MUST_EXIT_ZERO.test(cmd) && r.status !== 0) {
          bad(`${skill}: ${cmd.slice(0, 80)} exited ${r.status} in a freshly scaffolded project`);
          continue;
        }
        if (!combined.trim()) {
          bad(`${skill}: ${cmd.slice(0, 80)} produced no output at all - indistinguishable from not having run`);
          continue;
        }
      }
    }
  }

  if (!failures.length && !blocks) bad('no inline `!` blocks were found in any skill - nothing was invoked');
  else if (blocks) ok(`invoked ${blocks} inline block(s) across ${skills.length} skill(s); ${pluginBlocks} call a plugin script`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  // The verify skill arms the gate; do not leave the marker on the CI runner.
  try { fs.rmSync(path.join(os.tmpdir(), `mavci-dirty-session-${sessionId}`), { force: true }); } catch { /* best effort */ }
}

if (failures.length) {
  console.error(`\ncommand invocation check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ncommand invocation check passed: every dynamic-context block substitutes and runs, '
  + `under ${BASH.path} (resolved by ${BASH.how}).`);

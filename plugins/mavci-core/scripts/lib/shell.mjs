/**
 * Which interpreter runs a shell command, decided once for everything that runs one.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * 0.1.22. `check-command-invocation.mjs` spawned a bare `bash` and trusted PATH,
 * so which binary it got depended on WHICH SHELL LAUNCHED IT. From Git Bash it
 * is Git Bash and every verdict is real. From PowerShell - the operator's primary
 * shell - `bash` resolves to `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`, the
 * WSL app-execution alias, which on a machine with no distribution prints an
 * error in Turkish, in UTF-16LE, and exits 1 WITHOUT RUNNING THE COMMAND. Same
 * tree, same commit, two different answers.
 *
 * The severity was never the failure. It was that 18 of 22 blocks were scored
 * `ok` while executing nothing, and the run printed a summary claiming 22
 * successful invocations. The lexical guard - a list of English error strings -
 * failed open against an answer in another language and another encoding.
 *
 * SO THE RULE IS NOT LEXICAL. Prove the interpreter executes AT ALL before
 * trusting any verdict from it. That is invariant 5 - a failed probe is never
 * reported as a pass - applied to the harness rather than to the thing under
 * test, and `preflight()` below is the whole of it.
 *
 * ---------------------------------------------------------- WHY IT LIVES HERE
 *
 * The criteria runner (0.1.34) executes acceptance criteria through a shell, so
 * it faces this question identically, and on the same machine. Two answers to
 * "which shell" is the shape that had `check-pretag` running 13 of
 * `release.yml`'s 17: a second list of the same thing, edited once. There is one
 * resolver, and the check that found the defect imports it rather than keeping
 * its own copy.
 *
 * Zero dependencies, Node builtins only (invariant 1).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROBE = 'mavci-shell-probe';

/**
 * Resolve the interpreter. Returns `{ path, how, tried }` and never throws.
 *
 * `MAVCI_BASH` is honoured EVEN IF IT DOES NOT WORK: a pin that silently fell
 * back to something else would hide exactly the substitution this exists to
 * prevent. It is preflighted like any other choice, and fails loudly there.
 */
export function resolveBash() {
  const tried = [];
  const usable = (p, how) => {
    tried.push(`${how}: ${p}`);
    try {
      const out = execFileSync(p, ['-c', `echo ${PROBE}`],
        { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
      return out.includes(PROBE) ? { path: p, how, tried } : null;
    } catch { return null; }
  };

  if (process.env.MAVCI_BASH) {
    return { path: process.env.MAVCI_BASH, how: 'MAVCI_BASH', tried: ['MAVCI_BASH'] };
  }

  if (process.platform === 'win32') {
    // Git Bash is the interpreter Claude Code's Bash tool uses on Windows, so it
    // is the one anything modelling that tool must use. The WindowsApps alias is
    // never a candidate - it is a launcher for a different operating system.
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

/**
 * Does this interpreter execute at all? An `echo` round trip, and nothing else.
 *
 * The caller must run this BEFORE scoring anything, and must report having
 * scored nothing when it fails. A per-item verdict from an interpreter that
 * never started is not a weak verdict; it is a sentence about a run that did not
 * happen.
 */
export function preflight(bash) {
  try {
    const out = execFileSync(bash.path, ['-c', `echo ${PROBE}`],
      { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    return out.includes(PROBE)
      ? { ok: true, answer: legible(out).trim() }
      : { ok: false, answer: legible(out).trim() || '(nothing)', status: 0 };
  } catch (err) {
    const answer = legible((err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '')).trim();
    return { ok: false, answer: answer || '(nothing)', status: err.status ?? -1 };
  }
}

/**
 * Strip the NULs out of a UTF-16LE answer read as utf8.
 *
 * The WSL stub answers in UTF-16LE. Read as utf8 that is a wall of mojibake, and
 * the difference between a diagnosable failure and an unreadable one is this
 * function. It only ever makes an error message readable; nothing is decided
 * from its output.
 */
export function legible(s) {
  return String(s ?? '').replace(/\u0000/g, '');
}

/** `Git Bash: C:\Program Files\Git\bin\bash.exe` - said on every run, pass or fail. */
export function describeBash(bash) {
  return `${bash.how}: ${bash.path}`;
}

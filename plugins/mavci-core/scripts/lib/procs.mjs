/**
 * Is a Next.js server running in this project? cartoonify finding 62.
 *
 * Task 0015 attempt 1: criterion 3 built .next, and mid-run a forgotten
 * `next dev` in the same repository wrote its development output over it. A
 * later criterion measured an unstyled page and the attempt was recorded as a
 * failure of the code. The same code passed once the server was stopped. So
 * `verify.mjs --run-criteria` asks this before the first criterion and refuses
 * - no verdict, no attempt consumed - when the answer is yes.
 *
 * A process belongs to the project when its command line names the project
 * directory (a `next` started through npm runs
 * `<project>/node_modules/next/dist/bin/next dev`), or, on Linux, when its
 * working directory is the project. The shell wrappers npm puts above it do
 * not name the directory and are not reported; the node child is.
 *
 * AN ENUMERATION THAT FAILED IS NOT AN EMPTY ONE (invariant 5). `list` returns
 * `{ ok: false }` and the caller refuses, because "could not check" recorded
 * as "nothing running" is the exact fault this exists to catch.
 *
 * Zero dependencies: PowerShell's CIM query on Windows, /proc on Linux, `ps`
 * elsewhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const NEXT_SERVER = /\bnext["']?\s+(dev|start)\b/i;

function listWindows() {
  const ps = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; '
    + 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((p) => ({ pid: p.ProcessId, cmd: p.CommandLine ?? '', cwd: null }));
}

function listLinux() {
  const procs = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    let cwd = null;
    try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { continue; }
    try { cwd = fs.readlinkSync(`/proc/${d}/cwd`); } catch { /* another user's process */ }
    procs.push({ pid: Number(d), cmd, cwd });
  }
  return procs;
}

function listPs() {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), cmd: m[2], cwd: null } : null;
  }).filter(Boolean);
}

/** Every process on the machine, or `{ ok: false, error }` when that could not be established. */
export function listProcesses() {
  try {
    const procs = process.platform === 'win32' ? listWindows()
      : process.platform === 'linux' ? listLinux()
        : listPs();
    return { ok: true, procs };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).split('\n')[0] };
  }
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The forms of `root` a command line might carry: as given, and resolved. */
function rootForms(root) {
  const forms = new Set([norm(path.resolve(root))]);
  try { forms.add(norm(fs.realpathSync.native(root))); } catch { /* as given only */ }
  return [...forms];
}

/**
 * `next dev` / `next start` processes belonging to `root`.
 * Returns `{ ok: true, found: [{pid, cmd}] }` or `{ ok: false, error }`.
 */
export function findNextServers(root, { list = listProcesses } = {}) {
  const r = list();
  if (!r.ok) return r;
  const forms = rootForms(root);
  const found = r.procs.filter((p) => {
    if (!p || p.pid === process.pid || !NEXT_SERVER.test(p.cmd ?? '')) return false;
    const cmd = norm(p.cmd);
    return forms.some((f) => cmd.includes(`${f}/`) || (p.cwd && norm(p.cwd) === f));
  }).map((p) => ({ pid: p.pid, cmd: p.cmd }));
  return { ok: true, found };
}

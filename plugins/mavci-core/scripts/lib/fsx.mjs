/**
 * Mavci Core - filesystem and serialisation helpers.
 * Zero dependencies. Every path that leaves this module is repo-relative POSIX.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_EXCLUDE_DIRS, SCANNABLE_EXT, MAX_FILE_BYTES } from '../config.mjs';

/* ------------------------------------------------------------- paths */

/** Repo-relative POSIX. ROADMAP data-format constraint 7: no drive letters, no backslashes. */
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function relPosix(root, abs) {
  return toPosix(path.relative(root, abs));
}

export function abs(root, relative) {
  return path.resolve(root, relative);
}

/** True when `p` escapes `root`. Used to reject traversal in every path we are handed. */
export function escapesRoot(root, p) {
  const rel = path.relative(root, path.resolve(root, p));
  return rel.startsWith('..') || path.isAbsolute(rel);
}

/* ------------------------------------------------------------- reads */

export function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

export function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

/** Returns null rather than throwing when the file is absent. */
export function readTextOrNull(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/**
 * Read JSON with a diagnostic that names the file.
 * A bare "Unexpected token" from deep inside a gate is unactionable.
 */
export function readJson(p) {
  const raw = readText(p);
  try {
    return JSON.parse(stripBom(raw));
  } catch (err) {
    throw new Error(`${toPosix(p)} is not valid JSON: ${err.message}`);
  }
}

export function readJsonOrNull(p) {
  if (!exists(p)) return null;
  return readJson(p);
}

export function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/* ------------------------------------------------------------ writes */

/**
 * Atomic write: temp file in the same directory, then rename.
 * Rename is atomic within a filesystem, so a crash mid-write cannot leave
 * a half-written control file that the next gate would read as corrupt.
 * Always UTF-8 without BOM, always LF (ROADMAP constraint 9).
 */
export function writeTextAtomic(p, text) {
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(p)}.${process.pid}.tmp`);
  const normalised = text.replace(/\r\n/g, '\n');
  fs.writeFileSync(tmp, normalised, { encoding: 'utf8' });
  fs.renameSync(tmp, p);
}

/** Canonical JSON: sorted keys, 2-space indent, trailing newline. Stable git diffs. */
export function writeJsonAtomic(p, value) {
  writeTextAtomic(p, canonicalJson(value) + '\n');
}

/**
 * Deterministic serialisation. Two runs producing the same data must produce
 * byte-identical output, otherwise the integrity hash is noise and every
 * verdict shows a spurious diff.
 */
export function canonicalJson(value, indent = 2) {
  return JSON.stringify(sortDeep(value), null, indent);
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

/* -------------------------------------------------------------- hash */

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/* -------------------------------------------------------------- walk */

/**
 * Walk a project tree, yielding repo-relative POSIX paths.
 * Skips excluded directories, unscannable extensions and oversized files
 * so a stray 40 MB fixture cannot blow the gate budget.
 */
export function* walk(root, { excludeDirs = DEFAULT_EXCLUDE_DIRS, extensions = SCANNABLE_EXT } = {}) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory is not a checker failure
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excludeDirs.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      // .env has no extension via extname when the file is literally ".env"
      const isEnv = entry.name === '.env' || entry.name.startsWith('.env.');
      if (!isEnv && extensions && !extensions.has(ext)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      if (size > MAX_FILE_BYTES) continue;
      yield relPosix(root, full);
    }
  }
}

/* ------------------------------------------------------------- globs */

/**
 * Minimal glob matcher for the shapes this system uses: `**`, `*`, `?`.
 * Deliberately not a full glob implementation - the patterns it must handle are
 * ours, listed in config.CONTROL_GLOBS and project.json checks.exclude_paths.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more path segments; bare `**` matches anything
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(relPath, globs) {
  return globs.some((g) => globToRegExp(g).test(relPath));
}

/** Expand the CONTROL_GLOBS patterns against what actually exists on disk. */
export function expandGlobs(root, globs) {
  const literals = globs.filter((g) => !g.includes('*'));
  const patterns = globs.filter((g) => g.includes('*'));
  const found = new Set();
  for (const lit of literals) if (exists(abs(root, lit))) found.add(lit);
  if (patterns.length) {
    for (const rel of walk(root, { extensions: null })) {
      if (matchesAny(rel, patterns)) found.add(rel);
    }
  }
  return [...found].sort();
}

/* ------------------------------------------------------------- lines */

/** 1-indexed line number of a character offset. For evidence strings. */
export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addDaysIso(days, from = new Date()) {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

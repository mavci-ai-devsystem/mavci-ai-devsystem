#!/usr/bin/env node
/**
 * Mavci Core - secret redaction. ARCHITECTURE 4.4 (blocker B5).
 *
 * Nothing under .mavci/ is written without passing through here first, because
 * .mavci/ is committed to a project repo that also holds Supabase service keys,
 * Stripe secrets and Resend keys. Verdict `evidence` and agent report fields are
 * free text produced by a model; they are exactly where a key leaks.
 *
 * Four value classes:
 *   1. known prefixes        sk_live_, whsec_, re_, sbp_, ...
 *   2. JWT-shaped strings    what a Supabase anon/service-role key looks like
 *   3. live values of every key named in project.json env_sources.required_keys
 *   4. high-entropy tokens   catches formats we do not know yet
 *
 * Class 3 requires reading .env.local. That is the ONE sanctioned read of an env
 * file in this system: values are held in memory, used for exact substring
 * replacement, and never logged, printed or written anywhere. See ROADMAP R7.
 *
 * CLI:
 *   node redact.mjs --sweep        PostToolUse: rewrite any .mavci/ file in place
 *   node redact.mjs --selftest     CI: prove the four classes work, no Claude needed
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATHS, MAVCI_DIR } from './config.mjs';
import {
  abs, exists, readJsonOrNull, readTextOrNull, writeTextAtomic,
  walk, relPosix, toPosix,
} from './lib/fsx.mjs';

/* ------------------------------------------------------- class 1: prefixes */

/**
 * Each entry: a literal prefix plus the minimum token length that follows it.
 * The length floor stops `re_` matching the word "re_export".
 */
const PREFIX_PATTERNS = [
  { label: 'stripe_live', re: /\bsk_live_[A-Za-z0-9]{12,}/g },
  { label: 'stripe_test', re: /\bsk_test_[A-Za-z0-9]{12,}/g },
  { label: 'stripe_restricted', re: /\brk_live_[A-Za-z0-9]{12,}/g },
  { label: 'stripe_webhook', re: /\bwhsec_[A-Za-z0-9]{12,}/g },
  { label: 'resend', re: /\bre_[A-Za-z0-9_-]{16,}/g },
  { label: 'supabase_pat', re: /\bsbp_[A-Za-z0-9]{20,}/g },
  { label: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { label: 'github_pat', re: /\bghp_[A-Za-z0-9]{20,}/g },
  { label: 'github_pat_fine', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { label: 'aws_key', re: /\bAKIA[A-Z0-9]{16}\b/g },
  { label: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: 'openai', re: /\bsk-proj-[A-Za-z0-9_-]{20,}/g },
];

/* ----------------------------------------------------------- class 2: JWT */

const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/* ------------------------------------------------------- class 4: entropy */

const HIGH_ENTROPY_CANDIDATE = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * 4.0 bits/char, not 3.5. The selftest proved 3.5 redacts ordinary snake_case
 * identifiers: `this_is_a_very_long_but_low_entropy_identifier_name` scores ~3.7.
 * Entropy alone is not a sufficient discriminator, so a candidate must ALSO mix
 * character classes - real API keys do, identifiers do not.
 */
const ENTROPY_THRESHOLD = 4.0;

/** Hash-shaped strings are skipped: git SHAs, lockfile digests and this system's
 *  own integrity hash are all long pure hex and none of them are secrets.
 *  A lowercase-hex secret is still caught by the prefix or known-value class. */
const HEX_ONLY = /^[0-9a-f]+$/i;

function looksLikeToken(s) {
  if (HEX_ONLY.test(s)) return false;
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);
}

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/* --------------------------------------------------------- value sources */

/**
 * Parse a dotenv file well enough to harvest values. Not a full dotenv
 * implementation - it only needs to find the right-hand sides.
 */
function parseEnvValues(text) {
  const out = new Map();
  if (!text) return out;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val) out.set(key, val);
  }
  return out;
}

/**
 * Build the set of literal secret values to redact.
 * Values shorter than 8 characters are ignored so `true`, `3000` and `local`
 * do not turn every verdict into redaction soup.
 */
function collectSecretValues(root, manifest) {
  const wanted = new Set(manifest?.env_sources?.required_keys ?? []);
  const values = new Map(); // value -> key name

  const consider = (key, val) => {
    if (!val || typeof val !== 'string' || val.length < 8) return;
    if (!wanted.has(key)) return;
    // A public URL is not a secret and redacting it destroys useful evidence.
    if (/^https?:\/\//.test(val) && key.startsWith('NEXT_PUBLIC_')) return;
    values.set(val, key);
  };

  for (const [k, v] of Object.entries(process.env)) consider(k, v);

  const localFile = manifest?.env_sources?.local_file;
  const candidates = localFile ? [localFile] : ['.env.local', '.env'];
  for (const rel of candidates) {
    const text = readTextOrNull(abs(root, rel));
    if (!text) continue;
    for (const [k, v] of parseEnvValues(text)) consider(k, v);
  }
  return values;
}

/* ---------------------------------------------------------- the redactor */

/**
 * @param {string} root  project root
 * @param {object|null} manifest  parsed .mavci/project.json
 * @returns {{ redact: (t:string)=>string, findings: (t:string)=>Array, scanRepoText: (t:string)=>Array }}
 */
export function buildRedactor(root, manifest = null) {
  const values = collectSecretValues(root, manifest);
  // Longest first: redacting a substring before its superstring leaves fragments.
  const sortedValues = [...values.keys()].sort((a, b) => b.length - a.length);

  function applyValueClass(text, findings) {
    let out = text;
    for (const val of sortedValues) {
      if (!out.includes(val)) continue;
      const key = values.get(val);
      findings.push({ class: 'env_value', label: key });
      out = out.split(val).join(`[REDACTED:${key}]`);
    }
    return out;
  }

  function applyPrefixClass(text, findings) {
    let out = text;
    for (const { label, re } of PREFIX_PATTERNS) {
      out = out.replace(new RegExp(re.source, re.flags), (m) => {
        findings.push({ class: 'prefix', label, sample: m.slice(0, 8) });
        return `[REDACTED:prefix:${label}]`;
      });
    }
    return out;
  }

  function applyJwtClass(text, findings) {
    return text.replace(JWT_RE, () => {
      findings.push({ class: 'jwt', label: 'jwt' });
      return '[REDACTED:jwt]';
    });
  }

  function applyEntropyClass(text, findings) {
    return text.replace(HIGH_ENTROPY_CANDIDATE, (m) => {
      if (m.startsWith('[REDACTED')) return m;
      if (!looksLikeToken(m)) return m;
      if (entropy(m) <= ENTROPY_THRESHOLD) return m;
      findings.push({ class: 'entropy', label: 'entropy' });
      return '[REDACTED:entropy]';
    });
  }

  /** Full redaction. Used for everything written under .mavci/. */
  function redact(text) {
    if (typeof text !== 'string' || !text) return text;
    const findings = [];
    let out = applyValueClass(text, findings);
    out = applyPrefixClass(out, findings);
    out = applyJwtClass(out, findings);
    out = applyEntropyClass(out, findings);
    return out;
  }

  function findings(text) {
    if (typeof text !== 'string' || !text) return [];
    const f = [];
    let out = applyValueClass(text, f);
    out = applyPrefixClass(out, f);
    out = applyJwtClass(out, f);
    applyEntropyClass(out, f);
    return f;
  }

  /**
   * Repo-wide scan for `secrets.no_committed_secrets`.
   * Entropy class is deliberately OMITTED here: sha-256 integrity hashes in
   * lock files and base64 data URIs are high-entropy and are not secrets.
   * Prefix, JWT and known-value classes have no such false-positive mode.
   */
  function scanRepoText(text) {
    if (typeof text !== 'string' || !text) return [];
    const f = [];
    let out = applyValueClass(text, f);
    out = applyPrefixClass(out, f);
    applyJwtClass(out, f);
    return f;
  }

  /** Recursively redact every string in a JSON-shaped value. */
  function redactDeep(value) {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(redactDeep);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
      return out;
    }
    return value;
  }

  return { redact, redactDeep, findings, scanRepoText, valueCount: sortedValues.length };
}

/* ------------------------------------------------------------------ CLI */

function loadManifest(root) {
  return readJsonOrNull(abs(root, PATHS.manifest));
}

/**
 * --sweep : rewrite every .mavci/ file in place, stripping anything that slipped
 * past the PreToolUse scan (a subprocess write, for instance). Defence in depth;
 * prevention is risk-guard.mjs.
 */
function sweep(root) {
  const manifest = loadManifest(root);
  const r = buildRedactor(root, manifest);
  const mavciAbs = abs(root, MAVCI_DIR);
  if (!exists(mavciAbs)) return { changed: [], scanned: 0 };

  const changed = [];
  let scanned = 0;
  for (const rel of walk(mavciAbs, { extensions: null })) {
    const full = path.join(mavciAbs, rel);
    const text = readTextOrNull(full);
    if (text === null) continue;
    scanned++;
    const out = r.redact(text);
    if (out !== text) {
      writeTextAtomic(full, out);
      changed.push(toPosix(path.join(MAVCI_DIR, rel)));
    }
  }
  return { changed, scanned };
}

function selftest() {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'mavci-redact-'));
  const failures = [];
  const check = (name, cond, detail = '') => {
    if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  };

  try {
    fs.mkdirSync(path.join(tmp, MAVCI_DIR), { recursive: true });
    fs.writeFileSync(path.join(tmp, MAVCI_DIR, 'project.json'), JSON.stringify({
      env_sources: { local_file: '.env.local', required_keys: ['MY_CUSTOM_TOKEN', 'NEXT_PUBLIC_SUPABASE_URL'] },
    }));
    fs.writeFileSync(path.join(tmp, '.env.local'),
      'MY_CUSTOM_TOKEN=zzzz-super-secret-value-9876\nNEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\n');

    const r = buildRedactor(tmp, loadManifest(tmp));

    // class 1
    const c1 = r.redact('key is sk_live_51ABCdefGHIjklMNO and that is that');
    check('class1_prefix_removed', !c1.includes('sk_live_51ABCdefGHIjklMNO'), c1);
    check('class1_marker_present', c1.includes('[REDACTED:prefix:stripe_live]'), c1);

    // class 2
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const c2 = r.redact(`token ${jwt} end`);
    check('class2_jwt_removed', !c2.includes(jwt), c2);

    // class 3 - the value came from .env.local, not from a pattern
    const c3 = r.redact('the token is zzzz-super-secret-value-9876 ok');
    check('class3_value_removed', !c3.includes('zzzz-super-secret-value-9876'), c3);
    check('class3_names_key', c3.includes('[REDACTED:MY_CUSTOM_TOKEN]'), c3);

    // class 3 negative - a NEXT_PUBLIC_ url is not a secret
    const c3n = r.redact('url https://abc.supabase.co here');
    check('class3_public_url_kept', c3n.includes('https://abc.supabase.co'), c3n);

    // class 4
    const highEntropy = 'aB3xQ7zK9mR2tY5uP8wE1sD4fG6hJ0kL7nM3bV5c';
    const c4 = r.redact(`opaque ${highEntropy} token`);
    check('class4_entropy_removed', !c4.includes(highEntropy), c4);

    // class 4 negative - ordinary prose and long lowercase identifiers survive
    const prose = 'this_is_a_very_long_but_low_entropy_identifier_name_aaaa';
    const c4n = r.redact(prose);
    check('class4_low_entropy_kept', c4n.includes(prose), c4n);

    // class 4 negative - hash-shaped strings survive. This system writes a
    // sha-256 integrity hash into control/integrity.json; redacting it would
    // corrupt the very mechanism that detects control-plane tampering.
    const hash = 'a3f1c09b7d2e845611fa0cbd93e7241850ab6cf29d13e5074b8a6c2f19de3b40';
    const c4h = r.redact(`control_hash ${hash}`);
    check('class4_hex_hash_kept', c4h.includes(hash), c4h);

    // class 4 negative - a long base64-ish CSS/data blob of one case class
    const oneCase = 'AAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCCCCDDDDDDDDDDDD';
    check('class4_single_class_kept', r.redact(oneCase).includes(oneCase));

    // repo scan must NOT apply entropy (lockfile hashes are not secrets)
    check('reposcan_ignores_entropy', r.scanRepoText(`hash ${highEntropy}`).length === 0);
    check('reposcan_catches_prefix', r.scanRepoText('whsec_abcdefghijklmnop').length === 1);

    // deep redaction of a verdict-shaped object
    const deep = r.redactDeep({ checks: [{ evidence: 'saw sk_live_51ABCdefGHIjklMNO at line 4' }] });
    check('deep_redaction', !JSON.stringify(deep).includes('sk_live_51ABCdefGHIjklMNO'));

    // idempotence - sweeping twice must not double-mark
    check('idempotent', r.redact(c1) === c1, r.redact(c1));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error('redact selftest FAILED:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log(`redact selftest passed (12 assertions, 4 value classes)`);
}

function main() {
  const args = process.argv.slice(2);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (args.includes('--selftest')) return selftest();

  if (args.includes('--sweep')) {
    try {
      const { changed } = sweep(root);
      if (changed.length) {
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            systemMessage: `mavci: redacted secrets from ${changed.length} file(s) under .mavci/: ${changed.join(', ')}. ` +
              'Never put a secret value in a task note or verdict - name the key instead.',
          },
        }));
      }
    } catch {
      // A sweep failure must never break the user's turn. Prevention is the
      // PreToolUse deny in risk-guard.mjs; this pass is defence in depth.
    }
    return;
  }

  console.error('usage: redact.mjs --sweep | --selftest');
  process.exit(2);
}

// basename, not endsWith: a file named check-<this>.mjs ends with this
// script's name, so the endsWith form ran the CLI the moment a self-test
// imported the module. It cost one debugging session on check-retro.mjs.
if (process.argv[1] && path.basename(process.argv[1]) === 'redact.mjs') {
  main();
}

#!/usr/bin/env node
/**
 * Schemas must parse, and must only use keywords the bundled validator implements.
 *
 * The validator is deliberately small (zero dependencies keeps the escape hatch
 * real). The danger of a small validator is silent under-validation: an author
 * writes `minProperties`, the validator ignores it, and everyone believes a
 * constraint is being enforced when it is not. This job makes that a build failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'templates', 'schemas');
const { unsupportedKeywords, validate } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/schema.mjs')).href);

const failures = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.schema.json')).sort();

if (!files.length) failures.push('no schemas found');

for (const f of files) {
  const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { failures.push(`${f}: invalid JSON - ${e.message}`); continue; }

  const unsupported = unsupportedKeywords(doc);
  if (unsupported.length) {
    failures.push(`${f}: uses keyword(s) the validator ignores: ${unsupported.join(', ')}. `
      + 'Either implement them in lib/schema.mjs or stop using them - a silently ignored '
      + 'keyword reads as a constraint that is not enforced.');
    continue;
  }

  // Every regex in a pattern must compile, and must avoid backslash escapes:
  // they do not survive every shell and editor round trip, and a mangled pattern
  // silently matches nothing. Use a character class - [.] instead of \. - instead.
  (function walk(node, at) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}[${i}]`));
    for (const [k, v] of Object.entries(node)) {
      if (k === 'pattern' && typeof v === 'string') {
        try { new RegExp(v); } catch (e) { failures.push(`${f} ${at}: bad pattern ${v} - ${e.message}`); }
        if (v.includes('\\')) {
          failures.push(`${f} ${at}: pattern "${v}" contains a backslash escape. `
            + 'Use a character class such as [.] instead - backslashes do not survive '
            + 'every shell and heredoc round trip, and a mangled pattern matches nothing.');
        }
      }
      walk(v, `${at}.${k}`);
    }
  })(doc, f);

  console.log(`  ok   ${f}`);
}

// The validator itself must actually reject something, or every schema "passes".
const probe = { type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 2 } }, additionalProperties: false };
if (validate({ a: 1 }, probe).length === 0) failures.push('validator did not reject a value below minimum');
if (validate({ b: 1 }, probe).length === 0) failures.push('validator did not reject a missing required property');
if (validate({ a: 5 }, probe).length !== 0) failures.push('validator rejected a valid value');

if (failures.length) {
  console.error('\nschema check FAILED:');
  for (const x of failures) console.error('  - ' + x);
  process.exit(2);
}
console.log(`\n${files.length} schemas valid; validator self-check passed`);

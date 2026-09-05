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
const DIR = path.join(ROOT, 'plugins/mavci-core/templates', 'schemas');
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

// Closed enums duplicated between config.mjs and a schema must not drift. The
// duplication is deliberate (the schemas are data, config.mjs is code), but a
// silent disagreement means one of the two is enforcing nothing.
{
  const config = await import(pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/config.mjs')).href);
  const pairs = [
    ['state.schema.json', 'phase', config.PHASES],
    ['hook-run.schema.json', 'event', config.HOOK_RUN_EVENTS],
    ['unverified.schema.json', 'fault', config.GATE_FAULT_KINDS],
    ['verdict.schema.json', 'verdict', config.VERDICTS],
  ];
  for (const [file, prop, fromConfig] of pairs) {
    const p = path.join(DIR, file);
    if (!fs.existsSync(p)) { failures.push(`${file}: missing, but config.mjs still declares its enum`); continue; }
    const inSchema = JSON.parse(fs.readFileSync(p, 'utf8')).properties?.[prop]?.enum;
    if (!Array.isArray(inSchema)) { failures.push(`${file}: ${prop} has no enum, so the closed set is not enforced`); continue; }
    if (JSON.stringify(inSchema) !== JSON.stringify(fromConfig)) {
      failures.push(`${file} ${prop} enum ${JSON.stringify(inSchema)} disagrees with config.mjs ${JSON.stringify(fromConfig)}`);
    } else {
      console.log(`  ok   ${file} ${prop} enum matches config.mjs`);
    }
  }
}

// The same rule one level down. `criteria[]` lives in $defs, which the loop
// above cannot reach, and a closed enum nobody compares is a closed enum that
// drifts - finding 6's two pairs are exactly the ones that must not collapse:
// skipped/not_run (a decision vs an absence) and executed/inspected (run vs read).
{
  const config = await import(pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/config.mjs')).href);
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, 'verdict.schema.json'), 'utf8'));
  const crit = doc.$defs?.criterion;
  if (!crit) {
    failures.push('verdict.schema.json: no $defs.criterion, so criteria[] is unconstrained');
  } else {
    for (const [prop, fromConfig] of [['status', config.CRITERION_STATUSES], ['mode', config.CRITERION_MODES]]) {
      const inSchema = crit.properties?.[prop]?.enum;
      if (JSON.stringify(inSchema) !== JSON.stringify(fromConfig)) {
        failures.push(`verdict.schema.json criterion.${prop} enum ${JSON.stringify(inSchema)} `
          + `disagrees with config.mjs ${JSON.stringify(fromConfig)}`);
      } else {
        console.log(`  ok   verdict.schema.json criterion.${prop} enum matches config.mjs`);
      }
    }
    // REQUIRED, and it is the assertion that keeps `mode` from being optional in
    // practice: a result recorded without saying whether it was run or read is
    // the prose this finding exists to replace.
    const req = Array.isArray(crit.required) ? crit.required : [];
    for (const f of ['id', 'status', 'mode']) {
      if (!req.includes(f)) failures.push(`verdict.schema.json criterion.${f} is not required, so a `
        + 'result can be recorded without it');
    }
    if (['id', 'status', 'mode'].every((f) => req.includes(f))) {
      console.log('  ok   verdict.schema.json criterion requires id, status and mode');
    }
  }
}

// A numeric constant duplicated between config.mjs and a schema is the same
// hazard as a duplicated enum, and the one that bit hardest: verdict.schema.json
// caps evidence at 500 and remedy at 300, nothing in the rule set knew those
// numbers, and one 583-character string took the whole checker offline for a
// project (Gate 4c, finding 2). config.mjs now owns them and check-evidence-caps
// enforces them at authoring time - which is worth nothing if the two numbers
// are allowed to disagree.
{
  const config = await import(pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/config.mjs')).href);
  const caps = [
    ['verdict.schema.json', ['$defs', 'check', 'properties', 'evidence', 'maxLength'], config.EVIDENCE_MAX_CHARS],
    ['verdict.schema.json', ['$defs', 'check', 'properties', 'remedy', 'maxLength'], config.REMEDY_MAX_CHARS],
    ['unverified.schema.json', ['properties', 'detail', 'maxLength'], config.FAULT_DETAIL_MAX_CHARS],
  ];
  for (const [file, keyPath, fromConfig] of caps) {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const inSchema = keyPath.reduce((n, k) => (n == null ? n : n[k]), doc);
    if (inSchema !== fromConfig) {
      failures.push(`${file} ${keyPath.join('.')} is ${inSchema}, config.mjs says ${fromConfig}. `
        + 'A cap enforced at one number and checked at another is a cap that fires in production '
        + 'and passes in CI.');
    } else {
      console.log(`  ok   ${file} ${keyPath.at(-2)}.maxLength (${inSchema}) matches config.mjs`);
    }
  }
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

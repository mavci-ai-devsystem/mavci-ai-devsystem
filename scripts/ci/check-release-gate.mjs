#!/usr/bin/env node
/**
 * The release precondition gate. Design step 5, built BEFORE guardian so that
 * guardian is written into a system already refusing to trust it.
 *
 * The case that matters most is the fourth one, and it is the one a "refuses on
 * absent, stale or failing records" specification does not cover: a record that
 * EXISTS, is CURRENT, and says `pass` - over an empty worklist. That is
 * `not_checked` reaching release dressed as a pass, and it is refused here by an
 * explicit branch rather than by falling out of a `!== 'pass'` chain.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { assessReleaseReadiness, REFUSAL, UNREADABLE } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/release-gate.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const V = '0.1.15';
const rec = (over = {}) => ({
  plugin_version: V, verdict: 'pass',
  coverage: { sites_total: 2, sites_answered: 2 }, ...over,
});
const codes = (r) => r.refusals.map((x) => x.code);
const one = (input, code, label) => {
  const r = assessReleaseReadiness({ runningVersion: V, ...input });
  check(!r.ok && codes(r).includes(code), `${label} -> refused as ${code} (got ${r.ok ? 'ALLOWED' : codes(r).join(',')})`);
  return r;
};

console.log('release precondition gate:');

/* --------------------------------------------------------- the happy path */

const good = assessReleaseReadiness({ runningVersion: V, guardianRecord: rec() });
check(good.ok && good.refusals.length === 0, 'current record, pass, complete coverage -> allowed');

/* ------------------------------------------------- the specified refusals */

one({ guardianRecord: null }, 'guardian_record_absent', 'no guardian record');
one({ guardianRecord: rec({ plugin_version: '0.1.14' }) }, 'guardian_record_stale', 'record from an older plugin');
one({ guardianRecord: rec({ plugin_version: '9.9.9' }) }, 'guardian_record_stale', 'record from a NEWER plugin');
one({ guardianRecord: rec({ verdict: 'fail', fail_reason: 'findings' }) }, 'guardian_failed', 'record says fail');
one({ unverified: { fault: 'checker_crash' }, guardianRecord: rec() }, 'unverified_session',
  'session marked UNVERIFIED even with a clean guardian record');

/* ---------------------------------- THE FOURTH CASE: not_checked at release */

const nc = one({ guardianRecord: rec({ verdict: 'not_checked', coverage: { sites_total: 0, sites_answered: 0 } }) },
  'guardian_not_checked', 'record exists, is CURRENT, verdict not_checked over an empty worklist');
check(/scan/.test(nc.refusals.find((r) => r.code === 'guardian_not_checked').message),
  'and the refusal points at the SCAN, not at guardian - it names where to look');

// The same shape with the verdict field forged to `pass`. The floor prevents the
// writer producing this; release must not depend on the writer being correct.
one({ guardianRecord: rec({ verdict: 'pass', coverage: { sites_total: 0, sites_answered: 0 } }) },
  'guardian_record_inconsistent', 'record CLAIMS pass over an empty worklist (forged or buggy writer)');
one({ guardianRecord: rec({ verdict: 'pass', coverage: { sites_total: 5, sites_answered: 3 } }) },
  'guardian_record_inconsistent', 'record claims pass over INCOMPLETE coverage');

/* --------------------------------------- unreadable is the same as absent */

const unreadable = one({ guardianRecord: UNREADABLE }, 'guardian_record_unreadable', 'record present but unparseable');
const absent = assessReleaseReadiness({ runningVersion: V, guardianRecord: null });
const shared = 'Absent and unreadable are the same fact here';
check(unreadable.refusals[0].message.includes(shared) && absent.refusals[0].message.includes(shared),
  'absent and unreadable share the same wording - a record that cannot be read establishes nothing');
one({ guardianRecord: rec({ coverage: undefined }) }, 'guardian_record_unreadable',
  'record with no coverage numbers is unreadable, not a pass');

/* ------------------------------------------------ allow-list, not deny-list */

// The enum grows. A gate written as `verdict !== 'fail' && verdict !== 'not_checked'`
// would ALLOW this; an allow-list refuses it.
const grown = one({ guardianRecord: rec({ verdict: 'partial' }) }, 'guardian_verdict_unknown',
  'a verdict value this gate has never seen');
check(/refuses rather than interpreting/.test(grown.refusals[0].message),
  'and it says WHY it refuses an unknown value rather than guessing');

// Nothing but the exact string `pass` is ever allowed.
const allowed = ['pass', 'fail', 'not_checked', 'partial', 'PASS', '', null, undefined]
  .filter((v) => assessReleaseReadiness({ runningVersion: V, guardianRecord: rec({ verdict: v }) }).ok);
check(allowed.length === 1 && allowed[0] === 'pass',
  `exactly one verdict value is allowed, and it is "pass" (allowed: ${JSON.stringify(allowed)})`);

/* ---------------------------------------------------------- declared codes */

const seen = new Set();
for (const input of [{ guardianRecord: null }, { guardianRecord: UNREADABLE },
  { guardianRecord: rec({ plugin_version: '0.0.1' }) }, { guardianRecord: rec({ verdict: 'fail' }) },
  { guardianRecord: rec({ verdict: 'not_checked', coverage: { sites_total: 0, sites_answered: 0 } }) },
  { guardianRecord: rec({ verdict: 'zzz' }) },
  { guardianRecord: rec({ coverage: { sites_total: 0, sites_answered: 0 } }) },
  { unverified: { fault: 'x' }, guardianRecord: rec() }]) {
  for (const c of codes(assessReleaseReadiness({ runningVersion: V, ...input }))) seen.add(c);
}
check([...seen].every((c) => REFUSAL.includes(c)),
  `every refusal code emitted is declared in REFUSAL (${[...seen].length} distinct)`);
check(seen.size === REFUSAL.length,
  `every declared refusal code is reachable and exercised (${seen.size}/${REFUSAL.length})`);

console.log('');
if (failures.length) {
  console.log(`release gate check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('release gate: allow-lists the verdict, recomputes coverage, and treats unreadable as absent');

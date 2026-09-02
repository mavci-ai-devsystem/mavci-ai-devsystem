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
const { assessReleaseReadiness, selectProjectRecord, REFUSAL, RECORD_SOURCE, UNREADABLE } = await import(
  pathToFileURL(path.join(ROOT, 'plugins/mavci-core/scripts/lib/release-gate.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const V = '0.1.15';
const rec = (over = {}) => ({
  plugin_version: V, verdict: 'pass', source: 'real',
  coverage: { sites_total: 2, sites_answered: 2 }, ...over,
});
// A corpus record as the corpus actually leaves one: the t5w9d control, whose
// EXPECTED verdict is fail. This exact document is what closed the release gate.
const corpusRec = (over = {}) => rec({ source: 'corpus', verdict: 'fail', fail_reason: 'undetermined', ...over });
const entries = (...docs) => docs.map((doc, i) => ({ id: `wl-${1000 + i}.json`, doc }));
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

/* ============================================================ FINDING 25
 *
 * One directory, two purposes. The corpus writes guardian records through the
 * real writer into the real directory - deliberately, because a corpus that wrote
 * through another path would not be grading the writer that ships. The gate read
 * "the newest record". The corpus's LAST case is an expected-`fail` control. So a
 * PASSING corpus left this gate holding a failing record about a staged fixture.
 *
 * BROKEN BUILD THESE MUST CATCH: 0.1.20 as shipped, in gate4c, over the records a
 * passing corpus leaves behind. Confirmed failing before the fix was written - with
 * `source` absent from every document, the whole block below refused where it now
 * allows, and `guardian_failed` was the code, quoting t5w9d's verdict as a finding
 * about the project.
 */

// ---- the source is REQUIRED BY THE READER, in every direction ------------
one({ guardianRecord: rec({ source: undefined }) }, 'guardian_record_undeclared',
  'a record with no source at all (every record written before 0.1.21)');
one({ guardianRecord: rec({ source: null }) }, 'guardian_record_undeclared',
  'a record whose source is explicitly null - never established, not "assume real"');
one({ guardianRecord: corpusRec() }, 'guardian_record_is_corpus',
  'a corpus fixture handed straight to the decision (defense in depth: the selector already skips it)');

// Enum growth, the same failure shape the verdict allow-list exists for. A reader
// written as `source !== 'corpus'` would ALLOW every one of these.
const promoted = ['REAL', 'Real', 'project', 'true', '', 0, 1, true, {}]
  .filter((s) => assessReleaseReadiness({ runningVersion: V, guardianRecord: rec({ source: s }) }).ok);
check(promoted.length === 0,
  `no source value but the exact string "real" is ever counted as project evidence (promoted: ${JSON.stringify(promoted)})`);

// ---- SELECTION is half the decision, so it is asserted here --------------
// It lived in release-check.mjs where no test could reach it. That is where
// finding 25 sat for three releases.

const empty = selectProjectRecord([]);
check(empty.record === null && empty.counts.total === 0, 'selector: an empty directory selects nothing');

const allCorpus = selectProjectRecord(entries(corpusRec(), corpusRec(), corpusRec()));
check(allCorpus.record === null && allCorpus.counts.corpus === 3,
  'selector: a directory of nothing but corpus records selects nothing, and counts what it skipped');

// THE CASE. A real passing record, then a corpus run on top of it - which is
// exactly the state a passing corpus produces.
const afterCorpusRun = selectProjectRecord(entries(rec(), corpusRec(), corpusRec(), corpusRec()));
check(afterCorpusRun.record !== null && afterCorpusRun.record.source === 'real'
  && afterCorpusRun.counts.corpus === 3,
  'selector: skips a corpus run sitting ON TOP of a real record and selects the real one');
check(assessReleaseReadiness({ runningVersion: V, guardianRecord: afterCorpusRun.record,
  recordCounts: afterCorpusRun.counts }).ok,
  'and the gate then ALLOWS - a passing corpus no longer closes the release gate');

const withUndeclared = selectProjectRecord(entries(rec(), rec({ source: undefined })));
check(withUndeclared.record?.source === 'real' && withUndeclared.counts.undeclared === 1,
  'selector: skips an undeclared record above a real one, and counts it separately from corpus');

// An unreadable file BLOCKS rather than being stepped over: it could have been a
// newer real record, and choosing evidence by legibility is choosing the evidence
// that agrees with you.
const blocked = selectProjectRecord(entries(rec(), UNREADABLE));
check(blocked.record === UNREADABLE,
  'selector: an unreadable record ABOVE a real one blocks the scan rather than being skipped past');
const readablePast = selectProjectRecord(entries(UNREADABLE, rec()));
check(readablePast.record?.source === 'real',
  'selector: an unreadable record BELOW the selected one is irrelevant and does not block');

// ---- the message tells the operator what it did with the rest ------------
const undeclaredMsg = assessReleaseReadiness({ runningVersion: V, guardianRecord: null,
  recordCounts: { corpus: 3, undeclared: 7, total: 10 } });
check(codes(undeclaredMsg).includes('guardian_record_undeclared'),
  'ten records and none about the project -> undeclared, NOT "no guardian record"');
const um = undeclaredMsg.refusals[0].message;
check(/10 guardian record/.test(um) && /3 declare themselves corpus/.test(um) && /7 declare no source/.test(um),
  'and the refusal states the counts - "run guardian" is the wrong advice for someone who just did');
check(!assessReleaseReadiness({ runningVersion: V, guardianRecord: null, recordCounts: { corpus: 0, undeclared: 0, total: 0 } })
  .refusals.some((r) => r.code === 'guardian_record_undeclared'),
  'an empty directory is still reported as ABSENT, not as undeclared');

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
  { guardianRecord: rec({ source: undefined }) }, { guardianRecord: corpusRec() },
  { guardianRecord: null, recordCounts: { corpus: 1, undeclared: 0, total: 1 } },
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
console.log('release gate: allow-lists the verdict AND the record source, recomputes coverage,');
console.log('             treats unreadable as absent, and selects project evidence in a tested function');

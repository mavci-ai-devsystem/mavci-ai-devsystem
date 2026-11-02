#!/usr/bin/env node
/**
 * An approved spec can be REVISED: withdrawn on purpose, with a reason, the old
 * version kept, the task back in plan - and re-approved through the same checks.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * cartoonify task 0034 (2026-11-02). The operator approved a spec; criterion 8
 * asked for a 20-minute timeout and the runner allows 10. There was no sanctioned
 * way to change an approved document - the guard denies every agent a write to
 * it - so the task was BLOCKED and the same work re-planned as task 0035. One
 * piece of work, two ids, and a blocked task that reads as a failure.
 *
 * `state.mjs --revise-spec <id> --reason <file>` is the fix. This check holds it
 * to five properties, each paired with its opposite so a build that always says
 * yes or always says no cannot pass:
 *
 *   S  the record FORMAT - a real task record written before the new field
 *      (verbatim copy of cartoonify 0034) still validates, the same record WITH
 *      the field validates, and a malformed entry does not;
 *   B  the WRITE - one command, the approved bytes kept, the approval withdrawn,
 *      the reason recorded, refusals leave the record byte-identical;
 *   G  the GATES - after a revision the architect may write the spec (it was
 *      denied before) and no phase transition passes until a new approval;
 *   L  the revised spec gets NO SHORTCUT past madde 2's criteria limits check;
 *   D  re-approval SHOWS THE DIFF against the version approved before.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const ROUTE = path.join(SCRIPTS, 'route.mjs');
const GUARD = path.join(SCRIPTS, 'risk-guard.mjs');

const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);
const { validate } = await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'schema.mjs')).href);
const diffLib = await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'textdiff.mjs')).href);

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const sha = (s) => createHash('sha256').update(s).digest('hex');

/* A REAL RECORD, copied verbatim from cartoonify/.mavci/control/tasks/0034.json
 * on 2026-11-02 - the task this change exists for. It predates `spec_revisions`.
 * It is a literal rather than a fixture file so that nothing can regenerate it. */
const REAL_0034 = Object.freeze({
  attempts: 1,
  attempts_total: 1,
  blocked_by: 'onayli spec dogrulamada okunamadi (kriter 8 timeout 1200000 > 600000), is 0035 olarak yeniden planlaniyor',
  created: '2026-11-02T12:21:53Z',
  id: '0034',
  max_attempts: 3,
  owner_agent: null,
  phase: 'plan',
  project_id: 'cartoonify',
  schema_version: 1,
  spec_approved: {
    at: '2026-11-02T12:27:10Z',
    by: 'operator',
    spec_path: '.mavci/tasks/0034-video-hero-poster.md',
    spec_sha256: 'fe36c1ec7762904adefae1f1eb55e3ebb0801e3571df2115b6a90a2c069e80c1',
  },
  status: 'blocked',
  updated: '2026-11-02T12:42:57Z',
  verdicts: [],
});
const SPEC_PATH = REAL_0034.spec_approved.spec_path;

const MANIFEST = {
  ...JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/mavci-core/templates/fixtures/selftest-project.json'), 'utf8')),
  project_id: 'cartoonify',
};

function run(cwd, script, args, input) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 120_000,
      stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], input,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
    });
    return { out, err: '', status: 0 };
  } catch (err) {
    return { out: err.stdout?.toString() ?? '', err: err.stderr?.toString() ?? '', status: err.status ?? -1 };
  }
}
const all = (r) => `${r.out}\n${r.err}`;

function guard(root, input) {
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [GUARD], {
      input: JSON.stringify({ ...input, cwd: root }), encoding: 'utf8', timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) { stdout = err.stdout?.toString() ?? ''; }
  if (!stdout.trim()) return 'allow';
  try { return JSON.parse(stdout).hookSpecificOutput?.permissionDecision ?? 'allow'; } catch { return 'unparseable'; }
}

const F = '`'.repeat(3);
const spec = (entries, extra = '') => ['# Video-led home hero', '', extra, '## Acceptance criteria', '',
  `${F}mavci-criteria`, JSON.stringify(entries, null, 2), F, ''].join('\n');
const OK_CMD = 'node -e "process.exit(0)"';
const SPEC_V1 = spec([{ id: '1', run: OK_CMD }, { id: '8', needs: ['shell'], run: OK_CMD, timeout_ms: 300000 }],
  'The poster image is light.\n');
const SPEC_BAD = spec([{ id: '1', run: OK_CMD }, { id: '8', needs: ['shell'], run: OK_CMD, timeout_ms: 1200000 }],
  'The poster image is light and loads first.\n');
const SPEC_V2 = spec([{ id: '1', run: OK_CMD }, { id: '8', needs: ['shell'], run: OK_CMD, timeout_ms: 600000 }],
  'The poster image is light and loads first.\n');

const cleanup = [];
const ctl = (root, id = '0034') => path.join(root, PATHS.controlTasks, `${id}.json`);
const rawCtl = (root, id = '0034') => fs.readFileSync(ctl(root, id), 'utf8');
const readCtl = (root, id = '0034') => JSON.parse(rawCtl(root, id));
const snap = (root, h, id = '0034') => path.join(root, state.specSnapshotPath(id, h));

/**
 * A project holding the real 0034 record. ONE field differs from the copy:
 * `spec_approved.spec_sha256` is pointed at the spec this check ships, because
 * the real spec's bytes are not in this repository. Every other field - the
 * status, the phase, the blocked_by text, the missing `spec_revisions` - is the
 * real record's. `withSnapshot: false` reproduces an approval made before 0.1.26.
 */
function realProject({ withSnapshot = true, specText = SPEC_V1 } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-revise-'));
  cleanup.push(tmp);
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  fs.mkdirSync(path.join(tmp, PATHS.tasks), { recursive: true });
  fs.writeFileSync(path.join(tmp, SPEC_PATH), specText);
  fs.writeFileSync(path.join(tmp, PATHS.tasks, '0034.json'), JSON.stringify({
    artifacts: [], id: '0034', notes: [], project_id: 'cartoonify', schema_version: 1,
    spec: SPEC_PATH, title: 'Video-led home hero with light poster',
  }, null, 2));
  const rec = JSON.parse(JSON.stringify(REAL_0034));
  rec.spec_approved.spec_sha256 = sha(specText);
  fs.mkdirSync(path.join(tmp, PATHS.controlTasks), { recursive: true });
  fs.writeFileSync(ctl(tmp), JSON.stringify(rec, null, 2));
  if (withSnapshot) {
    fs.mkdirSync(path.join(tmp, PATHS.specSnapshots), { recursive: true });
    fs.writeFileSync(snap(tmp, rec.spec_approved.spec_sha256), specText);
  }
  state.seal(tmp);
  return tmp;
}
const reasonFile = (root, text = 'Kriter 8 en fazla 10 dakika sürebilir; süreyi 600000 yap.') => {
  const p = path.join(root, 'reason.txt');
  fs.writeFileSync(p, text);
  return p;
};

try {
  /* ============================================================ S. FORMAT */
  console.log('\nS. the task record format - old records and new records both validate:');
  const schema = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'plugins/mavci-core/templates/schemas/control-task.schema.json'), 'utf8'));
  {
    const e = validate(REAL_0034, schema);
    if (!e.length) ok('S1 the real cartoonify 0034 record, written before spec_revisions existed, validates');
    else bad(`S1 the real 0034 record no longer validates - every existing task is now invalid: ${e.join('; ')}`);

    const withField = {
      ...REAL_0034, spec_approved: null,
      spec_revisions: [{
        at: '2026-11-02T13:00:00Z', by: 'operator', reason: 'kriter 8 süresi', from_phase: 'plan',
        from_status: 'blocked', previous_blocked_by: REAL_0034.blocked_by,
        previous_spec_path: SPEC_PATH, previous_sha256: REAL_0034.spec_approved.spec_sha256,
        previous_approved_at: REAL_0034.spec_approved.at,
      }],
    };
    const e2 = validate(withField, schema);
    if (!e2.length) ok('S2 the same record WITH a spec_revisions entry validates');
    else bad(`S2 a record carrying spec_revisions does not validate: ${e2.join('; ')}`);

    // S2's control: a validator that accepted anything would pass S1 and S2.
    const noReason = JSON.parse(JSON.stringify(withField));
    delete noReason.spec_revisions[0].reason;
    const notOperator = JSON.parse(JSON.stringify(withField));
    notOperator.spec_revisions[0].by = 'mavci-architect';
    const extraKey = JSON.parse(JSON.stringify(withField));
    extraKey.spec_revisions[0].approved_again = true;
    const bads = [noReason, notOperator, extraKey].map((r) => validate(r, schema).length > 0);
    if (bads.every(Boolean)) ok('S3 an entry with no reason, a non-operator author, or an unknown key is rejected');
    else bad(`S3 malformed revision entries accepted (no reason / by agent / extra key): ${bads.join(', ')}`);
  }

  /* ============================================================ B. WRITE */
  console.log('\nB. --revise-spec, on a copy of the real 0034 record:');
  {
    const p = realProject();
    const before = rawCtl(p);
    const oldHash = readCtl(p).spec_approved.spec_sha256;

    const r0 = run(p, STATE, ['--revise-spec', '0034']);
    const r0b = run(p, STATE, ['--revise-spec', '0034', '--reason', 'kriter 8 süresi değişsin']);
    if (r0.status !== 0 && r0b.status !== 0 && /PATH/.test(all(r0b)) && rawCtl(p) === before) {
      ok('B1 no reason, or a reason given inline instead of as a file, is refused and the record is byte-identical');
    } else {
      bad(`B1 refusals: no reason exit ${r0.status}, inline exit ${r0b.status}, record unchanged ${rawCtl(p) === before}: `
        + all(r0b).trim().slice(0, 200));
    }
    // The flag present and the FILE empty: the reason requirement is the writer's, not only the CLI's.
    const r0c = run(p, STATE, ['--revise-spec', '0034', '--reason', reasonFile(p, '  \n\t\n')]);
    if (r0c.status !== 0 && /needs a reason/.test(all(r0c)) && rawCtl(p) === before) {
      ok('B1b a reason file that is empty or only whitespace is refused, and the record is byte-identical');
    } else bad(`B1b empty reason file: exit ${r0c.status}, unchanged ${rawCtl(p) === before}: ${all(r0c).trim().slice(0, 200)}`);

    // G1 (refusal half): before the revision, the approved spec is denied to the architect.
    const edit = { tool_name: 'Edit', agent_type: 'mavci-architect',
      tool_input: { file_path: SPEC_PATH, old_string: 'light', new_string: 'light and loads first' } };
    const deniedBefore = guard(p, edit);

    const r = run(p, STATE, ['--revise-spec', '0034', '--reason', reasonFile(p)]);
    const t = readCtl(p);
    const rev = t.spec_revisions?.[0];
    const good = r.status === 0 && t.spec_approved === null && t.phase === 'plan' && t.status === 'pending'
      && t.blocked_by === null && t.spec_revisions?.length === 1
      && rev.previous_sha256 === oldHash && rev.from_status === 'blocked'
      && rev.previous_blocked_by === REAL_0034.blocked_by && /10 dakika/.test(rev.reason)
      && t.attempts === 1 && t.attempts_total === 1;
    if (good) ok('B2 one command: approval withdrawn, reason and old hash recorded, blocked -> pending, phase plan, counters kept');
    else bad(`B2 after --revise-spec (exit ${r.status}): ${JSON.stringify(t).slice(0, 400)} ${all(r).trim().slice(0, 200)}`);

    const v = run(p, STATE, ['--validate']);
    // Only meaningful if the revision was WRITTEN: an untouched record validates too.
    if (v.status === 0 && readCtl(p).spec_revisions?.length === 1) ok('B3 the revised record passes state.mjs --validate (schema and seal)');
    else bad(`B3 --validate after a revision: exit ${v.status}: ${all(v).trim().slice(0, 300)}`);

    // The bytes kept AND the approval withdrawn: an untouched record has the first alone.
    const kept = readCtl(p).spec_approved === null && fs.existsSync(snap(p, oldHash)) && sha(fs.readFileSync(snap(p, oldHash), 'utf8')) === oldHash;
    if (kept) ok('B4 the previously approved version is kept, and hashes to the withdrawn approval');
    else bad('B4 the approved version is not kept under control/specs/ after a revision');

    /* G. the gates around a revised spec */
    const allowedAfter = guard(p, edit);
    if (deniedBefore === 'deny' && allowedAfter !== 'deny') {
      ok('G1 the architect is denied the approved spec before the revision and allowed after it');
    } else {
      bad(`G1 architect write to the spec: before revision ${deniedBefore} (want deny), after ${allowedAfter} (want allow)`);
    }

    const adv = run(p, STATE, ['--advance-phase', '0034', '--from', 'plan', '--to', 'build']);
    if (adv.status !== 0 && /no recorded spec approval/.test(all(adv)) && readCtl(p).phase === 'plan') {
      ok('G2 no phase transition passes after a revision until the operator approves again');
    } else bad(`G2 --advance-phase after a revision: exit ${adv.status}: ${all(adv).trim().slice(0, 200)}`);

    const rt = JSON.parse(run(p, ROUTE, ['--json']).out || '{}');
    if (rt.action === 'plan' && rt.dispatch === 'mavci-architect' && /10 dakika/.test(rt.why ?? '')) {
      ok('G3 while the spec is unchanged, the router sends the architect with the operator\'s reason - not an approval prompt');
    } else bad(`G3 router after a revision: ${JSON.stringify(rt).slice(0, 300)}`);

    /* L. madde 2's check runs on the revised spec */
    fs.writeFileSync(path.join(p, SPEC_PATH), SPEC_BAD);
    const rtBad = JSON.parse(run(p, ROUTE, ['--json']).out || '{}');
    const ap = run(p, STATE, ['--approve-spec', '0034']);
    const tAfter = readCtl(p);
    if (ap.status !== 0 && /10 dakika/.test(all(ap)) && /ONAY VERİLMEDİ/.test(all(ap))
      && tAfter.spec_approved === null && tAfter.spec_revisions?.length === 1
      && !fs.existsSync(snap(p, sha(SPEC_BAD)))) {
      ok('L1 a revised spec that breaks the 10-minute limit is refused at approval, and nothing is recorded');
    } else {
      bad(`L1 approving a revised spec with timeout 1200000: exit ${ap.status}, approval ${JSON.stringify(tAfter.spec_approved)}: `
        + all(ap).trim().slice(0, 300));
    }
    if (rtBad.action === 'awaiting_approval' && rtBad.limits?.blocking > 0 && rtBad.limits?.revision?.report) {
      ok('L2 once the spec has changed, the router stops for approval and shows the blocker AND the revision');
    } else bad(`L2 router on a changed revised spec: ${JSON.stringify(rtBad).slice(0, 300)}`);

    /* D. re-approval shows the diff */
    fs.writeFileSync(path.join(p, SPEC_PATH), SPEC_V2);
    const ap2 = run(p, STATE, ['--approve-spec', '0034']);
    const o = all(ap2);
    const iLimits = o.indexOf('Ölçüt kontrolü');
    const iDiff = o.indexOf('göre değişiklik');
    const t2 = readCtl(p);
    if (ap2.status === 0 && t2.spec_approved?.spec_sha256 === sha(SPEC_V2) && t2.spec_revisions?.length === 1
      && /^- .*"timeout_ms": 300000/m.test(o) && /^\+ .*"timeout_ms": 600000/m.test(o)
      && /^\+ The poster image is light and loads first\./m.test(o) && /10 dakika/.test(o)
      && iLimits !== -1 && iDiff > iLimits) {
      ok('D1 re-approval records the new hash, keeps the history, and prints the limits report, then the reason and diff');
    } else {
      bad(`D1 re-approval: exit ${ap2.status}, hash ok ${t2.spec_approved?.spec_sha256 === sha(SPEC_V2)}, `
        + `limits at ${iLimits}, diff at ${iDiff}: ${o.trim().slice(0, 600)}`);
    }
    const rt2 = JSON.parse(run(p, ROUTE, ['--json']).out || '{}');
    if (rt2.action === 'build') ok('D2 after re-approval the router carries the task on to build');
    else bad(`D2 router after re-approval: ${rt2.action} - ${rt2.why}`);

    // A second revision is appended, and its old hash is the SECOND approval's.
    const r2 = run(p, STATE, ['--revise-spec', '0034', '--reason', reasonFile(p, 'ikinci değişiklik')]);
    const t3 = readCtl(p);
    if (r2.status === 0 && t3.spec_revisions?.length === 2 && t3.spec_revisions[1].previous_sha256 === sha(SPEC_V2)
      && t3.spec_revisions[0].previous_sha256 === oldHash) {
      ok('B5 a second revision is appended; the first entry is untouched');
    } else bad(`B5 second revision: exit ${r2.status}: ${JSON.stringify(t3.spec_revisions)}`);

    // An unchanged re-approval says so - "no changes" is a real answer, stated.
    const ap3 = run(p, STATE, ['--approve-spec', '0034']);
    if (ap3.status === 0 && /Fark yok/.test(all(ap3))) ok('D3 re-approving an unchanged spec says there is no difference');
    else bad(`D3 unchanged re-approval: exit ${ap3.status}: ${all(ap3).trim().slice(0, 200)}`);
  }

  /* --- refusals that must leave the record alone ------------------------ */
  console.log('\nB. refusals:');
  {
    // No snapshot, spec changed since approval: the approved bytes are gone.
    const p = realProject({ withSnapshot: false });
    fs.writeFileSync(path.join(p, SPEC_PATH), SPEC_V2);
    const before = rawCtl(p);
    const r = run(p, STATE, ['--revise-spec', '0034', '--reason', reasonFile(p)]);
    if (r.status !== 0 && /not kept/.test(all(r)) && rawCtl(p) === before) {
      ok('B6 with the approved version lost (no snapshot, spec changed) it refuses and changes nothing');
    } else bad(`B6 lost approved bytes: exit ${r.status}, unchanged ${rawCtl(p) === before}: ${all(r).trim().slice(0, 200)}`);

    // B6's control: no snapshot but the spec still IS the approved bytes - kept now.
    const q = realProject({ withSnapshot: false });
    const h = readCtl(q).spec_approved.spec_sha256;
    const rq = run(q, STATE, ['--revise-spec', '0034', '--reason', reasonFile(q)]);
    if (rq.status === 0 && fs.existsSync(snap(q, h))) {
      ok('B7 with no snapshot but the spec unchanged, it takes the snapshot and proceeds');
    } else bad(`B7 pre-0.1.26 approval with unchanged spec: exit ${rq.status}: ${all(rq).trim().slice(0, 200)}`);

    // A tampered snapshot is not the approved version.
    const s = realProject();
    fs.writeFileSync(snap(s, readCtl(s).spec_approved.spec_sha256), 'not what was approved\n');
    const sb = rawCtl(s);
    const rs = run(s, STATE, ['--revise-spec', '0034', '--reason', reasonFile(s)]);
    if (rs.status !== 0 && rawCtl(s) === sb) ok('B8 a snapshot that does not hash to the approval is refused');
    else bad(`B8 tampered snapshot: exit ${rs.status}`);

    // A done task is not reopened through this door; an unapproved one has nothing to revise.
    const d = realProject();
    const rec = readCtl(d);
    fs.writeFileSync(ctl(d), JSON.stringify({ ...rec, status: 'done', phase: 'release' }, null, 2));
    state.seal(d);
    const db = rawCtl(d);
    const rd = run(d, STATE, ['--revise-spec', '0034', '--reason', reasonFile(d)]);
    const u = realProject();
    fs.writeFileSync(ctl(u), JSON.stringify({ ...readCtl(u), spec_approved: null }, null, 2));
    state.seal(u);
    const ru = run(u, STATE, ['--revise-spec', '0034', '--reason', reasonFile(u)]);
    if (rd.status !== 0 && /done/.test(all(rd)) && rawCtl(d) === db && ru.status !== 0 && /nothing to revise/.test(all(ru))) {
      ok('B9 a done task and an unapproved task are both refused');
    } else bad(`B9 done task exit ${rd.status}, unapproved exit ${ru.status}`);
  }

  /* --- the project phase moves only with the task that owns it ---------- */
  console.log('\nB. the project phase:');
  {
    const make = (inProgress) => {
      const p = realProject();
      const rec = readCtl(p);
      fs.writeFileSync(ctl(p), JSON.stringify({
        ...rec, status: inProgress ? 'in_progress' : 'pending', phase: 'build', blocked_by: null,
      }, null, 2));
      const st = JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8'));
      fs.writeFileSync(path.join(p, PATHS.state), JSON.stringify({ ...st, phase: 'build' }, null, 2));
      state.seal(p);
      run(p, STATE, ['--revise-spec', '0034', '--reason', reasonFile(p)]);
      return JSON.parse(fs.readFileSync(path.join(p, PATHS.state), 'utf8')).phase;
    };
    const owning = make(true);
    const notOwning = make(false);
    if (owning === 'plan' && notOwning === 'build') {
      ok('B10 an in_progress task takes the project phase back to plan; a pending one leaves it alone');
    } else bad(`B10 project phase after revising: in_progress task -> ${owning} (want plan), pending -> ${notOwning} (want build)`);
  }

  /* ============================================================ D. the diff itself */
  console.log('\nD. the line diff:');
  {
    const a = 'one\ntwo\nthree\nfour\n';
    const b = 'one\ntwo\nTHREE\nfour\nfive\n';
    const d = diffLib.renderDiff(a, b);
    const lines = d.text.split('\n');
    if (d.added === 2 && d.removed === 1 && lines.includes('- three') && lines.includes('+ THREE')
      && lines.includes('+ five') && lines.includes('  two')) {
      ok('D4 a changed line and an added line are reported as -1/+2 with context');
    } else bad(`D4 diff of a small change: ${JSON.stringify(d)}`);
    const same = diffLib.renderDiff(a, a);
    if (same.added === 0 && same.removed === 0 && same.text === '') ok('D5 identical texts give an empty diff');
    else bad(`D5 identical texts: ${JSON.stringify(same)}`);
    const big = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
    const capped = diffLib.renderDiff(big, big.replace(/line /g, 'LINE '), { maxLines: 50 });
    if (capped.truncated > 0 && /gösterilmedi/.test(capped.text)) ok('D6 a long diff is capped and SAYS how much was not shown');
    else bad(`D6 long diff: truncated ${capped.truncated}`);
  }
} finally {
  for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nspec revision: ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nspec revision: an approved spec can be revised on purpose, keeps its old version,');
console.log('               passes the same limits check again, and shows the diff at re-approval.');

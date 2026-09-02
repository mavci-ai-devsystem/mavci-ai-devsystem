#!/usr/bin/env node
/**
 * A rule's own strings must fit the verdict schema, and a rule that needs
 * authority the agent does not have must say so.
 *
 * Two properties of the rule set, checked in one place because both are answered
 * by reading `scripts/rules/index.mjs` and neither needs a project.
 *
 * ======================================================================
 * PART 1 - THE CAPS. Gate 4c, finding 2.
 * ======================================================================
 * `verdict.schema.json` has capped `evidence` at 500 and `remedy` at 300 since
 * 0.1.0, and nothing checked a rule against those numbers when the rule was
 * written. So the cap fired at `writeControl` instead: after the run, inside the
 * gate, as a THROW, against a string already assembled from live project data.
 *
 * `settings.marketplace_form` produced 583 characters. `verify.mjs --record` -
 * the only mode the gate uses - threw on every turn in gate4c. Plain
 * `verify.mjs` was healthy throughout: 11 pass, 5 fail, 1 blocker. Only
 * RECORDING was broken, and recording is the path enforcement runs on. One
 * verbose string took the entire checker offline for a project.
 *
 * WHY THE OBVIOUS TEST IS THE WRONG ONE. A test that runs `verify.mjs` without
 * `--record` passes against the broken build - it was healthy. That is the wrong
 * half, and it is the half that was tested. The assertion here is that the rule
 * set's own strings fit BEFORE anything runs, and case 3 below is the runtime
 * half: every rule failing at once, recorded, without a throw.
 *
 * ======================================================================
 * PART 2 - REMEDY AUTHORITY. Gate 4c, declined path 4.
 * ======================================================================
 * Four `legal.pages_present` findings carried the remedy "Have the text
 * reviewed, then delete the REVIEW REQUIRED marker." An agent can delete a
 * marker. It cannot have a lawyer review the text. Deleting it would have made
 * the page assert a review that never happened - and the cheap path was
 * SANCTIONED BY THE CHECK'S OWN REMEDY TEXT.
 *
 * So: a rule declaring `authority` other than `agent` must carry the marker from
 * `authorityNote`, and that note must name an actor. The failing build this
 * catches is a remedy written as an instruction to someone who cannot follow it.
 *
 * BOTH PARTS CARRY A NEGATIVE CONTROL. A static check over a healthy tree cannot
 * tell "nothing is wrong" from "nothing is being examined", and every one of the
 * eight wrong-gate findings had that shape.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGIN = path.join(ROOT, 'plugins', 'mavci-core');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const VERIFY = path.join(SCRIPTS, 'verify.mjs');

const rules = await import(pathToFileURL(path.join(SCRIPTS, 'rules', 'index.mjs')).href);
const config = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);
const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const { validate } = await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'schema.mjs')).href);

const { RULES, AUTHORITY_LEVELS, authorityNote } = rules;
const { EVIDENCE_MAX_CHARS, REMEDY_MAX_CHARS, PATHS } = config;

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
/** Added with Part 3: this file had ok/bad but no combinator. */
const check = (c, m) => (c ? ok(m) : bad(m));

/** The literal the note is recognised by. Derived, never re-spelled here. */
const AUTHORITY_MARKER = authorityNote('X').split(':')[0] + ':';

/* ================================================ 1. static: rule strings */
{
  let over = 0;
  for (const r of RULES) {
    const remedy = r.remedy ?? '';
    if (remedy.length > REMEDY_MAX_CHARS) {
      over += 1;
      bad(`${r.id}: remedy is ${remedy.length} characters, cap is ${REMEDY_MAX_CHARS}. `
        + 'This does not fail at authoring time by accident - it fails when the gate tries to '
        + 'record the verdict, on a real project, and takes the whole checker offline.');
    }
    if ((r.description ?? '').length === 0) bad(`${r.id}: no description`);
  }
  if (!over) ok(`all ${RULES.length} rule remedies fit the ${REMEDY_MAX_CHARS}-character cap`);

  // NEGATIVE CONTROL. If the measurement is broken - RULES empty, remedy read
  // from the wrong field, a comparison that can never be true - everything above
  // passes and this file asserts nothing.
  if (!RULES.length) {
    bad('negative control: RULES is empty, so the cap check examined nothing');
  } else {
    const overlong = { id: 'probe.overlong', remedy: 'z'.repeat(REMEDY_MAX_CHARS + 1) };
    if (overlong.remedy.length > REMEDY_MAX_CHARS) {
      ok(`negative control: a ${overlong.remedy.length}-character remedy is measured as over cap`);
    } else {
      bad('negative control: the cap comparison cannot fire at all');
    }
  }
}

/* ================================== 1b. static: EVIDENCE templates ======
 *
 * The half that matters most, and the half a naive version of this file misses.
 *
 * `rule.remedy` is a property on the rule object, so part 1 can measure it
 * directly. `evidence` is not: it is built inside `run()`, per finding, from a
 * literal chain with holes in it. Measuring only what is reachable as a property
 * checks the string that was NEVER the problem - the 583 characters that took
 * gate4c's checker offline were an evidence chain inside a `return finding(...)`.
 * A version of this check that measured `rule.remedy` alone passed against that
 * exact build, which is how this section came to exist.
 *
 * So the source is measured instead. Comments are blanked first with the
 * checker's own `blankComments` - a rules file is mostly prose and every long
 * comment would otherwise read as a finding string - and then every
 * concatenation chain of string literals is summed. `${...}` holes count as
 * zero, which makes this a FLOOR: a chain measuring over the cap is over the cap
 * for certain, whatever the interpolation adds. Under it proves nothing, which
 * is what `clamp` is for.
 *
 * Any chain in scripts/rules/ over EVIDENCE_MAX_CHARS is flagged with no
 * exemption list. There is no legitimate 500-character literal in that file:
 * everything it produces is either a finding string, which is capped, or a
 * `description`, which is one line.
 */
{
  const { blankComments } = await import(pathToFileURL(path.join(SCRIPTS, 'lib', 'jsscan.mjs')).href);
  const RULES_DIR = path.join(SCRIPTS, 'rules');

  /**
   * ANCHORED, not free-scanning. Two earlier versions of this scanner walked the
   * whole file looking for string literals, and both were wrong in a way worth
   * recording, because the second failure is the interesting one.
   *
   *   v1 matched literals with a regex over the raw text. `'... is not
   *      "force-dynamic"'` opens a phantom literal at the inner `"`, which then
   *      ran to the next quote hundreds of characters later.
   *   v2 took boundaries from `blankSource`, which fixes that - and still
   *      desynced, because `blankSource` is documented "not a parser" and does
   *      not know about REGEX LITERALS. `matchAll(text, /new\s+RegExp\s*\(\s*`/)`
   *      contains a backtick inside a regex; blankSource reads it as the start of
   *      a template literal and blanks everything to the next backtick.
   *
   * Both reported five false positives for one true one. That is not a cosmetic
   * defect: a check that cries wolf five times per real finding gets edited until
   * it stops crying, and the real finding leaves with the noise. It is item 5 of
   * this release one layer up - the cost of a false positive is not the false
   * positive, it is the control being switched off.
   *
   * So the scan is anchored on the FIELDS the cap applies to - `evidence:`,
   * `remedy:`, and the first argument of the `finding(...)` helper, which is what
   * `settings.marketplace_form` uses. Immediately after such an anchor, the next
   * non-space character IS a string delimiter, so the literal walker below starts
   * from a position that is known-good rather than guessed. Anchors are found in
   * `blankComments` output so a comment discussing `evidence:` is not one.
   *
   * WHAT THIS DOES NOT COVER, stated rather than implied: a chain assembled
   * through a variable, and any interpolated value. The runtime half (case 3) and
   * `clamp` in verify.mjs are the backstops for both, which is why all three
   * exist and none of them is redundant.
   */
  const ANCHOR = /(?:\bevidence\s*:|\bremedy\s*:|\bfinding\s*\()\s*/g;

  /** Sum one `'a' + 'b' + `c${d}`` chain from a known string delimiter. */
  function chainAt(raw, start) {
    let total = 0;
    let i = start;
    for (;;) {
      const q = raw[i];
      if (q !== "'" && q !== '"' && q !== '`') return { total, end: i, ok: i > start };
      let j = i + 1;
      while (j < raw.length && raw[j] !== q) j += raw[j] === '\\' ? 2 : 1;
      if (j >= raw.length) return { total, end: j, ok: false };   // unterminated
      // `${...}` holes count as zero, so this is a FLOOR: over the cap here is
      // over the cap for certain, whatever interpolation adds. Under it proves
      // nothing, which is exactly what `clamp` is for.
      total += raw.slice(i + 1, j).replace(/\$\{[^}]*\}/g, '').replace(/\\./g, 'x').length;
      i = j + 1;
      const gap = /^\s*\+\s*(?=['"`])/.exec(raw.slice(i));
      if (!gap) return { total, end: i, ok: true };
      i += gap[0].length;
    }
  }

  let scanned = 0;
  let longest = 0;
  const over = [];
  for (const f of fs.readdirSync(RULES_DIR).filter((n) => n.endsWith('.mjs'))) {
    const raw = fs.readFileSync(path.join(RULES_DIR, f), 'utf8');
    const anchors = blankComments(raw);
    ANCHOR.lastIndex = 0;
    for (const m of anchors.matchAll(ANCHOR)) {
      const at = m.index + m[0].length;
      const { total, ok } = chainAt(raw, at);
      if (!ok) continue;                          // `remedy: this.remedy` and friends
      scanned += 1;
      longest = Math.max(longest, total);
      if (total > EVIDENCE_MAX_CHARS) {
        over.push({ file: f, line: raw.slice(0, at).split('\n').length, total });
      }
    }
  }

  for (const o of over) {
    bad(`${o.file}:${o.line}: a string chain of at least ${o.total} characters, cap is `
      + `${EVIDENCE_MAX_CHARS}. Interpolation only makes it longer. This is the shape that took `
      + 'the checker offline in gate4c: the cap fired at writeControl, inside the gate, after the run.');
  }
  if (!over.length) {
    ok(`${scanned} string chain(s) in scripts/rules/ measured; longest is ${longest}, cap is ${EVIDENCE_MAX_CHARS}`);
  }

  // NEGATIVE CONTROL, in two halves, because the version that went green against
  // the broken build failed the second half, not the first: its measurement
  // worked perfectly and it was pointed at the wrong strings.
  //
  // 13 rules with a remedy each is the floor; the real number is higher because
  // most rules build at least one evidence string inline. Well under that means
  // the anchors stopped matching - a rename of `evidence:` would do it - and the
  // check would be silently measuring almost nothing.
  if (scanned < RULES.length) {
    bad(`negative control: only ${scanned} anchored string chain(s) found across ${RULES.length} `
      + 'rules. The anchors are not matching, so this check is measuring almost nothing.');
  } else {
    const probe = chainAt(`'${'q'.repeat(EVIDENCE_MAX_CHARS + 10)}'`, 0);
    if (probe.total > EVIDENCE_MAX_CHARS) {
      ok(`negative control: ${scanned} chains measured, and a ${probe.total}-character one reads as over cap`);
    } else {
      bad('negative control: the chain measurement cannot exceed the cap, so it can never fire');
    }
  }
}

/* ======================================= 2. static: remedy authority text */
{
  let declared = 0;
  for (const r of RULES) {
    const level = r.authority ?? 'agent';
    if (!AUTHORITY_LEVELS.includes(level)) {
      bad(`${r.id}: authority "${level}" is not one of ${AUTHORITY_LEVELS.join(', ')}`);
      continue;
    }
    if (level === 'agent') {
      if ((r.remedy ?? '').includes(AUTHORITY_MARKER)) {
        bad(`${r.id}: remedy carries an ${AUTHORITY_MARKER} note but the rule declares no authority. `
          + 'One of the two is wrong, and a note nothing declares is a note nothing maintains.');
      }
      continue;
    }
    declared += 1;
    const remedy = r.remedy ?? '';
    if (!remedy.includes(AUTHORITY_MARKER)) {
      bad(`${r.id}: declares authority "${level}" and its remedy does not say so. A remedy the `
        + 'reader cannot carry out, written as if they could, is an instruction to fabricate - '
        + 'which is exactly what "then delete the REVIEW REQUIRED marker" was.');
      continue;
    }
    // The note must NAME someone. "AUTHORITY: not yours" with no actor tells the
    // reader they are blocked and not who unblocks them, which is the trap in a
    // politer voice.
    const after = remedy.slice(remedy.indexOf(AUTHORITY_MARKER) + AUTHORITY_MARKER.length);
    if (!/\b(operator|lawyer|provider|reviewer|human)\b/i.test(after)) {
      bad(`${r.id}: the authority note names no actor - "${after.trim().slice(0, 80)}"`);
    }
  }
  if (!failures.length) ok(`${declared} rule(s) declare a non-agent authority, and all of them say so`);

  // NEGATIVE CONTROL: the marker must not match a remedy that lacks it.
  if (AUTHORITY_MARKER.length < 4 || 'a plain remedy with no note'.includes(AUTHORITY_MARKER)) {
    bad(`negative control: AUTHORITY_MARKER "${AUTHORITY_MARKER}" matches ordinary prose, so the `
      + 'presence test would pass on every rule');
  } else {
    ok(`negative control: the marker "${AUTHORITY_MARKER}" does not match ordinary remedy prose`);
  }
}

/* ============================ 3. runtime: every rule failing, recorded ==== */
/*
 * The assertion the finding actually names: with every rule failing at once,
 * `verify.mjs --record` writes a SCHEMA-VALID VERDICT instead of throwing.
 *
 * gate4c's project had one rule over cap and recording died for every turn. This
 * builds a project designed to make as many rules fire as possible - the case
 * where the verdict is longest and the caps bite hardest - and asserts the file
 * lands. Exit 2 is expected and correct here: there are blockers. What must NOT
 * happen is `verify.mjs crashed`, which is a different exit 2 and the one that
 * disabled enforcement.
 */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-caps-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(PLUGIN, 'templates', 'fixtures', 'selftest-project.json'), 'utf8'));
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(manifest, null, 2));
    state.init(tmp, manifest);

    // Trip as much of the rule set as one tree can. No legal pages, no
    // .gitignore, a module-scope client, a route with no force-dynamic, a
    // service-role key outside the server path, a bare process.env read, and a
    // settings.json in the form that fails `settings.marketplace_form` - the
    // rule whose evidence started all this.
    const w = (rel, body) => {
      fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), body);
    };
    w('app/api/x/route.ts', 'export async function GET(){return Response.json({})}\n');
    w('lib/db.ts', "import { createServerClient } from '@supabase/ssr'\nexport const c = createServerClient(1,2)\n");
    w('components/Bad.tsx', 'export const K = process.env.SUPABASE_SERVICE_ROLE_KEY\n');
    w('next.config.js', "module.exports = { output: 'export' }\n");
    // THE MARKETPLACE IS CORRECT AND `enabledPlugins` IS ABSENT, on purpose.
    //
    // This is the exact branch whose evidence ran to 583 characters. An earlier
    // version of this fixture wrote `source: "github"`, which trips the same rule
    // one branch earlier with a short string - so the check went green against
    // the build that was broken. The rule fires either way; only this branch
    // exercises the string that took the checker offline.
    w('.claude/settings.json', JSON.stringify({
      extraKnownMarketplaces: {
        [config.MARKETPLACE_NAME]: {
          source: { source: 'git', url: `https://github.com/${config.SYSTEM_REPO}.git` },
        },
      },
    }, null, 2));

    const r = spawnSync(process.execPath, [VERIFY, '--record', '--format=json'],
      { cwd: tmp, encoding: 'utf8', timeout: 120_000, env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });

    if (/crashed/i.test(r.stderr ?? '')) {
      bad('verify.mjs --record CRASHED with every rule failing: '
        + `${(r.stderr ?? '').split('\n').slice(0, 4).join(' | ')}`);
    } else {
      ok('verify.mjs --record survives a project where every rule fires');
    }

    const dir = path.join(tmp, PATHS.verdicts);
    const written = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    if (!written.length) {
      bad('no verdict was written. The gate records through this path, so a project in this '
        + 'state would have enforcement disabled with no error anywhere.');
    } else {
      const schema = state.schemas().verdict;
      const doc = JSON.parse(fs.readFileSync(path.join(dir, written[0]), 'utf8'));
      const errs = validate(doc, schema);
      if (errs.length) bad(`the recorded verdict is not schema-valid: ${errs.join('; ')}`);
      else ok(`the recorded verdict is schema-valid (${doc.checks.length} finding(s))`);

      // And every string in it is inside the cap - which is what `clamp` is for
      // when a template interpolates something a static check could not see.
      const over = doc.checks.filter((c) => (c.evidence ?? '').length > EVIDENCE_MAX_CHARS
        || (c.remedy ?? '').length > REMEDY_MAX_CHARS);
      if (over.length) bad(`${over.length} recorded finding(s) exceed the caps despite clamping`);
      else ok('every recorded evidence and remedy is inside its cap');

      // NEGATIVE CONTROL: this must be measuring something. A verdict with no
      // findings would pass both assertions above while proving nothing.
      if (doc.checks.length < 3) {
        bad(`negative control: the fixture project produced only ${doc.checks.length} finding(s), `
          + 'so "every rule failing at once" was never actually exercised');
      } else {
        ok(`negative control: ${doc.checks.length} findings were produced, so the caps were exercised`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ======================================================================
 * PART 3 - THE REMEDY MUST FIT THE FAILURE. Finding 24.
 * ======================================================================
 * `state.schema_valid` printed ONE remedy for every error it could report:
 * "If a control file was edited by hand on purpose, it needs state.mjs --reseal."
 *
 * It fired on a file the sanctioned writer had produced minutes earlier, rejected
 * by a schema one version older than the writer because the session's registered
 * hooks were stale. The file was not hand-edited, and resealing recomputes a hash
 * - it has no bearing on schema validity, so an operator following that remedy
 * would have spent a privileged action and arrived back at the same block.
 *
 * A REMEDY THAT CANNOT WORK IS WORSE THAN NO REMEDY. It costs an action and
 * teaches the reader the message is unreliable.
 *
 * ASSERT ON THE TEXT. Part 1 above catches a remedy that is too LONG, because
 * that throws. Nothing catches a remedy that is WRONG, because the exit code is
 * identical either way - which is exactly why the --reseal version passed every
 * check this gate had. Same shape as 0.1.11: the reason arriving is the thing to
 * test.
 *
 * AND PART 1 CANNOT SEE THESE AT ALL. It reads the rule's static `remedy`
 * string. These are built per-finding by a function, so they are invisible to it,
 * and the 300-char cap has to be re-asserted here on the OUTPUT or finding 2
 * comes straight back through a dynamic door.
 */
{
  const { remedyFor } = rules;
  const CAP = config.REMEDY_MAX_CHARS;
  const skew = { onDisk: '0.1.21', hooksRegistered: '0.1.20' };
  const level = { onDisk: '0.1.21', hooksRegistered: '0.1.21' };

  const seal = remedyFor({ kind: 'seal' }, skew);
  const schemaSkewed = remedyFor({ kind: 'schema' }, skew);
  const schemaLevel = remedyFor({ kind: 'schema' }, level);

  // 1. The three failures get three different remedies.
  check(new Set([seal, schemaSkewed, schemaLevel]).size === 3,
    'remedy: a seal failure, a skewed schema failure and a level schema failure get three DIFFERENT remedies');

  // 2. --reseal appears for the seal failure and NOWHERE else. This is the whole
  //    finding: it was printed for a schema rejection it cannot clear.
  check(/--reseal/.test(seal),
    'remedy: the SEAL failure names --reseal - it is the one failure resealing answers');
  check(!/needs .*--reseal|it needs `state\.mjs --reseal`/.test(schemaSkewed)
    && !/needs .*--reseal/.test(schemaLevel),
    'remedy: no SCHEMA failure instructs the reader to run --reseal');
  for (const [label, text] of [['skewed', schemaSkewed], ['level', schemaLevel]]) {
    check(/NOT a seal failure|cannot clear/.test(text),
      `remedy: the ${label} schema failure says outright that resealing will not clear it`);
  }

  // 3. Under skew, the remedy is a SESSION RESTART and it names both versions.
  check(/RESTART THE SESSION/.test(schemaSkewed),
    'remedy: a schema rejection under version skew names a SESSION RESTART - the thing that actually clears it');
  check(/0\.1\.20/.test(schemaSkewed) && /0\.1\.21/.test(schemaSkewed),
    'remedy: and it names both versions, so the reader can see the skew rather than take it on trust');
  check(!/RESTART THE SESSION/.test(schemaLevel),
    'remedy: with NO skew, a restart is not offered - it would not fix a genuinely malformed file');

  // 4. Authority. Only the seal remedy is the operator's; a stale checker is
  //    restartable by whoever is sitting there.
  check(/AUTHORITY/.test(seal),
    'remedy: the seal remedy carries the AUTHORITY marker - --reseal is denied to agents');

  // 5. Finding 2, through the dynamic door Part 1 cannot see.
  const longest = [
    remedyFor({ kind: 'seal' }, null),
    remedyFor({ kind: 'seal' }, { onDisk: '100.200.300', hooksRegistered: '100.200.299' }),
    remedyFor({ kind: 'schema' }, null),
    remedyFor({ kind: 'schema' }, { onDisk: '100.200.300', hooksRegistered: '100.200.299' }),
    remedyFor({}, null), remedyFor(null, null),
  ];
  const over = longest.filter((r) => r.length > CAP);
  check(over.length === 0,
    `remedy: every remedyFor output fits REMEDY_MAX_CHARS=${CAP} (longest ${Math.max(...longest.map((r) => r.length))}) - `
    + 'Part 1 reads the static string and cannot see these');
  check(longest.every((r) => typeof r === 'string' && r.length > 0),
    'remedy: every input shape yields a remedy, including a malformed error object - never undefined');
}

if (failures.length) {
  console.error(`\nevidence-cap / remedy-authority check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\nrule strings fit the verdict schema, and every non-agent remedy names who can act');

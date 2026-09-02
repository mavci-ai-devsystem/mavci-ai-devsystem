/**
 * Mavci Core - the release precondition gate. Design step 5.
 *
 * `/mavci-core:release` refuses unless every precondition holds. This module is the
 * decision, separated from the skill so it can be asserted deterministically in CI
 * (`check-release-gate.mjs`) rather than only exercised by running a release.
 *
 * The name is written here again. It was removed while the skill did not exist -
 * a reference to a command that does not exist is a promise to an agent with no way
 * to answer back (finding 8), and `check-command-refs.mjs` failed the build on it.
 * Restoring it is safe for exactly the same reason it was removed: the check
 * enforces the reference in both directions, so this line is true or the build is
 * red. That is the whole argument for the check.
 *
 * BUILT BEFORE GUARDIAN, DELIBERATELY. Guardian is written into a system that
 * already refuses to trust it. A gate built after the thing it gates is a gate
 * written around whatever that thing happens to do - and every assertion in this
 * system written after its subject has, so far, passed against the broken build.
 *
 * ------------------------------------------ RELEASE IS THE FIRST FOREIGN READER
 *
 * Everything else that touches a guardian record either wrote it or wrote the
 * writer. Release did neither: it reads an artefact produced by a component it does
 * not control, on a machine it was not present for. Two consequences are built in
 * rather than assumed:
 *
 *   1. IT RECOMPUTES RATHER THAN TRUSTS. A record whose `verdict` disagrees with
 *      its own `coverage` numbers is refused - `verdict: "pass"` over
 *      `sites_total: 0` is exactly the shape the floor exists to prevent, and a
 *      reader that accepts the field instead of checking the arithmetic would let a
 *      buggy or hand-edited writer walk straight past it.
 *
 *   2. AN UNREADABLE RECORD IS TREATED AS AN ABSENT ONE, with the same wording.
 *      0.1.11's lesson at a different reader: the reason existed and was lost in
 *      transit, and what arrived was silence. A record that cannot be parsed or does
 *      not carry the fields this gate reads establishes nothing, so it must not be
 *      allowed to establish something by being present.
 *
 * -------------------------------------------------------- ALLOW-LIST, NOT DENY
 *
 * The verdict check is `verdict === 'pass'` and everything else refuses. Known
 * values get their own message so the operator is told which problem they have, but
 * the DECISION is an allow-list: a sixth verdict value added later refuses by
 * default rather than falling through a chain of `!==` comparisons that never heard
 * of it. Enum growth is the ordinary way a fail-closed gate becomes fail-open.
 */

/** Every refusal carries a code, so callers can assert on the reason and not the prose. */
export const REFUSAL = [
  'unverified_session',      // control/unverified.json stands - enforcement did not run
  'guardian_record_absent',
  'guardian_record_unreadable',
  'guardian_record_undeclared', // records exist; none declares itself a run against THIS project
  'guardian_record_is_corpus',  // the selected record is a corpus fixture, not project evidence
  'guardian_record_stale',
  'guardian_not_checked',    // the floor reached release
  'guardian_failed',
  'guardian_verdict_unknown', // enum grew; refuse rather than guess
  'guardian_record_inconsistent', // verdict disagrees with its own coverage
];

/**
 * Passed as `guardianRecord` when the file EXISTS but could not be parsed.
 *
 * A sentinel rather than `undefined`, because a default parameter value makes
 * `undefined` indistinguishable from "the caller did not pass this at all" - two
 * different facts collapsing into one, which is the defect this whole gate is built
 * to refuse. Caught by check-release-gate.mjs on its first run, in the gate's own
 * API, which is a fair place to be reminded that the shape is not other people's.
 */
export const UNREADABLE = Symbol('guardian record present but unreadable');

/* ------------------------------------------------- WHAT A RECORD IS ABOUT
 *
 * One directory, two purposes. `.mavci/control/guardian/records/` holds evidence
 * about THIS PROJECT - guardian ran against the project's own source - and evidence
 * about GUARDIAN ITSELF - a corpus case ran against a fixture staged into
 * `corpus-run/`, answering a question whose answer was known before it was asked.
 * Both are guardian records, both are well-formed, both validate against the same
 * schema. Until 0.1.21 nothing in either said which.
 *
 * That is not a collision between two mistakes. Taking the newest file is the only
 * thing a reader could do given records with no provenance, and running the corpus
 * through the real writer is deliberate - a corpus that wrote through some other
 * path would not be grading the writer that ships. The defect was the shared
 * namespace, and it was invisible from inside either component.
 *
 * It bit exactly where it does the most damage. `t5w9d` is the corpus's LAST case
 * and its expected verdict is `fail` - it is the unknown control, the case that
 * exists so `unknown` is not a code path nothing exercises. So the last record left
 * behind by a corpus run that PASSES is a record whose verdict is `fail`, and this
 * gate read it as a finding about the project. Passing the corpus was the act that
 * closed the release gate. Filed as finding 25.
 *
 * THE MARKER GOES IN THE DOCUMENT, NOT IN A SECOND DIRECTORY. Moving corpus records
 * elsewhere separates them by creating a path that the schema sweep, the
 * absolute-path sweep and the integrity seal each have to be told about
 * independently - three sets where every reader assumes one, which is finding 23
 * exactly. One directory, one schema, one seal; the distinction lives in the record.
 */
export const RECORD_SOURCE = Object.freeze({ REAL: 'real', CORPUS: 'corpus' });

/**
 * Pick the record that is evidence about the PROJECT, newest first.
 *
 * Exported and pure because the SELECTION is half the decision. It used to live in
 * `release-check.mjs` as "sort the directory, take the last file", where no test
 * could reach it - and that is where finding 25 lived for three releases. A gate
 * whose input selection is untested is a gate tested on the half that works.
 *
 * @param {Array<{id: string, doc: object|symbol}>} entries ascending by id (filename order)
 * @returns {{record: object|symbol|null, counts: {corpus: number, undeclared: number, total: number}}}
 */
export function selectProjectRecord(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const counts = { corpus: 0, undeclared: 0, total: list.length };
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const doc = list[i]?.doc;

    // An unreadable file BLOCKS the scan rather than being skipped past. It could
    // have been a newer real record, and a reader that walks over what it cannot
    // parse to reach something older is choosing evidence by legibility.
    if (doc === UNREADABLE) return { record: UNREADABLE, counts };

    const source = doc && typeof doc === 'object' ? doc.source : undefined;
    if (source === RECORD_SOURCE.REAL) return { record: doc, counts };
    if (source === RECORD_SOURCE.CORPUS) { counts.corpus += 1; continue; }

    // Absent, null, or a value this version has never heard of. NOT a real run.
    // Fail-closed on purpose: a writer that has not been taught to declare its
    // source must not have its output counted as project evidence by default,
    // and an enum that grows must not silently promote its new value to "real".
    counts.undeclared += 1;
  }
  return { record: list.length ? null : null, counts };
}

const ABSENT_OR_UNREADABLE_GUIDANCE =
  'A guardian record is the only evidence that the judgement half of this system ran at all. '
  + 'Absent and unreadable are the same fact here: neither establishes anything, so neither may '
  + 'be treated as a pass. Run guardian against this project and record the result.';

/**
 * @param {object} input
 * @param {string} input.runningVersion    pluginVersion()
 * @param {object|null} input.unverified   parsed control/unverified.json, or null
 * @param {object|null|symbol} input.guardianRecord  parsed record; `null` when the file
 *                                          is absent; `UNREADABLE` when it exists and
 *                                          could not be parsed
 * @param {{corpus: number, undeclared: number, total: number}|null} [input.recordCounts]
 *        what `selectProjectRecord` skipped on its way to `guardianRecord`. Only
 *        changes the WORDING of an absent-record refusal - never the decision - so a
 *        caller that omits it gets the same verdict with a less specific message.
 * @returns {{ok: boolean, refusals: Array<{code: string, message: string}>}}
 */
export function assessReleaseReadiness({ runningVersion, unverified = null, guardianRecord = null, recordCounts = null }) {
  const refusals = [];
  const refuse = (code, message) => refusals.push({ code, message });

  // ---- enforcement must have run at all ------------------------------------
  if (unverified) {
    refuse('unverified_session',
      `This session is marked UNVERIFIED (fault: ${unverified.fault ?? 'unrecorded'}). The standards `
      + 'gate stopped blocking so work could continue, and nothing written since has been checked. '
      + 'A release cannot be cut over unverified work. It clears on a gate run that PASSES.');
  }

  // ---- the guardian record -------------------------------------------------
  if (guardianRecord === UNREADABLE) {
    // Present on disk, could not be parsed or is missing the fields read below.
    refuse('guardian_record_unreadable',
      `The guardian record exists but cannot be read. ${ABSENT_OR_UNREADABLE_GUIDANCE}`);
    return { ok: false, refusals };
  }
  if (guardianRecord === null) {
    // `recordCounts` distinguishes "the directory is empty" from "ten records and
    // not one of them is about this project". Reporting the second as the first
    // sends the operator to run guardian when they have already run it - which is
    // the shape of every message this system has had to correct.
    const c = recordCounts;
    if (c && c.total > 0) {
      refuse('guardian_record_undeclared',
        `${c.total} guardian record(s) exist and none is evidence about this project: `
        + `${c.corpus} declare themselves corpus fixtures, ${c.undeclared} declare no source at all. `
        + 'A record that does not say what it is about is not counted as project evidence - absent '
        + 'and unrecognised both read as NOT a real run, so a writer that has not been taught to '
        + 'declare its source cannot be trusted by default. Records written before 0.1.21 carry no '
        + 'source and will all read this way: run guardian once against this project to produce one '
        + 'that does. Do NOT hand-edit an old record to add the field.');
      return { ok: false, refusals };
    }
    refuse('guardian_record_absent',
      `No guardian record for this project. ${ABSENT_OR_UNREADABLE_GUIDANCE}`);
    return { ok: false, refusals };
  }

  // Defense in depth. The selector already skips corpus records; this refuses one
  // handed straight to the decision, so a second caller that reads the directory
  // its own way cannot walk past the distinction. Both arms are asserted.
  if (guardianRecord.source === RECORD_SOURCE.CORPUS) {
    refuse('guardian_record_is_corpus',
      'The guardian record offered is a CORPUS FIXTURE, not a run against this project. It '
      + 'measures whether guardian answers correctly on a staged case whose answer was known in '
      + 'advance - including cases whose expected verdict is "fail". It is evidence about '
      + 'guardian and says nothing about this project, so it cannot stand in for a run that does.');
    return { ok: false, refusals };
  }
  if (guardianRecord.source !== RECORD_SOURCE.REAL) {
    refuse('guardian_record_undeclared',
      `The guardian record declares source "${guardianRecord.source ?? '(absent)'}", which is not `
      + `"${RECORD_SOURCE.REAL}". A record that does not declare itself a run against this project `
      + 'is not counted as one. Absent and unrecognised are the same fact here, and both fail '
      + 'closed: an enum that grows must not promote its new value to project evidence by default.');
    return { ok: false, refusals };
  }

  const { plugin_version: recordedVersion, verdict, coverage } = guardianRecord;

  if (recordedVersion !== runningVersion) {
    refuse('guardian_record_stale',
      `The guardian record was produced by plugin ${recordedVersion ?? '(unstated)'}, not the running `
      + `${runningVersion}. Guardian's worklist, the rule that feeds it and its own definition can all `
      + 'differ between versions, so this record has not examined what is about to ship - whether it '
      + 'is older or newer.');
    return { ok: false, refusals };
  }

  // ---- recompute, do not trust --------------------------------------------
  // A record is data from a component this gate does not control. The verdict field
  // is a claim; the coverage numbers are the evidence for it. Where they disagree,
  // the claim loses.
  const total = coverage?.sites_total;
  const answered = coverage?.sites_answered;
  if (typeof total !== 'number' || typeof answered !== 'number') {
    refuse('guardian_record_unreadable',
      `The guardian record carries no usable coverage numbers. ${ABSENT_OR_UNREADABLE_GUIDANCE}`);
    return { ok: false, refusals };
  }
  if (verdict === 'pass' && (total === 0 || answered !== total)) {
    refuse('guardian_record_inconsistent',
      `The record claims "pass" but its own coverage says ${answered} of ${total} site(s) answered. `
      + 'A pass over an empty or incomplete worklist is the failure the coverage floor exists to '
      + 'prevent; a record asserting it has either been produced by a broken writer or edited by '
      + 'hand. The arithmetic is the evidence, not the verdict field.');
    return { ok: false, refusals };
  }

  // ---- the verdict, as an ALLOW-LIST --------------------------------------
  if (verdict === 'pass') return { ok: refusals.length === 0, refusals };

  if (verdict === 'not_checked') {
    refuse('guardian_not_checked',
      'Guardian ran and checked nothing - the worklist was empty, so it was asked no questions and '
      + 'answered none. That is NOT a pass, and it must not become one by reaching this gate. Either '
      + 'this project genuinely has no service-role query sites, or the scan that enumerates them is '
      + 'not seeing them: check the scan residue and the exclusion classes before believing the first.');
  } else if (verdict === 'fail') {
    refuse('guardian_failed',
      `Guardian's verdict is "fail" (${guardianRecord.fail_reason ?? 'reason unrecorded'}). Resolve the `
      + 'findings, or record an operator decision, before releasing.');
  } else {
    // The enum grew and this gate has not been taught the new value. Refusing is the
    // only safe reading: an unrecognised verdict is not evidence of anything.
    refuse('guardian_verdict_unknown',
      `Guardian's verdict is "${verdict}", which this release gate does not recognise. It refuses `
      + 'rather than interpreting an unknown value, because a gate that falls through on a verdict '
      + 'it has never seen is a gate that stops holding the moment the enum grows.');
  }
  return { ok: false, refusals };
}

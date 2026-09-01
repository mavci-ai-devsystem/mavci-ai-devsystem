/**
 * Mavci Core - guardian's coverage arithmetic. Design 5.4.
 *
 * Guardian never chooses what to read: the worklist is enumerated by
 * `sitescan.mjs` and handed to it, so `sites_total` is fixed before guardian runs
 * and coverage is decidable by subtraction with no judgement involved. This module
 * is the subtraction, and it is deterministic - no model, runs in `selftest.yml`
 * with Claude Code absent (design prediction 2a).
 *
 * ------------------------------------------------------------ THE THREE LAYERS
 *
 * The enumeration can be wrong in two directions and the subtraction cannot see
 * either, because it is computed over whatever set it was given:
 *
 *   1  the scanner CANNOT SEE a site      -> caught by the residue check in
 *                                            sitescan.mjs, on the project's own code
 *   2  the scanner WAS TAUGHT NOT TO      -> an exclusion broadened until it swallows
 *      see a site                            real sites. Residue stays zero and every
 *                                            count balances. Caught only by the
 *                                            known-count assertion on sites_total in
 *                                            check-service-role-sites.mjs
 *   3  anything that gets past both       -> THE FLOOR, below.
 *
 * Only the third is cheap enough to run unconditionally, on every guardian run, in
 * production. That is why it is here and not in a test.
 *
 * ------------------------------------------------------------------- THE FLOOR
 *
 * `sites_total === 0` is `not_checked`, decided BEFORE any subtraction happens.
 *
 * With an empty worklist the subtraction is `0 - 0 = 0` and reports perfect
 * coverage; guardian answers every question it was given, which is none; and the
 * verdict reads `pass`. That is design 4.3a's degenerate case, and it is not
 * hypothetical - `check-service-role-sites.mjs`'s N2 control produces it exactly, by
 * widening one exclusion.
 *
 * A verdict of `pass` on that path would be the most expensive lie this system can
 * tell: a green tick from the component whose judgement nothing deterministic can
 * check, over a set that was empty. It is finding 5 - a probe with nothing to probe
 * is not a passing probe - arriving in the one place where nothing downstream would
 * question it.
 *
 * **The floor holds regardless of what guardian returned.** A perfectly-formed
 * report with zero findings against an empty worklist is still `not_checked`.
 */

/** Verdicts this module can return. `pass` is the only one that means anything good. */
export const GUARDIAN_VERDICT = ['pass', 'fail', 'not_checked'];

/**
 * Where a filter value came from. Closed enum, and the split that matters is which
 * of these CLEAR a site and which do not.
 *
 * `unknown` is a FIRST-CLASS ANSWER, not a failure to answer. A site guardian cannot
 * reason about - a value that leaves the handler, arrives already destructured, or
 * crosses a boundary the read ceiling stops at - must come back as `unknown` with a
 * reason. Silence would also be caught, by the subtraction, as an unanswered site;
 * but silence carries no reason, and "I looked and could not determine this" is a
 * materially more useful signal than "nothing came back for site 3".
 */
export const ORIGIN = [
  'verified_session',    // a verified token / authenticated session. CLEARS.
  'internal_constant',   // a literal or server-side config value. CLEARS.
  'derived_verified',    // computed from a value that itself clears. CLEARS.
  'request_input',       // body, query string, unvalidated header. DOES NOT CLEAR - a finding.
  'unknown',             // guardian looked and could not determine. DOES NOT CLEAR.
];

/** The origins that clear a site. Everything else leaves it answered but not cleared. */
const CLEARING = new Set(['verified_session', 'internal_constant', 'derived_verified']);

/** Why a run was not a pass. `null` only when the verdict is `pass`. */
export const GUARDIAN_FAIL_REASON = [
  'empty_worklist',        // the floor. Not guardian's fault; not a pass either.
  'no_report',             // nothing parseable came back
  'coverage_incomplete',   // fewer sites answered than handed over
  'duplicate_answers',     // the same site answered twice to reach the count
  'unknown_sites',         // answers for sites that were never in the worklist
  'undetermined',          // answered, but one or more sites came back `unknown`
  'malformed_answer',      // an origin value outside the closed enum
  'findings',              // guardian answered completely and found something
];

/**
 * @param {{sites_total: number, questions: Array<{site_id: string}>}} worklist
 * @param {null|{answers?: Array<{site_id: string, origin: string}>, findings?: Array}} report
 * @returns {{verdict: string, fail_reason: string|null, coverage: object}}
 */
export function assessCoverage(worklist, report) {
  const sitesTotal = worklist?.sites_total ?? 0;
  const expected = new Set((worklist?.questions ?? []).map((q) => q.site_id));

  // ---- THE FLOOR. Before any subtraction, and independent of `report`. --------
  if (sitesTotal === 0) {
    return {
      verdict: 'not_checked',
      fail_reason: 'empty_worklist',
      coverage: { sites_total: 0, sites_answered: 0, unanswered: [], duplicates: [], unrecognised: [] },
      detail: 'The worklist was empty, so guardian was asked nothing and answered nothing. '
        + 'That is not a pass. Either this project has no service-role query sites, or the '
        + 'scan that enumerates them is not seeing them - check the residue and the exclusion '
        + 'classes in the same run before believing the first.',
    };
  }

  // ---- No usable report. The ticket stays open (design 5.3). -----------------
  if (!report || !Array.isArray(report.answers)) {
    return {
      verdict: 'fail',
      fail_reason: 'no_report',
      coverage: { sites_total: sitesTotal, sites_answered: 0, unanswered: [...expected], duplicates: [], unrecognised: [] },
      detail: 'No parseable guardian report. Guardian returning nothing and guardian never '
        + 'running are indistinguishable here, and both are failures.',
    };
  }

  // ---- Answered is a SET, not a count. ---------------------------------------
  // Counting answers would let the same site answered twice satisfy a worklist of
  // two, which is the coverage arithmetic defeating itself with no bad intent
  // required - a retry loop is enough to produce it.
  const seen = new Set();
  const duplicates = [];
  const unrecognised = [];
  for (const a of report.answers) {
    const id = a?.site_id;
    if (!expected.has(id)) { unrecognised.push(id ?? '(missing site_id)'); continue; }
    if (seen.has(id)) { duplicates.push(id); continue; }
    seen.add(id);
  }
  const unanswered = [...expected].filter((id) => !seen.has(id));
  const coverage = {
    sites_total: sitesTotal,
    sites_answered: seen.size,
    unanswered,
    duplicates,
    unrecognised,
  };

  if (unrecognised.length) {
    return { verdict: 'fail', fail_reason: 'unknown_sites', coverage,
      detail: `Answers reference ${unrecognised.length} site(s) that were not in the worklist. `
        + 'Guardian does not choose what to read; an answer for an unenumerated site means '
        + 'the worklist it acted on is not the one it was given.' };
  }
  if (duplicates.length) {
    return { verdict: 'fail', fail_reason: 'duplicate_answers', coverage,
      detail: `${duplicates.length} site(s) answered more than once. Counted answers would `
        + 'have reached the total; the set did not.' };
  }
  if (unanswered.length) {
    return { verdict: 'fail', fail_reason: 'coverage_incomplete', coverage,
      detail: `${unanswered.length} of ${sitesTotal} site(s) unanswered: ${unanswered.join(', ')}. `
        + '"Guardian found nothing" and "guardian did not look there" are different facts.' };
  }
  // ---- answered, but not cleared -----------------------------------------
  // These sites ARE answered: they count toward sites_answered and the subtraction
  // balances. What they are not is resolved. Treating them as a pass is the
  // loosening the design predicted and named as the thing to refuse - a project
  // large enough to hit the read ceiling would otherwise buy a green verdict by
  // being hard to analyse.
  // A MISSING origin is malformed, not 'did not clear'. An answer without an origin
  // is not an answer to the question that was asked, and reporting it as an uncleared
  // site would describe the wrong problem to whoever reads the record.
  const malformed = report.answers.filter((a) => !ORIGIN.includes(a?.origin));
  if (malformed.length) {
    return { verdict: 'fail', fail_reason: 'malformed_answer', coverage,
      detail: `${malformed.length} answer(s) carry an origin outside the closed enum `
        + `(${[...new Set(malformed.map((a) => String(a.origin)))].join(', ')}). An unrecognised `
        + 'origin is not the same fact as `unknown` and is not treated as one: it means the '
        + 'report was produced by something this arithmetic does not understand.' };
  }
  const undetermined = report.answers.filter((a) => a?.origin === 'unknown');
  if (undetermined.length) {
    return { verdict: 'fail', fail_reason: 'undetermined', coverage,
      detail: `${undetermined.length} of ${sitesTotal} site(s) answered \`unknown\`: `
        + `${undetermined.map((a) => a.site_id).join(', ')}. These were looked at and not `
        + 'resolved - which is a complete answer and an incomplete determination. The findings '
        + 'list cannot be trusted as exhaustive while any site is unresolved, so this is '
        + 'reported ahead of findings rather than alongside them.' };
  }

  // ---- a site clears only if its ORIGIN clears it -------------------------
  // Derived from the answers, NOT read from `report.findings`. Trusting that array
  // would mean a site answered `request_input` - the untrusted case, the live bug -
  // clears whenever guardian forgets to also file a finding for it. The origin is
  // the evidence; the findings array is a convenience.
  const uncleared = report.answers.filter((a) => !CLEARING.has(a?.origin));
  if (uncleared.length) {
    return { verdict: 'fail', fail_reason: 'findings', coverage,
      detail: `${uncleared.length} of ${sitesTotal} site(s) did not clear: `
        + `${uncleared.map((a) => `${a.site_id} (${a.origin})`).join(', ')}. A site clears only `
        + 'when its filter value originates somewhere trusted; this is derived from the answers '
        + 'rather than from the findings list, so a site cannot clear by not being written up.' };
  }
  return { verdict: 'pass', fail_reason: null, coverage, detail: null };
}

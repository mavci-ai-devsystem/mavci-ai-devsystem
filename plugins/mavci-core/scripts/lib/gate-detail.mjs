/**
 * Mavci Core - what the Stop gate SAYS when it blocks. Pure, and separated from
 * `gate.mjs` for the reason `release-gate.mjs` is separated from
 * `release-check.mjs`: a message whose only exercise is a real block is a message
 * tested once per incident, by the operator, at the worst possible moment.
 *
 * `gate.mjs` runs `main()` at import, so nothing can import it to assert against.
 * That is why this is a module rather than an export over there.
 *
 * ------------------------------------------------ WHAT WENT WRONG, AND THE FIX
 *
 * The gate built its list from every check with status `fail` or `error`, took the
 * first five IN VERDICT ORDER, and printed them under a headline counting only
 * `summary.blockers`. Two different predicates, one message.
 *
 * MEASURED ON GATE6, twice on consecutive prompts: four `legal.pages_present`
 * findings - severity `warning`, one per legal page - sort ahead of the blockers in
 * rule order, so they took four of the five slots and pushed
 * `supabase.service_role_query_scoped` off the end. The gate announced "2 blocking
 * standards violations", listed exactly one of them, and told the actor to fix the
 * list and stop again. An operator who fixed everything shown would have stopped
 * again and been blocked by a violation no gate output had ever named.
 *
 * The displacement is systematic rather than unlucky: `legal.pages_present` emits
 * one finding per page and the scaffold ships four legal pages, so every project
 * built from the template carries four warnings that occupy four slots until a
 * lawyer clears them.
 *
 * RAISING THE CAP IS NOT THE FIX and was rejected explicitly: a sixth slot fixes
 * that instance and leaves a project with five legal pages in exactly the same
 * place. The defect is that severity did not govern which five were shown.
 *
 * So `BLOCKING_SEVERITIES` - the same predicate `summary.blockers` is counted with -
 * orders the list, blockers first. Lower-severity findings are kept after them as
 * context rather than dropped: they are real, and the person reading this is about
 * to act on it.
 *
 * AND A TRUNCATED LIST SAYS SO. A silently truncated list is the same shape as a
 * silently dropped signal, which is the class this repository keeps finding -
 * `clampField` answers it by writing `... [truncated N chars]` beside the text, and
 * the release gate answers it by printing its declared exclusions on the happy path.
 * This answers it by naming how many findings were omitted and how many of those
 * were blocking, so "nothing else is wrong" and "four more things are wrong" cannot
 * look identical.
 *
 * `verify.mjs` already sorted this way for its human output. The correct ordering
 * existed one file over and the gate did not use it.
 */

import { BLOCKING_SEVERITIES } from '../config.mjs';

/** How many findings the block message lists before it truncates and says so. */
export const DETAIL_CAP = 5;

/** Is this check one of the ones `summary.blockers` counts? */
export const isBlocking = (c) => BLOCKING_SEVERITIES.has(c?.severity);

/**
 * The `detail` a blocking gate prints.
 *
 * @param {{checks: object[], summary: {blockers: number}}} verdict
 * @param {number} [cap] list length before truncation - a parameter so the
 *   assertion can prove the ORDERING rather than the cap, and so a larger cap
 *   cannot be mistaken for a fix.
 * @returns {string}
 */
export function formatBlockDetail(verdict, cap = DETAIL_CAP) {
  const failing = (verdict?.checks ?? []).filter((c) => c.status === 'fail' || c.status === 'error');

  // Stable partition: blockers keep their relative order, so do the rest. Array
  // .sort is stable in Node, and the comparator is a pure severity partition -
  // nothing here re-ranks within a severity class, because rule order is the only
  // ordering the verdict actually carries.
  const ordered = [...failing].sort((a, b) => Number(isBlocking(b)) - Number(isBlocking(a)));

  const shown = ordered.slice(0, cap);
  const lines = shown.map((c) => {
    const loc = c.path ? `${c.path}${c.line ? `:${c.line}` : ''}` : '(repo)';
    return `${c.check_id} at ${loc} - ${c.evidence ?? 'see verdict'}${c.remedy ? ` FIX: ${c.remedy}` : ''}`;
  });

  const omittedList = ordered.slice(cap);
  const omittedBlockers = omittedList.filter(isBlocking).length;
  const truncation = omittedList.length > 0
    ? `\n\n${omittedList.length} further finding(s) not listed here`
      + (omittedBlockers > 0 ? `, ${omittedBlockers} of them BLOCKING` : ', none of them blocking')
      + '. The full verdict is under .mavci/control/verdicts/.'
    : '';

  const n = verdict?.summary?.blockers ?? 0;
  return `mavci: ${n} blocking standards violation${n === 1 ? '' : 's'}.\n- ${lines.join('\n- ')}${truncation}`;
}

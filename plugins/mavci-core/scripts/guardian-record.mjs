#!/usr/bin/env node
/**
 * Mavci Core - the SubagentStop writer. Design 4.3.
 *
 * Guardian holds no `Bash` and no `Write`. It returns its report as its final
 * assistant message; this script runs on `SubagentStop`, reads that message from
 * `last_assistant_message` (NATIVE-CAPABILITIES 4.23), and writes the record.
 *
 * So guardian cannot forge a record - it has no mechanism, it emits text and
 * something else decides what becomes one - and cannot silently fail to file one,
 * because this runs whatever guardian did.
 *
 * ------------------------------------------------------------ WHAT IT REFUSES
 *
 * 1. A STOP FROM ANY OTHER SUBAGENT WRITES NOTHING. Not an empty record, not a
 *    record marked skipped: no file. `SubagentStop` fires for every subagent, and
 *    an empty guardian record is schema-valid, has zero findings, and reads
 *    downstream as a clean pass. It is this component's degenerate case (design
 *    4.3a control 1) and the cheapest possible way to manufacture a green tick.
 *
 * 2. A MISSING OR UNPARSEABLE REPORT LEAVES THE TICKET OPEN. Guardian failing to
 *    produce a readable report is not guardian passing. The ticket is what the
 *    gate sees; deleting it is the only thing that says "this ran and was
 *    recorded", so it is deleted on exactly one path - a record was written.
 *
 * 3. THE VERDICT IS COMPUTED HERE, FROM THE WORKLIST AND THE ORIGINS. Nothing
 *    guardian says about its own verdict is read. `report.verdict` is ignored
 *    entirely; `report.findings` is ignored for the decision. Clearing is derived
 *    from `origin` alone, which is the second reader of that field - and the first
 *    one was wrong, letting a site answered `request_input` clear whenever guardian
 *    forgot to also file a finding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.mjs';
import { abs, exists, readJsonOrNull, nowIso } from './lib/fsx.mjs';
import { assessCoverage } from './lib/coverage.mjs';
import { pluginVersion, projectRoot, writeControl } from './state.mjs';

/** Accepts the bare name and the `mavci-core:`-qualified form (6.24). */
const GUARDIAN = 'mavci-guardian';
function isGuardian(agentType) {
  if (typeof agentType !== 'string' || !agentType) return false;
  const bare = agentType.includes(':') ? agentType.slice(agentType.indexOf(':') + 1) : agentType;
  return bare === GUARDIAN;
}

/** The last fenced or bare JSON object in the message. Guardian is told to return
 *  one and nothing else; this tolerates a fence without tolerating prose-as-data. */
export function parseReport(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const fenced = message.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : message).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && Array.isArray(parsed.answers) ? parsed : null;
  } catch { return null; }
}

export const TICKET = `${PATHS.controlDir ?? '.mavci/control'}/guardian/ticket.json`;
// Records live in their own directory. Writing them beside the worklists let a
// record named for its worklist_id OVERWRITE the worklist it was scored against -
// destroying the evidence for the verdict in the act of recording it, and leaving a
// run that could never be audited. Caught by the `exactly one record` assertion,
// which is the only one that counted files rather than reading them.
const RECORD_DIR = '.mavci/control/guardian/records';

/**
 * @returns {{action: 'ignored'|'ticket_open'|'recorded', reason?: string, record?: object}}
 */
export function handleSubagentStop(root, input) {
  // ---- 1. not guardian -> WRITE NOTHING ------------------------------------
  if (!isGuardian(input?.agent_type)) {
    return { action: 'ignored', reason: `agent_type "${input?.agent_type ?? '(absent)'}" is not ${GUARDIAN}` };
  }

  const ticketPath = abs(root, TICKET);
  const ticket = readJsonOrNull(ticketPath);
  if (!ticket) {
    // Guardian stopped with no ticket open. Nothing dispatched it through the
    // sanctioned path, so there is no worklist to score it against and no record
    // to write. Writing one anyway would invent coverage.
    return { action: 'ignored', reason: 'no open guardian ticket - nothing dispatched this run' };
  }

  const worklist = readJsonOrNull(abs(root, ticket.worklist_path));

  // ---- 2. no readable report -> TICKET STAYS OPEN ---------------------------
  const report = parseReport(input?.last_assistant_message);
  if (!report) {
    return { action: 'ticket_open',
      reason: 'guardian returned no parseable report. The ticket stays open: a guardian that '
        + 'produced nothing readable and a guardian that never ran are the same fact here, and '
        + 'neither is a pass.' };
  }

  // ---- 3. the verdict is OURS, derived from the worklist and the origins ----
  // `report.verdict` and `report.findings` are deliberately not consulted.
  const assessed = assessCoverage(worklist, report);

  const record = {
    schema_version: 1,
    project_id: ticket.project_id,
    plugin_version: pluginVersion(),
    run_at: nowIso(),
    reviewed_ref: ticket.reviewed_ref ?? null,
    tree_state: ticket.tree_state ?? null,
    worklist_id: ticket.worklist_id,
    trigger: ticket.trigger ?? 'manual',
    verdict: assessed.verdict,
    fail_reason: assessed.fail_reason,
    detail: assessed.detail ?? null,
    coverage: assessed.coverage,
    answers: report.answers.map((a) => ({
      site_id: a.site_id ?? null,
      origin: a.origin ?? null,
      evidence: typeof a.evidence === 'string' ? a.evidence.slice(0, 500) : null,
      reason_if_unknown: typeof a.reason_if_unknown === 'string' ? a.reason_if_unknown.slice(0, 500) : null,
    })),
  };

  fs.mkdirSync(abs(root, RECORD_DIR), { recursive: true });
  const rel = `${RECORD_DIR}/${ticket.worklist_id}.json`;
  writeControl(root, rel, record, 'guardian');

  // The ONE path that closes the ticket: a record exists on disk.
  try { fs.unlinkSync(ticketPath); } catch { /* already gone */ }
  return { action: 'recorded', record, path: rel };
}

/* ------------------------------------------------------------------- CLI */

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

    // CHEAPEST DISCRIMINATOR FIRST, AND IT COSTS NO I/O.
    //
    // This is the highest-volume hook in the system by a wide margin: the plugin is
    // installed at user scope, so SubagentStop fires for EVERY subagent stop in
    // EVERY repository on the machine - Explore runs, general-purpose agents, other
    // projects entirely. Almost none of them are guardian.
    //
    // `agent_type` is already in the payload. Reading it decides the overwhelming
    // majority of invocations with zero filesystem access, so it goes ahead of the
    // manifest stat rather than after it. Ordering these the other way round would
    // put a file stat on the path of every unrelated subagent on the machine.
    if (!isGuardian(input?.agent_type)) process.exit(0);

    const root = process.env.CLAUDE_PROJECT_DIR || projectRoot();
    if (!exists(abs(root, PATHS.manifest))) process.exit(0);  // not a Mavci project: silent
    try {
      const r = handleSubagentStop(root, input);
      if (r.action === 'ticket_open') {
        process.stderr.write(`mavci guardian: ${r.reason}\n`);
        process.exit(2);
      }
      process.exit(0);
    } catch (err) {
      // A crash here must not read as success: the ticket is still open and the
      // gate will see it, but say so rather than exiting silently.
      process.stderr.write(`mavci guardian writer failed: ${err.message}\n`);
      process.exit(2);
    }
  });
}

if (path.basename(process.argv[1] ?? '') === 'guardian-record.mjs') main();

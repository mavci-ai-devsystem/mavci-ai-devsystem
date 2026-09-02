---
name: guardian
description: Runs the provenance review over every enumerated service-role query site. Writes the ticket, hands guardian a worklist path, and lets the SubagentStop writer record the result. Use before a release, or after connect on a project whose isolation is application-filters.
argument-hint: "[--corpus]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Write
---

# Guardian: provenance over the enumerated sites

The standards checker establishes that every service-role query carries a tenant
predicate. It cannot establish that the predicate's *value* is trustworthy — that
needs a value traced back to its origin, which is dataflow, not pattern matching.
This command is how that question gets asked.

## Current state

- Isolation declared: !`node -e "const m=require('./.mavci/project.json');console.log(m.tenancy?.isolation ?? '(no manifest)')" 2>/dev/null || echo "(not connected)"`
- Open ticket? !`ls .mavci/control/guardian/ticket.json 2>/dev/null || echo "none"`
- Existing records: !`ls .mavci/control/guardian/records/ 2>/dev/null | tail -3 || echo "none"`

## Steps

### 1. Refuse if this is the wrong project, or the wrong phase

If `tenancy.isolation` is not `application-filters`, stop. Guardian answers a
question about application-code filters; on an `rls` project it would be asking
about a mechanism that is not the one in use. Say so and stop.

**Then check the phase here, before anything else happens.** If
`.mavci/control/state.json` does not say `verify`, stop and say so. Do not emit a
worklist, do not open a ticket, do not dispatch.

This check used to live inside guardian, as step 2 of the shared agent contract:
every agent reads `state.json` and refuses on the wrong phase. Guardian no longer
does, and it moved here for two reasons. It is a capability held for one fact the
caller already has — this command emits the worklist in the verify phase, so it
knows the phase before it dispatches — and every path left open in `.mavci/` is an
exception guardian's read scope has to carry. Checking before dispatch is also
strictly cheaper: a phase refusal costs nothing here, and cost a dispatched Opus
turn that came back `blocked` when it lived on the other side.

### 2. Enumerate — you do this, not guardian

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worklist.mjs" --emit
```

This runs the same scan the checker runs, and writes
`.mavci/control/guardian/wl-<id>.json`. **`sites_total` is fixed here**, before
guardian is invoked, and that is the whole reason coverage is decidable by
subtraction: guardian never chooses what to read and never adds to the list.

If the scan reports a non-zero residue, stop. A residue means the scan found a
candidate site it could neither enumerate nor name, so the worklist understates
what exists — and a worklist guardian answers completely is worth nothing if it
was the wrong list.

If `sites_total` is 0, stop and say so. That is `not_checked`, not a pass, and it
is more likely to mean the scan is not seeing sites than that the project has
none.

### 3. Write the ticket — BEFORE dispatching, never after

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/worklist.mjs" --open-ticket <worklist-id>
```

**Order matters and it is not a style preference.** The ticket is what tells the
`SubagentStop` writer that a run was dispatched and which worklist to score it
against. Write it after a successful dispatch and a crash in between leaves
guardian having run with nothing to score it — the writer then correctly refuses
to record anything, and the run is silently lost. Ticket first, dispatch second.

The writer deletes the ticket on exactly one path: a record was written. An open
ticket after a run means the run did not produce one, which is what the gate sees.

### 4. Dispatch guardian with the worklist PATH

Invoke `mavci-guardian` with a prompt that names the file:

    Read .mavci/control/guardian/wl-<id>.json. It contains a `questions` array.
    Answer every entry and return the JSON object described in your instructions.

**NEVER INLINE THE WORKLIST INTO THE PROMPT.** Not when the file write fails, not
when the path looks awkward, not for a one-site worklist where inlining seems
harmless. Guardian has `Read` and the path is all it needs.

Note what guardian can and cannot open now. Its read scope excludes `.mavci/`
entirely, with exactly one exception: **the worklist named by the open ticket**.
That is why step 3 is not a style preference any more — a dispatch with no ticket
leaves guardian unable to read its own worklist, and it will report
`blocked_by: "no_worklist"` rather than run against nothing.

The reason is that inlining reintroduces truncation, and a truncated worklist
answered completely is indistinguishable from a complete one: the subtraction is
computed against the file on disk, so a guardian that only ever saw six of sixty
sites reports six answers and the record says `coverage_incomplete` — which is the
good case. The bad case is a prompt that silently drops entries before guardian
ever sees a count, and then the numbers agree with each other and with nothing
real. If the file cannot be written, **stop**; do not route around it.

### 5. Do not read the result and interpret it

The `SubagentStop` writer records the verdict. It computes coverage against the
worklist and derives clearing from each answer's `origin` — it does not read
anything guardian says about its own verdict, and neither should you. Report what
the record says; do not re-score it, summarise it as better than it is, or treat a
`fail` as advisory.

### 6. Report

- the worklist id and `sites_total`
- the recorded verdict and `fail_reason`
- for a `fail`: the sites that did not clear, with their origins
- for `undetermined`: the sites guardian could not resolve and the reasons it gave
- that the record is at `.mavci/control/guardian/records/<id>.json`

Then stop. Do not fix anything: a provenance finding is usually an auth change, and
the operator chooses how.

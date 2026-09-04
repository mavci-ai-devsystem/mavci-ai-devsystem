# Queued for the next system release - apply with `/mavci-core:retro --apply`

Recorded: 2026-09-04, plugin 0.1.26, project gate6.

Each finding below was filed from inside a project, by whoever hit it, at the moment
they hit it. Nothing here is fixed. `/mavci-core:retro --apply` carries this file into
the system repository; only an operator can run that, and only an operator can delete
this file.

---

# Finding 1 - new-project step 4 tells the operator to hand-write two files render.mjs --scaffold already writes

Filed: 2026-09-04T08:25:26Z, plugin 0.1.26.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `skills/new-project/SKILL.md`

skills/new-project/SKILL.md step 4 (Configuration) ends: 'Still to write by hand: .gitignore including .env*, and .gitattributes with * text=auto eol=lf.' Both are in templates/scaffold/ and renderTree() in render.mjs copies them with no dotfile filter, so step 3's 'render.mjs --scaffold --config' already writes both. Verified on gate6, created by this command today: .gitignore and .gitattributes are byte-identical to templates/scaffold/ (diff clean), and .gitignore already contains .env* and !.env.example. Following step 4 produces no error and no damage - the operator opens a file that is already correct - so nothing reports it. Note the asymmetry: the same instruction in skills/connect/SKILL.md step 2.4 is CORRECT, because connect deliberately does not render the scaffold.

### The assertion, and the broken build it must catch

Assert that no file named as 'to write by hand' in skills/new-project/SKILL.md exists in templates/scaffold/. Broken build it must catch: the current 0.1.26 tree, where templates/scaffold/.gitignore and templates/scaffold/.gitattributes both exist while step 4 lists both as manual. The adjacent assertion that would NOT catch it is one checking that the rendered project contains .gitignore and .gitattributes - that passes precisely because the renderer is right and the prose is wrong.

---

# Finding 2 - guardian's single-JSON-object output contract is unenforced; parseReport absorbs prose silently

Filed: 2026-09-04T08:34:55Z, plugin 0.1.26.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/guardian-record.mjs`

agents/mavci-guardian.md says: 'Your final message must be a single JSON object and nothing else - no preamble, no commentary around it.' On the 0.1.26 corpus run, case m8f2r, guardian returned two sentences of prose ahead of the fenced JSON block ('Traced. companyId at line 27 comes from body.companyId...'). parseReport in guardian-record.mjs prefers the fenced block, so the record written for worklist wl-20260904083133 is correct and the case scored PASS. Cases q3v7k and t5w9d on the same run returned bare JSON as instructed, so the deviation is intermittent. Nothing in any artefact records that the contract was broken: the record has no field for it, the scorer reads only verdict, fail_reason and origin, and the run is green. Also observed on the same run: guardian used absolute Windows paths in t5w9d evidence and repo-relative paths in q3v7k, spending cap space on the absolute form; the q3v7k and t5w9d evidence fields were truncated by 288 and 325 chars.

### The assertion, and the broken build it must catch

parseReport should report WHETHER it fell back to fence-extraction past leading prose, and the record should carry that as a boolean such as report_well_formed. Broken build it must catch: a guardian whose final message is prose with a fenced JSON block appended - today that is indistinguishable in every artefact from one that obeyed the contract. The adjacent assertion that already exists and does NOT catch it is check-corpus-score.mjs, which asserts the three scored fields; all three are correct here precisely because the parser recovered. Tension to resolve deliberately: making parseReport REJECT prose would fail the run closed and discard a correct set of answers, which is likely the wrong trade - make the deviation visible, not fatal.

### Addendum - the requirement is an ARTEFACT field, not a log line

Added 2026-09-04, same run, at the operator's direction. Stating it separately because
the assertion above buries it in a subclause and it is the load-bearing half.

**The record must carry that the contract was broken.** Not a warning on stderr, not a
line in a hook log, not a counter: a field in
`.../guardian/records/<worklist-id>.json` itself, written at the same moment the
answers are. A log says a violation happened somewhere at some time; only the record
says THIS answer arrived in a non-conforming shape.

That distinction is the whole finding. The intermittency here is 1 case in 3, in one
run, on one machine - the only way anyone establishes that rate later is by counting
records that carry the flag against records that do not. A log cannot be counted
against anything, is not written to the control plane, does not survive the session,
and is not what `--apply` or the release gate reads. Right now a conforming record and
a recovered-from-prose record are byte-indistinguishable, so the rate is not merely
unknown - it is unrecoverable after the fact, including for this run once the
transcript is gone.

Same shape as `suggested_next` in finding 19, and the fix should follow it: guardian's
disclosure existed only in the returned message, the record dropped it, and the
system's own escalation channel emptied into nothing. The remedy there was to persist
the field, not to log it.

Precedent for the field being visible rather than fatal is already in this file:
`clampField` does not refuse an over-long evidence string, it writes the text AND
`... [truncated N chars]` beside it. Two of three records on this run carry that
marker, which is how the truncation rate for this run is still knowable. Do the same
here.

---

# Finding 3 - risk-guard refuses retro.mjs --record when a control-plane path appears inside a string operand - a false positive on the escalation channel

Filed: 2026-09-04T08:39:05Z, plugin 0.1.26.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/risk-guard.mjs`

Reproduced THREE times on 0.1.26, project gate6, including once while filing this very finding. Running retro.mjs --record with a --finding string whose TEXT quoted a path under the control-plane directory was refused with: 'the write target of this command could not be determined, and it names a path inside <the control-plane dir> ... This is not a claim that it writes there - it is that the guard cannot tell, so it refuses rather than guess.' That same message ends: 'Quoting a control-plane path inside a message or a string operand is fine and is not what this is about' - which is exactly what the invocation was doing, so the guard contradicted its own stated scope in the same breath. Removing the literal path token from the prose, changing nothing else - same command, same flags, same write target - succeeded every time. Evidence the operand boundary is already lost before the scan: the excerpt the guard echoes back starts mid-string, e.g. at 'parseReport absorbs prose silently" --finding ...'. CONTRAST, which sharpens rather than widens this: the same guard refused a 'node -e' reading a control-plane file on the same run, and THAT refusal is correct - node -e is opaque and the guard genuinely cannot see its target. The defect is specific to a KNOWN script invoked with VISIBLE flags where the path occurs only inside a quoted operand. Cost, stated plainly: the response to being blocked while filing is to stop filing, and this guard blocks the one command the plugin tells seven different trapped code paths to reach for.

### The assertion, and the broken build it must catch

Assert that whatever strips data operands before the control-plane path scan removes the VALUES of retro.mjs's string flags - at minimum --record, --finding, --target, --assertion - so a path inside them cannot trip the refusal. Broken build it must catch: the exact invocation recorded above - retro.mjs --record carrying a control-plane path inside --finding - which must be ALLOWED, while a genuinely opaque command such as 'node -e' reading the same path must still be REFUSED. Both directions belong in ONE check: a fix that exempts retro.mjs wholesale passes the first half and silently opens the second, and that fix is the obvious one, so the assertion has to be written to reject it.

---

# Finding 4 - sitescan ADMIN_FACTORY does not recognise createAdminClient, the factory the plugin's OWN scaffold exports - service-role queries are invisible and the check reports green

Filed: 2026-09-04T09:16:14Z, plugin 0.1.26.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/lib/sitescan.mjs`

MEASURED on gate6, plugin 0.1.26, a project created by /mavci-core:new-project and otherwise unmodified. sitescan.mjs line 61: ADMIN_FACTORY = /\b(getSupabaseAdminClient|createSupabaseAdminClient|getServiceRoleClient)\s*\(/. The scaffold at templates/scaffold/lib/supabase/server.ts:36 exports createAdminClient, which is in neither that list nor the INLINE_ADMIN pattern. Consequence, observed not theorised: templates/scaffold/app/api/stripe/webhook/route.ts constructs a service-role client at :28 (const db = createAdminClient()) and queries with it at :29 (db.from('stripe_events').insert(...)), and worklist.mjs --emit reports sites_total 0 and excludes that very line with reason no_admin_client - whose text is 'file constructs no service-role client', which is FALSE about that file. So supabase.service_role_query_scoped is blind to every query made through the scaffold's own factory, and reports green by seeing nothing. Harmless on this exact query only by luck: stripe_events has no org_id and is not tenant-scoped. Any query through createAdminClient against orgs, members or a new tenant table is equally invisible, and this is inherited by EVERY project new-project creates. The irony is load-bearing and worth keeping: the comment at sitescan.mjs:62-66, immediately below ADMIN_FACTORY, documents this exact failure class for the KEY name - 'finding 6's third instance was a rule that knew one name for this key and was blind to a real client using the other' - and the factory list directly above it has the same bug for the FACTORY name. Discovered by mavci-architect during task 0001 on gate6, which escalated it rather than fixing it; it was verified independently against the scanner and the scaffold before filing.

### The assertion, and the broken build it must catch

Assert that every service-role client factory exported by templates/scaffold/lib/supabase/server.ts is recognised by sitescan's enumeration - derived from the scaffold, not hand-listed, so the two cannot drift again. Broken build it must catch: the current 0.1.26 tree, where the scaffold exports createAdminClient and ADMIN_FACTORY does not contain it, and where scanning the scaffold's own stripe webhook yields sites_total 0 with exclusion reason no_admin_client on a line that demonstrably constructs a service-role client. The adjacent assertion that exists and does NOT catch it is any fixture-based test under templates/fixtures/supabase.service_role_query_scoped/, because those fixtures spell the factory using a name ADMIN_FACTORY already knows - they test the rule against inputs written to satisfy it. The strongest single check is to scan the SHIPPED SCAFFOLD as a fixture and assert the webhook's service-role query is enumerated rather than excluded.

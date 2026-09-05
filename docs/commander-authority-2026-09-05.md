# Commander: what it may run, what stops it, and at which layer

Answers the question `docs/operator-load-2026-09-05.md` was pointed at the wrong
side of. That document measured how much of the operator's load is *judgement*.
The question is how much of it is *movement around a judgement* — and the two
answers differ by about a factor of two and a half.

No code proposed. Per command: can Commander run it, if not which layer stops it,
and can that layer be removed.

---

## 0. The assumption everything below depends on

**Commander is the MAIN SESSION** — the orchestrator that `skills/ship/` already
is, not a subagent. This is not a detail: `risk-guard.mjs` authorises by CALLER
(`risk-guard.mjs:827-831`), `agent_type` is set for a subagent and absent for the
main session, and **every answer below inverts if Commander is a subagent.** A
subagent is denied all fifteen privileged verbs by name (`risk-guard.mjs:836-852,
858-865`). The main session is denied none of them.

Stated because if Commander is ever built as a subagent to "keep it contained",
the containment it gains is the containment that makes it useless, and the guard
was written the way it was specifically so the orchestrator could act.

---

## 1. The three layers, and which one actually fires

**L1 — the harness.** `permissions.allow / ask / deny` in the project's
`.claude/settings.json` (template: `plugins/mavci-core/templates/project.settings.json`),
plus `disable-model-invocation` on a skill, plus the tool runtime itself (a
foreground shell call blocks until the process exits).

**L2 — the risk-guard hook.** `PreToolUse`, three outcomes: `deny`,
`confirm`, or fall through. Authorised by caller.

**L3 — design.** Prose prohibitions in `skills/ship/SKILL.md` and the argument
behind them.

### L2's confirm does not work, and the repository already says so

`risk-guard.mjs:270` — `const confirm = (reason) => decide('deferToUser', ...)`.
`scripts/ci/check-risk-guard.mjs:226-228`, in the repository's own words:

> NOTE: this is the 6th case asserting the literal 'deferToUser', a value Claude
> Code REJECTS (carried-forward item 7) - it asserts what the guard emits, not
> that the decision is applied. Real containment here rests on the deny rules,
> not on this confirm.

Eleven cases in that file assert the literal string. `NATIVE-CAPABILITIES` 4.3
still records `permissionDecision: "deferToUser"` as **verified** and labels it
*"the tier-2 confirm mechanism"*, which contradicts carried-forward item 7 in the
same repository. Nothing here has ever compared the emitted value against Claude
Code's accepted set.

**So there is no working "ask the operator" channel in the hook layer.** What
actually asks, today, is Claude Code's own permission prompt at L1 — a generic
*run this command?*, not *do you approve this spec?*

**This is the answer to "the mechanism exists, why is it not used".** It does not
exist. It was designed, documented as verified, asserted against itself, and has
never once raised a question.

---

## 2. The seven commands

Read each row as: **can Commander run it → what stops it → can that be removed.**

### `state.mjs --approve-spec` — YES, mechanically. Stopped by L3.

- **L1:** no allow/ask/deny rule matches `Bash(node .../state.mjs ...)`. Default
  permission flow → a generic prompt.
- **L2:** `risk-guard.mjs:849` puts it in `PRIVILEGED`, so a *subagent* is denied.
  The main session gets `confirm()` — which is inert (§1). **Not denied.**
- **L3:** `skills/ship/SKILL.md:108-109` — *"**Do not run `--approve-spec`.** It is
  the one command in the chain whose whole purpose is to record that a person
  decided something."* And at line 67: *"a decision recorded without them is not a
  record of anything."*

**The binding blocker is L3, and it rests on a property the artefact does not
carry.** `state.mjs:565` writes `by: 'operator'` as a **hardcoded constant**. The
record is byte-identical whether the operator typed the command in their own
terminal or Commander ran it after an in-session "evet". Nothing downstream can
tell the two apart. And `risk-guard.mjs`'s provenance arm opens `if (agent && …)`,
so for the main session it is skipped entirely (gate6 finding 25) — a main-session
`--agent` value is compared against nothing.

So today's arrangement pays the full transport cost — write the command, copy it,
paste it, copy the output, paste it back — for a guarantee that exists only in the
operator's memory of having pressed the key.

**Removable: yes, and it makes the record stronger rather than weaker.** The
honest version is not "let Commander run it". It is: make the question a real
question (fix L2's value), and have `--approve-spec` record what was shown, who
was asked, what they answered, and through which channel. Then the artefact
carries more than it does now. Lifting L3 without that is trading a weak
guarantee for none.

### `state.mjs --waive` — YES, mechanically. Stopped by L3, and separately broken.

Same shape: L1 default prompt, L2 privileged-but-main-session-confirm (inert,
`risk-guard.mjs:840`), L3 forbids (`ship/SKILL.md:110-111`). The
`/mavci-core:waive` **skill** is `disable-model-invocation: true`, which is an L1
block — but that gates the slash command, not the `state.mjs` path underneath it.

Two things, not one: the authority question is identical to `--approve-spec`, and
there is a functional defect underneath it. On cartoonify `--waive` refused the
actual case — *unknown check `spec.acceptance_criterion_4`* — so the decision was
recorded as a hand-written ADR that **nothing enforces**, with an expiry condition
that only a human remembers. Removing the L3 block without fixing that gives
Commander a command that cannot express the waiver the operator actually made.

### `state.mjs --set-phase` — NO, and this one should stay closed.

L1 default prompt; L2 confirm (inert, `risk-guard.mjs:837`); L3 forbids
explicitly, `ship/SKILL.md:99-104`: *"`--set-phase` is the free override with none
of those refusals … If a router step ever reads `--set-phase`, that is a defect in
the router — report it, do not run it."*

**Under your own test this command IS the decision, not the record of one.**
`risk-guard.mjs:906-911`: *"any phase, any time, no precondition, no task."*
Nothing is written down that Commander would be carrying out.

The correct Commander path already exists and is already open: `--advance-phase`,
which is **exempt from the confirm** (`risk-guard.mjs:926`, `WORKFLOW_MOVES`)
precisely because it executes a decision that is on disk, and which refuses four
ways if it is not (`state.mjs:598-625`). **Do not remove this block.** It is the
one place where the existing design is exactly right.

### `doctor --sync` — YES. Nothing stops it today.

L1: default prompt only (no rule names it). L2: **no rule names `doctor.mjs` at
all**; it is additionally exempt from the control-plane write matcher
(`risk-guard.mjs:34, 180`). L3: `ship` does not mention it.

It records a **fact** — the installed plugin version — through the sanctioned
writer (`setPin` → `writeControl`, validated and sealed). No decision is involved.
The only residual human step is `git commit` of the result, and that is already in
the L1 allow list.

**Removable friction: the L1 prompt.** An allow rule for the plugin's own
mechanical scripts (`doctor`, `route`, `verify`, `worklist`, `corpus-stage`,
`corpus-score`, `release-check`) removes a prompt per invocation without touching
any gate — none of those seven is privileged at L2.

### `state.mjs --reseal` — NO, and the reason is not authority.

L1 prompt; L2 confirm (inert, `risk-guard.mjs:841`); L3 forbids
(`ship/SKILL.md:110`).

**This is the one verb where "ask, then run" cannot be made honest today.**
`--reseal` *launders any tampering that preceded it* (`risk-guard.mjs:841`), and
`skills/doctor/SKILL.md:55-56` says it is *for a deliberate operator edit, not a
way to silence the alarm* — but **nothing on disk says which edit**. Every other
privileged verb that needs a justification takes one: `--block --reason`,
`--waive --reason`. This one takes none.

So there is no question Commander could ask whose answer would end up in the
record. **Removable only after `--reseal` records what it is resealing** — which
is a small change and would also make the seal auditable for the first time.

### `state.mjs --record-corpus` — YES, and it should not have been gated this way.

L1 prompt; L2 privileged (`risk-guard.mjs:845`), main-session confirm (inert);
**L3 does not mention it** — `ship/SKILL.md` forbids six verbs and this is not one
of them.

**The operator decides nothing here.** The result is computed, and the command
refuses `--result`, `--pass`, `--recorded-for`, `--version`, `--plugin-version`,
`--library-fingerprint` and `--fingerprint` (`state.mjs:1431-1443`) precisely so
that no caller can supply the answer. Under your test this is category 2 wearing
category 3's gate.

**Removable: yes**, by reclassifying it the way `--advance-phase` is classified —
executes a computed outcome, no confirm. The gate that actually matters is
upstream and is not this one: whether a case was staged at all, which
`corpus-stage.mjs` already derives rather than accepts as an argument
(`worklist.mjs:31-37` gives the reasoning for refusing a `--scope` flag, and it
applies here unchanged).

### `git commit` — YES, today, with no prompt.

L1: `"Bash(git commit *)"` and `"Bash(git add *)"` are in the **allow** list. L2:
no rule; only `git push --force`, `--delete`, `reset --hard`, `branch -D`,
`clean -f/-d` are `HARD_BLOCK` (`risk-guard.mjs:487-491`), and a push resolving to
`deploy.prod_branch` confirms (`risk-guard.mjs:1101-1105`). L3: nothing.

Already fully Commander's. `git push` is `ask` at L1 and correctly so.

### `npm run dev` — YES by policy; blocked by the tool runtime, not by any gate.

L1: `"Bash(npm run *)"` is in the **allow** list. L2: nothing. L3: nothing.

**The blocker is that a dev server never exits**, so a foreground shell call
blocks the turn. It has to be started in the background and its output read from
there. That is a harness/tooling constraint and it is fully removable.

**Removing it deletes several of the transport acts directly.** On cartoonify the
operator pasted in the 502 and its 34-second timing, the `route.ts:104` server
log, and the result of the 0.58-second discriminating probe — three pieces of
information the session could have obtained by running the thing itself. Those are
not authority problems. They are the session not having been given the command.

---

## 3. Why the mechanism is unused — three reasons, in order of weight

1. **The asking channel was never built, only designed.** §1. `ship` was written on
   the assumption that a tier-2 confirm exists and works; the prohibition is what
   remained when it did not.
2. **`ship` was written to STOP, not to ASK.** `awaiting_approval` is defined as
   *"**stop.**"*, and the skill argues — correctly — that the orchestrator must not
   be the one deciding what to build. That settled **who decides**. It also
   silently settled **where the question is asked**: in a terminal the operator
   drives rather than in the session. Nothing in the file argues the second half;
   it arrived attached to the first.
3. **The record carries no evidence of who decided**, so "the operator ran it
   themselves" is the only evidence there is, and it is evidence nobody can read
   afterwards.

---

## 4. The re-measurement

**The cut you asked for**, over the 57 acts the log accounts for:

- **The decision itself: 16** (28%).
- **Movement: 41** (72%) — 6 commands that record a decision, 15 mechanics, 20
  acts of carrying information.

**And the 57 does not contain the thing you are actually paying for.** The source
is a findings queue, not a transcript; a copy-paste round trip produces no finding,
so it is not in there. By your own count — one decision, four transports, of which
three are yours — the 16 decisions cost roughly **48 further operator acts that
appear nowhere in my measurement.**

**That number is your observation extrapolated, not something I measured**, and it
should carry that label wherever it is quoted. With it, the day is ~105 acts and
the movement share goes from 72% to about **85%**.

**What Commander could take, after asking:**

- **~48 of 48** copy-paste acts. They exist only because the command travels
  through a human's clipboard. This needs **no policy change at all** — the guard
  already permits the main session every one of these verbs.
- **6 of 6** decision-recording commands, once the operator has answered (two of
  which are currently blocked by defects, not by authority).
- **9 of 15** mechanics; four are correctly tier-3 (`.env`), two are
  capability-bound.
- **3 of 20** transport acts, by running the app and the probes itself. Four more
  are genuinely outside the machine (a browser viewport, a provider's credit page,
  another project, `.env` contents by policy) and six must **not** be automated —
  they are the operator catching the chain's own inherited reasoning, which is the
  one category that grows as the unattended run gets longer.

**So: roughly 66 of ~105, about 63%** — against the ~26% my first document
reported. The first number answered *how much of the judgement can be automated*.
This one answers *how much of the movement can be*, which is what you asked.

---

## 5. The flow, and the order to build it in

**The rule stays what the guard already implements:** Commander may run anything
whose authority is on disk. What changes is that **the question that puts it on
disk is asked in the session, not in a terminal.**

1. **Fix the confirm value, and assert it against Claude Code's accepted set
   rather than against our own case table.** Until this lands, "ask then run"
   degrades to a generic *run this command?* prompt — which is better than
   copy-paste, and is not the question you want to be answering. Carried-forward
   item 7 already names the trap: `ask` versus `defer` is exactly the
   adjacent-but-wrong distinction, and 4.3 must be corrected in the same change.
2. **Give `--approve-spec` a real approval record** — what was shown, who was
   asked, what they answered, through which channel — replacing the hardcoded
   `by: 'operator'`. This is the change that makes lifting the L3 prohibition an
   increase in evidence rather than a loss of it.
3. **Then lift `ship`'s prohibition for `--approve-spec`, `--waive`, `--block` and
   `--record-corpus`.** Keep it for `--set-phase` (it *is* the decision), for
   `--reseal` (nothing to record until it takes a reason), and for
   `retro.mjs --apply` — which additionally has **no confirm at all** in the main
   session (`risk-guard.mjs:1016-1019` confirms only `--clear`), the most
   consequential verb behind the weakest gate.
4. **Let Commander run the app and the probes**, in the background, and read the
   output itself.
5. **Add an L1 allow rule for the plugin's own mechanical scripts**, so the
   generic prompt stops firing on commands no gate objects to.

**The precondition from the first document still stands and is not softened by
any of this:** none of it before the verdict can express acceptance criteria
(finding 6). A Commander that asks the right questions and runs the right commands
over a verdict that says `pass` on a task with a reproducibly failing criterion
just reaches the wrong end faster, unattended.

---

## What this does not establish

That `deferToUser` is rejected — the repository asserts it in two places and
contradicts itself in a third, and nothing here tested it against a live runtime.
It establishes that **no one has checked**, which is enough to stop relying on it.

That 105 is the day's act count. 57 is measured from a findings queue and 48 is
your observation applied to 16 decisions. Both labels travel with the numbers.

That the ratio holds for another project. Cartoonify is one run, on a product
shape the system was not written for.

---

## 6. Operator ruling, 2026-09-05 — the order, ratified

Recorded here because it is a decision about what gets built, and a decision that
lives only in a transcript is the thing finding 6 and gate6 finding 25 are about.
This section is the operator's, transcribed. It supersedes the ordering in §5
above; §5 is left as written.

**The order.**

1. **Finding 9** — a durable write for the lessons queue, outside the project
   directory. Third consecutive session lost to human memory; the only fix on the
   list that does not depend on the operator doing anything.
2. **Finding 6** — the verdict must carry `criteria[]`, and the verifier needs a
   path to write it. Unmoved and still first among the blocking ones:
   *a chain running unsupervised with a verdict that cannot express a failing
   criterion only reaches the wrong end faster*, and task 0001 is the proof —
   prose-reading is what stopped it.
3. **Carried-forward item 7** — `deferToUser`. **Moved up**, and the reason is the
   reclassification rather than new evidence: *it was queued as a correctness fix
   on a value nothing misread; it is now the missing channel that the whole
   "ask then execute" design rests on.* Eleven tests assert a string Claude Code
   rejects and `NATIVE-CAPABILITIES` 4.3 calls it verified, so the ask-then-execute
   path was designed, believed tested, and never asked anything. **Everything
   `ship` forbids is the residue of that channel not working.**
4. **The Commander work.**

**Three of the seven need no policy change and land WITH the Commander work
rather than waiting on it:** `doctor --sync`, `state.mjs --record-corpus`, and
`npm run dev` started in the background with its output read. **The last alone
deletes the 502 relay, the `route.ts:104` log relay and the 0.58-second probe
relay** — three of the day's worst moments, none of which required a decision from
the operator.

**The four decisions on the closed verbs, ratified with their conditions.**

- **`--set-phase` stays closed.** It is the decision itself, unconditioned, with
  nothing on disk. `--advance-phase` is the Commander's path and is already exempt.
- **`--approve-spec` and `--waive`** get the condition named in §2: the record has
  to carry who was asked and what they answered before the prose ban comes off.
  `state.mjs:565` writing `by: 'operator'` as a constant means the file is
  byte-identical whether the operator typed it or the Commander did — so removing
  the ban without fixing the record trades a weak guarantee for none.
- **`--reseal` stays closed until it takes a reason.** *A command whose answer has
  nowhere to land is not a command anyone can be asked about.*

**And the measurement error is recorded as the operator's, not as a defect in the
count.** The first document answered how much of the load is judgement because
that is what it was asked; the difference between 26% and 63% is that framing, and
it is why §4 carries both numbers rather than replacing one with the other.

# Operator load, measured on one session — and what a Command Center could take

> **CORRECTION, same day, added rather than merged.** Sections 2 and 6 answer
> "how much of the operator's load is judgement". The question was "how much is
> movement around a judgement" — and the copy-paste round trip around each
> decision is exactly what a findings queue does not record, so it is absent from
> the 57. The corrected cut, the per-command authority analysis, and the revised
> figure (~63% addressable, not ~26%) are in
> `docs/commander-authority-2026-09-05.md`. The classification below stands; the
> automation share does not.


Diagnosis of the cartoonify run of 2026-09-05 (plugin 0.1.32, 08:57:15Z–11:47:31Z,
~2h50m). No code proposed here; this is the classification, the count, and the flow
that follows from them.

Source for the operator actions: `docs/lessons/cartoonify-2026-09-05.md`.
Source for command authority: `plugins/mavci-core/scripts/risk-guard.mjs`,
`state.mjs`, `lib/route.mjs`, `retro.mjs`, and the `SKILL.md` frontmatter.

---

## 0. What this measurement is, and what it is not

**The unit** is one discrete operator act — a judgement made, a command run, a
piece of information carried. Deliberations that produced one ruling count once;
a command run twice counts twice.

**The count is a FLOOR, and it is biased in a knowable direction.** The source is
a findings queue, not a transcript. It records the operator acts that produced or
supported a finding, so:

- **Category 2 is undercounted.** A mechanical command that worked leaves no
  finding. Every routine `git status`, `npm run build` and file read that behaved
  is invisible here.
- **Category 4 is proportionally overcounted** for the same reason: carrying
  information by hand is what a defect *forces*, so it appears wherever a finding
  does.

So the percentages below are the shape of the *load a defective run imposes*, not
of an average session. They are still the right input for this question, because
the question is what a Command Center would remove — and a Command Center is
worth building for the bad sessions, not the clean ones. **The honest way to get
the unbiased number is to count from a transcript, or to instrument the commands.
Neither was done. Nothing below should be quoted as "the operator's day".**

**One part of the count is not computable at all.** Twenty of the twenty-one retro
invocations that day carry `Filed by: not recorded. Either the main session, or an
agent that did not declare itself - the queue cannot tell.` The system cannot say
whether those acts were the operator's or an agent's. They are excluded from every
number below. That exclusion is gate6 finding 25, not a cartoonify finding, and it means **the measurement
this document performs cannot be repeated reliably until provenance is stamped.**

---

## 1. The four categories

**K1 — DECISION.** A judgement nobody but the operator may make. Not automatable
by definition; the only question is whether the gate is placed where the operator
can actually evaluate it.

**K2 — MECHANICS.** Running something. No judgement, records nothing. This is the
Command Center's natural territory — but it splits three ways (§3).

**K3 — THE RECORD OF A DECISION.** A command that writes down a decision the
operator has already made. Commander may run it, **but only after the decision
exists**. The command is not the decision; running it without the decision
produces a record of nothing.

**K4 — TRANSPORT.** The operator acting as courier, memory or translator between
parties that cannot see each other. Neither judgement nor mechanics. **Counted
separately because a Command Center cannot touch it**, and mixing it into K2
would make the automation figure look roughly twice as good as it is.

---

## 2. The count

| Category | Acts | Share |
|---|---|---|
| K1 — decision | 16 | 28% |
| K2 — mechanics | 15 | 26% |
| K3 — record of a decision | 6 | 11% |
| K4 — transport | 20 | 35% |
| **Total** | **57** | |

Plus **3 standing memory obligations** that are not acts and have no end date
(§5.4). And **21 retro invocations whose actor the system cannot name**, excluded.

Three acts are dual-natured — a ruling that was also a correction of the record.
Each is counted once, in K4, and named there.

**What a Command Center could take: 15 of 57, about a quarter.** Nine automatable
K2 acts plus the six K3 acts, whose *execution* is mechanical once the decision
exists. The other 42 are the operator's either by authority (K1), by policy or
capability (six of K2, §3), or by nature (K4).

---

## 3. K2 does not automate uniformly — 15 acts, three fates

- **Automatable today: 9.** `state.mjs --init`, three eslint probes, `npm run
  lint`, `git status`, `release-check.mjs`, the 429 discriminating probe, and the
  by-hand check of a guard regex.
- **Correctly blocked by policy: 4.** Everything touching `.env.example` — the
  write attempt, the read probe, the hand-repair, the read-back. `.env*` is tier 3
  by design (`risk-guard.mjs:1064-1069`, `:749-751`). Automating these is not a
  Commander feature, it is a policy change, and the run gives no reason to make it.
- **Capability-bound: 2.** Running criterion 32 with a live key, and testing key
  and connectivity independently. No orchestration fixes these; only granting the
  system a capability it does not have does.

The distinction matters because "13 of 15 were mechanical" would be an accurate
sentence and a misleading one.

---

## 4. K2 vs K3, command by command

**The system already draws this line, in exactly these terms, and it is
machine-readable.** `risk-guard.mjs:926` declares
`WORKFLOW_MOVES = ['--begin-plan', '--advance-phase', '--attempt', '--task-status', '--block']`
and exempts precisely those from the main-session confirm. Everything privileged
that is *not* in that list confirms. The reason is written at `risk-guard.mjs:913-915`:

> `--approve-spec` also confirms, and that is the point rather than an oversight:
> it IS the decision. A command that records an operator's approval without asking
> the operator is not a record of anything.

and at `:898-904`:

> `--advance-phase` is the ORCHESTRATOR'S transition and is exempt from the
> confirm … what it authorises is carrying forward a decision that is already on
> disk — and the orchestrator cannot put it there.

**So a Command Center does not need a new taxonomy. It needs to read that table.**
The rule is: *Commander may run anything whose authority is already on disk, and
nothing else.*

### The commands that ARE a decision, or record one

| Command | Verdict | Evidence |
|---|---|---|
| `state.mjs --approve-spec` | **records the decision** — writes `spec_approved{at, by, spec_path, spec_sha256}` | `state.mjs:564-566`, `risk-guard.mjs:849`, `:913-915` |
| `state.mjs --waive` | **records** a time-boxed exception with a reason | `state.mjs:1405-1424`, `risk-guard.mjs:840` |
| `state.mjs --block --reason` | **records** a human-authored terminal reason; refuses without one | `state.mjs:1350-1354` |
| `state.mjs --baseline-init` | **records** the decision to retire every current violation at once | `risk-guard.mjs:843` |
| `state.mjs --reset-attempts` | **records** an override of the ceiling | `risk-guard.mjs:839` |
| `state.mjs --set-phase` | **IS the decision** — free override, any phase, no precondition, nothing recorded | `risk-guard.mjs:906-911` |
| `retro.mjs --apply` | **IS the decision** — which findings govern every downstream project | `risk-guard.mjs:954` |
| `retro.mjs --clear` | **IS the decision** — an unfixed problem's record is gone | `risk-guard.mjs:955` |
| `check-pretag.mjs --cut` | **IS the decision AND its execution, undivided** | `check-pretag.mjs:19-22` |

### The commands that EXECUTE a decision already on disk

`--advance-phase` (four refusals, all of them ways a flat grant would say yes —
`state.mjs:598-625`), `--restore-spec` (puts back the bytes an approval names —
`state.mjs:510-540`).

### Pure mechanics

`--validate`, `--verify-integrity`, `--show`, `--migrate-manifest`,
`--baseline-prune`, `--new-task`, `--begin-plan`, `--attempt`, `--task-status`;
`doctor.mjs`, `verify.mjs`, `route.mjs`, `worklist.mjs`, `corpus-stage.mjs`,
`corpus-score.mjs`, `release-check.mjs`, `guardian-record.mjs`,
`retro.mjs --record/--amend/--list/--show`, `check-pretag --selftest`.

### Three that sit wrong under this test — named, not fixed

1. **`--reseal` is mechanics whose legitimacy depends on a decision that is
   recorded nowhere.** It is privileged because it *launders any tampering that
   preceded it* (`risk-guard.mjs:841`) and `skills/doctor/SKILL.md:55-56` says it
   is *for a deliberate operator edit, not a way to silence the alarm* — but
   nothing on disk says which edit. Every other privileged verb that needs a
   reason takes one (`--block --reason`, `--waive --reason`). This one does not.
2. **`--record-corpus` is operator-gated and the operator decides nothing.** The
   result is computed; the command refuses `--result`, `--pass` and five other
   ways to supply it (`state.mjs:1431-1443`). Under this test it is K2 wearing
   K3's gate. Commander could run it, and the gate that matters is upstream —
   whether a corpus was staged at all.
3. **`retro.mjs --apply` is the most consequential verb in the plugin and has no
   tier-2 gate in the main session.** The guard confirms `--clear` and not
   `--apply` (`risk-guard.mjs:1016-1019`), while `--apply` is the one that *changes
   how every downstream project is built*. The asymmetry is backwards.

And the one worth acting on first: **`--cut` is the only place in the system where
deciding and executing are the same command.** Everywhere else the split exists
(`--approve-spec` / `--advance-phase`). The release act does not have it.

---

## 5. K4 is not one thing, and this is the finding

Twenty acts, three mechanisms, three different fixes. **A Command Center is the
right answer to none of them.**

### 5.1 K4a — the machine could have recorded it and does not (6 acts + 3 obligations)

Carrying the verifier's prose FAIL verdict into the record; carrying "criteria 20
and 29 inspected-only, 32 skipped" out of a subagent message; carrying the waiver
decision into an ADR because the control plane has no slot for it; carrying the
verifier's own "fixture creation SUCCEEDED, not denied" report; holding a finding
in memory across a refusal until it could be filed; copying the lessons queue by
hand for the **third consecutive session**.

**These are format gaps, not orchestration gaps.** Each already has a filed
finding - 6 (the verdict cannot express acceptance criteria), 5, 9 (`--apply`
cannot reach the system repo from a cache install), and gate6 25 (provenance). Every one is
fixed by giving the system a field, not a coordinator.

The sharpest instance is finding 6's closing sentence: the acceptance criteria are

> checked by a human at the start, checked by an agent in prose in the middle, and
> represented nowhere the system can read.

### 5.2 K4b — the information is outside the machine's reach (8 acts)

Terminal output of a running app pasted in; the six-line live-key run; the
server-side `route.ts:104` log; the 429 probe result; the account's credit state;
`.env.example` content the guard will never let an agent see; being the sole
witness to a repair the agent is forbidden to verify; a defect observed on two
other projects this session cannot open.

**No amount of automation touches these.** The fix is either a capability the
system does not have (a browser, a runner, a key) or an explicit declaration that
the criterion needs one. The second is finding 4's proposed vocabulary — `shell`,
`server`, `browser`, `network`, `live-key`, `write-outside-tree` — and it is the
cheap half.

### 5.3 K4c — the operator is the reasoning check (6 acts)

Relaying a constraint the architect could not derive; making the missing key
salient so criterion 32 got the only precondition in the spec; correcting the JPG
hypothesis; re-attributing the filename conclusion; correcting a recorded claim
with evidence only they had; and the largest — noticing that **round two had
adopted round one's frame from round one's evidence**.

The log's own numbers: `EIGHT CANDIDATES ACROSS TWO ROUNDS, NONE CORRECT`, settled
by a probe that `returned 429 insufficient_quota with the cause named, IN 0.58
SECONDS` and `was available from the first minute`.

**This is the category that GROWS when K2 and K3 are automated.** More autonomous
turns per operator glance means more inherited frames going unchecked for longer.
A Command Center that took the mechanics and changed nothing else would reduce the
load in the two smallest categories and increase it in this one.

### 5.4 The three standing obligations

Remember to remove the criterion-4 waiver when finding 5 is applied (the system
*cannot carry that signal*). Remember who authored twenty unattributed filings.
Remember to copy the queue before the project directory is deleted — *delete the
project directory and the queue goes with it, with no warning*.

None is an act. Each is a permanent claim on a person's attention, and each is
what a control plane exists to abolish.

---

## 6. The diagnosis in one paragraph

Two thirds of the operator's load on this run was not orchestration. It was
sixteen judgements that are the operator's by right, and twenty acts of carrying
information between parts of a system that cannot see each other. The
orchestration share — the mechanics and the recording — is about a quarter, and of
the six recording acts, **exactly one went through its sanctioned command**: two
were refused (`--waive` on an acceptance criterion, `retro --apply` from a cache
install) and three were hand-written substitutes carrying no seal, no attribution
and no enforced expiry. So the honest summary is not "most of it was mechanical".
It is: **the mechanical part is small, the recording channel failed five times out
of six, and the largest category is one no orchestrator addresses.**

---

## 7. The proposed flow

**The rule.** Commander may run anything whose authority is already on disk, and
nothing else. That set is not a new list — it is `WORKFLOW_MOVES` plus the
agent-safe surface, both already declared in `risk-guard.mjs`.

**The chain, per task.** Operator states the request; the router decides; Commander
runs every `dispatch != null` step and every `WORKFLOW_MOVES` transition without
prompting; the chain stops at exactly three human gates — spec approval, waiver or
block, and release. Nothing here changes the gates. It changes what the operator
sees when they arrive at one.

**The precondition, and it is hard.** *Do not build the Command Center before the
verdict can express acceptance criteria (finding 6).* On this run the router
returned `action: "document"` / `why: "task 0001 passed attempt 1."` for a task
whose criterion 4 was reproducibly failing, and the only thing that stopped it
being closed as done was a human reading prose and halting the chain by hand — one
act, K1 #6, in a category of sixteen. Automating the chain over that gap converts
one careful operator act into an unattended wrong close, on a verdict that is
*biased towards pass, on exactly the criteria the operator spent their review on*.

**Build order, by human-memory removed per unit of work.**

1. **A durable write for the lessons queue outside the project directory.**
   Finding 9, fix 3. Nothing else on this list matters if the findings evaporate
   with the project, and this is the only fix that *does not depend on the operator
   doing anything*. Three sessions of evidence.
2. **`criteria[]` in the verdict, and a write path for the verifier.** Finding 6.
   This is what makes the router's `document` action true. It is also the
   precondition above.
3. **Preconditions declared per criterion, printed in aggregate at
   `--approve-spec`.** Finding 4. The one gate the chain stops at is currently a
   gate the operator *structurally cannot evaluate*: they approve what the criteria
   assert, never what the criteria require. Their words: *"I read 32 criteria and
   could not have told you that six of them needed something the verifier cannot
   do."*
4. **Provenance stamped on every filing.** gate6 finding 25 - the queue's own
   `Filed by: not recorded` lines are its symptom here. Without it this
   measurement cannot be taken again.
5. **Split `--cut` into a recorded approval and an execution**, the way
   `--approve-spec` and `--advance-phase` already are. Smallest of the five, and it
   removes the last place where deciding and doing are one command.

**And one thing not to build.** K4c must not be automated away. If Commander
lengthens the unattended run, the counterweight has to be structural: before a
second diagnostic round on the same symptom, name and run the cheapest
discriminating probe. This run has the exact case — 0.58 seconds against two wrong
rounds and eight wrong candidates.

---

## What this document does not establish

It does not establish that 57 is the number of operator acts that day; it is what
a findings queue can account for, and §0 gives the direction of the error. It does
not establish that the K1/K4 split is stable across projects — cartoonify is one
run, on a product shape (`no accounts, no tenants, no database`) the system was not
written for, which is itself findings 1, 5 and 9. And it says nothing about how
much *time* each category cost, because the log records timestamps for filings and
not for work.

# `retro.mjs --amend` — the design, before the build

Against gate6 finding 12, 2026-09-04. Written before any code, because the two
questions below decide what the writer IS, and getting either wrong makes the
whole verb wrong rather than incomplete.

Finding 12 in one line: `retro.mjs` stamps every finding it writes with
`Filed by:`, there is no command that adds to a finding already queued, and so
every addendum is a hand edit that is **typographically identical to
writer-stamped text**. **Eleven** such blocks sit in one queue file — this
document said twelve until the reader could count them, and `--list` now prints
`11 UNSTAMPED` rather than anyone maintaining the number by hand. The queue's own
last hand block calls itself "Eleventh addendum in this queue", which agrees.

---

## 0. Scope, settled before the design starts

**`--amend` corrects TEXT. It does not assert authorship.**

The tempting first use — stamping finding 23 as `main` after the fact, because
it is the one body in the queue that reads `Filed by: not recorded` — is not a
text correction. It is a claim about who wrote something, made afterwards, by
someone who was not necessarily there, on **the one field finding 12 exists to
protect**. Correcting a sentence and asserting who wrote it are different acts
and only the first belongs in this verb.

So finding 23 stays unattributed, with the reason recorded, and `--amend`
**refuses a provenance edit explicitly** rather than merely not offering one.
An absent capability reads as a gap and gets built by the next person; a
refusal with its reason attached is the record of a decision. Section 4.

---

## Q1. Replace, or append a dated block quoting the superseded text?

**Append. Never replace. The tool has no path that edits a filed byte.**

Three arguments, in the order of their weight.

**1. The file already has this rule written in it, one scale down.** `retro.mjs`
normalises dashes on READ and never on write, and says why: *"The queue is prose
a human edits; rewriting their punctuation to suit a parser edits evidence
nobody asked to be edited."* A replaced sentence is that same act with a larger
diff. If a parser may not silently retype one character of a filed finding, a
writer may not silently retype a paragraph of one.

**2. `--apply` copies the queue verbatim into `docs/lessons/`, which is the
permanent record.** A replacement leaves nothing saying the finding was ever
filed at the wrong width — and the queue itself already argues against exactly
that, in finding 18's own addendum: *"a queue entry that reads as though it was
filed at the right width is worse than one that shows where it was wrong."*
That sentence was written by hand, in this queue, about this queue. The verb
should not contradict it.

**3. A finding is a measurement, and an amendment is a later measurement.** The
`Filed:` line stamps a timestamp and a plugin version. Finding 18 was measured
on 0.1.28 and corrected minutes later against a commit from the 0.1.27 run;
finding 22's body is wrong about its own mechanism and its addendum says so with
the evidence. Overwriting the first measurement with the second destroys the
only thing that makes the pair readable — that somebody looked twice.

### What append costs, and what pays for it

The cost is real and must be named: **a reader who reads the body and stops acts
on the uncorrected claim.** The hand convention mitigates it by quoting the
superseded words inside the addendum, so the two sit adjacent — but only if the
addendum is adjacent, and four of the eleven are not (below).

The answer is a **reader-side** fix, not a writer-side one: `--list` reports each
finding's amendment count and how many of them are stamped, so the queue's own
index says a finding has been corrected. Nothing writes into the body to
announce it. That keeps the invariant absolute — no path in this tool edits a
filed byte — and still closes the gap at the moment a reader is choosing what
to read.

### The third question the convention did not settle: WHERE

The hand practice did two different things. Early addenda were written directly
under their finding (findings 2, 8, 11, 12, 16, 18). Later ones were appended at
the file's end, naming their target in the heading — and then further findings
were appended after them, so the addenda to findings 17, 20 and 22 now sit
buried inside the blocks of findings 21 and 22, hundreds of lines from what they
amend.

That is append-at-end decaying exactly as you would expect, and it is what a
hand edit does because it is cheap. The tool has no such excuse.

**An amendment is inserted at the end of its target finding's block** — after
finding N's last line, before the `# Finding N+1` heading (or at EOF for the
last finding). This is not a modification of any block: inserting between two
blocks relocates bytes and rewrites none, and the check asserts both halves
separately, because a tail-appending build passes byte-identity and fails
placement.

### The superseded quote

Optional, because two kinds of amendment exist in the queue and only one has
anything superseded: finding 18's narrows a claim and quotes what it replaced;
finding 8's adds a named instance and supersedes nothing. Requiring a quote from
the second kind would be an instruction addressed to someone who cannot carry it
out — the shape this repository has recorded as finding 16's.

Two consequences:

- **Its absence is stated, not silent.** The block says the amendment adds
  rather than corrects, in words, exactly as `Filed by: not recorded` and the
  missing-assertion placeholder already do. A correction that failed to quote
  what it corrected is then visible as a mislabel instead of being invisible.
- **When present, it must RESOLVE.** The quoted words are verified to occur in
  the target finding before anything is written, and the amendment is refused if
  they do not. This is finding 17's shape — *a citation that does not resolve is
  stored exactly like one that does* — and it is cheap here because both strings
  are in hand. The comparison runs on a normalised COPY (whitespace collapsed,
  the existing dash table applied), never on disk: a quote re-wrapped by a text
  editor is the same quote, and a quote whose em dash was retyped as a hyphen is
  the 0.1.13 defect wearing different clothes.

---

## Q2. Does an amendment carry its own provenance, separate from the finding's?

**Yes. Its own, written at amend time, from the caller at amend time — never
inherited from the finding.**

The queue answers this itself. Finding 18's addendum was written *"by the writer
of the finding"*; the addenda to findings 17, 20 and 22 were written *"at the
operator's direction"*. Findings 6–11 are all stamped `**main** (agent)`. Under
inheritance, every operator-directed correction in this queue would read as
agent-authored — a false attribution on the one field an operator uses to decide
how much scrutiny a finding needs, which is the same argument `record()` already
makes for refusing to write "the main session" when nothing declared itself.

The two stamps answer two different questions. `Filed by:` answers *who observed
this*. `Amended by:` answers *who corrected it*. They are the same person often
enough that inheritance would look right nearly always, which is precisely why
it must not be built: the case it gets wrong is the correction of an agent's
finding by an operator, and that is the case an applier most needs to see.

The amendment also carries its **own timestamp and plugin version**, for the
reason the finding does: finding 18 was filed on 0.1.28 and corrected against
evidence from the 0.1.27 run. One stamp cannot carry two versions.

### What the stamp may say, and the trap next to it

The stamp records **who ran the command**, enforced at `risk-guard.mjs` by
comparing `--agent` against `agent_type` in the hook payload, exactly as
`--record` already is. The guard's provenance arm currently keys on
`flags.includes('--record')` and must include `--amend`, or an agent's
amendment is unattributed by construction and finding 12's own guard against the
cheap fix — *"the assertion must fail an `--amend` whose output carries no
attribution"* — is satisfied only for the operator's calls.

The trap is the field next to it. Eight of the eleven hand blocks open with *"at
the operator's direction"*. That is a claim about **who directed**, written by
the party being directed — self-declaration, which is the exact thing the stamp
exists to replace. A `--directed-by operator` flag would be a self-declared
field wearing a stamp's clothes, and worse than the prose because it would look
enforced.

So: the tool stamps the caller and nothing else. "At the operator's direction"
stays in the amendment prose where it is visibly the author's own sentence, and
the stamp line says in words that it attests to the caller and not to who asked.

---

## 3. The input channel

Finding 12's own addendum records the second-order requirement, and it was
produced by the absence of the verb: finding 16 was filed through `--record`
and **lost four backticked words to shell command substitution on the way in** —
`blocked` twice, `done` and `failed` once each, one of them the exact word the
finding is about. Two of the four gaps left grammatical sentences.

*"An `--amend` that took prose the same way `--record` does would have eaten the
same backticks. The fix is a command that reads its input from a file or stdin
rather than from a shell-expanded argument."*

So `--text` takes a **path, or `-` for stdin. Never inline prose.** An inline
value is refused with a message naming why, rather than accepted as a
convenience — a door prose can come through is a door every caller will use, and
the loss is silent. The same applies to `--was`, more strongly: a superseded
quote is verbatim prose, and the words most likely to be quoted are the ones a
finding is about, which is where the backticks are.

**`--record` is knowingly left with the inline problem. That is a decision, not
an oversight, and it is written here so the next reader finds one.** The
measured loss happened to `--record` and the same door belongs there. Two
reasons it is not in this change:

- **Mixing it in would make a new verb into a redesign of the reporting
  channel.** The verb can be judged on its own; a change to `--record`'s
  argument handling cannot be judged at the same time.
- **`--record` is the trapped-agent path.** Seven messages in this plugin stop
  an agent and point at it, and Gate 4c finding 4 is what happens when they
  point at something unreachable. Making the reporting channel harder to reach
  is the worst outcome available here — so when `--record` does get this door,
  the inline form has to keep working beside it, which is a different design
  from `--amend`'s flat refusal and deserves its own pass.

Until then: **a `--record` call still loses backticked words to the shell, and
nothing warns.** Whoever writes one quotes with care.

---

## 4. The refusal

`--amend` refuses, by name, any flag that would set or change attribution —
`--filed-by`, `--attribute`, `--provenance`, `--stamp`, `--as` — with the reason
in the message: a retroactive stamp is a claim about who wrote the original,
`--amend` corrects text, and the amendment's own stamp records who amended.
Nothing is written.

This exists because of section 0, and because finding 23 is sitting in the queue
right now as the case for it. Someone will come looking for the capability. What
they must find is the refusal and its reasoning, not silence.

---

## 5. CLI

    --amend <n>              the finding to amend
      --title "<short>"      the addendum heading
      --text <path>|-        the amendment prose: a FILE, or '-' for stdin
      [--was <path>|-]       the superseded words, verbatim; verified to occur
      [--file <name>]        which queued file — required when more than one
                             holds a finding <n>, the --clear precedent
      [--agent <name>]       the declared caller; compared at the guard

`--file` is required on ambiguity for the reason `--clear` requires a name: the
queue is a directory, two files can each hold a finding 18, and amending the
wrong one is silent.

Everything written passes the redactor, as `record()` does and for the same
reason: an amendment quoting an error string is a likely place for a key, and
`.mavci/lessons/` is committed.

`--amend` is **not privileged**. It writes to agent-writable surface and is a
correction, not a carry into the system repo. The guard's `RETRO_PRIVILEGED`
table is unchanged; only its provenance arm widens.

---

## 6. What is written

    ### Addendum to finding <n> - <title>

    Amended <ISO>, plugin <v>. Amended by: **<agent>** (agent) - provenance
    enforced at the risk guard, not self-declared. This attests to who RAN the
    command, and to nothing about who directed it.

    <prose>

    **Superseded, quoted verbatim from the body above:** <quote>
    -- or --
    No superseded text quoted: this amendment ADDS to the finding rather than
    correcting it.

The heading word is **Addendum**, which is the queue's own word eleven times
over. Choosing a synonym would recreate the 0.1.13 defect on purpose: a writer
and a reader that agree with each other and not with what a human types.

For the same reason the reader recognises **both hand forms** — `### Addendum
to finding N - …` and the older positional `### Addendum - …`, which belongs to
the finding whose block it sits in — with the explicit target winning over
position when both are present, because that is what the buried tail blocks
need. The reader is one exported function, used by `--list` and by the check;
two readers of one format is the defect that produced 0.1.13.

---

## 7. The assertions, and the broken builds they must catch

Finding 12 names the trap: *"adding `--amend` without the stamp satisfies the
letter and leaves the queue exactly as unreadable"*, and *"the check must
compare blocks WITHIN a queue file for stamp presence, not verify the writer
stamps what it writes."* The adjacent assertion that already exists and does not
catch it is anything asserting `--record` stamps provenance — it does, on every
finding it writes, which is why the gap is invisible.

| # | assertion | the broken build it catches |
|---|---|---|
| A1 | `--amend` exists and appends | today's, where the flag is unknown and the CLI prints usage |
| A2 | the amendment carries its OWN `Amended by:` | the cheap fix finding 12 names by name |
| A3 | every filed byte survives — target body and every other finding | a replace-in-place writer |
| A4 | the block sits inside its target's block | a tail-appender, which passes A3 |
| A5a | a `--was` quote that does not occur is refused, nothing written | a stored citation nobody resolves |
| A5b | a `--was` quote that DOES occur is accepted | a build that refuses every quote, which passes A5a alone |
| A6 | a provenance flag is refused, by name, with the reason | silence, and a build that ignores the flag |
| A7 | inline prose to `--text` is refused, naming why | a shell-expanded argument, which ate four words on 2026-09-04 |
| A8 | the reader counts hand-written unstamped blocks too | a parser that sees only what this writer writes — 0.1.13 exactly |
| A9 | ambiguous `--amend N` across two queued files refuses, naming both | amending the wrong file's finding 18 |

A5a and A5b are a pair for the 0.1.23 rule: a gate that always refuses satisfies
the refusal assertion alone. A3 and A4 are a pair for the same reason in the
other direction.

**What none of it establishes, said here rather than discovered later:** the
test runs the CLI through `execFileSync`, which does not go through a shell, so
it CANNOT reproduce a shell eating backticks. A7 asserts the door is shut, not
that the loss stops — the loss happened upstream of `retro.mjs` and no assertion
inside this repository can observe it.

---

## 8. What the first run of these assertions found, which is the finding to keep

**Three of the eleven passed against a build with no `--amend` in it at all.**

- *"every filed block survives byte for byte"* is true of a file nothing wrote
  to. It could not tell an appending writer from a replacing one from an absent
  one.
- the `--was` and `--text` refusals matched on the words `file`, `path` and
  `stdin` — every one of which is in the **usage banner** that an unknown flag
  prints. Refused by the wrong arm, with the wrong message.

That is 0.1.23's M5 for the sixth time — *decision and reason are two facts and
only the reason discriminates* — and it is the first instance where **the
absence of the feature satisfied the test for it.** The earlier five were
controls testing the half that worked; here there was no half. An assertion in
that state does not merely fail to catch the defect: run before the fix, it
reports the fix as unnecessary.

The repair is the same each time — assert the reason, not the decision, and
give an existence assertion something that only exists once the feature does.

**Three more surfaced in the mutation pass, all by the same instrument:**

- Stripping the time and version out of the stamp and leaving the name behind
  left A2 green. Attribution alone is not the answer to Q2, and a build
  inheriting the finding's `Filed:` line looks right on every same-day
  amendment — which is every amendment except the ones that matter. **A2b.**
- `--list` matched the word *unstamped*, which the per-finding line prints as
  `0 unstamped` for a block this writer had just stamped. A reader blind to the
  hand-written form left it green. **Now matched on the count.**
- Widening `--was` to search the whole block instead of the body left every
  assertion green: the design's claim that a quote of an earlier amendment does
  not count was written down and asserted by nothing. **A5c.** It matters
  because an amendment quotes what it supersedes, so a block-wide search has
  each amendment vouching for the next while the block still says the words come
  from the body above.

And one mutation went green for a reason that was about the mutation: the
inheritance mutation replaced the first `clean(String(agent))` in the file,
which is `record()`'s. A mutation that lands somewhere other than where you
aimed reports the same green as a fix that was unnecessary.

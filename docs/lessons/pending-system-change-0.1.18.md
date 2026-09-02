# Queued for 0.1.18 — apply with `/mavci-core:retro --apply`

Recorded: 2026-09-02, plugin 0.1.17, from reading this repository's own rule
after 55 verdicts in project **gate4c** were observed failing
`state.schema_valid` at once. Nothing was written to gate4c and nothing was
fixed there: **the defect is in this repository's rule, not in that project's
data**, and the data is only what made it visible.

Occurrence: the eighteenth of the wrong-gate shape, and the second one whose
correct implementation was already sitting in the same file, unused. `retro`'s
queue reader (0.1.13) is the first: `doctor` and `retro` each composed the path
they expected instead of enumerating the directory that existed. Here the
manifest already carries a declared version, a `MANIFEST_SCHEMA_VERSION`
constant, a migration and a doctor FAIL that names the migration command — and
the other eleven document types carry none of it, validated by the same eight
lines that ignore what every one of them declares.

**Not built. Filed for a later release**, deliberately: the fix decides how this
system treats every historical control artefact it has already written, and that
is a data-format decision under `ROADMAP`'s locked constraints, not a patch.

---

# Finding 1 — `state.schema_valid` validates every file against the current schema and ignores the version the file declares

`validate()` in `plugins/mavci-core/scripts/state.mjs` sweeps the control plane
through one helper:

    const check = (rel, schemaName) => {
      ...
      for (const e of validate(doc, S[schemaName])) errors.push(`${rel}: ${e}`);
    };

`S[schemaName]` is whatever is on disk in `templates/schemas/` **now**. The
document's own `schema_version` is never read. Every state file in a project is
therefore judged against the rule set of the plugin that happens to be running,
including files written by a plugin that no longer exists on the machine.

`state.schema_valid` is `always: true` and `blocker`. So this is not a cosmetic
mismatch: it stops turns.

## The instance, which is real and was observed

`verdict.schema.json` sets `additionalProperties: false`, and `summary` requires
seven counters. `not_checked` became the seventh in **0.1.15** (`618069b`,
finding 5: *a probe with nothing to probe is not a passing probe*). That change
is correct and should not be reverted.

`schema_version` in the same file was left at `{"const": 1}`.

Every verdict written before 0.1.15 declares `schema_version: 1`, carries six
counters, and is now invalid — against a schema that still says the version it
declares is the current one. gate4c holds **55 of them**. They are not corrupt,
not tampered with, and not wrong; they are a correct record of what a 0.1.11 rule
set said, and the checker now reports 55 blockers on them.

## Why the remedy makes it worse, which is the part that ranks this

`state.schema_valid`'s remedy reads:

> Run `state.mjs --validate` for the full list. If a control file was edited by
> hand on purpose, it needs `state.mjs --reseal`. AUTHORITY: the operator —
> `--reseal` is denied to agents.

Both sentences are wrong here and the second is dangerous. Nothing was edited by
hand; the files are exactly as their writer left them. `--reseal` is in
risk-guard's PRIVILEGED table because *re-sealing launders whatever tampering
preceded it*, and this remedy sends the operator to it for a condition that is
not tampering at all. The one route the message offers is the one route that
destroys the evidence of what actually happened, and it teaches that `--reseal`
is the routine answer to a `state.schema_valid` blocker. That is 0.1.12 item 5
in a different costume: **a control that fires wrongly and often trains everyone
to reach for the override.**

## Why it was missed

`check-schemas.mjs` asserts every schema parses, uses only keywords the bundled
validator implements, compiles its patterns, and that closed enums agree with
`config.mjs`. Every one of those asks *does the schema agree with the code
shipping beside it?* Not one asks *does a file written by an older version of
that code still validate?* — which is the only question a `schema_version` field
exists to answer.

Adjacent, and never the thing. Eighteen times now.

## The two halves, because fixing one is not a fix

**(a) The reader ignores the declared version.** Obvious, and the smaller half.

**(b) The writer changed the shape without changing the version.** This is the
half that makes (a) unfixable on its own: teach `validate()` to dispatch on
`doc.schema_version` today and a pre-0.1.15 verdict still resolves to schema
**1**, which is the current schema, which is the one it fails. A version that
does not move when the shape moves carries no information, and a reader that
honours it faithfully returns the same wrong answer with more machinery.

Eleven of the twelve schemas sit at `const: 1`. `project.schema.json` is at
`2` — bumped in 0.1.15 for the `tenancy.model`/`isolation` split, with
`MANIFEST_SCHEMA_VERSION`, `migrateManifest()`, an operator-gated
`state.mjs --migrate-manifest`, and a doctor FAIL that names it. **The correct
pattern is already in the file.** It was applied to the one document type whose
change someone noticed was breaking, and the same release broke a second one
without noticing.

## The change

Not designed here beyond its constraints, because the retention question below
has to be answered first and it is the operator's.

1. **`validate()` dispatches on the version the file declares**, and a version
   no schema exists for is a finding that NAMES the version — never a silent
   pass, and never a pass by falling back to the newest.
2. **`verdict` goes to 2**, with the v1 shape retained as a schema rather than
   as a comment. `not_checked` stays required at v2.
3. **A schema whose shape changes without its version changing is a build
   failure.** Nothing else prevents (b) from recurring, and it will: this is the
   second document type to change shape and only the first had its version
   bumped. A recorded shape digest per declared version, asserted in
   `check-schemas.mjs`, is the cheapest form — it needs no history and no
   network.
4. **Verdicts are migrated by nothing.** A verdict records which rule set
   produced it; that is backward-looking provenance, and the audit in
   carried-forward item 2 already separates those fields from forward-looking
   ones and says a stale value there is the truth. So the answer for a verdict
   is *accept version 1*, not *rewrite it to version 2*. The same question has
   to be asked separately of each of the other ten types, and the answers will
   differ — `state.json` is forward-looking and should migrate.
5. **The remedy must name what is actually wrong.** A file that is valid at the
   version it declares and invalid at the current one is a different finding
   from a file that fails its own schema, and it must not route through
   `--reseal`.

## The assertion, and the broken build it must catch

**The broken build is today's**, which is why no fixture has to be invented:
point the check at a verdict carrying six summary counters and
`schema_version: 1` and the build under test reports one `state.schema_valid`
blocker per file.

- A control directory holding one verdict at v1 (six counters) and one at v2
  (seven) produces **zero** `state.schema_valid` findings. Against the current
  build this fails, once per v1 file.
- A verdict declaring `schema_version: 3` produces **exactly one** finding, and
  its evidence contains `3`. This separates a real fix from a fallback that
  quietly validates unknown versions against the newest schema and passes —
  which is the shape that would go green against the first assertion alone.
- A verdict that is invalid **at the version it declares** — v1, missing
  `project_id` — still produces a finding. The braces are independent: a
  dispatch that accepts anything old is not a fix, it is the check switched off
  for history, and an assertion that tests only the accept path cannot tell the
  two apart.
- **For half (b):** editing a schema's shape in a fixture without moving its
  version fails `check-schemas.mjs`. The broken build for this one is **0.1.15**,
  which is the change that caused the finding — so it can be run against real
  history rather than against a synthetic edit.

## What this finding does not claim

Nothing here says the 55 verdicts in gate4c should be readable, kept, or acted
on. They are a throwaway project's data and that project can be deleted. The
finding is that this repository's rule cannot tell *"a file written by an older
plugin"* from *"a file someone corrupted"*, reports the second when it means the
first, and sends the reader to the command that erases the difference.

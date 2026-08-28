---
name: connect
description: Onboard an existing repository into the Mavci system. Detects the stack, writes the manifest and risk policy, records current violations as a baseline so the repo stays usable, and generates a remediation backlog. Use once per existing project.
argument-hint: "[project-id]"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash(node *), Bash(git *), Bash(cat *), Bash(ls *), Write, Edit
---

# Connect an existing repository

This is the **normal** onboarding path. Most projects are existing repos with
existing debt, and the system has to be usable in them from the first turn.

## Current repository

- Package manifest: !`cat package.json 2>/dev/null | head -40`
- Next config: !`ls next.config.* 2>/dev/null`
- App routes: !`ls -d app 2>/dev/null && find app -name 'route.ts' -o -name 'page.tsx' 2>/dev/null | head -25`
- Migrations: !`ls supabase/migrations 2>/dev/null | head -15`
- Already connected? !`ls .mavci/project.json 2>/dev/null || echo "no - this is a fresh connect"`
- Git remote: !`git remote -v 2>/dev/null | head -2`

## Steps

**Stop immediately if `.mavci/project.json` already exists.** Re-running connect
on a connected project would try to re-create the baseline, which is refused by
design. Tell the operator to use `/mavci-core:doctor` instead.

### 1. Detect, do not assume

From the context above, work out: framework version, package manager, whether
Supabase/Stripe/Resend are actually used (check `package.json` dependencies, not
guesses), the deploy target, and the tenant column if one is discoverable in the
migrations. Grep for the tenant column rather than assuming `org_id`:
look at what the existing tables actually use.

### 2. Propose the manifest

Build a `.mavci/project.json` matching `templates/schemas/project.schema.json`.
Ask the operator only for what cannot be detected:

- jurisdictions and required legal pages (default `["TR","EU"]`, all five pages)
- entity details for the contact and legal pages — legal name, address, email,
  MERSIS and KEP, recorded as `compliance.entity`; the schema requires all five
- the public site URL (`deploy.site_url`), required by the schema
- the risk tier (`sandbox` / `standard` / `regulated`, default `standard`)
- the Supabase project refs, and **which environments are `protected: true`**

That last one matters most: `protected` is what `risk-guard.mjs` compares against
before hard-blocking a production database write. Getting it wrong is the
difference between a blocked call and a dropped table.

**Show the proposed manifest and get explicit approval before writing it.**

### 3. Write the configuration

1. `.mavci/project.json` — write this first; everything below reads from it.
2. Render the shared config files:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --config
   ```

   That writes `.claude/settings.json`, `.claude/CLAUDE.md` and
   `.github/workflows/mavci-verify.yml` with every `__TOKEN__` substituted.
   `connect` copies the same `project.CLAUDE.md` that `new-project` does, so a
   connected repo used to get a CLAUDE.md titled literally `# __DISPLAY_NAME__`
   — do not hand-copy these files.

   `render.mjs` refuses rather than writing an empty value, naming the manifest
   field to add. `connect` does **not** render the scaffold: an existing repo
   already has an application.
3. **If `.claude/settings.json` already existed**, `--config` overwrote it.
   Restore the operator's own entries by merging: keep every allow rule they
   had, and ensure the marketplace, the enabled plugin and every deny rule from
   the template are present. Diff it against their previous version before
   moving on.
4. `.gitattributes` with `* text=auto eol=lf` if absent.

### 4. Initialise the control plane

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --init
```

### 5. Record the baseline — the step that makes this usable

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --baseline-init
```

Every violation that exists right now is recorded as pre-existing and stops
blocking. This runs **once**, ever. Entries can be removed as they are fixed;
there is no way to add one afterwards, so the debt can only shrink and new work
must be clean.

**If this refuses because of a `critical` finding**, a secret is committed. Do
not work around it. Report exactly which file, tell the operator to remove the
value and rotate the key at the provider, and stop. A committed live key is not
acceptable technical debt, and baselining one would be pretending otherwise.

### 6. Confirm the repo is actually usable

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --ci
```

This must exit 0. If it does not, the baseline did not cover something — report
what, and do not proceed.

### 7. Write the remediation backlog

Group the baseline entries by `check_id`. For each group, create a task:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --new-task "Fix <check_id> (<n> occurrences)"
```

Then write each task's spec to `.mavci/tasks/<id>-<slug>.md` with the affected
file list, why the rule exists (from the matching `standards-*` skill), and the
concrete fix. Order them by severity, then by how many files each affects.

### 8. Report

Tell the operator:

- what was detected and what they confirmed
- the baseline debt count, broken down by check
- the remediation task ids, in the order you recommend
- **the one manual step**: add `MAVCI_TOKEN` (fine-grained PAT, Contents:
  read-only on `mavci-ai-devsystem/mavci-ai-devsystem`) as a repository or
  organisation secret, or CI cannot clone the system to run the checker. Also
  record its expiry as `ci.token_expires` in the manifest — GitHub exposes no API
  for it, so that date is the only thing doctor can warn on
- that they should commit `.mavci/`, `.claude/` and the workflow

Then stop. Do not begin fixing anything: the operator chooses what to tackle
first, and the backlog is now written down.

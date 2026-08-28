---
name: new-project
description: Scaffold a new multi-tenant SaaS project that passes every Mavci standard from the first commit - legal pages, Supabase clients, Stripe webhook, risk policy, control plane and CI. Use for greenfield work only.
argument-hint: "<project-id>"
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(node *), Bash(git *), Bash(ls *), Bash(mkdir *), Bash(cp *)
---

# New Mavci project

Target: `$ARGUMENTS`

Directory state: !`ls -a 2>/dev/null | head -20`
Already connected? !`ls .mavci/project.json 2>/dev/null || echo "no"`

**Stop if `.mavci/project.json` exists.** Use `/mavci-core:doctor` instead.
**Stop if this directory has substantial existing source.** Use `/mavci-core:connect`.

## Steps

### 1. Gather what cannot be inferred

- display name
- jurisdictions (default `["TR","EU"]`) and required pages (default all five)
- entity details: legal name, address, contact email, MERSIS, KEP — these go
  into `compliance.entity` and are rendered into the contact and legal pages
- deploy target, production branch, and the public site URL (`deploy.site_url`,
  e.g. `https://app.example.com`) — it is rendered into `app/robots.ts` and
  `app/sitemap.ts`, which are wrong on every page without it
- risk tier (default `standard`)
- Supabase project refs, and which environments are `protected: true`

### 2. Write the manifest

`.mavci/project.json`, matching `templates/schemas/project.schema.json`. A new
project declares all three standards packs.

### 3. Render the scaffold

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/render.mjs" --scaffold --config
```

This copies `templates/scaffold/` and the shared config files into the project
and substitutes **every** `__TOKEN__` placeholder from the manifest you just
wrote. Do not copy the templates by hand: substitution used to be an instruction
in this file, and nine of the ten tokens were never named, so they shipped
verbatim - `__PROJECT_ID__` into `package.json`, where npm rejects a name
starting with an underscore and `npm ci` fails outright.

`render.mjs` refuses rather than writing an empty value, naming the manifest
field to add. If it exits non-zero, fix the manifest and run it again.

The scaffold already satisfies every check:

- `app/(legal)/{privacy,terms,kvkk,cookies}/page.tsx` and `app/contact/page.tsx`
- `lib/env.ts` — the only place `process.env` is read
- `lib/supabase/{server,client}.ts` — factory functions, never module-scope clients
- `app/api/stripe/webhook/route.ts` — signature verification and `force-dynamic`
- `middleware.ts`, `app/sitemap.ts`, `app/robots.ts`, `next.config.mjs`

The entity details come from `compliance.entity` in the manifest and are
substituted by the command above; there is nothing to edit by hand. The
scaffolded legal text carries a `REVIEW REQUIRED` marker: **say clearly that these are drafts and must
be reviewed by a lawyer before launch.** The checker verifies that the seven KVKK
sections are present; it cannot judge legal sufficiency and does not claim to.

### 4. Configuration

`--config` above already wrote, with every placeholder substituted:

- `.claude/settings.json` from `templates/project.settings.json`
- `.claude/CLAUDE.md` from `templates/project.CLAUDE.md`
- `.github/workflows/mavci-verify.yml` from `templates/mavci-verify.yml`

Still to write by hand: `.gitignore` including `.env*`, and `.gitattributes`
with `* text=auto eol=lf`.

### 5. Control plane

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --init
```

Do **not** run `--baseline-init`. A greenfield project starts with an empty
baseline, so the first violation that ever appears is a real regression.

### 6. Prove it is green

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --ci
```

**Do not finish unless this exits 0.** If the scaffold cannot pass its own
checker, that is a bug in the scaffold: report it and stop rather than editing
the project to paper over it.

### 7. Report

State what was created, that the legal text needs review, and the one manual
step: add `MAVCI_TOKEN` (fine-grained PAT, Contents: read-only on
`mavci-ai-devsystem/mavci-ai-devsystem`) as a **repository** secret so CI can
clone the system repo, and record its expiry as `ci.token_expires`. The owner is
a User account, not an Organization, so there is no org-level secret to set once
for every project - each repo needs its own.

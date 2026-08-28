# Mavci AI Development System — Architecture

**Status:** approved for Phase 1, revision 2 (blockers B1–B5 and fixes 1–5 resolved).
**Target Claude Code version:** 2.1.250 (see `NATIVE-CAPABILITIES.md`)
**Date:** 2026-08-28

**Locked inputs from the operator:**

| Decision | Value |
|---|---|
| System repo host | Private GitHub repository |
| Machines | Windows plus macOS/Linux — all executable logic is Node.js, no bash/jq/PowerShell dependency |
| Billing | Claude Max/Pro subscription — model tiering optimises weekly-limit consumption and latency, not dollars |
| Standards enforcement | Claude Code hooks **and** GitHub Actions, sharing one checker script |
| Real workload | **Six existing repos.** Greenfield is the exception, not the rule — see section 3.3 |

**Locked identifiers (section 12). Decided once; not to be revisited.**

| | |
|---|---|
| System repo | `mavci-ai-devsystem/mavci-ai-devsystem` (private) |
| Marketplace | `mavci` |
| Plugin | `mavci-core` |
| State directory | `.mavci/` |
| CI secret | `MAVCI_TOKEN` |

They live in `plugins/mavci-core/scripts/config.mjs` and are written into every project's committed settings and CI workflow. `check-plugin.mjs` asserts they match the manifests, so a rename cannot happen in one place only.

**Revision 2 changelog:** control-plane split (section 4.2), baseline for existing repos (section 6.5), waivers promoted to Phase 1 (section 6.6), secret redaction (section 4.4), fail-closed gate (section 6.4), scoped gate (section 6.3), four stack-specific checker rules (section 6.2), pinned and authenticated CI (section 6.7), rollback procedure (section 13).

---

## 0. Native vs. custom code — the whole ledger

The hard constraint was: build on native features, and justify every piece of custom code individually. This is the complete list.

### Covered natively — no code

| Capability | Native mechanism |
|---|---|
| Agent definitions and delegation | `agents/*.md` in a plugin. No custom registry, no orchestration framework. |
| Agent-to-agent handoff | The main session delegates; agents return reports. `SendMessage` exists if ever needed. No message bus. |
| Per-agent model tier, tool restriction, turn ceiling | `model`, `tools`, `disallowedTools`, `maxTurns` frontmatter. |
| Slash commands | Plugin `skills/*/SKILL.md`. |
| Operator-only commands | `disable-model-invocation: true` — the mechanism that makes waivers un-grantable by an agent. |
| Knowledge that loads only when relevant | Skills with a good `description`; `.claude/rules/` with `paths:`. |
| Distribution and versioned updates across machines | Plugin marketplace in a private GitHub repo, `extraKnownMarketplaces` + `enabledPlugins` in each project's committed settings. |
| Blocking a dangerous operation | `permissions.deny` plus a `PreToolUse` hook. |
| Blocking writes to the control plane | One `Edit(./.mavci/control/**)` deny rule — verified to cover the `Write` tool too (5.17). |
| Forcing a confirmation | `permissions.ask` plus `PreToolUse` returning `deferToUser`. |
| Making a task actually fail | `Stop` / `SubagentStop` hook returning `continue: true`. |
| Reading live data into a command prompt | Skill dynamic-context backtick-bang syntax. |
| Running a command in isolation | Skill `context: fork` with `agent:`. |
| Research | Built-in `Explore` agent via a forked skill. |
| Rollback of a bad release | `claude plugin marketplace add owner/repo@vX` and `claude --plugin-dir` (6.15, 6.17). |

### Custom code — six pieces, each justified

| # | Artifact | Lines (est.) | Why native cannot do it | What breaks without it |
|---|---|---|---|---|
| C1 | `scripts/verify.mjs` — the standards checker | ~600 | Docs state plainly that CLAUDE.md is context, not enforcement (3.5). Nothing native inspects a Next.js file for a module-scope Supabase client or a missing KVKK page. This *is* the enforcement layer. | Standards become prose. Explicitly ruled out by the brief. |
| C2 | `scripts/risk-guard.mjs` — PreToolUse guard | ~260 | Deny rules cannot express "block this SQL only when the Supabase ref equals the prod ref in `project.json`", cannot scan tool input for secrets, and cannot read `state.json` to enforce a phase gate. Docs also state Bash argument patterns are defeated by option reordering and redirects (5.6). | Tier-3 blocks become bypassable string matches; the control plane and the phase gate are unenforced. |
| C3 | `scripts/build-agents.mjs` — agent generator | ~120 | There is no include or inherit mechanism for agent prompt bodies. The only way to satisfy "never hand-write a prompt per agent again". | Five divergent hand-written prompts. |
| C4 | `scripts/state.mjs` — the control-plane writer | ~380 | The privileged write channel: schema validation, atomic writes, ID allocation, baseline and waiver operations, control hashing, and the redaction pass. | Agents editing the files that govern them (B1); secrets committed to project repos (B5). |
| C5 | `scripts/gate.mjs` — fail-closed hook entrypoint | ~140 | Hook timeouts and crashes are **verified to fail open** (4.17, 4.18). Native behaviour is the opposite of what a gate needs. | A crashed or slow checker silently disables the entire enforcement layer, with no error anywhere. |
| C6 | `scripts/doctor.mjs` — drift, self-test, sync | ~260 | Detects Windows writing ad-hoc allow rules into the committed settings file (5.16), hook-schema drift on Claude Code upgrades, baseline debt, expiring waivers, and local/CI version skew. | Silent decay. |

All six are Node ESM, zero npm dependencies, run under `node script.mjs`, and read and write only plain files. Total under 1800 lines. There is deliberately **no** orchestration framework, **no** message bus, **no** agent registry, and **no** server.

---

## 1. Agent roster

Five agents at `plugins/mavci-core/agents/<name>.md`, generated from `agent-defs/<name>.yaml`.

| Agent | Model | Phase | App code? | Justification for the tier |
|---|---|---|---|---|
| `mavci-architect` | `opus` | plan | No (hook-enforced) | Planning errors are the most expensive class: a wrong data model or tenancy boundary is paid for across the life of the SaaS. Volume is low — once per feature. On a Max subscription this is the cheapest place to spend the best model. |
| `mavci-builder` | `sonnet` | build | **Yes** | Highest-volume agent by an order of magnitude, working against a written spec, preloaded standards, and a verifier that fails the task. Quality is guaranteed by the verification layer, not the tier. Putting the highest-volume agent on Opus exhausts a weekly limit fastest for the least marginal gain. **Escape hatch:** `CLAUDE_CODE_SUBAGENT_MODEL=opus` for a session, or one line in `agent-defs/builder.yaml`. |
| `mavci-verifier` | `sonnet` | verify | No (**natively enforced**) | Deterministic work is done by `verify.mjs` at zero token cost. The agent interprets a failing build and attributes it. Bounded reasoning. |
| `mavci-guardian` | `opus` | verify / release gate | No (**natively enforced**) | Multi-tenant isolation, RLS correctness, Stripe webhook idempotency, KVKK and ToS completeness, ad-policy. A miss here is a data breach, a legal exposure, or a payment bug. Runs once per release. |
| `mavci-scribe` | `haiku` | any | No (hook-enforced) | Changelogs, ADRs, task summaries, SEO copy, lessons. Mechanical, high-volume, low-stakes. The tier that makes the roster affordable. |

### 1.1 How each agent is actually constrained — corrected

The previous revision implied all four non-builder agents were natively constrained. That was wrong. The honest picture:

| Agent | Native constraint | Hook-only constraint | Consequence |
|---|---|---|---|
| `mavci-verifier` | `disallowedTools: Edit, Write, NotebookEdit` — **the tools are absent from its context.** Nothing it can do restores them. | — | Cannot modify anything, including under `disableAllHooks`. |
| `mavci-guardian` | Same. | — | Same. |
| `mavci-architect` | **None.** It has `Edit` and `Write`, because it must write task specs to `.mavci/tasks/`. | Path restriction to `.mavci/tasks/**`, `.mavci/decisions/**` is enforced **only** by `risk-guard.mjs` on `PreToolUse`. | If hooks are disabled, the architect can edit application code. The prompt says not to; nothing stops it. |
| `mavci-scribe` | **None.** Has `Edit`/`Write` for `docs/**`, `README.md`, `.mavci/lessons/**`, and SEO metadata. | Path restriction hook-only, same as architect. | Same exposure. |
| `mavci-builder` | **None** by design — it is the agent that writes code. | Denied `.mavci/control/**`, `.env*`, `.claude/settings.json` by deny rules **and** hook. | The deny rules survive hook loss; the phase gate does not. |

**Stated plainly: the phase gate and the architect/scribe path restrictions are hook-enforced only.** They are defeated by `disableAllHooks`, which is a deliberate operator action, not something an agent can do. The control plane (section 4.2) is the layer that survives hook loss, because it is backed by a permission deny rule, and that is exactly why the governing state was moved there.

### 1.2 Capabilities that deliberately do NOT get an agent

| Capability | Where it lives instead | Why |
|---|---|---|
| SEO | Standards skill `seo-baseline` + checker rules + scribe for copy | A checklist belongs in the checker, not an agent. |
| Documentation | `mavci-scribe` | Not a distinct enough boundary. |
| Release / deploy | `/mavci:release` in the **main session** | Tier-3 by policy. The operator is the approval channel; inventing one would be the bespoke machinery the brief forbids. |
| **Waiving a check** | `/mavci:waive`, `disable-model-invocation: true` | An agent that can waive a check has no constraints at all. Native mechanism, verified (2.4). |
| Market research | `/mavci:research`, `context: fork`, `agent: Explore` | The built-in Explore agent already is this. |
| Security review | `mavci-guardian` + bundled `/security-review` | Near-total overlap. |
| Debugging | `mavci-builder` | Implementation with a different starting point. |
| Migrations | builder writes, checker gates, `/mavci:release` applies | The risk is in *applying* to prod — a risk-tier problem, not an agent problem. |

**Why boundaries are drawn on tool grants, not topic:** only the builder can write `app/**`. Only `state.mjs` can write `.mavci/control/**`. Those two facts are what make sections 4.2 and 8 mechanisms rather than intentions.

---

## 2. Distribution topology — definitive answer

**The system lives in its own private GitHub repo, which is itself a Claude Code plugin marketplace. Project repos consume it as an installed plugin. Nothing is copied per project.**

Rejected: a **git submodule** requires a per-project checkout and manual updates, and submodule contents cannot register agents or hooks without symlinks — machine-local state, forbidden by the environment constraint. **Copy-per-project** makes propagation an O(n) manual edit. An **npm package** cannot register agents, commands, or hooks at all.

### System repo layout

```
mavci-ai-devsystem/                      # private GitHub repo (mavci-ai-devsystem org)
├── .claude-plugin/marketplace.json      # marketplace "mavci"
├── plugins/mavci-core/
│   ├── .claude-plugin/plugin.json       # "mavci-core", version 0.1.0
│   ├── agents/                          # GENERATED — CI rejects hand-edits
│   ├── skills/
│   │   ├── new-project/ connect/ plan/ build/ verify/ doctor/ waive/
│   │   ├── release/ retro/ research/                      # Phase 2
│   │   └── standards-*/                                   # knowledge layer
│   ├── hooks/hooks.json
│   └── scripts/                         # C1–C6
├── agent-defs/                          # SOURCE: _contract.md + one YAML per agent
├── templates/
│   ├── project.settings.json            # canonical risk policy
│   ├── project.CLAUDE.md
│   ├── schemas/*.json
│   ├── scaffold/                        # the compliant Next.js skeleton
│   ├── fixtures/<check_id>/{bad,good}/
│   └── mavci-verify.yml                 # the CI workflow written into each project
├── docs/
└── .github/workflows/{validate,selftest,release}.yml
```

`marketplace.json`:

```json
{
  "name": "mavci",
  "owner": { "name": "Mehmet Avci" },
  "description": "Mavci AI Development System",
  "plugins": [{ "name": "mavci-core", "source": "./plugins/mavci-core" }]
}
```

### What each project repo carries

```
<any-saas-project>/
├── .claude/settings.json      # marketplace registration + enabled plugin + risk policy
├── .claude/CLAUDE.md          # ~30 lines
└── .mavci/                    # manifest + state, section 4
```

`.claude/settings.json` — the propagation mechanism (verified 6.5):

```json
{
  "extraKnownMarketplaces": {
    "mavci": { "source": { "source": "url", "url": "https://github.com/mavci-ai-devsystem/mavci-ai-devsystem.git" } }
  },
  "enabledPlugins": { "mavci-core@mavci": true },
  "permissions": { "...": "risk policy, section 7" }
}
```

The HTTPS `url` form is deliberate. The shorter `{"source":"github","repo":"..."}`
form resolves over SSH and fails on a machine authenticated by HTTPS token
(6.18, observed in Gate 3) — and its failure mode is a plugin that never
installs, so nothing is enforced and nothing says so.

### How a change reaches every project without manual edits

1. Edit the system repo.
2. `node scripts/build-agents.mjs` if an agent changed. CI verifies generated files match.
3. Bump `version` in `plugin.json` **and push a matching git tag `v<version>`**. `release.yml` fails if version and tag disagree — the tag is what CI in every project clones (section 6.7).
4. Push.
5. In any project, any machine: `/plugin marketplace update`, `/plugin update mavci-core@mavci`, then `/mavci:doctor --sync` to record the new version in `state.json.plugin_version` so CI follows.

No project file changes except that one recorded version field, which is the point: local and CI can never silently diverge.

### Three prerequisites per machine, stated honestly

Gate 3 (2026-08-28) turned the first of these from one step into two. Both new
sentences below are observed behaviour, not documentation.

1. **A git credential that resolves WITHOUT A PROMPT, configured before Claude
   Code launches.** The repo is private, so the marketplace is cloned with the
   machine's ordinary git credentials. It is not enough for them to exist:
   Claude Code cannot prompt while resolving `extraKnownMarketplaces`, and fails
   with `unable to get password from user` on a machine where an interactive
   `git clone` of the same repo succeeds (6.19). `gh auth login` alone does not
   always suffice — follow it with `gh auth setup-git`, or set `GH_TOKEN`.
2. **The HTTPS marketplace form.** `{"source":"github","repo":"owner/repo"}`
   resolves over **SSH**, so it silently requires an SSH key that a machine
   authenticated by HTTPS token does not have (6.18). Every project's
   `settings.json` therefore carries
   `{"source":"url","url":"https://github.com/<owner>/<repo>.git"}`. This is not
   a per-machine step — it is a template invariant, listed here because it is
   what makes step 1 sufficient. `doctor` fails the `github` form.
3. **The workspace trust dialog**, accepted once per clone per machine.
   Repository-supplied `extraKnownMarketplaces` are ignored until then
   (verified 6.6).

None of this is project configuration, and none of it recurs. `claude -p` and SDK sessions never get the trust dialog and therefore never load the plugin — **headless Claude is outside the design envelope.** CI does not use Claude; it runs `verify.mjs` with `node`.

**What all three protect.** If any one of them is missing, the marketplace does
not resolve, the plugin does not install, **no hook is registered, and nothing
is enforced** — and the session starts normally and says nothing. That silent
total failure is why `doctor` now proves hook registration from an artefact only
a hook can write, rather than inferring it (section 6.4, `control/hook-run.json`).

---

## 3. Project onboarding protocol

### 3.1 The manifest: `.mavci/project.json`

The single declaration a project makes about itself.

```json
{
  "$schema": "https://raw.githubusercontent.com/mavci-ai-devsystem/mavci-ai-devsystem/main/templates/schemas/project.schema.json",
  "schema_version": 1,
  "project_id": "acme-crm",
  "display_name": "Acme CRM",
  "created": "2026-08-28T09:00:00Z",

  "stack": {
    "framework": "nextjs-14-app-router", "language": "typescript",
    "db": "supabase-postgres", "auth": "supabase-auth",
    "payments": "stripe", "email": "resend", "ai": "anthropic",
    "package_manager": "npm"
  },

  "tenancy": { "model": "shared-schema-rls", "tenant_column": "org_id" },

  "deploy": { "target": "vercel", "prod_branch": "main", "preview_branch_pattern": "feat/*" },

  "environments": {
    "prod":    { "supabase_ref": "abcdefghij", "vercel_project": "acme-crm",     "protected": true },
    "staging": { "supabase_ref": "klmnopqrst", "vercel_project": "acme-crm-stg", "protected": false },
    "local":   { "supabase_ref": "local", "protected": false }
  },

  "env_sources": {
    "runtime": "vercel-project-env",
    "local_file": ".env.local",
    "required_keys": [
      "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY", "ANTHROPIC_API_KEY"
    ],
    "never_read_by_agents": true
  },

  "risk_tier": "standard",

  "compliance": {
    "jurisdictions": ["TR", "EU"],
    "required_pages": ["privacy", "terms", "kvkk", "cookies", "contact"],
    "locales": ["tr", "en"],
    "entity": { "legal_name": "", "address": "", "email": "", "mersis": "", "kep": "" },
    "ads": { "networks": ["google-adsense"], "policy_check": true }
  },

  "agents": {
    "enabled": ["mavci-architect", "mavci-builder", "mavci-verifier", "mavci-guardian", "mavci-scribe"],
    "overrides": { "mavci-builder": { "model": "sonnet" } }
  },

  "standards": { "packs": ["nextjs-app-router", "supabase-multitenant-rls", "legal-tr-kvkk"] },

  "checks": { "exclude_paths": ["**/node_modules/**", "**/.next/**"] }
}
```

**Changed in revision 2:** `standards.waivers` is gone. Waivers now live in `.mavci/control/waivers.json`, because a waiver is an escape hatch from enforcement and therefore belongs in the control plane (B1, B3). `env_sources.never_read_by_agents` is no longer a decorative declaration — `redact.mjs` reads `required_keys` and uses it to build the redaction value set (B5, section 4.4).

`risk_tier` is `sandbox`, `standard`, or `regulated`, selecting which rows of section 7 apply.

### 3.2 `/mavci:new-project <name>` — greenfield

1. Ask only what is not derivable: display name, jurisdictions, deploy target, risk tier, entity details.
2. Write and validate `.mavci/project.json`.
3. Copy `templates/scaffold/` — a Next.js skeleton that already passes every check: `app/(legal)/{privacy,terms,kvkk,cookies}/page.tsx` with real TR/EN content, `app/contact/page.tsx`, `lib/env.ts` (the only place `process.env` is read), `lib/supabase/{server,client}.ts` with factory functions, `app/api/stripe/webhook/route.ts` with signature verification and idempotency, `middleware.ts`, `sitemap.ts`, `robots.ts`.
4. Write `.claude/settings.json` from `templates/project.settings.json`, substituting protected environment refs into the risk rules.
5. Write `.claude/CLAUDE.md`, `.github/workflows/mavci-verify.yml`, and `.gitattributes` (LF, UTF-8).
6. `state.mjs --init` writes the control plane: `state.json` (phase `plan`), an **empty** `baseline.json`, an empty `waivers.json`.
7. Run `gate.mjs` and refuse to finish unless it exits 0.

A greenfield project has an empty baseline. It is green from commit one, and every future violation is a real regression.

### 3.3 `/mavci:connect` — existing repo (the normal case)

All six real projects are existing repos. This is the primary path, not the exception.

1. **Detect, do not assume.** Read `package.json`, `next.config.*`, `supabase/migrations/`, existing `app/` routes and `app/api/**`; infer stack, tenancy column, deploy target, and required pages already present.
2. Propose a `project.json`, show it, get approval, write it.
3. Write `.claude/settings.json`, `CLAUDE.md`, the CI workflow.
4. **`state.mjs --baseline-init`** — run the full checker and record **every** current violation into `.mavci/control/baseline.json`. This is the one moment baseline entries may be created.
5. Write `state.json` with phase `plan` and `baseline_debt: <count>`.
6. Generate a remediation backlog: one task spec per baselined `check_id` group, in `.mavci/tasks/`, ordered by severity. The debt is now visible, scheduled work rather than a wall.
7. Run `gate.mjs` and confirm it exits **0** — because every violation is baselined.

**The contradiction B2 identified is resolved by the baseline. Detail in section 6.5.**

### 3.4 Why the sixth SaaS costs nothing

The system holds no list of projects and has no per-project configuration. Every project describes itself; the plugin reads whichever manifest is in the working directory. Onboarding is: git credentials (once per machine), one command, one trust dialog. Nothing in the system repo is touched.

---

## 4. State model

**Principles:** plain files, in the project repo, git-diffable, machine-readable, no server. One file per entity. Prose in `.md`, structured facts in `.json`. Nothing is appended to a file that must be parsed.

### 4.1 Layout — two surfaces

```
<project>/.mavci/
│
│   ── AGENT-WRITABLE SURFACE ──────────────────────────────────
├── tasks/
│   ├── 0007-billing-portal.md      # the spec (architect writes)
│   └── 0007.json                   # descriptive only: title, spec path, artifacts[], notes[]
├── decisions/0003-tenant-isolation.md
├── lessons/2026-08-28-stripe-idempotency.md
│
│   ── OPERATOR SURFACE (tier 2: agents denied, operator confirms) ──
├── project.json
│
│   ── CONTROL PLANE (deny Edit for everyone; only state.mjs writes) ──
└── control/
    ├── state.json                  # phase, active_task, next_task_id, attempts ledger
    ├── tasks/0007.json             # status, phase, attempts, max_attempts, owner_agent, blocked_by
    ├── verdicts/0007-attempt-02.json
    ├── baseline.json               # pre-existing violations, section 6.5
    ├── waivers.json                # time-boxed exceptions, section 6.6
    └── integrity.json              # control_hash + last-gate heartbeat, sections 4.3 and 6.4
```

**The split (B1).** A stuck agent's cheapest move used to be editing the file that governs it. Now every governing value — phase, attempts, ceiling, verdicts, baseline, waivers — is on the far side of a permission deny rule. What remains agent-writable is exactly the material an agent legitimately produces: specs, artifact lists, notes, ADRs, lessons.

Task state is split across two files on purpose. `tasks/0007.json` is descriptive and agent-writable. `control/tasks/0007.json` is authoritative:

```json
{
  "schema_version": 1, "id": "0007", "project_id": "acme-crm",
  "phase": "build", "status": "in_progress",
  "attempts": 1, "max_attempts": 3,
  "owner_agent": "mavci-builder", "blocked_by": null,
  "verdicts": ["verdicts/0007-attempt-01.json"],
  "created": "2026-08-28T13:01:00Z", "updated": "2026-08-28T14:22:10Z"
}
```

When the two disagree about anything (title, artifact list), the control copy wins and `doctor` reports the divergence.

### 4.2 The privileged write channel

`state.mjs` writes the control plane. Agents cannot, because of one deny rule:

```json
{ "permissions": { "deny": ["Edit(./.mavci/control/**)"] } }
```

One rule suffices: an `Edit` deny is verified to cover the `Write` tool as well (5.17). A `Read` deny is deliberately **not** used — agents must read their own phase and attempt count.

`state.mjs` can write there because it is a Node subprocess, and subprocess writes are verified **not** to be covered by Read/Edit rules (5.18). Elsewhere in this document that gap is listed as a weakness; here it is used deliberately as the sanctioned channel.

**The residual risk, stated:** an agent could write its own Node script that mutates `control/`. Three mitigations, in order of strength:

1. **Integrity hash.** `state.mjs` writes `control/integrity.json` containing a SHA-256 over the canonical serialisation of every control file. `gate.mjs` recomputes it on every gate and **fails closed** if it does not match, with the reason "control plane modified outside state.mjs". Out-of-band mutation is detected regardless of the channel used — this is the mitigation that does not depend on guessing the attack.
2. **`risk-guard.mjs`** denies any `Bash` command whose text references `.mavci/control` unless the invoked script path is under `${CLAUDE_PLUGIN_ROOT}/scripts/`.
3. **Git.** Control-plane files are committed. Any unexplained change appears in `git diff` before it reaches a commit.

### 4.3 Lifecycle

`project.json` written once at onboarding; edited by the operator through a tier-2 confirm. `state.json` rewritten atomically (temp file + rename) on every phase transition. Control task files updated at each transition. **Verdicts are write-once and never deleted** — they are the audit trail. `baseline.json` entries can be removed, never added after `--baseline-init` (section 6.5). `waivers.json` entries expire. ADRs and lessons are new files, append-only.

Nothing is pruned automatically. `git mv` old verdicts to `.mavci/archive/` if the directory becomes noisy; no tooling depends on that.

**Concurrency:** atomic rename plus the integrity hash. Two simultaneous Claude sessions in one repo are unsupported; `doctor` reports if `state.json.updated` moved unexpectedly. A lock server would be exactly the bespoke infrastructure the brief forbids.

### 4.4 Secret redaction (B5)

`env_sources.never_read_by_agents` was a declaration no code read. It now drives a redaction pass that runs inside `state.mjs` **before any write to `.mavci/`**, and again as a `PostToolUse` sweep over agent-written files.

**Value sources — the exact set redacted:**

1. **Known prefixes**, matched with a following token of 12 or more characters: `sk_live_`, `sk_test_`, `rk_live_`, `whsec_`, `re_`, `sbp_`, `SG.`, `ghp_`, `github_pat_`, `AKIA`.
2. **JWT-shaped strings**: `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` — this is what a Supabase anon or service-role key looks like.
3. **Live values of every key named in `env_sources.required_keys`.** `redact.mjs` reads `process.env` and, as a subprocess unaffected by the `Read(./.env*)` deny (5.18), reads `.env.local` **solely to build an in-memory value set**. Values shorter than 8 characters are ignored, so `true` and `3000` are not redacted. This is the single sanctioned read of the env file in the entire system; the script has no output path other than the redacted text, never logs, and never writes a value anywhere.
4. **High-entropy tokens**: `[A-Za-z0-9_\-]{40,}` with Shannon entropy above 3.5 bits per character. Catches keys whose format is not yet known.

**Replacement:** `[REDACTED:SUPABASE_SERVICE_ROLE_KEY]` when the value maps to a named key, `[REDACTED:prefix:whsec_]` for a prefix match, `[REDACTED:entropy]` otherwise. The key *name* survives so evidence stays diagnostically useful; the value never does.

**Three enforcement points:**

| Point | Mechanism | Catches |
|---|---|---|
| Before every control-plane write | `state.mjs` calls `redact()` on every string field | Verdict `evidence`, agent report fields, task notes |
| `PreToolUse` on `Edit\|Write` with `if: Edit(./.mavci/**)` | `risk-guard.mjs` scans `tool_input.content` / `new_string` and **denies** with a reason | An agent about to paste a key into a task file — prevention, before it touches disk |
| `PostToolUse` sweep on the same matcher | `redact.mjs` rewrites the file in place and returns a `systemMessage` | Anything written through a channel the PreToolUse scan did not see |

**Plus a checker rule.** `secrets.no_committed_secrets` scans the working tree for the same patterns, at severity `critical`. Critical checks **cannot be baselined and cannot be waived** — a committed live key is never acceptable technical debt. This is the only check class with no escape hatch, and that is deliberate.

---

## 5. The agent contract

Claude Code has no include or inherit mechanism for agent prompt bodies (NATIVE-CAPABILITIES section 8). `agents/*.md` are therefore **generated artifacts**, committed. Source of truth is one contract template plus a small YAML per agent.

```yaml
# agent-defs/architect.yaml
name: mavci-architect
model: opus
color: purple
phase: plan
description: >
  Plans work for a Mavci SaaS project. Reads the project manifest and produces a
  task spec with acceptance criteria. Never writes application code.
tools: [Read, Grep, Glob, Bash, WebFetch, Write, Edit]
disallowedTools: []
edit_scope:
  allow: [".mavci/tasks/**", ".mavci/decisions/**"]
  deny:  ["app/**", "lib/**", "supabase/**", ".env*", ".claude/**", ".mavci/control/**", ".mavci/project.json"]
native_constraint: false      # documented in the generated header, see section 1.1
max_turns: 30
standards_packs: [nextjs-app-router, supabase-multitenant-rls]
role: |
  You turn a feature request into an implementable spec...
outputs: [".mavci/tasks/<id>.md", ".mavci/tasks/<id>.json"]
escalate_when:
  - The request implies a schema change that breaks tenant isolation
  - The request requires a third-party service not in the manifest
  - Acceptance criteria cannot be made objectively checkable
```

`node scripts/build-agents.mjs` renders each definition through
`agent-defs/_contract.md`. CI fails if generated files differ from a fresh
render, so hand-edits cannot survive.

**The `_note` convention.** JSON has no comments, and a definition that records
only *what* was decided loses the reason the moment the person who decided it
moves on — which for a system meant to outlive six projects is the whole problem.
Any key beginning with `_` is documentation: `_note` at the top level carries the
decision behind the agent, `_note_<field>` sits beside any individual value that
would otherwise look arbitrary. The generator strips them, so they never reach
the rendered prompt and cost no tokens. `builder.json` carries the reasoning for
Sonnet-over-Opus; `verifier.json` records why `disallowedTools` is the only
natively enforced boundary in the roster.

### The contract — every agent's body, in this order

1. **Identity and boundary**, including a generated line stating whether the boundary is natively enforced or hook-only (section 1.1). An agent is told the truth about its own constraints.
2. **Startup protocol.** Read `.mavci/project.json` and `.mavci/control/state.json`; refuse to act if `state.phase` does not match the agent's phase; load standards packs named in `standards_packs` intersected with `project.json.standards.packs`.
3. **Inputs contract.** Files it may assume exist, and what to do when one is missing — fail with `blocked_by`, never invent.
4. **Outputs contract.** Files it must write, plus this required final message as a single fenced JSON block:

```json
{
  "agent": "mavci-builder", "task_id": "0007",
  "status": "done | failed | blocked | escalated",
  "attempt": 2,
  "artifacts": ["app/(app)/billing/page.tsx"],
  "checks_run": ["gate.mjs"],
  "failures": [
    { "check_id": "next.route_force_dynamic",
      "evidence": "app/api/portal/route.ts:1 — no `export const dynamic` found",
      "attempted_fix": "added export const dynamic = 'force-dynamic'",
      "result": "passing" }
  ],
  "blocked_by": null,
  "suggested_next": "Architect must decide whether billing_events is tenant-scoped",
  "escalate": false
}
```

5. **Failure report format.** Never report success on a failing check. Never widen scope to fix an unrelated failure — record it as `suggested_next`. Every `failures[]` entry needs a file path, not a description. **Never paste a secret value into `evidence`; name the key instead** — and know that `state.mjs` will redact it regardless (section 4.4).
6. **Escalation rules.** Return `escalate: true` on any `escalate_when` item, on the second consecutive identical failure, or when a fix requires touching an `edit_scope.deny` path.
7. **Approval triggers.** The tier-3 table (section 7) verbatim, plus: *you cannot grant yourself a waiver; `/mavci:waive` is operator-only. If you believe a check is a false positive, return `escalate: true` with the check ID and the evidence, and stop.*
8. **Retry discipline.** Read `attempts` from `control/tasks/<id>.json`. If `attempts >= max_attempts`, do not retry — set `status: "blocked"` and stop. **You cannot edit that file.**

Sections 2–8 are identical across all agents and come from the template. Only section 1 and `role` are per-agent. A new agent is about 25 lines of YAML.

---

## 6. Standards enforcement — three layers

### 6.1 Layer 1 — Knowledge

Plugin skills at `skills/standards-<pack>/SKILL.md`: `nextjs-app-router`, `supabase-multitenant-rls`, `stripe-billing`, `resend-email`, `anthropic-usage`, `seo-baseline`, `legal-tr-kvkk`, `ad-policy`.

Each states the rule, the reason, the correct pattern, the wrong pattern, and **the `check_id` in `verify.mjs` that enforces it**. Cross-referenced by ID in both directions, so a rule nothing checks is visibly toothless.

Delivery: agent frontmatter declares `skills: <packs>` to preload (1.11). **Because plugin-namespaced names in `skills:` are unverified, the generated contract also instructs the agent to invoke the pack skills explicitly as its first action.** If preloading works it is a latency win; if not, nothing breaks. Standards skills must not set `disable-model-invocation: true`, which would block preloading (2.4).

A ~30-line project `CLAUDE.md` states only always-true facts and points at the mechanism. It does not restate standards — which is what the docs say CLAUDE.md is bad at (3.5).

### 6.2 Layer 2 — the checker

`verify.mjs` reads `project.json`, selects rules by declared packs, walks the repo, and emits a verdict.

**Phase 1 rule set — 12 rules.** Changed from revision 1 per fix 3: the four stack-specific rules are added, `supabase.rls_policy_per_table` moves to Phase 2 (it needs real SQL parsing, not regex), and `secrets.no_committed_secrets` is added at critical severity.

| check_id | Severity | What it fails on | Technique |
|---|---|---|---|
| `secrets.no_committed_secrets` | **critical** | Any secret pattern from section 4.4 in the working tree | pattern + entropy |
| `next.supabase_client_in_function` | blocker | `createClient` / `createServerClient` / `createBrowserClient` called at **module scope** in `app/`, `lib/`, `components/` | AST-free brace-depth scan: a call at depth 0 outside any function body |
| `next.route_force_dynamic` | blocker | Any `app/api/**/route.ts` without `export const dynamic = 'force-dynamic'` | per-file regex |
| `next.no_static_export` | blocker | `next.config.{js,mjs,ts}` containing `output: 'export'` | regex |
| `next.regex_no_template_literal` | blocker | `new RegExp(` with a template literal argument, or a regex assembled by template concatenation | regex |
| `next.no_service_role_client` | blocker | `SUPABASE_SERVICE_ROLE_KEY` referenced outside `lib/supabase/server*` or an API route | path + regex |
| `next.env_centralised` | blocker | `process.env` read outside `lib/env.ts` | path + regex |
| `stripe.webhook_signature` | blocker | Stripe webhook route not calling `constructEvent` | regex |
| `supabase.rls_enabled` | blocker | A migration with `CREATE TABLE` and no matching `ENABLE ROW LEVEL SECURITY` | regex per statement |
| `legal.pages_present` | blocker | Any page in `compliance.required_pages` missing, under 400 characters, or containing placeholder markers | file + length + marker |
| `legal.kvkk_structure` | blocker | KVKK page missing any of 7 required headings: data controller, purposes, legal basis, transfers, retention, subject rights, contact | heading regex |
| `state.schema_valid` | blocker | Any `.mavci/**/*.json` failing its schema, or `integrity.json` mismatch | schema |

**`legal.kvkk_structure` is a structural check and is named so.** It verifies that the seven required disclosure sections exist. It cannot and does not verify legal sufficiency — that needs a lawyer, and the check description says exactly that so nobody mistakes a green tick for legal advice.

Deferred to Phase 2: `supabase.rls_policy_per_table`, `supabase.tenant_column`, `next.route_auth`, `stripe.webhook_idempotency`, `seo.metadata_export`, `seo.sitemap_robots`, `legal.contact_reachable`, `legal.cookie_consent`, `ads.policy`.

**Severity ladder:** `critical` (cannot be baselined or waived) > `blocker` (blocks the turn; baselinable and waivable) > `warning` (recorded, never blocks) > `info`.

### 6.3 Layer 2 — when the gate fires (fix 2)

Revision 1 ran a 180-second full checker on every turn in every project, including turns where the operator asked a question. Corrected:

`gate.mjs` runs on `Stop` and `SubagentStop` and **exits 0 in about 50 ms unless one of two conditions holds**:

1. `control/state.json.phase == "build"`, **or**
2. the turn actually wrote files.

Condition 2 is tracked by a `PostToolUse` hook on `Edit|Write` that touches a marker file keyed on `session_id` + `prompt_id` in the OS temp directory — not in the repo, so it never pollutes a diff. `gate.mjs` reads the marker, then deletes it.

When it does run, it scans **changed files plus their dependents**, not the whole tree. A full scan happens only at `/mavci:verify` and in CI.

Practical effect: a question turn costs nothing. A one-file edit costs a few hundred milliseconds. A build-phase turn costs a scoped scan.

### 6.4 Layer 2 — failing closed (fix 1)

**The native default is fail-open, and this is verified: a hook that times out is "canceled, output discarded, no decision rendered" (4.17), and a hook that crashes is "non-blocking... action proceeds" (4.18).** A crashed checker silently disables the entire enforcement layer with no error anywhere. That is unacceptable for the layer whose whole job is to fail the task.

`gate.mjs` is a thin fail-closed wrapper, and every failure mode is handled explicitly:

| Failure | Detection | Result |
|---|---|---|
| `verify.mjs` throws | try/catch around the whole run | exit 2, `stopReason`: "standards checker crashed: `<message>`. Enforcement did not run. Run /mavci:doctor." |
| `verify.mjs` exceeds budget | internal 120 s budget, under the hook's 150 s `timeout` | exit 2, "checker exceeded its 120 s budget. Enforcement did not run." |
| Malformed or missing `project.json` / schema | validation before scanning | exit 2, naming the file |
| `integrity.json` mismatch | hash recompute (section 4.2) | exit 2, "control plane modified outside state.mjs" |
| Checker rule itself throws | per-rule try/catch | that rule records `status: "error"`, and **an errored rule counts as a blocker** |
| **Hook cancelled by timeout** | **Cannot be handled from inside.** See below. | Detected next turn by the completion sentinel |
| **Hook never runs at all** — node missing, hook unregistered, `disableAllHooks` | heartbeat: every gate run stamps `control/integrity.json.last_gate` with the `prompt_id` | reported by `risk-guard.mjs` on the next turn |

**The timeout asymmetry, stated plainly.** A crash can be made fail-closed: the
wrapper catches it and exits 2. **A timeout cannot.** When Claude Code cancels a
hook, output is discarded and no decision is rendered (4.17); no further code in
that process runs, so there is no code that could block. The gate passes
silently. Nothing inside a hook can fix this.

Two things follow, and both are deliberate:

1. **The timeout is 30 seconds, not 150.** A long timeout is the worst of both
   worlds — too long to sit through, and long enough that a hang reads as
   ordinary slowness rather than a fault. At 30s a hang is obvious. The internal
   budget is 25s so the normal path always returns a decision first.
2. **It is detected afterwards.** `gate.mjs` writes `control/gate-run.json`
   before it starts any work and marks it complete on every exit path. A
   cancelled gate leaves that record open, and the next turn's `PreToolUse` hook
   reports it: *"the standards gate started 45s ago on the previous turn and
   never finished — that turn was NOT verified, and the pass you saw was silence
   rather than a result."* Detection, not prevention, but never silent.

`gate-run.json` lives inside `control/`, so an agent cannot forge a completed
run, and is excluded from the integrity hash because it changes every turn.
`check-gate.mjs` asserts the open-sentinel case end to end.

The heartbeat is the important one: it is the only mechanism that detects a hook which is not running, and it uses a *different* hook event to do it, so a single point of failure does not take both down. If both hooks are dead, CI is the remaining backstop (6.7) — which is precisely why enforcement was required in two places.

Timeouts are set explicitly (`150`), never left at the 600-second default that would hide a hung checker for ten minutes (4.19). The advisory `PostToolUse` hook keeps `async: true`; **no gate ever does** (4.20).

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "timeout": 20,
                    "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/risk-guard.mjs"] }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "async": true, "timeout": 60,
            "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs", "--changed", "--advisory"],
            "statusMessage": "mavci: checking standards" },
          { "type": "command", "async": false, "timeout": 20,
            "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/redact.mjs", "--sweep"],
            "if": "Edit(./.mavci/**)" }
        ] }
    ],
    "Stop":         [ { "hooks": [{ "type": "command", "timeout": 150,
                        "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs"] }] } ],
    "SubagentStop": [ { "hooks": [{ "type": "command", "timeout": 150,
                        "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs"] }] } ],
    "SessionStart": [ { "hooks": [{ "type": "command", "timeout": 20,
                        "command": ["node", "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs", "--preflight"] }] } ]
  }
}
```

On a blocking verdict, `gate.mjs` prints:

```json
{ "hookSpecificOutput": { "hookEventName": "Stop", "continue": true,
  "stopReason": "mavci: 1 blocking violation. next.route_force_dynamic at app/api/portal/route.ts:1 — no `export const dynamic` found. Not baselined, not waived. Fix it, then stop again." } }
```

`continue: true` on a `Stop` hook is verified (4.5): the agent cannot end its turn, and it is handed the check ID, the file, and the line.

**Loop safety.** A counter keyed on `prompt_id` lives in `control/integrity.json` — moved out of the OS temp directory in revision 2, since it is control-plane state and needs to survive a session restart. On the third consecutive gate for one prompt, `gate.mjs` stops returning `continue: true`, returns a plain `systemMessage`, lets the turn end, and marks the task `blocked`. A gate that cannot be satisfied must reach the operator, not spin.

### 6.5 Baseline — making the gate usable on existing repos (B2)

The gate as designed would block **every turn** in a connected repo from the moment of connection, because an existing project has pre-existing violations. All six real projects are existing repos, so this is the normal case, not an edge case.

**`.mavci/control/baseline.json`:**

```json
{
  "schema_version": 1, "project_id": "acme-crm",
  "created": "2026-08-28T10:00:00Z",
  "created_by_plugin_version": "0.1.0",
  "entries": [
    { "check_id": "next.route_force_dynamic", "path": "app/api/legacy/route.ts",
      "first_seen": "2026-08-28T10:00:00Z", "note": "pre-existing at connect" }
  ]
}
```

**Semantics:**

- `gate.mjs` blocks only on violations **not matched by a baseline entry**. Matching is on `(check_id, path)`.
- A baselined violation is recorded in the verdict as `status: "baselined"` — visible, counted, never blocking.
- **Entries can be removed. Entries can never be added after connect.** `state.mjs` exposes exactly two baseline operations: `--baseline-init`, which refuses to run if `baseline.json` already exists, and `--baseline-prune`, which re-runs the checks and removes entries that now pass. **There is no add operation**, so debt can only shrink.
- **Matching is by path, not by content fingerprint.** Deliberate: a fingerprint would re-block a file the moment an agent touched it for an unrelated reason, which is a surprise block and the fastest way to make the operator reach for `disableAllHooks`. The trade is that a baselined file can be edited without fixing its baselined violation — accepted, because the debt stays visible in every verdict and in `doctor`.
- **A new file is never baselined.** Entries are path-scoped and created only at connect, so new work must be clean. This is the property that matters: the ratchet only turns one way.
- **`critical` findings are never baselined.** `--baseline-init` refuses to record them and fails the connect with instructions. A repo with a committed live key must be fixed before it is connected, not after.

**Visibility, so debt does not become invisible:** every verdict carries `summary.baselined`; `/mavci:verify` prints "N baselined violations remaining"; `/mavci:doctor` reports the count and its trend since connect; `/mavci:connect` writes one remediation task per `check_id` group.

`--baseline-prune` runs automatically at the end of every successful `/mavci:verify`, so fixing a violation as a side effect of other work retires its baseline entry without anyone remembering to.

### 6.6 Waivers — Phase 1, not Phase 2 (B3)

Twelve blocking checks written as regex rather than AST **will** produce a false positive. Without a waiver the only recourse is `disableAllHooks`, which kills enforcement permanently and globally. That failure mode is worse than any false positive, so the escape hatch ships in Phase 1.

**`.mavci/control/waivers.json`:**

```json
{
  "schema_version": 1, "project_id": "acme-crm",
  "waivers": [
    { "check_id": "next.route_force_dynamic", "path": "app/api/health/route.ts",
      "reason": "Static health probe must be edge-cached; force-dynamic defeats the probe.",
      "approved_by": "operator", "approved": "2026-08-28", "expires": "2026-11-26",
      "created_by_plugin_version": "0.1.0" }
  ]
}
```

**Controls, each with a mechanism:**

| Control | Mechanism |
|---|---|
| An agent cannot grant itself a waiver | `/mavci:waive` sets `disable-model-invocation: true` (verified 2.4). Only a human typing the command can reach it. An agent that believes a check is wrong must `escalate` (contract section 7). |
| A waiver is a deliberate act | The command is tier-2: `risk-guard.mjs` returns `deferToUser`, so the operator confirms the exact check, path, and reason. |
| No empty justifications | `state.mjs` rejects a `reason` shorter than 20 characters. |
| No permanent waivers | `--days` defaults to 90, hard cap 180. An expired waiver stops applying and the check blocks again. |
| No silent expiry | `doctor` warns 14 days out and lists expired waivers. `gate.mjs` names the expiry date when a formerly-waived check starts blocking. |
| Waivers are narrow | A waiver is `(check_id, path)`. A `check_id` with no path is rejected — no project-wide waivers. |
| Critical is never waivable | `state.mjs` refuses a waiver for a `critical` check. |
| Waivers are reviewable | `waivers.json` is committed. Every waiver is visible in `git diff` and in code review. |

A waiver is also the correct **input to the self-improvement loop**: a waiver granted for a false positive is a class-B lesson (the check is wrong), and `/mavci:retro` reads `waivers.json` to find them.

### 6.7 Layer 2 — the second enforcement point (B4)

Revision 1 had two defects in one line: `git clone` against a private repo with no token, and `--depth 1` with no ref pinning CI to `main` HEAD while the local hook ran the installed plugin version — so CI and local could apply different rule sets with no visible cause.

`.github/workflows/mavci-verify.yml`, written into every project:

```yaml
name: mavci-verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Resolve pinned system version
        id: mavci
        run: |
          v=$(node -p "require('./.mavci/control/state.json').plugin_version")
          echo "ref=v$v" >> "$GITHUB_OUTPUT"

      - name: Fetch Mavci system at the pinned version
        uses: actions/checkout@v4
        with:
          repository: mavci-ai-devsystem/mavci-ai-devsystem
          ref: ${{ steps.mavci.outputs.ref }}
          token: ${{ secrets.MAVCI_TOKEN }}
          path: .mavci-system
          persist-credentials: false

      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - run: node .mavci-system/plugins/mavci-core/scripts/gate.mjs --ci --format=github

      - run: npm ci && npx tsc --noEmit && npm run build
```

**The token.** `MAVCI_TOKEN` is a fine-grained PAT with read-only `Contents` on
`mavci-ai-devsystem/mavci-ai-devsystem` and nothing else. Set it once as an
**organisation-level secret** and every project inherits it; a per-repo secret
works too. The workflow checks for it in a named step before the checkout, so a
missing token reads as *"MAVCI_TOKEN is not set"* rather than as GitHub's
"repository not found", which is what an unauthenticated private clone actually
produces and which costs an afternoon to diagnose.

`/mavci:doctor` reports two separate things about it, because they fail
differently:

- **Presence** is checkable. Doctor asks `gh api repos/<slug>/actions/secrets`
  and the org equivalent, and reports `FAIL` when the secret is absent. If `gh`
  is missing or unauthenticated it reports *"not checked"* — never a pass, since
  an unchecked control is not a working control.
- **Expiry is NOT checkable.** GitHub exposes no API for a secret's value or a
  PAT's expiry date. The only thing that can be warned on is a date the operator
  records in the manifest as `ci.token_expires`. Doctor warns 30 days out and
  reports `FAIL` once past. When the field is absent it says so, rather than
  implying the token is fine. This is a weaker guarantee than it looks, and
  saying so is better than pretending doctor knows something it cannot know.

**The pin.** CI clones the tag `v<state.json.plugin_version>` — the same version the local hook runs. The two cannot silently diverge, because the version is a committed field. The release procedure in section 2 requires the tag; `release.yml` in the system repo fails if `plugin.json` version and git tag disagree.

**Skew detection, both directions.** `gate.mjs` writes its own plugin version into every verdict. If the running plugin version differs from `state.json.plugin_version`, `doctor` reports the skew and `/mavci:doctor --sync` resolves it by recording the installed version. On a **major** version difference the gate fails closed rather than guessing.

### 6.8 Layer 3 — Scaffolding

`/mavci:new-project` writes a skeleton that already satisfies every check, so new projects begin green and the first red is always a real regression. `templates/scaffold/` is verified by CI on every push to the system repo — a scaffold that cannot pass its own checker is a build failure.

---

## 7. Risk policy

Three tiers. Every tier-3 operation is enforced **twice**: a `permissions.deny` rule in the project's settings, and a `PreToolUse` hook shipped in the plugin. Reasons, all verified:

- Deny rules **cannot ship in the plugin** (5.15) — written per project, so they can drift or be edited away.
- Hooks **do** ship and auto-propagate, but can be turned off wholesale with `disableAllHooks` (4.16).
- Deny beats a permissive hook; a blocking hook beats an allow rule (5.3, 5.4). Neither can override the other, so together they cover each other's failure mode.
- Bash argument patterns are documented as defeatable (5.6). The hook parses the real command and the real MCP payload.

| Operation | Tier | Decision | Enforcement mechanism |
|---|---|---|---|
| Read source, Grep, Glob | 0 | auto | `allow: ["Read(./**)"]` |
| `npm run lint / test / build`, `tsc --noEmit` | 0 | auto | `allow: ["Bash(npm run *)", "Bash(npx tsc *)"]` |
| Edit `app/`, `lib/`, `components/` | 0 | auto | `allow: ["Edit(./**)"]`, narrowed per agent by `edit_scope` and the phase hook |
| Write `.mavci/tasks/**`, `decisions/**`, `lessons/**` | 0 | auto | `allow: ["Edit(./.mavci/tasks/**)", ...]` — agent-writable surface only |
| **Write `.mavci/control/**`** | **3** | **hard-block** | `deny: ["Edit(./.mavci/control/**)"]` — covers Write too (5.17). Only `state.mjs` writes there (4.2). Integrity hash detects out-of-band mutation. |
| **Edit `.mavci/project.json`** | 2 | confirm (operator), **deny (agents)** | `ask: ["Edit(./.mavci/project.json)"]` + hook denies when `agent_type` is set |
| Local Supabase: `start`, `db reset`, `migration new` | 1 | auto | `allow: ["Bash(supabase start*)", "Bash(supabase db reset*)", "Bash(supabase migration new*)"]` |
| `git add`, `git commit`, `git switch -c` | 1 | auto | `allow: ["Bash(git add *)", "Bash(git commit *)"]` |
| `git push` to a feature branch | 1 | auto | `allow: ["Bash(git push origin feat/*)"]`; hook rejects a push resolving to `deploy.prod_branch` |
| Write `.env*` | 2 | confirm | `ask: ["Edit(./.env*)"]` + hook `deferToUser`; the hook names the key, never the value |
| Edit `.claude/settings.json` | 2 | confirm | `ask` + hook |
| Add an npm dependency | 2 | confirm | `ask: ["Bash(npm install *)", "Bash(npm i *)"]` |
| Migration touching an existing table | 2 | confirm | hook parses SQL for `ALTER` / `DROP COLUMN` against a tracked table |
| **Granting a waiver** | 2 | confirm | `/mavci:waive` is `disable-model-invocation: true`; hook returns `deferToUser` |
| `git push --force`, `reset --hard`, branch delete | 3 | **hard-block** | `deny: ["Bash(git push --force*)", "Bash(git push -f*)", "Bash(git reset --hard*)", "Bash(git branch -D*)", "Bash(git push origin --delete*)"]` + hook |
| `rm -rf`, recursive delete outside `node_modules`/`.next` | 3 | **hard-block** | `deny: ["Bash(rm -rf *)", "Bash(rm -r *)"]` + hook path allowlist |
| Repo delete or visibility change | 3 | **hard-block** | `deny: ["Bash(gh repo delete*)", "Bash(gh repo edit*)"]` + hook |
| **Prod DB write or DDL** | 3 | **hard-block** | `deny: ["mcp__claude_ai_Supabase__execute_sql", "mcp__claude_ai_Supabase__apply_migration"]` + hook comparing the call's project ref against every `environments.*.protected: true` ref. **The hook is the real control** — MCP rules cannot carry parameters in a settings file (5.9). |
| `DROP TABLE`, `TRUNCATE`, `DELETE` with no `WHERE` | 3 | **hard-block** | hook regex over Bash `psql`/`supabase db` payloads and MCP SQL arguments, **in every environment including local** — a destructive migration written locally reaches prod later |
| Supabase project pause / restore / delete / create | 3 | **hard-block** | `deny: ["mcp__claude_ai_Supabase__pause_project", "..__restore_project", "..__create_project", "..__delete_branch"]` |
| **Prod deploy** | 3 | **hard-block for agents** | `deny: ["Bash(vercel --prod*)", "Bash(vercel deploy --prod*)", "Bash(railway up*)", "mcp__claude_ai_Vercel__deploy_to_vercel"]` + hook. Reached only through `/mavci:release`, operator present. |
| Vercel/Railway project or protection changes | 3 | **hard-block** | `deny: ["mcp__claude_ai_Vercel__update_project_deployment_protection", "..__pause_project", "..__create_git_project"]` |
| **Money** — domain purchase, plan upgrade, credits | 3 | **hard-block** | `deny: ["mcp__claude_ai_Vercel__buy_domain", "..__buy_pro", "..__buy_credits", "..__buy_addon"]` |
| Stripe live-mode keys | 3 | **hard-block** | hook rejects any command or content containing `sk_live_`; `deny: ["Read(./.env.production*)"]` |
| **Reading any secret** | 3 | **hard-block** | `deny: ["Read(./.env)", "Read(./.env.*)", "Read(./**/*.pem)", "Read(./**/*.key)"]` |
| **Writing a secret into `.mavci/`** | 3 | **hard-block** | `risk-guard.mjs` scans tool input and denies; `redact.mjs` sweeps after; `secrets.no_committed_secrets` is critical and unwaivable (4.4) |
| Sending real email via Resend | 3 | **hard-block** | hook rejects recipients other than `@example.com` or the operator's address |

**Tier semantics by `project.risk_tier`:** `sandbox` demotes prod-DB and deploy rows to tier 2. `regulated` promotes every tier-1 row to tier 2. `standard` is the table as written. **The control-plane row is tier 3 in all three tiers** — it is not a project-risk question.

### 7.1 Honest limits

1. **`Read`/`Edit` deny rules do not stop subprocesses** (5.8). An agent that writes a Node script to read `.env` is not stopped by a deny rule. `risk-guard.mjs` mitigates by rejecting Bash commands that pipe dotfiles or reference `.mavci/control` from a non-plugin script, and the integrity hash catches control-plane mutation after the fact — but this is a real hole. Closing it needs OS sandboxing (Phase 3). **The system uses this same gap deliberately for `state.mjs` and `redact.mjs` (4.2, 4.4); it cannot be both used and closed, and using it is the lesser cost.**
2. **`bypassPermissions` is not certified** (4.15 unverified). Every project sets `"permissions": { "disableBypassPermissionsMode": "disable" }`, verified to work from project scope (5.12).
3. **A repo skill's `allowed-tools` bypasses workspace trust** (2.8). Relevant only when opening untrusted repos. Noted, not mitigated.
4. **On Windows, "don't ask again" writes into the committed `.claude/settings.json`** (5.16). `doctor` diffs `allow` against the template and reports every addition, visible in one command and in `git diff`.
5. **Hook-only constraints die with hooks.** The phase gate and the architect/scribe path limits are hook-enforced only (1.1). The control plane and every tier-3 row survive, because they are backed by deny rules.

---

## 8. Phase separation

Four phases: `plan`, `build`, `verify`, `release`. Three independent mechanisms.

**1. Tool grants.** Only `mavci-builder` writes `app/**`, `lib/**`, `supabase/**`. The verifier and guardian have `disallowedTools: Edit, Write, NotebookEdit` and **physically cannot** change code while judging it — the only natively enforced boundaries in the roster (1.1).

**2. A phase hook.** `risk-guard.mjs` on `PreToolUse` for `Edit|Write` reads `control/state.json`, denies edits to application paths whenever `phase != "build"`, and applies each agent's `edit_scope` using `agent_type` from the hook payload (4.9). Hook-only, and section 1.1 says so.

**3. Explicit transitions**, written by `state.mjs` — never by an agent, because `state.json` is control plane:

```
/mavci:plan "<request>"   →  architect  →  phase plan   →  writes spec, sets phase build
/mavci:build <task-id>    →  builder    →  phase build  →  implements, sets phase verify
/mavci:verify <task-id>   →  verifier   →  phase verify →  verdict; pass → phase release + baseline-prune
                                                            fail → phase build, attempts++
/mavci:release            →  main session, operator present, guardian pass required
```

The verifier refuses to start while phase is `build`; the builder cannot resume after a pass. The gate is a file readable with `cat`, changeable by the operator through `state.mjs --set-phase`, and **not** editable by the agent it governs — which is the whole point of B1.

`/mavci:release` runs a checklist in the main session — guardian pass, verifier pass, zero unbaselined blockers, migrations reviewed, env keys present in the deploy target, changelog written — then prints the deploy command for the operator to run. It never deploys, because deploy is tier-3.

---

## 9. Failure handling

**Detection**, cheapest first:

| Signal | Source | Cost |
|---|---|---|
| Standards blocker | `gate.mjs` exit 2 | free, deterministic |
| Type or build error | `tsc --noEmit`, `next build` | free, deterministic |
| Test failure | `npm test` | free, deterministic |
| Checker could not run | `gate.mjs` fail-closed (6.4) | free — and it blocks, rather than silently passing |
| Agent self-report `status: failed` | the contract's JSON block | one agent call |
| Semantic wrong-ness | guardian, or the operator | one agent call, or human |

**Retry policy.** `max_attempts: 3` in `control/tasks/<id>.json` — three tries, two retries. **The agent cannot edit that file** (4.2); it is read-only to the thing it governs. Retry input is not "try again": the failing verdict's `failures[]` array is injected verbatim, so attempt N+1 starts from file paths and line numbers. Each attempt writes its own immutable verdict.

Within one attempt the `Stop` gate can force at most 2 additional in-turn corrections (6.4). `maxTurns` in agent frontmatter (1.5) is the outer hard cap against a runaway agent.

**At the ceiling**, four things happen and then it stops:

1. Status → `"blocked"`, `blocked_by` set to the dominant `check_id` or error class.
2. Phase → `"plan"`. A blocked task is a planning problem; a fourth build attempt is how loops start.
3. `state.mjs` writes a lesson stub at `.mavci/lessons/<date>-<task-id>-<check-id>.md`, pre-filled with all three verdicts and the attempted diffs.
4. `/mavci:build <id>` refuses to run on a blocked task, printing the three verdicts, the stub path, and the three available moves: `/mavci:retro <id>`, `/mavci:waive <check_id> <path>` if it is a false positive, or `state.mjs --reset-attempts <id>` after the operator has changed something.

**Never retried, escalated immediately:** anything with `blocked_by: "risk_tier_3:*"`, any schema-invalid state file, any integrity-hash mismatch, any missing input, and any `critical` finding. Retrying these is pure waste.

---

## 10. Self-improvement loop

`/mavci:retro [<task-id>]`.

**In the project:**

1. Gather evidence: verdicts for the task, the diff, any **waiver granted for a false positive** (waivers are a first-class retro input, 6.6), and — for a rejection with no verdict — one question: *what was wrong, in one sentence?*
2. Classify into exactly one of four:

| Class | Meaning | Destination in the system repo |
|---|---|---|
| **A — missing standard** | The correct pattern was never written down | `skills/standards-<pack>/SKILL.md` |
| **B — unenforced or wrong check** | Written down but nothing checked it, **or** a check produced a false positive | a rule and fixture in `verify.mjs` — **always paired with A** |
| **C — wrong agent boundary** | Wrong agent, tools, phase, or model | `agent-defs/<agent>.yaml`, then regenerate |
| **D — one-off** | Project-specific | stays in `.mavci/lessons/` only |

3. Write `.mavci/lessons/<date>-<slug>.md` — committed to the project repo, the permanent local record.
4. For A, B, or C, write `.mavci/lessons/pending-system-change.md` with the exact target path and proposed diff.

**In the system repo** (`/mavci:retro --apply <path>`, or via `--add-dir`):

5. Apply. **A class-A change with no class-B check is rejected** — a standard nothing verifies is how the system decays back into prose.
6. Add a fixture under `templates/fixtures/<check_id>/{bad,good}/`. CI asserts the checker fails `bad/` and passes `good/`, so a rule cannot regress silently. **A class-B fix for a false positive adds the false-positive case to `good/`** — the exact code that was wrongly flagged, now asserted to pass.
7. Bump `plugin.json`, push the matching tag, commit.
8. Next `/plugin update` carries it to every project, including the five that never hit the bug.

**Cost:** one command, one markdown file, one rule, one fixture, one version bump. No dashboard, no database, no scheduled job.

**Guarantee it happens:** the ceiling handler (section 9) writes the lesson stub automatically, so the artifact exists before anyone decides to act. `doctor` reports unresolved `pending-system-change.md` files and every waiver granted in the last 30 days, so a queued lesson cannot be quietly forgotten.

---

## 11. Escape hatch

**Claim: delete Claude Code entirely and every artifact this system produces stays fully usable.**

| Artifact | Format | Usable without the system because |
|---|---|---|
| Application code | Next.js, TypeScript, SQL | Ordinary source in an ordinary git repo. No runtime dependency on the system. |
| Specs, ADRs, lessons | Markdown + YAML frontmatter | Renders on GitHub; readable with `cat`. |
| Manifest, state, tasks, verdicts, baseline, waivers | JSON with a `$schema` pointer | Parseable by `jq`, Python, a spreadsheet. Schemas are public files in the repo. |
| Agent definitions | Standard Claude Code markdown | `cp -r plugins/mavci-core/agents .claude/agents` and they work with no plugin, marketplace, or generator. |
| Standards | Markdown `SKILL.md` | Readable engineering documentation. |
| The checker | `node verify.mjs`, zero npm dependencies | Runs in CI, a pre-commit hook, or by hand. No knowledge of Claude at all. |
| Risk policy | JSON in `.claude/settings.json` | Human-readable; section 7 is the source of truth for meaning. |

**What guarantees it, mechanically:** `.github/workflows/selftest.yml` runs on every push in a container with Claude Code **not installed**, executing `gate.mjs --ci`, `state.mjs --validate`, and `redact.mjs --selftest` against `templates/fixtures/`. If any needs Claude Code, the job fails. The escape hatch is a passing test, not a promise.

**Explicit non-guarantee:** the *automation* is Claude-Code-specific — hooks, agents, and slash commands do not run elsewhere. What survives is every artifact, every standard, and every check. The work product is portable; the labour-saving is not.

**Format rules that make this hold, enforced by schema:** no binary formats; no format the system invented; every enum closed and documented; no absolute paths or backslashes in state files; prose in sibling `.md` files rather than JSON strings; UTF-8 without BOM and LF endings via `.gitattributes`, so Turkish characters in KVKK content survive a Windows/macOS round trip.

---

## 12. Decisions that are expensive to reverse

| Decision | Value | Reversal cost |
|---|---|---|
| Marketplace name | `mavci` | Baked into `extraKnownMarketplaces` and `enabledPlugins` in every project. Manual edit in every repo. `renames` helps the plugin name, not the marketplace name. |
| Plugin name | `mavci-core` | Same, plus every `/mavci-core:*` command name. `renames` (6.13) exists but is a migration. |
| State directory | `.mavci/`, with `control/` inside it | Referenced in every script, hook, schema, deny rule, and CI workflow. Mechanical but touches everything. |
| Control-plane boundary | `control/` subtree | Moving a file across the boundary later changes a deny rule in every project's settings. |
| Task ID scheme | zero-padded 4-digit, per project, never reused | Changing it invalidates every filename and cross-reference. |
| One plugin vs. several | One (`mavci-core`) | Splitting later needs a dependency declaration and a settings change per project. The `standards/` layout already anticipates it. |
| Repo topology | System repo is the marketplace | Switching to submodules or copy-per-project means touching every project. |

---

## 13. Rollback of a bad plugin release

A bad release reaches every project at once. That is the cost of the propagation model, and it needs a rehearsed answer rather than an improvised one.

**Never the wrong move: `disableAllHooks`.** It kills enforcement on every project permanently and globally, and nothing reminds you to turn it back on. The three levers below all preserve enforcement.

### Lever 1 — roll forward (primary, fully verified)

1. In the system repo: `git revert <bad-commit>`.
2. Bump `plugin.json` to the next patch (`0.3.1`), whose content equals the last-good release.
3. Push, with tag `v0.3.1`. `release.yml` verifies version and tag agree.
4. In each project: `/plugin marketplace update`, `/plugin update mavci-core@mavci`, `/mavci:doctor --sync`.

Roll-forward is primary because every step is a verified mechanism and it leaves a linear, auditable history. Time to recover: about two minutes plus one command per project.

### Lever 2 — pin one project to an older version

`extraKnownMarketplaces` with a git ref is **unverified** (6.16), so this is documented with its uncertainty rather than assumed. The verified equivalent is the CLI form (6.15):

```
claude plugin marketplace add mavci-ai-devsystem/mavci-ai-devsystem@v0.2.0
```

Phase 1 acceptance tests whether a `@v0.2.0` suffix inside the settings `repo` field also works. **If it does not, lever 2 is per-machine rather than committed, and lever 1 remains the only project-wide answer** — which is why lever 1 is primary.

The CI side of a pin is one committed line: set `state.json.plugin_version` to the older version and CI clones that tag (6.7).

### Lever 3 — emergency local override, one machine, one session

```
claude --plugin-dir <path-to-known-good-checkout-of-plugins/mavci-core>
```

Verified (6.17): a `--plugin-dir` plugin of the same name takes precedence over the installed one for that session. Use when the bad release blocks the very work needed to fix it. It changes nothing on disk and expires when the session ends.

### Deciding between them

| Situation | Lever |
|---|---|
| Bad rule, all projects affected | 1 — revert, bump, retag, update |
| Bad rule affecting one project's legitimate pattern | **Waiver** (6.6), not a rollback — narrower, time-boxed, auditable |
| Release breaks the checker itself, so nothing runs | 1, and note the gate fails closed (6.4), so work is blocked rather than silently unverified — which is the correct failure |
| Need to work *right now* while fixing | 3, then 1 |
| Suspect skew between local and CI | `/mavci:doctor` reports it; `--sync` resolves it |

### After every rollback

Write a class-B lesson (section 10) with the false-positive code in `templates/fixtures/<check_id>/good/`. A rollback that produces no fixture will happen again.

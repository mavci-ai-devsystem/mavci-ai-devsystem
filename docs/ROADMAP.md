# Mavci AI Development System — Roadmap

**Companion to** `ARCHITECTURE.md` and `NATIVE-CAPABILITIES.md`.
**Revision 2** — blockers B1–B5 and fixes 1–5 folded in. Approved for Phase 1.
**Date:** 2026-08-28 · **Claude Code:** 2.1.250

---

## Phase 1 — Foundation (one session)

**Goal:** a plugin that installs from a private GitHub repo on any machine, **connects an existing repo without blocking it**, scaffolds a compliant greenfield project, blocks a dangerous operation, fails a task on a standards violation, cannot be edited by the agents it governs, and never writes a secret to disk.

Scope grew in revision 2 (baseline, waivers, redaction, control plane, fail-closed gate). It is paid for by deferring `supabase.rls_policy_per_table` to Phase 2 and by the gate scoping in fix 2, which removes the full-scan cost from ordinary turns.

### Build list

**System repo skeleton**
1. `.claude-plugin/marketplace.json` — marketplace `mavci`.
2. `plugins/mavci-core/.claude-plugin/plugin.json` — version `0.1.0`.
3. `.gitignore`, `.gitattributes` (LF, UTF-8), `README.md` with the install and token setup steps.

**Custom code (C1–C6), Node ESM, zero dependencies**
4. `scripts/state.mjs` — the privileged writer: schema validation, atomic writes, ID allocation, `--init`, `--baseline-init`, `--baseline-prune`, `--waive`, `--set-phase`, `--reset-attempts`, `--validate`, control hash, and the redaction call on every write.
5. `scripts/redact.mjs` — the four pattern classes from ARCHITECTURE 4.4; modes `--sweep` and `--selftest`.
6. `scripts/verify.mjs` — the 12 Phase 1 rules (below); modes `--gate`, `--advisory`, `--changed`, `--ci`, `--format=github`; per-rule try/catch where an errored rule counts as a blocker.
7. `scripts/gate.mjs` — the fail-closed wrapper: 25 s internal budget under a 30 s hook timeout, completion sentinel, integrity check, heartbeat stamp, loop counter, baseline and waiver filtering.
8. `scripts/risk-guard.mjs` — PreToolUse: tier-3 hard blocks, tier-2 `deferToUser`, phase gate, per-agent `edit_scope`, secret scan of tool input, control-plane Bash guard, previous-turn heartbeat check.
9. `scripts/build-agents.mjs` — definition plus contract to `agents/*.md`; strips `_note` keys.
10. `scripts/doctor.mjs` — settings drift, plugin/CI version skew, `--sync`, `--preflight`, hook self-test, baseline debt, expiring waivers, pending lessons.

**Agents — 3 of 5**
11. `agent-defs/_contract.md` — the 8-section contract, including the generated native-vs-hook constraint line (ARCHITECTURE 1.1).
12. `agent-defs/{architect,builder,verifier}.json` (JSON, not YAML: parsing YAML needs a dependency, which would break the zero-dep escape hatch).
13. `plugins/mavci-core/agents/*.md` — generated, committed, CI-checked.

**Skills**
14. Commands: `new-project`, `connect`, `plan`, `build`, `verify`, `doctor`, **`waive`** (`disable-model-invocation: true`).
15. Standards packs — 3 of 8: `nextjs-app-router`, `supabase-multitenant-rls`, `legal-tr-kvkk`.

**Wiring**
16. `hooks/hooks.json` — exactly as in ARCHITECTURE 6.4: PreToolUse guard (20 s), PostToolUse advisory (async) and redaction sweep (sync), Stop and SubagentStop gates (30 s), SessionStart preflight.
17. `plugins/mavci-core/templates/schemas/` — `project`, `state`, `control-task`, `task`, `verdict`, `baseline`, `waivers`, `integrity`, `agent-report`.
18. `plugins/mavci-core/templates/project.settings.json` — the full risk policy including the control-plane deny rule.
19. `plugins/mavci-core/templates/project.CLAUDE.md`, `plugins/mavci-core/templates/scaffold/`, `plugins/mavci-core/templates/mavci-verify.yml`.
20. `plugins/mavci-core/templates/fixtures/<check_id>/{bad,good}/` for all 13 rules.
21. `.github/workflows/`: `validate.yml` (plugin validate, schema validate, agent-regen diff, fixture assertions), `selftest.yml` (escape-hatch proof, no Claude Code), `release.yml` (fails if `plugin.json` version and git tag disagree).

### Phase 1 rule set — 13 rules

`secrets.no_committed_secrets` (**critical**, unwaivable, unbaselinable) · `next.supabase_client_in_function` · `next.route_force_dynamic` · `next.no_static_export` · `next.regex_no_template_literal` · `next.no_service_role_client` · `next.env_centralised` · `stripe.webhook_signature` · `supabase.rls_enabled` · `legal.pages_present` · `legal.kvkk_structure` · `state.schema_valid`.

The four stack-specific rules from fix 3 are in. `supabase.rls_policy_per_table` is out — it needs real SQL parsing, and regex would generate exactly the false positives that B3 warns about.

### Deferred out of Phase 1 on purpose

`mavci-guardian`, `mavci-scribe`; `/mavci-core:release`, `/mavci-core:retro`, `/mavci-core:research`; five standards packs; nine further checker rules. All additive — a YAML file, a `SKILL.md`, or a rule function. None require rework of Phase 1.

---

## Acceptance test for Phase 1

Two repositories, because the two paths have different failure modes and **the existing-repo path is the one that matters for all six real projects**.

**Setup:** system repo pushed to `github.com/mavci-ai-devsystem/mavci-ai-devsystem` with tag `v0.1.0`. Machine A = Windows, with the three per-machine prerequisites done (ARCHITECTURE section 2): `gh auth login` **and `gh auth setup-git`** (6.19: the credential must resolve without a prompt), and **one** `claude plugin marketplace add https://github.com/mavci-ai-devsystem/mavci-ai-devsystem.git` followed by `claude plugin install mavci-core@mavci --scope user` — from a terminal, not from inside a session. `MAVCI_TOKEN` set as an org-level secret.

**Before starting, assert the machine is clean.** `claude plugin list --json` must show `mavci-core@mavci` at `"scope": "user"` and must **not** show a `"scope": "project"` record left over from an earlier run: a pin with no user-scope anchor loads nothing in any other directory and reports no error (6.20), which would make every assertion below untrustworthy. Remove one with `claude plugin uninstall mavci-core@mavci --scope project` run from the directory it names. Gate repos are single-use for the same reason — a repo that has hosted a run carries an auto-recorded pin (6.22) and an untracked settings file, and is not a clean starting state.

### Part A — greenfield (`~/acceptance-new`)

| # | Action | Assertion |
|---|---|---|
| A1 | `claude` in the empty repo, accept the trust dialog. **No `/plugin` command of any kind** — the marketplace and the user-scope install were done once per machine in Setup, and the in-session `/plugin install` takes no `--scope` argument, so it would pin the plugin to this directory (6.20). | `/context`, as the session's first command, lists the three agents. `/help` lists `/mavci-core:new-project` and `/mavci-core:waive`. |
| A2 | `/mavci-core:new-project acceptance-new` — TR+EU, Vercel, tier `standard` | `project.json` validates. `.claude/settings.json` contains every tier-3 deny rule **including `Edit(./.mavci/control/**)`**. The five legal pages exist with real content. `control/baseline.json` exists and is **empty**. |
| A3 | `node <plugin>/scripts/gate.mjs` | Exit `0`. Verdict written, 13 checks passing. The scaffold is green from commit one. |
| A4 | `/mavci-core:plan "add a tenant-scoped projects table with RLS and a list page"` | Task spec in `.mavci/tasks/`, control task in `.mavci/control/tasks/`. `state.phase` is `build`. `git status` shows **zero** changes under `app/` or `supabase/`. |
| A5 | Instruct the architect to edit `app/page.tsx` | Blocked by `risk-guard.mjs`, reason names the phase gate and `edit_scope`. |
| A6 | **Ask any agent to edit `.mavci/control/state.json` to set `attempts: 0`** | **Denied by the permission rule, not the hook.** Re-run with hooks disabled — still denied, proving the control plane survives hook loss (B1). |
| A7 | **Ask an agent to `node -e` a script that writes `control/state.json`** | Blocked by the `risk-guard.mjs` control-plane Bash guard. Then bypass the guard by hand-editing the file, and run any turn: `gate.mjs` **fails closed** with "control plane modified outside state.mjs" (integrity hash). |
| A8 | `/mavci-core:build 0001`, with the migration template seeded to omit `force-dynamic` on the new route | The `Stop` gate fires: `continue: true`, `stopReason` names `next.route_force_dynamic` with file and line. Builder fixes it **in the same turn** and stops cleanly. `verdicts/0001-attempt-01.json` records the failure. |
| A9 | Ask the builder to run `vercel deploy --prod` | Hard-blocked, message names tier 3. Repeat with `.claude/settings.json` renamed — still blocked, proving the hook holds independently. |
| A10 | Ask the builder to read `.env.local`, then to paste `STRIPE_SECRET_KEY` into a task note | Read denied. The paste is **denied by `risk-guard.mjs` before it reaches disk**. Then write a secret through a subprocess: the `PostToolUse` sweep rewrites it to `[REDACTED:STRIPE_SECRET_KEY]` (B5). |
| A11 | Ask the builder to run `psql -c "DROP TABLE projects"` | Hard-blocked, including against the local environment. |
| A12 | **Break the checker deliberately** — introduce a syntax error into `verify.mjs`, run a turn that edits a file | Turn is **blocked** with "standards checker crashed... Enforcement did not run." Not silently passed (fix 1). |
| A13 | **Unregister the Stop hook**, run a turn that edits a file, then start a second turn | Second turn's `Edit` is denied: "the standards gate did not run on the previous turn" (heartbeat, fix 1). |
| A14 | Ask a question that touches no files | `gate.mjs` returns in under ~100 ms and runs no checks (fix 2). Confirmed in the debug log. |
| A15 | `/mavci-core:verify 0001`, then commit and push | Verdict `pass`; `tsc --noEmit` and `next build` succeed; phase `release`. GitHub Action `mavci-verify` clones the system repo **at tag `v0.1.0` using `MAVCI_TOKEN`** and passes (B4). |

### Part B — existing repo, the real case (`~/acceptance-legacy`)

A repo seeded with realistic pre-existing debt: three routes without `force-dynamic`, a module-scope Supabase client, a missing KVKK page, and **no** committed secret.

| # | Action | Assertion |
|---|---|---|
| B1 | `/mavci-core:connect` | Detects the stack. Writes `project.json`, settings, CI workflow. `--baseline-init` records **every** current violation into `control/baseline.json`. Remediation tasks written, one per `check_id` group. |
| B2 | **Run any ordinary turn that edits an unrelated file** | **The turn completes.** `gate.mjs` exits 0 — every violation is baselined. **This is the B2 proof: a connected repo is usable from the first turn.** |
| B3 | Add a **new** route without `force-dynamic` | **Blocked.** New files are never baselined, so the ratchet only turns one way. |
| B4 | Fix one baselined route, run `/mavci-core:verify` | `--baseline-prune` removes that entry automatically. Verdict reports `baselined: N-1`. Debt shrinks without anyone remembering to prune. |
| B5 | Attempt to add a baseline entry by hand, then run a turn | Denied by the control-plane rule; if forced, the integrity hash fails the gate. There is no add operation in `state.mjs` after init. |
| B6 | Seed a `sk_live_` key in the repo and run `/mavci-core:connect` on a fresh copy | Connect **refuses**: `critical` findings cannot be baselined. Message says fix it before connecting. |
| B7 | Trigger a genuine false positive — a health route that must stay cached — then `/mavci-core:waive next.route_force_dynamic app/api/health/route.ts --reason "..." --days 90` | Operator confirmation prompt appears. Waiver written to `control/waivers.json`, committed, visible in `git diff`. Turn now passes. Verdict records `status: "waived"`. |
| B8 | Ask an **agent** to grant the same waiver | It cannot: `/mavci-core:waive` is `disable-model-invocation: true`. The agent returns `escalate: true` naming the check (B3). |
| B9 | Set the waiver's `expires` to yesterday via `state.mjs`, run a turn | The check **blocks again**, and the message names the expiry date. `doctor` lists it as expired. |
| B10 | `/mavci-core:doctor` | Reports plugin version, settings drift vs. template, hook self-test, **baseline debt count and trend**, expiring waivers, CI token status, 0 pending lessons. |

### Part C — portability, propagation, rollback

| # | Action | Assertion |
|---|---|---|
| C1 | **Machine B (macOS or Linux).** Step one: `gh auth login` **then `gh auth setup-git`**. The system repo is private, and Claude Code cannot prompt for a credential while resolving the marketplace — it fails with `unable to get password from user` even where an interactive `git clone` succeeds (6.19, observed Gate 3). Then clone the project, run `claude`, accept the trust dialog. | **This is two steps, not zero.** Machine B needs a non-interactive git credential once, and the trust dialog once per repo. What is zero is *project* configuration: no file in the project is edited. `gate.mjs` then runs identically on macOS/Linux — no bash, jq or PowerShell dependency. |
| C2 | In the system repo: add rule #13 with fixtures, bump to `0.2.0`, push tag `v0.2.0` | `validate.yml` passes; fixture assertions confirm the rule fails `bad/` and passes `good/`. `release.yml` confirms version and tag agree. |
| C3 | **On each machine**, run the propagation procedure (ARCHITECTURE §2 step 5): `git -C ~/.claude/plugins/marketplaces/mavci fetch origin` + `checkout -B main origin/main`, then `claude plugin uninstall mavci-core@mavci` + `claude plugin install mavci-core@mavci --scope user`, then **restart**. Then in a project on that machine: `/mavci-core:doctor --sync`. **Not `/plugin marketplace update` or `claude plugin update`** — neither moves anything (6.21) | Doctor reports 13 rules and version `0.2.0`, and writes `0.2.0` into `state.json.plugin_version`. **No other project file changed.** Propagation proof — and it costs one operator visit per machine, not per project: the second project on a machine needs only the `--sync`. |
| C4 | Commit and push | CI now clones `v0.2.0`, following the committed field. Local and CI cannot diverge silently (B4). |
| C5 | **Rollback drill.** Publish `v0.3.0` with a deliberately broken rule (false-positives on every page). Confirm it blocks work in both test repos. | The gate blocks — correctly, since the checker is doing what it was told. |
| C6 | Execute **lever 1**: `git revert`, bump to `0.3.1`, tag, push; then the same four-command procedure as C3 on each machine, restart, and `/mavci-core:doctor --sync` in both repos | Work unblocked. Total elapsed under five minutes. **Rollback proof (fix 4).** Time the manual procedure here specifically: it is the step that scales with machines, and an incident is when that cost is felt. |
| C7 | Test **lever 2**: set `extraKnownMarketplaces.mavci.source.repo` to `mavci-ai-devsystem/mavci-ai-devsystem@v0.2.0` and restart | **Records whether a ref suffix works in the settings object** — currently unverified (6.16). If it works, lever 2 is committable per project. If not, the docs are updated to say lever 1 is the only project-wide rollback, and the CLI form remains as the per-machine pin. |
| C8 | Test **lever 3**: `claude --plugin-dir <known-good-checkout>` while `v0.3.0` is still installed | The local copy takes precedence; work proceeds; nothing on disk changes. **Note this cuts both ways:** because `--plugin-dir` overrides an installed plugin (6.9), all local development so far has exercised the local path and never the GitHub one. C1–C7 are the only steps that test real distribution. |
| C8b | Test the **kill switch**: set `enabledPlugins["mavci-core@mavci"]` to `false` in the project's `.claude/settings.json`, restart | Agents, commands and hooks all disappear; the project is inert but intact. This is the per-project off switch when a release is bad and rolling forward is not immediate. Confirm the tier-3 **deny rules still apply**, since they live in project settings rather than the plugin — enforcement degrades, it does not vanish. |
| C9 | Uninstall Claude Code in the CI container, run `selftest.yml` | Passes. **Escape-hatch proof.** |

### Distribution is the unproven half

Everything in Parts A and B was developed and tested with `--plugin-dir`, which
takes precedence over an installed marketplace plugin (6.9). That means **the
GitHub route has never executed**: marketplace resolution against a private repo,
the trust dialog gating `extraKnownMarketplaces` (6.6), the per-machine
user-scope install, version-bump propagation, and the rollback levers are all
untested. C1–C8b are not a formality; they are the part most likely to fail.

Gate 4 (2026-08-28) closed part of this and found the failure mode that makes
the rest hard to trust: every layer between the settings file and the loaded
plugin reports success whether or not the plugin loaded (6.21), and a
project-scoped install record silently answers for the wrong directory (6.20).
So every distribution assertion below is confirmed by **running a
`/mavci-core:` command or reading `/context` in a fresh session** — never by
inspecting `installed_plugins.json`, the cache, or the clone HEAD.

### The eight steps that decide it

**A6, A7** (control plane holds against both the agent and a subprocess) · **A12, A13** (the checker fails closed when it crashes and when it does not run) · **B2, B3** (a connected repo is usable, and the ratchet only turns one way) · **C6** (a bad release is reversible in minutes) · **C9** (escape hatch).

If any of those eight fails, Phase 1 is not done regardless of the rest.

---

## Phase 2 — Completing the roster (1–2 sessions)

- `mavci-guardian` (opus) and `mavci-scribe` (haiku).
- `/mavci-core:release` — the gated release checklist, main-session only.
- `/mavci-core:retro` — both halves of the self-improvement loop, reading `waivers.json` for false-positive lessons.
- `/mavci-core:research` — forked `Explore`.
- Standards packs: `stripe-billing`, `resend-email`, `anthropic-usage`, `seo-baseline`, `ad-policy`.
- Nine further checker rules, each with fixtures. **`supabase.rls_policy_per_table` and `supabase.tenant_column` get a real SQL statement parser** rather than regex — this is the specific reason they were deferred.
- **Exit criterion:** the first real SaaS project connected, its baseline debt reduced by half, and at least one waiver granted, expired, and resolved.

## Phase 3 — Operating at scale (after 2–3 projects are live)

- `/mavci-core:status` — read-only aggregation across sibling repos by globbing `.mavci/control/state.json`. No daemon, no index. This is the data source a Command Center would later read.
- Migration and rollback playbooks as skills.
- **OS-level sandboxing** to close the subprocess hole (ARCHITECTURE 7.1 item 1) — the one honest gap that cannot be closed with permission rules or hooks.
- Second stack pack, if ever needed — the trigger for splitting `mavci-core`.
- Cost and usage telemetry, **only if** a verified native surface exists then.

## Phase 4 — Command Center

Not scoped. See below.

---

## NOT building yet

| Item | Why not |
|---|---|
| **Visual Command Center** | No data until several projects run through Phases 1–2. Building the view before the data model is proven bends the data model to fit the view. Format constraints locked below so it stays additive. |
| **Custom orchestration framework, message bus, agent registry** | Native delegation covers it. Explicitly forbidden by the brief, and correctly so. |
| **Multi-agent parallel workflows** | The roster must be stable and the contract proven serially first. Parallelism multiplies a bad contract. |
| **Automated production deploys** | Tier 3 by policy. The operator is the approval channel. |
| **AST-based checking** | Would need a TypeScript parser dependency, breaking the zero-dependency escape-hatch guarantee. Revisit only if regex false positives outlive the waiver mechanism — and the waiver data will say whether they do. |
| **Cross-project shared lessons database** | `/mavci-core:retro` promoting into the system repo already gives cross-project reach, with git as the store. |
| **A custom MCP server** | Nothing the system needs is unreachable from Node scripts and native tools. |
| **Auto memory / subagent `memory`** | Verified machine-local (3.7). Violates the environment constraint. |
| **Headless / `claude -p` operation** | Verified: project allow rules and `extraKnownMarketplaces` do not apply without an interactive trust dialog (5.14, 6.6). CI uses `node`, not Claude. |
| **A second stack** | No demand. The pack layout already anticipates it. |

### Data-format constraints locked NOW so the Command Center is additive

Enforced by JSON Schema in Phase 1 and asserted in CI.

1. **`schema_version` (integer) and a `$schema` URL** on every state file, pointing at a stable raw-GitHub path. Version bumps are additive; a field is never repurposed.
2. **`project_id` on every state file**, so a verdict is meaningful read in isolation and files aggregate across repos without inferring anything from the directory path.
3. **ISO-8601 UTC with a `Z` suffix** for every timestamp. No local time, no epoch integers.
4. **Closed enums, declared in schema:** `phase` ∈ {plan, build, verify, release} · `status` ∈ {pending, in_progress, done, failed, blocked} · check `status` ∈ {pass, fail, **waived**, **baselined**, **error**} · `severity` ∈ {**critical**, blocker, warning, info} · `verdict` ∈ {pass, fail} · `risk_tier` ∈ {sandbox, standard, regulated}.
5. **`check_id` is a stable dotted identifier** (`domain.rule`) that never changes meaning. Renaming requires a `renamed_from` field, not a silent edit — otherwise historical verdicts, baselines, and waivers become unreadable.
6. **One file per entity. Never append to a file that must be parsed.** Verdicts are immutable and numbered.
7. **Repo-relative POSIX paths only** — no absolute paths, no drive letters, no backslashes. This is what lets a file written on Windows be read by a dashboard on Linux.
8. **Prose in sibling `.md` files**, never inside JSON strings, except a single-line `evidence` field.
9. **UTF-8 without BOM, LF endings**, enforced by `.gitattributes`, so Turkish characters in KVKK content survive a Windows/macOS round trip.
10. **No file in `.mavci/` is machine-specific.** `doctor` flags absolute paths found in state files.
11. **The control-plane boundary is part of the format.** A future dashboard reads `.mavci/control/**` and must never offer to write it; `integrity.json` lets any reader verify the plane has not been tampered with.
12. **Every state file carries the `plugin_version` that wrote it**, so a reader can interpret older files against the rule set that produced them.

---

## Risks and open questions

### Uncertain — flagged, with a fallback already designed

| # | Uncertainty | Fallback if wrong |
|---|---|---|
| R1 | **`skills:` preload with plugin-namespaced names** (1.11) is undocumented. | The contract already instructs agents to invoke standards skills explicitly as step one. Preloading is a latency optimisation. A1–A4 record which path fired. |
| R2 | **Do PreToolUse hooks run under `bypassPermissions`?** (4.15) | Not relied upon. `disableBypassPermissionsMode: "disable"` is set in every project, verified to work from project scope. |
| R3 | **`extraKnownMarketplaces` ref pinning** (6.16) is unverified. | Acceptance step C7 settles it. If it fails, lever 1 (roll-forward) is the only project-wide rollback — already the documented primary. |
| R4 | **Sonnet's Next.js/Supabase quality for the builder.** Justified on limit consumption, not measured on this stack. | One line in `agent-defs/builder.yaml`, regenerate, bump. Deliberately the cheapest decision in the design to reverse. |
| R5 | **Regex false-positive rate across four new stack rules.** Unknown until real repos are connected. | Waivers (6.6) absorb them without killing enforcement, and `waivers.json` becomes the measurement: if one check accumulates waivers across projects, that is the signal to rewrite it — or to reconsider AST parsing. |
| R6 | **Baseline path-matching lets a baselined file be edited without fixing its violation.** Deliberate (6.5), but it may prove too loose. | If debt stops shrinking, add an opt-in `--baseline-strict` that re-blocks a baselined violation when its file is touched. Not the default, because surprise blocks drive people to `disableAllHooks`. |
| R7 | **`redact.mjs` reads `.env.local`.** A script that reads secrets is itself a risk surface, however narrow. | It has no output path other than redacted text, never logs, and is covered by `--selftest` in `selftest.yml`. If that is judged too much, drop value-based redaction and keep the three pattern classes — weaker, but the script stops touching secrets. Operator's call. |
| R7b | **An agent could copy `state.mjs` under another name and run the copy.** The caller-based authorisation in `risk-guard.mjs` matches the `state.mjs` basename, so a rename evades it, and the seal still validates because the same code did the sealing. | Not closed in Phase 1, and listed rather than implied. It is the same class as the documented subprocess gap (5.8); OS-level sandboxing in Phase 3 is what closes it. Until then the practical mitigations are that control files are committed, so an unexplained change shows in `git diff`, and that the copy step itself is conspicuous in the transcript. |
| R8 | **Integrity hashing adds a failure mode:** a legitimate hand-edit by the operator now fails the gate. | `state.mjs --reseal` recomputes the hash after a deliberate manual edit, and `doctor` tells you to run it. Annoying by design — an unexplained control-plane change should require a conscious act. |

### What could break when Claude Code changes

Ordered by blast radius. Detection is `doctor.mjs` plus `selftest-hooks.mjs`, which asserts a known-bad command is genuinely blocked.

1. **Hook JSON output schema.** The largest risk. A silent change to `hookSpecificOutput` field names turns every hard block into a no-op. The self-test asserts an actual block rather than trusting the config to parse.
2. **Hook timeout and crash semantics** (4.17, 4.18). The whole fail-closed design exists because these currently fail open. If they ever change to fail closed natively, `gate.mjs` becomes a thin pass-through — a welcome simplification, not a break.
3. **Hook event names.** 31 today and growing; a rename silently unregisters a hook. The heartbeat (6.4) is the detection.
4. **Marketplace trust semantics.** Changed across v2.1.196–v2.1.238. A tightening could stop repo-supplied `extraKnownMarketplaces` from working, breaking propagation. Fallback: `claude plugin marketplace add` once per machine — worse, survivable.
5. **`Edit` deny covering `Write`** (5.17). The control plane rests on this. If it regresses, add an explicit `Write` deny — but note the docs say `Write(...)` path rules are never consulted, so the real fallback is the integrity hash, which is why it exists.
6. **Plugin subagent frontmatter exclusions** (6.12). Nothing depends on the excluded fields.

### Expensive to reverse

`ARCHITECTURE.md` section 12. The four that matter: **the marketplace name `mavci`**, **the plugin name `mavci-core`**, **the state directory `.mavci/`**, and **the `control/` boundary** — the last because moving a file across it changes a deny rule in every project's settings.

### Open questions for the operator — none blocking

1. **GitHub owner** for the system repo — needed at the first commit.
2. **Turkish legal content**: does the KVKK aydınlatma metni come from a lawyer, or does the scaffold ship a marked draft? `legal.kvkk_structure` verifies **structure, not legal sufficiency**, and says so in its own description. Recommendation: ship a draft carrying a `REVIEW REQUIRED` marker that `legal.pages_present` treats as a **warning** in `sandbox` and a **blocker** in `standard` and `regulated`.
3. **Entity details** (legal name, address, MERSIS, KEP) now live in `compliance.entity` in each project's manifest — per-project, so no shared file needs editing when details change. Confirm that is right rather than a shared default.
4. **R7**: is `redact.mjs` reading `.env.local` acceptable, or should redaction be pattern-only?
5. **Which of the six repos is connected first.** Recommendation: the least critical one, so the first real contact with `/mavci-core:connect` and the baseline mechanism is low-stakes.

---

## Approval status

Phase 1 approved. Docs updated for B1–B5 and fixes 1–5. Building now, in the build-list order above.

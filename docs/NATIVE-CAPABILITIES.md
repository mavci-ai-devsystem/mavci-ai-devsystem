# Native Capabilities Verification

**Claude Code version checked:** `2.1.250`
**Date checked:** 2026-08-28
**Method:** Official documentation only (`code.claude.com/docs`). No blog posts, gists, or training-data recall.
**Rule applied:** nothing in `ARCHITECTURE.md` is built on a row marked `unverified` or `not available` without an explicitly stated fallback.

---

## Legend

| Status | Meaning |
|---|---|
| **verified** | Confirmed in official docs at the URL and version above. Safe to build on. |
| **unverified** | Plausible but not confirmed by the docs I read. A fallback is required and is stated in ARCHITECTURE.md. |
| **not available** | Docs state it does not exist, or the docs contradict the assumption. |

---

## 1. Subagents

| # | Capability | Status | Evidence / exact behaviour | Doc URL |
|---|---|---|---|---|
| 1.1 | Project-scoped subagents in `.claude/agents/`, git-trackable | **verified** | Table of locations: `.claude/agents/` = "Current project", note "Check into version control for team use". Scanned recursively. | https://code.claude.com/docs/en/sub-agents |
| 1.2 | Subagent frontmatter fields | **verified** | Required: `name`, `description`. Optional: `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`. | https://code.claude.com/docs/en/sub-agents |
| 1.3 | Per-agent model tier | **verified** | `model` accepts `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`. Default `inherit`. Resolution order: `CLAUDE_CODE_SUBAGENT_MODEL` env > per-invocation > frontmatter > main conversation. | https://code.claude.com/docs/en/sub-agents |
| 1.4 | Per-agent tool restriction | **verified** | `tools:` comma-separated allowlist; `disallowedTools:` denylist applied first. Supports `mcp__<server>` patterns and `Agent(subagent-name)`. | https://code.claude.com/docs/en/sub-agents |
| 1.5 | Per-agent turn ceiling | **verified** | `maxTurns: <positive integer>`. "Output marked partial when reached." Used as the runaway-loop cap in the failure policy. | https://code.claude.com/docs/en/sub-agents |
| 1.6 | Per-agent hooks in frontmatter | **verified** | `hooks:` supports `PreToolUse`, `PostToolUse`, `Stop`. **Ignored for plugin subagents.** This is why risk hooks live in `hooks/hooks.json`, not agent frontmatter. | https://code.claude.com/docs/en/sub-agents |
| 1.7 | Per-agent permissionMode | **verified** | `default`/`manual`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. **Ignored for plugin subagents.** Not relied upon. | https://code.claude.com/docs/en/sub-agents |
| 1.8 | Subagents inherit CLAUDE.md | **verified** | Non-fork subagents start with: agent system prompt, task message, CLAUDE.md hierarchy (except Explore/Plan), git status, preloaded skills. **Not** included: main conversation history, parent memory. | https://code.claude.com/docs/en/sub-agents |
| 1.9 | Built-in subagent types | **verified** | `Explore`, `Plan`, `general-purpose`, `claude`, `statusline-setup`, `claude-code-guide`. Disable via `permissions.deny: ["Agent(Explore)"]`. | https://code.claude.com/docs/en/sub-agents |
| 1.10 | Subagent nesting and concurrency | **verified** | Up to 3 layers below main conversation by default; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, set `1` to disable. Concurrency default 20. | https://code.claude.com/docs/en/sub-agents |
| 1.11 | Preloading skills into a subagent | **verified (field)** / **unverified (namespaced names)** | The `skills:` field exists and is documented as "comma-separated skill names". Docs do **not** state whether a plugin-namespaced name (`mavci-core:nextjs-standards`) is accepted there. **Fallback in ARCHITECTURE.md section 6.** | https://code.claude.com/docs/en/sub-agents |
| 1.12 | Subagent persistent memory | **verified as a feature / rejected here** | `memory: user \| project \| local` gives an agent its own auto-memory directory. Machine-local, so it violates the multi-machine constraint. Not used. | https://code.claude.com/docs/en/memory |
| 1.13 | Agent-to-agent messaging | **native, no custom code needed** | `SendMessage` plus a sibling roster exists natively. No custom message bus is designed. | https://code.claude.com/docs/en/sub-agents |

---

## 2. Skills and slash commands

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 2.1 | Custom commands merged into Skills | **verified** | "Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy`." Existing `commands/` keeps working. | https://code.claude.com/docs/en/skills |
| 2.2 | Project-scoped skills, git-trackable | **verified** | `.claude/skills/<name>/SKILL.md` = "This project only". Nested `.claude/skills/` under subdirectories are exposed as `apps/web:deploy`. | https://code.claude.com/docs/en/skills |
| 2.3 | Skill frontmatter | **verified** | `name`, `description`, `argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`, `model`, `context`, `agent`, `background`, `hooks`, `license`. | https://code.claude.com/docs/en/skills |
| 2.4 | Manual-only commands | **verified** | `disable-model-invocation: true` prevents automatic loading. Note: it **also** prevents preloading into subagents, so standards skills must NOT set it. | https://code.claude.com/docs/en/skills |
| 2.5 | Skill arguments | **verified** | `$ARGUMENTS` placeholder, replaced with text following the skill name. | https://code.claude.com/docs/en/skills |
| 2.6 | Dynamic context injection into a command | **verified** | Backtick-bang syntax runs a shell command before the skill content is sent; output replaces the placeholder. This is how `/mavci:doctor` and `/mavci:verify` feed real data to the model. | https://code.claude.com/docs/en/skills |
| 2.7 | Running a command in an isolated subagent | **verified** | `context: fork` runs the skill in a forked subagent; `agent:` selects the type; `background: false` waits in-turn (v2.1.218+). Backgrounded forks get the reduced background tool set. | https://code.claude.com/docs/en/skills |
| 2.8 | Per-skill tool pre-approval | **verified** | `allowed-tools` grants for the invoking turn only; clears on next user message. **Workspace trust does not gate this field** — a repo skill can grant itself tools in an untrusted folder. Carried into ARCHITECTURE.md section 7. | https://code.claude.com/docs/en/skills |
| 2.9 | Restricting which skills Claude may invoke | **verified** | Permission rules `Skill(name)` exact, `Skill(name *)` prefix. Bare `Skill` in deny disables all. | https://code.claude.com/docs/en/skills |

---

## 3. CLAUDE.md and rules

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 3.1 | Project CLAUDE.md | **verified** | `./CLAUDE.md` or `./.claude/CLAUDE.md`. Loaded every session. Target under 200 lines. Files over 4 MiB are skipped. | https://code.claude.com/docs/en/memory |
| 3.2 | `.claude/rules/*.md` | **verified** | Directory exists, discovered recursively. Rules without `paths` frontmatter load at launch with the same priority as `.claude/CLAUDE.md`. | https://code.claude.com/docs/en/memory |
| 3.3 | Path-scoped rules | **verified** | YAML frontmatter `paths:` with glob patterns; the rule loads only when Claude reads matching files. Brace-expansion budget 1000 patterns / 4 MiB. | https://code.claude.com/docs/en/memory |
| 3.4 | `@path` imports in CLAUDE.md | **verified** | Relative and absolute, max depth 4 hops. Imports resolving outside the working directory trigger a one-time approval dialog. Imported files load at launch, so they do not save context. | https://code.claude.com/docs/en/memory |
| 3.5 | CLAUDE.md as enforcement | **NOT AVAILABLE — explicitly contradicted** | "Claude treats them as context, not enforced configuration... To block an action regardless of what Claude decides, use a PreToolUse hook instead." **This sentence is what forces the three-layer standards model.** | https://code.claude.com/docs/en/memory |
| 3.6 | Sharing rules across projects via symlink | **verified / rejected** | `.claude/rules/` supports symlinks. Not used: symlinks are machine-local state and break the multi-machine constraint. | https://code.claude.com/docs/en/memory |
| 3.7 | Auto memory as system state | **verified as a feature / rejected here** | Stored at `~/.claude/projects/<project>/memory/`. Docs: "Auto memory is machine-local... Files are not shared across machines." **Disqualified by the environment constraint.** All system state goes in-repo instead. | https://code.claude.com/docs/en/memory |

---

## 4. Hooks

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 4.1 | Hook event names (31) | **verified** | `SessionStart`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `TeammateIdle`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `DirectoryAdded`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact`, `Elicitation`, `ElicitationResult`, `SessionEnd`. | https://code.claude.com/docs/en/hooks |
| 4.2 | `PreToolUse` can hard-block a tool call | **verified** | Exit code 2 blocks. JSON `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` also blocks. **This is the tier-3 hard-block mechanism.** | https://code.claude.com/docs/en/hooks |
| 4.3 | `PreToolUse` can force a confirmation prompt | **verified** | `permissionDecision: "deferToUser"`. **This is the tier-2 confirm mechanism.** | https://code.claude.com/docs/en/hooks |
| 4.4 | `PreToolUse` can rewrite tool input | **verified** | `updatedInput` object replaces the tool input. Not used in Phase 1. | https://code.claude.com/docs/en/hooks |
| 4.5 | `Stop` hook can refuse to let the turn end | **verified** | `{"hookSpecificOutput":{"hookEventName":"Stop","continue":true,"stopReason":"..."}}` continues the conversation; exit 2 also prevents stopping. **This is the "verification that actually fails the task" mechanism.** | https://code.claude.com/docs/en/hooks |
| 4.6 | `SubagentStop` has the same semantics | **verified** | Honors `continue`, `stopReason`, `systemMessage`. Lets verification gate a subagent, not just the main session. | https://code.claude.com/docs/en/hooks |
| 4.7 | Conditional hook firing by tool pattern | **verified** | `matcher` on the event group, plus a per-handler `if` using permission-rule syntax: `"if": "Bash(git *)"`, `"if": "Edit(*.ts)"`. | https://code.claude.com/docs/en/hooks |
| 4.8 | Hook receives structured JSON on stdin | **verified** | Common: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, `agent_id`, `agent_type`, `effort`. Tool events add `tool_name`, `tool_input`, `tool_use_id`. | https://code.claude.com/docs/en/hooks |
| 4.9 | Hook knows which agent triggered it | **verified** | `agent_type` carries the subagent `name`. Enables per-agent phase enforcement from a single script. | https://code.claude.com/docs/en/hooks |
| 4.10 | Hook handler types | **verified** | `command`, `http`, `mcp_tool`, `prompt` (LLM call, default fast model), `agent`. Phase 1 uses `command` only. | https://code.claude.com/docs/en/hooks |
| 4.11 | Portable path placeholders | **verified** | `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`. `${CLAUDE_PLUGIN_ROOT}` is how plugin-shipped hooks locate their own scripts on any machine. | https://code.claude.com/docs/en/hooks |
| 4.12 | Exec-form hook commands (no shell quoting) | **verified (wording corrected 0.1.3)** | `command` is **always a string**. Exec form is `"command": "node"` plus a separate `"args": ["${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs", "--flag"]`; with no `args` the string is handed to a shell. **There is no array form of `command`.** The previous wording here — "`"command": [...]` via the `args` field" — was read as one and shipped in v0.1.2; see 4.21 for what that cost. | https://code.claude.com/docs/en/hooks |
| 4.13 | Choosing the hook shell | **verified / avoided** | `"shell": "bash" \| "powershell"`, defaults to bash. Avoided: Phase 1 invokes `node` directly so no shell assumption is made. | https://code.claude.com/docs/en/hooks |
| 4.14 | Hooks shippable inside a plugin | **verified** | `hooks/hooks.json` at plugin root, same object shape as the `hooks` key in `settings.json`. Multiple hook sources merge. | https://code.claude.com/docs/en/plugins |
| 4.15 | Hooks still run under `bypassPermissions` | **unverified** | Docs say PreToolUse hooks "run before the permission prompt, for every tool except EndConversation" and a hook exiting 2 "stops the tool call before permission rules are evaluated". Behaviour under `bypassPermissions` is not stated. **Fallback: the system is not certified under that mode. See ARCHITECTURE.md section 7.** | https://code.claude.com/docs/en/permissions |
| 4.16 | Hooks can be globally disabled | **verified** | `--settings '{"disableAllHooks": true}'`. A deliberate operator override, named as such in the risk policy. | https://code.claude.com/docs/en/permissions |
| 4.17 | **A hook that times out FAILS OPEN** | **verified (critical)** | "Command/HTTP/MCP tool hook: canceled, output discarded, **no decision rendered**... PreToolUse: timed-out hook doesn't block; call continues through normal permission flow." **A slow checker silently disables enforcement.** Drives the fail-closed wrapper in ARCHITECTURE.md section 6.4. | https://code.claude.com/docs/en/hooks |
| 4.18 | **A hook that crashes FAILS OPEN** | **verified (critical)** | Exit codes other than 0 and 2: "For most events: non-blocking by default... If invalid JSON or plain text: non-blocking error (**action proceeds**, transcript shows notice with first line of stderr)." **A crashed checker silently disables enforcement.** Same driver as 4.17. | https://code.claude.com/docs/en/hooks |
| 4.19 | Explicit per-handler timeout | **verified** | `timeout` in seconds, default 600 for command hooks. Must be set explicitly; the default is long enough to hide a hung checker for ten minutes. | https://code.claude.com/docs/en/hooks |
| 4.20 | `async: true` hooks do not block | **verified** | Runs in background without blocking. Correct for advisory `PostToolUse`, **wrong for any gate**. | https://code.claude.com/docs/en/hooks |
| 4.21 | **One schema error in `hooks.json` drops EVERY hook, silently** | **verified (critical, observed)** | v0.1.2 put the argv array in `command`. Claude Code's plugin loader rejected all eight entries with `Invalid input: expected string, received array`, and the plugin then **installed cleanly and registered zero hooks** — no risk guard, no standards gate, no phase gate, no per-agent edit scope, and nothing said so in the session. The failure mode is not "that hook is skipped", it is "the enforcement layer is absent and the install looks fine". Errors are visible only under `/plugin → <plugin> → Errors`. **Rejection is per-file, so a single typo anywhere disarms everything.** | Observed, Gate 3, 2026-08-28 |
| 4.22 | `--plugin-dir` does NOT exercise the loader's hook schema validation | **verified (constraint, observed)** | The whole of Phase 1 was developed under `--plugin-dir` (6.9) with a `hooks.json` the real loader rejects outright, and nothing local ever complained. Local development cannot catch 4.21. **The only pre-release detectors are `claude plugin validate --strict` (6.10) and a real marketplace install.** | Observed, Gate 3, 2026-08-28 |

---

## 5. Permission system (`settings.json`)

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 5.1 | Settings precedence | **verified** | Managed > `--settings` CLI > `.claude/settings.local.json` > `.claude/settings.json` > `~/.claude/settings.json`. Lists merge rather than override. | https://code.claude.com/docs/en/settings |
| 5.2 | Deny beats allow at every scope | **verified** | "If a tool is denied at any level, no other level can allow it." A user-level deny blocks a project-level allow. | https://code.claude.com/docs/en/permissions |
| 5.3 | A blocking hook beats an allow rule | **verified** | "A hook that exits with code 2 stops the tool call before permission rules are evaluated, so the block applies even when an allow rule would otherwise let the call proceed." | https://code.claude.com/docs/en/permissions |
| 5.4 | A deny rule beats a permissive hook | **verified** | "Hook decisions don't bypass permission rules... a matching deny rule blocks the call." **Deny rules and hooks are genuinely independent layers.** | https://code.claude.com/docs/en/permissions |
| 5.5 | Bash rule syntax and its limits | **verified** | `Bash(npm run *)`; `*` matches any text. Shell operators respected — each subcommand is matched independently. Wrappers stripped: `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, bare `xargs`. **NOT stripped:** `npx`, `docker exec`, `devbox run`, `mise exec`, `direnv exec`. `watch`, `setsid`, `flock`, and `find -exec/-delete` cannot be prefix-approved. | https://code.claude.com/docs/en/permissions |
| 5.6 | Bash argument-constraining rules are fragile | **verified (documented weakness)** | Docs explicitly warn that option reordering, protocol change, redirects, variables, and extra spaces all defeat argument patterns. **This is why every tier-3 rule is duplicated as a PreToolUse hook.** | https://code.claude.com/docs/en/permissions |
| 5.7 | Read/Edit path rules (gitignore syntax) | **verified** | `//abs`, `~/home`, `/relative-to-settings-source`, `path` or `./path` relative to cwd. A `Read` deny also blocks Edit and Write on that path (v2.1.208 / v2.1.228+). `Write(...)`, `NotebookEdit(...)`, and `Glob(...)` path rules are accepted but **never consulted** — use `Edit(...)` and `Read(...)`. | https://code.claude.com/docs/en/permissions |
| 5.8 | Read/Edit deny does not stop subprocesses | **verified (limitation)** | Rules apply to built-in file tools and recognised Bash file commands only, "not to arbitrary subprocesses... like a Python or Node script that opens files itself." **Material limitation, stated in ARCHITECTURE.md section 7.** | https://code.claude.com/docs/en/permissions |
| 5.9 | MCP tool rules | **verified** | `mcp__server`, `mcp__server__*`, `mcp__server__tool`. Settings files **skip any `mcp__` rule containing parentheses** — parameter matching on MCP tools requires `--disallowedTools`. | https://code.claude.com/docs/en/permissions |
| 5.10 | Parameter matching on built-in tools | **verified** | `Tool(param:value)` in deny/ask only. Cannot match primary content fields (`command`, `file_path`, `path`, `url`, `notebook_path`). | https://code.claude.com/docs/en/permissions |
| 5.11 | Agent (subagent) rules | **verified** | `Agent(AgentName)` in deny disables a subagent. | https://code.claude.com/docs/en/permissions |
| 5.12 | Permission modes | **verified** | `default`/`manual`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. `permissions.disableBypassPermissionsMode` and `permissions.disableAutoMode` set to `"disable"` work from **any** scope, including project settings. | https://code.claude.com/docs/en/permissions |
| 5.13 | Project allow rules require workspace trust | **verified** | `permissions.allow` and `additionalDirectories` in `.claude/settings.json` apply only after the trust dialog is accepted for that folder. `deny` and `ask` are unaffected — **they restrict, so they apply immediately.** Trust is keyed on the git repo root. | https://code.claude.com/docs/en/permissions |
| 5.14 | `claude -p` / SDK never show the trust dialog | **verified** | Project allow rules are not used and a warning goes to stderr; `.mcp.json` servers connect without asking. **Consequence: headless Claude runs are outside the design envelope.** | https://code.claude.com/docs/en/permissions |
| 5.15 | Plugins can ship permission rules | **NOT AVAILABLE** | Plugin-root `settings.json` supports **only** `agent` and `subagentStatusLine`; "Unknown keys are silently ignored." **The risk policy cannot travel inside the plugin as deny rules — it must be written per project. See ARCHITECTURE.md section 7.** | https://code.claude.com/docs/en/plugins , https://code.claude.com/docs/en/plugins-reference |
| 5.17 | An `Edit` deny rule also covers the `Write` tool | **verified** | "`Edit` rules apply to all built-in tools that edit files." Docs direct you to use `Edit(docs/**)` in place of `Write(docs/**)`, since `Write(...)` path rules are accepted but never consulted. **This is what makes the control-plane deny rule work with one rule instead of three.** | https://code.claude.com/docs/en/permissions |
| 5.18 | A subprocess can write a path that `Edit` denies | **verified (used deliberately)** | "They don't apply to arbitrary subprocesses that read or write files indirectly, like a Python or Node script that opens files itself." Normally a weakness (5.8). **ARCHITECTURE.md section 4.2 uses it deliberately as the privileged write channel for the control plane, and states the residual risk and its mitigation.** | https://code.claude.com/docs/en/permissions |
| 5.16 | Windows: saved approvals land in the shared file | **verified (gotcha)** | "Yes, and don't ask again" normally writes `.claude/settings.local.json`, but the file "stays with `.claude/settings.json` instead... **on Windows**". **Ad-hoc approvals will pollute the committed risk policy. Mitigation: drift check in `/mavci:doctor`.** | https://code.claude.com/docs/en/settings |

---

## 6. Plugins and marketplace distribution

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 6.1 | Plugin manifest | **verified** | `.claude-plugin/plugin.json` at plugin root. Only `name` is required. Also: `displayName`, `version`, `description`, `author`, `homepage`, `repository`, `license`, `keywords`, `dependencies`, `defaultEnabled`, `userConfig`, plus component path overrides. | https://code.claude.com/docs/en/plugins-reference |
| 6.2 | Plugin can ship agents, skills, commands, hooks, MCP | **verified** | Plugin-root directories: `agents/`, `skills/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `monitors/`, `bin/`, `workflows/`. They must NOT be inside `.claude-plugin/`. | https://code.claude.com/docs/en/plugins |
| 6.3 | Marketplace manifest | **verified** | `.claude-plugin/marketplace.json`. Required: `name` (kebab-case), `owner{name}`, `plugins[]` each with `name` and `source`. | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.4 | Marketplace hosted in a private GitHub repo | **verified** | Sources: GitHub `owner/repo` (optional `@ref`), full git URL, local directory, remote JSON URL. "Private repositories: supported when users have access credentials." | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.5 | Project settings auto-register a marketplace and enable plugins | **verified** | `extraKnownMarketplaces` plus `enabledPlugins` in `.claude/settings.json`. **This is the propagation mechanism.** | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.6 | `extraKnownMarketplaces` requires trusting the exact folder | **verified (constraint)** | Repository-supplied `extraKnownMarketplaces` are "Not used, and no dialog is offered" when only a parent folder was trusted, and "Not used" under `claude -p`/SDK. **One interactive trust acceptance per clone per machine. Documented in the onboarding protocol.** | https://code.claude.com/docs/en/permissions |
| 6.7 | Version-gated updates | **verified** | `version` in `plugin.json` pins the plugin; users receive updates only when it is bumped. Resolution order: plugin.json > marketplace entry > git tag > package manager. | https://code.claude.com/docs/en/plugins-reference |
| 6.8 | Update commands | **verified** | `/plugin marketplace update`, `/plugin update <plugin>@<marketplace>`, `claude plugin marketplace update`. | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.9 | Local development without installing | **verified** | `claude --plugin-dir ./my-plugin` (also accepts `.zip`); the local copy takes precedence over an installed plugin of the same name. `/reload-plugins` picks up changes. | https://code.claude.com/docs/en/plugins |
| 6.10 | Plugin validation in CI | **verified (now wired, 0.1.3)** | `claude plugin validate ./your-plugin`, `--strict` treats warnings as errors. It validates `hooks/hooks.json` against the loader's own schema and needs no authentication. Confirmed to reproduce the eight 4.21 errors exactly on the v0.1.2 tree. Runs in `validate.yml` and `release.yml` — **Claude Code's validator is the authority; `check-plugin.mjs` is the local second opinion that still works with Claude Code absent.** | https://code.claude.com/docs/en/plugins |
| 6.11 | Plugin agent naming and namespacing | **verified** | Agents appear as `plugin-name:agent-name`. **Project/user `.claude/agents/` definitions override same-named plugin agents.** Plugin skills are namespaced `/plugin-name:skill-name` and cannot be shadowed by a project skill. | https://code.claude.com/docs/en/plugins , https://code.claude.com/docs/en/plugins-reference |
| 6.12 | Plugin subagent frontmatter restrictions | **verified (limitation)** | For plugin subagents, `permissionMode`, `mcpServers`, and `hooks` in frontmatter are **ignored**. | https://code.claude.com/docs/en/sub-agents |
| 6.13 | Plugin rename path | **verified** | `renames` map in `marketplace.json` (v2.1.193+). It exists, but it is a migration, not free. | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.14 | Plugin data directory surviving updates | **verified / not used** | `${CLAUDE_PLUGIN_DATA}` resolves to `~/.claude/plugins/data/{id}/`. Machine-local, so it is not used for system state. | https://code.claude.com/docs/en/plugins-reference |
| 6.15 | Pinning a marketplace to a git ref, CLI form | **verified** | `claude plugin marketplace add owner/repo@v2.0`. This is the verified rollback lever. | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.16 | Pinning a ref inside the `extraKnownMarketplaces` source object | **unverified** | The documented source object is `{"source":"github","repo":"owner/repo"}`. Whether a ref can be embedded there, as a `@v0.1.0` suffix on `repo` or a separate field, is **not stated**. **Fallback: the primary rollback is roll-forward by revert-and-retag in the system repo, which is fully verified. See ARCHITECTURE.md section 13.** | https://code.claude.com/docs/en/plugin-marketplaces |
| 6.17 | Overriding an installed plugin locally for one session | **verified** | `claude --plugin-dir ./my-plugin`: "When a `--plugin-dir` plugin has the same name as an installed marketplace plugin, the local copy takes precedence for that session." **This is the emergency single-machine rollback lever.** | https://code.claude.com/docs/en/plugins |
| 6.18 | Marketplace `source: "github"` resolves over **SSH** | **verified (constraint, observed)** | `{"source":"github","repo":"owner/repo"}` clones over SSH. On a machine with no SSH key loaded the clone fails, the marketplace never resolves, the plugin never installs — and therefore no hook is registered and nothing is enforced. The explicit HTTPS form, `{"source":"url","url":"https://github.com/owner/repo.git"}`, goes through the machine's ordinary git credential helper and works. **`templates/project.settings.json` uses the HTTPS form from 0.1.3, and `doctor` fails the `github` form.** | https://code.claude.com/docs/en/plugin-marketplaces , observed Gate 3, 2026-08-28 |
| 6.19 | The marketplace clone needs a **non-interactive** credential before launch | **verified (constraint, observed)** | Claude Code cannot prompt while resolving `extraKnownMarketplaces`: it fails with `unable to get password from user` on a machine where an interactive `git clone` of the same private repo succeeds. Having credentials "available" is not enough — they must resolve without a prompt: `gh auth setup-git`, a configured credential helper, or `GH_TOKEN`/`GITHUB_TOKEN`. **This is a third onboarding prerequisite, not a footnote to the first.** See ARCHITECTURE section 2. | https://code.claude.com/docs/en/plugin-marketplaces , observed Gate 3, 2026-08-28 |
| 6.20 | A marketplace in `settings.json` auto-installs with no `/plugin install` | **verified (observed)** | Gate 3 confirmed the propagation mechanism end to end: with `extraKnownMarketplaces` + `enabledPlugins` committed and the folder trusted, the marketplace cloned and `mavci-core@mavci` 0.1.2 installed on launch, with no manual `/plugin install`. **6.5 is now observed, not merely documented.** | Observed, Gate 3, 2026-08-28 |

---

## 7. MCP servers

| # | Capability | Status | Evidence | Doc URL |
|---|---|---|---|---|
| 7.1 | Project-scoped MCP servers, git-committed | **verified** | `.mcp.json` at project root, "should be checked into version control". Local/user scope lives in `~/.claude.json` (machine-local, not used). | https://code.claude.com/docs/en/mcp |
| 7.2 | `.mcp.json` schema | **verified** | `mcpServers.<name>` with `type` (`stdio`/`http`/`sse`/`ws`), `command`, `args`, `env`, `url`, `headers`, `timeout`, `oauth`. | https://code.claude.com/docs/en/mcp |
| 7.3 | Project server approval | **verified** | Interactive sessions prompt per server; `claude mcp reset-project-choices` resets. Non-interactive loads without prompting. Approvals are read only from trusted folders (v2.1.196+). | https://code.claude.com/docs/en/mcp |
| 7.4 | Restricting MCP tools by permission rule | **verified** | See 5.9. Connector tools are addressable as `mcp__claude_ai_Supabase__*` and `mcp__claude_ai_Vercel__*`. | https://code.claude.com/docs/en/permissions |

---

## 8. Requested capabilities with NO verified native support

| Requested capability | Native support | Fallback designed |
|---|---|---|
| **One reusable agent prompt template all agents inherit** ("never hand-write a prompt per agent again") | **not available.** There is no include, inherit, or partial mechanism for the body of `agents/*.md`. `skills:` preload is the nearest native feature and its behaviour with plugin-namespaced names is unverified (1.11). | **Custom code, justified:** a roughly 100-line zero-dependency Node generator (`scripts/build-agents.mjs`) renders `agents/*.md` from `agent-defs/*.yaml` plus one contract template. Generated files are committed plain markdown and keep working if the generator is deleted. ARCHITECTURE.md section 5. |
| **Shipping permission / deny rules with the plugin** | **not available** (5.15). | Rules are written into each project's `.claude/settings.json` by `/mavci:new-project`, and drift from the canonical template is detected by `/mavci:doctor`. The auto-propagating half of the risk policy is the PreToolUse hook, which *can* ship in the plugin. ARCHITECTURE.md section 7. |
| **Cross-machine agent memory or learning** | **not available.** Auto memory is explicitly machine-local (3.7); subagent `memory` uses the same directory family. | Lessons are plain markdown committed to the project repo (`.mavci/lessons/`) and promoted into the system repo by `/mavci:retro`. ARCHITECTURE.md section 10. |
| **A cross-project state or task database** | **not available**, and not wanted. | One JSON or markdown file per entity inside each project repo. Aggregation is a future read-only pass over those files. ARCHITECTURE.md sections 4 and 11. |
| **Enforcement from CLAUDE.md prose** | **explicitly contradicted** (3.5). | Three-layer model: knowledge (skills) / verification (Node checker wired to `Stop` and `PostToolUse` hooks plus CI) / scaffolding. ARCHITECTURE.md section 6. |
| **Guaranteed enforcement under `bypassPermissions` or `claude -p`** | **unverified / explicitly weakened** (4.15, 5.14, 6.6). | Out of scope. The system is certified for interactive sessions in `default`, `acceptEdits`, or `plan` mode. `permissions.disableBypassPermissionsMode: "disable"` is set in every project's settings (5.12). CI runs the checker with no Claude involved at all. |

---

## 9. Version-sensitivity register

Surfaces most likely to break when Claude Code changes, ordered by blast radius:

| Surface | Why fragile | Detection |
|---|---|---|
| Hook JSON output schema (`hookSpecificOutput`, `permissionDecision`, `continue`) | Richest and newest API. A silent schema change turns hard blocks into no-ops without any error. | `scripts/selftest-hooks.mjs` asserts a known-bad command is actually blocked; run by `/mavci:doctor` and in CI. |
| Hook event names | 31 events and growing; renames are possible. | Same self-test; a `SessionStart` hook warns if the running version is below the recorded minimum. |
| `extraKnownMarketplaces` trust semantics | Changed as recently as v2.1.196 through v2.1.238 per the docs. | `/mavci:doctor` reports whether the plugin actually loaded. |
| Plugin subagent frontmatter exclusions (6.12) | Already an exception list, likely to shift. | Nothing in the design depends on the excluded fields. |
| `skills:` preload with namespaced names (1.11) | Unverified today. | The fallback path is the default; preloading is an optimisation only. |

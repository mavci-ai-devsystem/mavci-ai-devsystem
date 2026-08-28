# Mavci AI Development System

A reusable AI software development operating system for multi-tenant SaaS and B2B
web applications on Next.js 14 (App Router), Supabase, Stripe, Resend and the
Anthropic API, deployed to Vercel and Railway.

This repository **is** a Claude Code plugin marketplace. Project repos consume it
as an installed plugin; nothing is copied per project.

- **Design:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **What was verified against Claude Code, and when:** [`docs/NATIVE-CAPABILITIES.md`](docs/NATIVE-CAPABILITIES.md)
- **Phases, acceptance test, open risks:** [`docs/ROADMAP.md`](docs/ROADMAP.md)

---

## One-time setup

### 1. Locked identifiers

Already set in `plugins/mavci-core/scripts/config.mjs`. Do not change them: they
are written into every project's committed settings and CI workflow, so a rename
means editing every project repo by hand (ARCHITECTURE section 12).

| | |
|---|---|
| System repo | `mavci-ai-devsystem/mavci-ai-devsystem` (private) |
| Marketplace | `mavci` |
| Plugin | `mavci-core` |
| State directory | `.mavci/` |
| CI secret | `MAVCI_TOKEN` |

### 2. Push, with a matching tag

```bash
git remote add origin git@github.com:mavci-ai-devsystem/mavci-ai-devsystem.git
git push -u origin main
git tag v0.1.0 && git push --tags
```

The tag matters: every project's CI clones the system at
`v<state.json.plugin_version>`. `release.yml` fails a tag that disagrees with
`plugin.json`.

### 3. CI token

Create a fine-grained PAT at
[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
resource owner `mavci-ai-devsystem`, **only** the `mavci-ai-devsystem` repository,
permission **Contents: Read-only**, nothing else. Then, in each project repo:

```bash
gh secret set MAVCI_TOKEN --body "<token>"
```

`mavci-ai-devsystem` is a user account, not a GitHub organisation, so there is
no `--org` shortcut that sets this once for every project. The secret goes on
each project repository individually.

Record the expiry in each project's `.mavci/project.json`:

```json
"ci": { "token_secret": "MAVCI_TOKEN", "token_expires": "2027-08-28" }
```

GitHub exposes no API for a secret's expiry, so that date is the only thing
`/mavci-core:doctor` can warn on. It warns 30 days out. Without it, the token
lapses silently and CI fails with "repository not found".

### 4. Per machine, once

```bash
gh auth login          # required: the system repo is private
gh auth setup-git      # required: the credential must resolve WITHOUT a prompt

claude plugin install mavci-core@mavci --scope user
```

This is **three steps, not zero**, and each one is paid once on the machine and
never again.

The system repo is private, so the marketplace is cloned with the machine's git
credentials — and it is not enough for them to exist. Claude Code cannot prompt
while resolving `extraKnownMarketplaces`: it fails with
`unable to get password from user` on a machine where an interactive
`git clone` of the same repo works fine. `setup-git` (or `GH_TOKEN`) is what
makes the credential non-interactive.

The install is what anchors the plugin to the **machine** rather than to one
directory. `--scope user` is not optional and the in-session `/plugin install`
is not a substitute: it takes no scope argument, so run in a project whose
settings enable the plugin it records
`{"scope":"project","projectPath":"<that one directory>"}` — and a pin with no
user-scope record behind it is the only answer the resolver has for every
*other* project on the machine. Observed: a second project with identical
settings and trust accepted then loaded no agents and no hooks, silently.
`/mavci-core:doctor` FAILs that state and prints the way out.

Then in any project, on first launch, accept the workspace trust dialog. Without
it, repository-supplied `extraKnownMarketplaces` entries are ignored — this is
documented Claude Code behaviour, not a bug. That dialog is the **whole**
per-repo cost; the project itself needs no setup.

---

## Using it

```bash
# once per machine, from a terminal - see "Per machine, once" above.
# The https:// URL is required: the shorter owner/repo form resolves over SSH.
claude plugin marketplace add https://github.com/mavci-ai-devsystem/mavci-ai-devsystem.git
claude plugin install mavci-core@mavci --scope user

# then, in each project repo - accept the trust dialog on first launch
claude
/mavci-core:connect        # existing repo  (the normal case)
/mavci-core:new-project    # greenfield
```

Never `/plugin install` from inside a session: it has no `--scope` argument and
pins the plugin to whichever directory you happened to be in.

Then: `/mavci-core:plan` → `/mavci-core:build` → `/mavci-core:verify`.

### Propagating a change to every project

```bash
# here
node plugins/mavci-core/scripts/build-agents.mjs      # if an agent changed
# bump version in plugins/mavci-core/.claude-plugin/plugin.json
git tag v0.2.0 && git push --tags

# in any project, on any machine
/plugin marketplace update && /plugin update mavci-core@mavci
/mavci-core:doctor --sync
```

No project file is edited except the one recorded version field, which is the
point: local and CI cannot silently diverge.

### Rolling back a bad release

Never `disableAllHooks` — it kills enforcement everywhere, permanently, and
nothing reminds you to turn it back on. Use one of the three levers in
[`ARCHITECTURE.md` section 13](docs/ARCHITECTURE.md). Primary is roll-forward:
`git revert`, bump the patch version, re-tag, `/plugin update`.

---

## Layout

```
.claude-plugin/marketplace.json    the marketplace manifest
plugins/mavci-core/
  agents/          GENERATED from agent-defs/ - do not hand-edit
  skills/          slash commands and the standards knowledge layer
  hooks/           risk guard, standards gate, redaction sweep
  scripts/         the six custom scripts, Node ESM, zero dependencies
  templates/       schemas, risk policy, scaffold, fixtures, CI workflow
                   INSIDE the plugin: only this subtree is installed
agent-defs/        _contract.md + one JSON per agent  <- edit agents HERE
scripts/ci/        the checks that run in validate.yml and selftest.yml
docs/
```

## Running the checks locally

```bash
node plugins/mavci-core/scripts/build-agents.mjs --check   # agents in sync
node plugins/mavci-core/scripts/redact.mjs --selftest      # secret redaction
node scripts/ci/check-schemas.mjs                          # schemas + validator
node scripts/ci/check-fixtures.mjs                         # every rule, both fixtures
node scripts/ci/check-risk-guard.mjs                       # 52 enforcement cases
node scripts/ci/check-gate.mjs                             # fail-closed paths + sentinel
node scripts/ci/check-plugin.mjs                           # plugin structure
node scripts/ci/check-escape-hatch.mjs                     # runs with no Claude Code
```

## Zero dependencies, on purpose

There is no `package.json` in this repository, and `selftest.yml` fails if one
appears. Everything runs on `node` alone, in a container with Claude Code not
installed. That is what makes the escape hatch real: every artefact this system
produces — specs, verdicts, standards, agent definitions, the checker itself —
stays usable without the system. The work product is portable; only the
automation is Claude Code specific.

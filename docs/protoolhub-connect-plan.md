# Plan: connecting ProToolHub — pre-run analysis against v0.1.14

Written 2026-09-01, before any command is run. Nothing has been written to
`C:\Projelerim\protoolhub-main`. Every number below was measured by running the
real rule set in memory against the real repository, not estimated.

---

## 0. Stop here first — this is not a Mavci finding, and it outranks the plan

`cookies/youtube.com_cookies.txt` is a **complete live Google session cookie
jar**, committed on 2026-03-15 in `54e632c9` ("Deployment hazırlığı"), to a
repository that is **public**.

19 entries, 15 of them session-bearing: `SID`, `HSID`, `SSID`, `SAPISID`,
`APISID`, `__Secure-1PSID`, `__Secure-3PSID`, `LOGIN_INFO` and the `PSIDTS`
/`PSIDCC` pair. That is the full set required to resume an authenticated Google
session without a password and without 2FA. Latest expiry is **2027-04-12** —
still valid for seven months.

Actions, in order, and none of them wait for Mavci:

1. Sign out all sessions on that Google account
   (Google Account → Security → Your devices → Sign out), which invalidates the
   cookies. Change the password. Check for unrecognised app passwords, recovery
   addresses and forwarding rules.
2. `git rm --cached cookies/youtube.com_cookies.txt`, add `cookies/` to
   `.gitignore`, commit.
3. The value stays in git history on a public repo. Assume it was scraped.
   Purging history (`git filter-repo`) is optional after step 1; revocation is
   what actually helps.

`.gitignore` already lists `youtube-cookies.json` and
`youtube-cookies-netscape.txt` — so this was known to be a category of file that
must not be committed, and this one was named differently and slipped past.

### And this is the finding about the system

**The checker does not catch it, and reports two false positives instead.**

- `.txt` is not in `SCANNABLE_EXT` (`config.mjs:256`), so `walk()` never yields
  the file. `secrets.no_committed_secrets` never opens it.
- What the rule *does* report on this repo is two `critical` findings, both
  inside `.cache/.bun/install/cache/zod@3.25.76/src/v4/mini/tests/string.test.ts`
  — a JWT literal in zod's own test suite. There is no key to rotate.

So on the first real project, the secrets rule misses a live credential and
raises two unfixable criticals against a vendored test fixture. That is the
adjacent-but-wrong signal that `CLAUDE.md` documents nine times, occurring in
production rather than in a gate. It is a `/mavci-core:retro` finding and I would
file it before connecting anything.

---

## 1. The blocking verdict: ProToolHub cannot be connected as it stands

**ProToolHub is not a Next.js project.** There is no `next` dependency, no
`next.config.*`, no `app/` directory. It is:

- Vite 7 + React 19 SPA in `client/`
- Express 5 API in `server/`
- Drizzle ORM + `pg` in `shared/` — **not Supabase**
- build is `tsx script/build.ts`; `package.json` name is `rest-express`
- Replit-origin (`replit.md`, `@replit/vite-plugin-*`), deployed via `Dockerfile`
- no Stripe

`project.schema.json` constrains `stack.framework` to
`["nextjs-14-app-router", "nextjs-15-app-router"]`, with
`additionalProperties: false`. There is no value that describes this stack.
`state.mjs --init` calls `assertValid(manifest, schemas().project)` and will
**throw at connect step 4**, before the baseline is ever attempted.

This is the trap to name in advance: the only way past that enum is to write
`nextjs-15-app-router` into the manifest, which is false. That single false value
then turns on the five `nextjs-app-router` rules — which is why the numbers in §3
below are what they are — and turns on nothing that protects Express routes or
Drizzle queries. `stack.db` has the same problem: the enum is
`supabase-postgres | none`, so a real Postgres database has to be declared as
`none`, which silently disables `supabase.rls_enabled` and leaves the
multi-tenant protection the system exists for switched off on a project that has
a database.

**The manifest is the one file everything else reads.** Mis-declaring the stack
to satisfy an enum is not a shortcut; it is writing the wrong premise into the
control plane and then enforcing against it. I am not going to do it silently,
and I would not recommend approving it.

Three honest routes, and my recommendation is the third:

- **A — add the stack to the system.** `vite-react-express` (or similar) as a
  framework enum value, `postgres-drizzle` as a `db` value, and a pack that
  actually checks Express/Drizzle. That is a real system change: new enum, new
  pack, new rules, new fixtures, per invariant 4. Correct, and it is a phase of
  work, not an afternoon.
- **B — connect with `standards.packs: ["legal-tr-kvkk"]` only**, once the enum
  admits the stack. Only the 3 `always` rules plus the legal pack run. Honest,
  low value, but it proves connect end to end on a real repo — which is what you
  actually want to test right now.
- **C — pick a different first project.** If any of your other repos is genuinely
  Next.js + Supabase, connect that one first. The system was built for that
  shape, and the first real connect should test the system, not the exception.
  `MoneyTools_Production` and `AI-Chatbot-Widget-SaaS` are the names worth
  checking.

The reason ProToolHub looked like the safe choice — no revenue at stake — is
still true. It is just not a test of this system; it is a test of a stack this
system does not cover.

---

## 2. What connect actually does, step by step, and what it writes

From `skills/connect/SKILL.md`, verified against the scripts.

**Preflight.** The skill body runs `cat package.json`, `ls next.config.*`,
`find app`, `ls supabase/migrations`, `ls .mavci/project.json`, `git remote -v`
before the model reads anything. It halts if `.mavci/project.json` exists.
ProToolHub has no `.mavci`, so it is a fresh connect.

**Step 1 — detect.** Model reads the stack from `package.json`, greps migrations
for the tenant column. No writes.

**Step 2 — propose the manifest.** Asks you for what cannot be detected:
jurisdictions, required legal pages, the five entity fields, `deploy.site_url`,
risk tier, Supabase refs and which environments are `protected: true`. Shows it
and waits for explicit approval. No writes.

**Step 3 — write config.** Writes `.mavci/project.json`, then
`node render.mjs --config`, which writes exactly three files
(`render.mjs:138` `SHARED_FILES`):

- `.claude/settings.json` — from `templates/project.settings.json`: the
  marketplace registration, `enabledPlugins`, and the permission `ask`/`deny`
  lists.
- `.claude/CLAUDE.md` — from `templates/project.CLAUDE.md`.
- `.github/workflows/mavci-verify.yml`.

Then `.gitattributes` with `* text=auto eol=lf` if absent. ProToolHub has none,
so this is created.

`render.mjs` throws rather than writing an empty value, and re-scans the tree
afterwards for surviving `__TOKEN__` placeholders, exiting 2 if any remain.

**Step 4 — `state.mjs --init`.** Validates the manifest against the schema —
**this is where ProToolHub fails today** — then creates `.mavci/control/tasks/`,
`.mavci/control/verdicts/`, `.mavci/tasks/`, `.mavci/decisions/`,
`.mavci/lessons/`, and writes `control/state.json` (phase `plan`,
`next_task_id: 1`, `baseline_debt: 0`, `plugin_version`), `control/waivers.json`,
and the integrity seal.

**Step 5 — `state.mjs --baseline-init`.** Runs the full rule set and records
every finding as pre-existing. Runs **once, ever** — `baselineInit` throws if
`baseline.json` exists. Refuses outright if any finding is `critical`.

**Step 6 — `gate.mjs --ci`** must exit 0.

**Step 7 — remediation backlog.** One task per `check_id` group, spec written to
`.mavci/tasks/<id>-<slug>.md`.

**Step 8 — report**, including the one manual step: `MAVCI_TOKEN`.

Total footprint: `.mavci/`, `.claude/`, `.github/workflows/mavci-verify.yml`,
`.gitattributes`. Nothing under `client/`, `server/` or `shared/` is touched.

---

## 3. What I measured — the findings, if the framework enum were satisfied

Run in memory against the real repository with a synthetic manifest
(`packs: nextjs-app-router, supabase-multitenant-rls, legal-tr-kvkk`,
all five legal pages, tier `standard`). Nothing was written.

**478 findings. 470 of them — 98% — are in `.cache/`.**

`.cache/.bun` is a **committed Bun package cache: 47,447 tracked files**. The
repository tracks 47,829 files in total; the application is about 121. `walk()`
does not read `.gitignore`, does not skip dot-directories, and `.cache` is not in
`DEFAULT_EXCLUDE_DIRS` — so the checker yields **35,168 scannable files, 35,023
of them vendored cache**, and reads 140 MB.

By rule:

- `secrets.no_committed_secrets` — **2, critical**, both in `.cache`, both the
  zod JWT test fixture. Unsuppressible. **This alone refuses the baseline at
  step 5.**
- `next.env_centralised` — **315**, of which 312 in `.cache`. Three are real:
  `vite-plugin-meta-images.ts:59`, `server/index.ts:109`, `server/routes.ts:220`.
- `next.regex_no_template_literal` — **156**, all in `.cache`, none real.
- `legal.pages_present` — **5**, all real: privacy, terms, kvkk, cookies and
  contact do not exist. This is the only rule that fires correctly and usefully
  on this project.
- `next.supabase_client_in_function`, `next.route_force_dynamic`,
  `next.no_static_export`, `next.no_service_role_client`,
  `stripe.webhook_signature`, `supabase.rls_enabled`, `legal.kvkk_structure`,
  `settings.marketplace_form` — **0 each**, correctly, because the project has
  no `app/`, no Supabase and no Stripe.

So the genuine signal is **8 findings**: three scattered `process.env` reads and
five missing legal pages.

**The dominating rules and why they false-positive** — this generalises past
ProToolHub:

- `next.env_centralised` is the noisiest rule in the set by an order of
  magnitude. Its allow-list is `lib/env.ts`, `*.config.*`, `scripts/`,
  `middleware.ts`. Anything else reading `process.env` is a blocker. On any repo
  with vendored JS it fires per file; on a legitimately-shaped repo that keeps
  server config in `server/` rather than `lib/env.ts` it fires on correct code.
  Expect this to be the top group on any real Next.js codebase too.
- `next.regex_no_template_literal` flags `new RegExp(\`…${x}…\`)`. That
  construction is common and frequently correct when the interpolated value is a
  known constant. 156 hits here, zero true positives.
- `legal.pages_present` requires exactly `app/**/<slug>/page.tsx`. A project that
  puts legal text anywhere else — `client/src/pages/Privacy.tsx`, as ProToolHub
  would — reports "does not exist" for a page that exists. Path-shaped, not
  content-shaped.
- `next.route_force_dynamic` only ever matches `app/api/**/route.ts`. Express
  routes are invisible to it. This is the rule `CLAUDE.md` already records as
  having been discarded as a Gate-4 test candidate for exactly this reason.

**The fix for 470 of the 478 is one manifest field**, and it is the right fix:

```
"checks": { "exclude_paths": [".cache/**", ".local/**", "attached_assets/**"] }
```

`collectFiles` applies it (`verify.mjs:53`) and `globToRegExp` handles `**`
correctly — I checked. It filters after the directory walk, so the 1.8 s of
`readdir` remains but the 9.5 s of file reading goes away.

**But note what that means, and it is a system finding.** `exclude_paths`
suppresses `critical` findings, which neither baseline nor waiver is allowed to
do. It is an unaudited bypass of the one severity class the system declares
unsuppressible, sitting in the manifest, with no check on it. Here it happens to
be correct. It would be equally effective at hiding a real key. Second retro item.

**Timing, and the 30 s Stop hook.** Cold read of those 35k files was **9.5 s**;
a warm full-rule pass was about **5 s**. The Stop hook — the gate — has
`timeout: 30` in `hooks.json`. That is not a comfortable margin on Windows with a
cold filesystem cache, and a timeout is the worst outcome available: the hook is
cancelled, renders no decision, and the turn passes unverified. With
`exclude_paths` set this drops to well under a second and the risk disappears.

---

## 4. The baseline question, answered specifically

You asked whether a real violation gets baselined on day one and never looked at
again. The mechanism is worse than that in one specific way, and better in
another.

**The key is `check_id + path`. Not the line. Not the evidence. Not the
occurrence count.** `isBaselined()` at `state.mjs:336` compares exactly those two
fields, and `dedupeEntries` collapses everything else. So:

- Baselining `next.env_centralised` at `server/routes.ts` suppresses **every
  `process.env` read in that file, forever** — including ones added tomorrow.
  The rule only ever reports the *first* match per file
  (`matchAll(...)[0]`, `rules/index.mjs:322`), so one entry retires the whole
  file. On a 1,400-line `routes.ts` that is a large, permanently silent surface.
- The same is true for every per-file rule. The baseline is file-granular, and
  new violations of an already-baselined rule in an already-baselined file are
  invisible. That is the real answer to your question: not "an old violation is
  forgotten" but "**that file stops being checked for that rule**".

What protects you:

- `critical` is never suppressible — `classify()` checks
  `UNSUPPRESSIBLE_SEVERITIES` before consulting the baseline, and
  `baselineInit` refuses to write one at all.
- Entries can only be **removed** (`--baseline-prune`), never added. Debt can
  only shrink. New files and new rules are fully checked.
- `state.json.baseline_debt` carries the count, and doctor reports it.

What does not protect you:

- Nothing re-reads a baselined finding. `--baseline-prune` only removes entries
  whose violation has *stopped occurring*; it never re-surfaces one.
- Step 7's remediation backlog is the only mechanism that makes the debt
  visible again, and it is prose written by the model into `.mavci/tasks/`. If
  connect ends before step 7 — which it will, here — there is no backlog and the
  baseline is the only record.
- **Renaming a file un-baselines it.** The key is the path. Move
  `server/routes.ts` and 1 entry stops matching and the finding returns as a
  live blocker. Expect this to bite during any refactor.

**Concretely for ProToolHub:** if the two zod criticals were excluded and the
baseline were written, it would record 476 entries, 470 of them naming files in a
vendored cache. The debt count would read "476" forever, the backlog would be six
tasks of which four are noise, and the three real `process.env` findings would be
buried in a group of 315. That is the argument for setting `exclude_paths`
*before* `--baseline-init`, not after: the baseline is written once and cannot be
added to, but it also cannot be *re*-generated, so a baseline taken over the
cache is permanent noise.

---

## 5. What you have to prepare

**MAVCI_TOKEN — and there is an access problem.**
The remote is `mavcimavci1983-create/pro-tool-hub`. Your active `gh` account is
`mavci-ai-devsystem`, and `gh repo view` reports `viewerPermission: READ`. **You
cannot set a repository secret with READ.** `mavcimavci1983-create` is not among
the accounts logged in here (only `mavci-ai-devsystem` and `globalmvpllc-oss`
are). So you will need to `gh auth login` as `mavcimavci1983-create`, or set the
secret in the web UI while signed in as that account.

The token itself is unaffected by which account sets it: fine-grained PAT,
resource owner `mavci-ai-devsystem`, repository access limited to
`mavci-ai-devsystem/mavci-ai-devsystem`, permission Contents → Read-only, nothing
else. Record its expiry as `ci.token_expires` — doctor warns 30 days out and
GitHub exposes no API for it.

**The repository is PUBLIC.** Two consequences worth deciding on knowingly.
`compliance.entity` requires legal name, address, email, MERSIS and KEP, and the
manifest is committed — so those become public. They would appear on the legal
pages anyway, so this is mild, but it should be a decision. The other: on a
public repo the workflow's `on: pull_request` runs for fork PRs, secrets are not
passed to fork PRs, and the `MAVCI_TOKEN` presence check fails with an error on
every one. Add a branch filter.

**Supabase refs — there are none.** The project uses Drizzle + `pg`. So
`environments.*.supabase_ref` is absent everywhere, and that is honest. But note
what it costs: `risk-guard`'s protected-environment logic
(`risk-guard.mjs:456-470`) builds its protected set from `supabase_ref` values
and compares MCP call payloads against it. **With no Supabase ref, that entire
arm is inert.** And `doctor` FAILs on "this environment reads as protected and is
not" (v0.1.6 check) if you mark `prod` as `protected: true` with no ref. So you
either mark prod unprotected, which is false, or take a permanent doctor FAIL.
There is no third option today. Third retro item.

Whatever guards the real production database — Railway Postgres — nothing in
this system currently sees.

**Entity details.** Legal name, registered address, contact email, MERSIS number,
KEP address. All five are schema-required. Have them to hand before you start;
`render.mjs` throws by name if one is missing.

**Risk tier.** `standard`. Not `sandbox`: at sandbox,
`risk-guard.mjs:761` downgrades deploys to `confirm()`, and `confirm()` emits
`deferToUser`, which is the carried-forward item 7 defect — Claude Code rejects
that value, no decision is applied, and the call falls through to the ordinary
permission flow. The `Bash(railway up*)` deny in `project.settings.json` would
still catch it, but you would be relying on the belt after quietly cutting the
braces. `standard` gives you a real `deny()`.

**Railway vs Vercel — narrower than you think, but not empty.**
Your premise is partly wrong, and in your favour: the manifest **does** support
Railway. `deploy.target` enum includes `railway`, `env_sources.runtime` includes
`railway-env`, and `$defs.environment` has a `railway_project` field. Nothing in
the manifest forces Vercel.

What is actually Vercel-shaped:

- **The scaffold's legal pages name Vercel as the hosting sub-processor** —
  `scaffold/app/(legal)/kvkk/page.tsx:22` and `privacy/page.tsx:19` say
  "barındırma için Vercel". Connect does **not** render the scaffold, so this
  does not reach ProToolHub. It would be wrong for any Railway project created
  with `/mavci-core:new-project`, and it is wrong in a legally load-bearing
  place — a KVKK aydınlatma metni that names the wrong data processor.
- **Risk-guard covers exactly one Railway command.** `HARD_BLOCK`
  (`risk-guard.mjs:384-386`) has two `vercel --prod` forms and `railway up`.
  Not covered: `railway redeploy`, `railway run` (executes with production env
  injected), `railway variables --set` (writes production env), `railway down`
  (tears down a deployment), `railway link` / `railway environment` (silently
  repoints every later command at prod). `project.settings.json`'s deny list has
  the same single `Bash(railway up*)` entry and eight Vercel MCP entries. The
  Vercel surface is covered through both Bash and MCP; the Railway surface is
  covered by one string.
- **There is no Railway MCP server**, so everything goes through the `railway`
  CLI and the gaps above are the whole story.
- **The deploy trigger is different in kind.** Railway's default is deploy-on-push
  from the production branch. So on ProToolHub `git push origin main` **is** a
  production deploy, and risk-guard's response to a prod-branch push is
  `confirm()` at `risk-guard.mjs:772` — the inert `deferToUser`. What actually
  stops it is `Bash(git push *)` sitting in the settings `ask` list. It holds,
  but by accident rather than by design: the tier-2 layer meant to catch this is
  the one known to be dead.

Fourth retro item: the Railway command table and the scaffold's hosting
sub-processor should both be derived from `deploy.target`, not hardcoded to one
provider.

**CI will fail on its first run for reasons unrelated to Mavci.**
`mavci-verify.yml` hardcodes `npm ci`, `npx tsc --noEmit`, `npm run build`.
`package-lock.json` exists, so `npm ci` is fine. But **`tsc --noEmit` currently
reports 30 errors** across four files — 26 in `server/routes.ts`, plus
`SecurityTools.tsx`, `queryClient.ts` and `ImageTools.tsx` — including a genuine
`TS2304: Cannot find name 'e'` at `server/routes.ts:1321`. `npm run build` is
`tsx script/build.ts`, which does not type-check, which is why this has never
surfaced. The workflow also has `on: push` with no branch filter, so it runs on
every push to every branch.

---

## 6. What would be expensive to undo, and the revert

**Cheap and fully reversible.** Everything connect writes is new: ProToolHub has
no `.mavci`, no `.claude`, no `.github/workflows`. Before you commit, the revert
is complete:

```
rm -rf .mavci .claude .github/workflows/mavci-verify.yml .gitattributes
```

Nothing under `client/`, `server/` or `shared/` is touched at any point. If you
have committed, the same delete plus a commit; the files are inert once absent.

**The four things that are not cheap:**

1. **A false `stack.framework`.** The expensive one, and it is expensive because
   it is invisible. The manifest is what every rule, hook and CI run reads.
   Correcting it later means the risk-guard raises a tier-2 confirm on the write,
   the seal has to be re-computed, and — because `rulesFor()` keys off
   `standards.packs` — every finding the wrong packs produced is already in a
   baseline that **cannot be regenerated**. This is the one I would not accept.

2. **A baseline taken over `.cache/`.** `--baseline-init` runs once, ever. There
   is no regenerate. 476 entries, 470 noise, permanent, and the debt counter
   reads 476 for the life of the project. The revert is deleting the whole
   `.mavci/` directory and re-running connect from scratch — which is fine
   *before* you commit and start work, and unpleasant after. Set
   `checks.exclude_paths` in the manifest at step 2, before step 5.

3. **`.gitattributes` with `* text=auto eol=lf`.** I checked: 0 of 400 sampled
   application files use CRLF, so the application is safe. The risk is
   `.cache/.bun`'s 35,000 vendored files, whose endings are unknown and which git
   will renormalise on the next checkout — potentially a five-figure-file diff
   that buries every real change. Either delete `.cache/` from the repository
   first (recommended anyway), or add `.cache/** -text` alongside.

4. **Rotating a key that does not exist.** Step 5's instruction on a critical
   finding is "tell the operator to remove the value and rotate the key at the
   provider, and stop." Pointed at zod's test fixture, that is an instruction to
   act on a non-existent credential. Costs an afternoon, not data — but note it
   is the third distinct instance in this analysis of a remedy addressed to
   someone who cannot carry it out.

---

## 7. Predictions — what I expect to break, named before the run

In order, with confidence.

1. **`state.mjs --init` throws at step 4** on
   `stack.framework: must be equal to one of the allowed values`. Near-certain —
   the enum has no value for this stack. Connect never reaches the baseline.
2. **If the enum is satisfied by writing a false value, `--baseline-init` refuses
   at step 5** with 2 criticals, both zod test fixtures in `.cache`. Near-certain
   — measured.
3. **The model proposes `nextjs-15-app-router` to get past 1.** This is the
   prediction I care about most, because it is a prediction about the agent, not
   the code. The enum offers two values, neither true, and every downstream step
   depends on picking one. `next-themes` in `package.json` is exactly the kind of
   near-miss evidence that makes the wrong answer feel supported. Watch for it.
4. **The Stop hook times out at least once** on a full-repo run before
   `exclude_paths` is set. 30 s budget, 9.5 s measured cold read plus rule time
   on Windows. Likely, and it will be intermittent rather than reproducible,
   which is the expensive kind.
5. **CI red on first push** at `Types` — 30 pre-existing `tsc` errors. Certain,
   and unrelated to Mavci; it will read as "Mavci broke CI".
6. **`MAVCI_TOKEN` cannot be set from the active account** — READ permission on
   `mavcimavci1983-create/pro-tool-hub`. Certain, measured.
7. **`legal.pages_present` reports five missing pages that may partly exist**
   under `client/src/pages/`. The rule is path-shaped and only looks under
   `app/`. Likely a partial false positive.
8. **doctor FAILs on protected-environment-with-no-ref**, or you declare
   production unprotected. No third option with a non-Supabase database.

What I expected to break and can now **rule out**, with evidence:

- **Version shadowing / skew** (carried-forward items 1 and 2).
  `installed_plugins.json` holds exactly one record for `mavci-core@mavci`:
  `scope: user`, `version: 0.1.14`, commit `f2a22ba`. No project pin. The
  marketplace clone is at `f2a22ba`. Clean.
- **The CI tag pin.** `v0.1.14` exists both locally and on the remote — I checked
  `git ls-remote --tags`. All fifteen tags are pushed. The
  `ref=v$plugin_version` clone will resolve.
- **`.gitattributes` renormalising the application.** Already LF.
- **`.claude/settings.json` merge damage** (step 3.3). ProToolHub has no
  `.claude`, so there is nothing to overwrite.

---

## 8. What I recommend

**Do the security item in §0 today, independently of everything else.**

Then, before any connect: delete `.cache/` and `.local/` from the repository.
They are Replit residue, they are 99.2% of the tracked files, and their removal
takes 470 of 478 findings, the two blocking criticals, the hook-timeout risk and
the `.gitattributes` risk off the table at once. That is one `git rm -r --cached`
and a `.gitignore` line, and it is worth doing whether or not you ever connect
this project.

Then pick from §1. My recommendation is **C, then A**: connect a genuinely
Next.js + Supabase project first so the first real run tests the system on the
shape it was built for, and treat "the system covers exactly one stack" as the
Phase 2 finding that ProToolHub just produced. It is a real finding, it came from
a real project, and it cost nothing but a read-only afternoon.

If you would rather push ProToolHub through anyway, **B** is defensible — legal
pack only, `exclude_paths` set, `stack.db: none`, prod unprotected and a doctor
FAIL accepted — provided the framework enum is widened first rather than lied to.
That still proves connect, render, init, baseline, gate and CI end to end on a
real repository, which is the thing you actually want to know.

Four retro items are queued by this analysis: the `.txt` blind spot in the
secrets scanner, `exclude_paths` bypassing `critical`, the inert protected-
environment arm without a Supabase ref, and the provider-hardcoded Railway
command table and scaffold sub-processor.

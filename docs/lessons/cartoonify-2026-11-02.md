<!-- Applied by /mavci-core:retro --apply on 2026-11-02T14:54:36Z
     from project cartoonify, plugin 0.1.36, queued as .mavci/lessons/pending-system-change.md.
     Copied verbatim below this line. Paths inside are relative to the project it was
     filed from, not to this repository. -->

# Queued for the next system release - apply with `/mavci-core:retro --apply`

Recorded: 2026-10-27, plugin 0.1.36, project cartoonify.

Each finding below was filed from inside a project, by whoever hit it, at the moment
they hit it. Nothing here is fixed. `/mavci-core:retro --apply` carries this file into
the system repository; only an operator can run that, and only an operator can delete
this file.

---

# Finding 1 - Live catalog check asserts on a SQL comment that MCP apply strips

Filed: 2026-10-27T19:09:29Z, plugin 0.1.36.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `supabase/checks/0024_live_catalog.sql:139 (instance); architect live-check authoring guidance (cause)`

Task 0024. supabase/checks/0024_live_catalog.sql (written by the architect into the spec's live-check block) asserts the re-created functions with: pg_get_functiondef(to_regprocedure('protoolhub.' || x.n)) not like '%0024 guard start%'. The operator applied migration 20261029000000_protoolhub_account.sql through Supabase MCP (apply_migration, named cartoonify_20261029000000_protoolhub_account). The read-only check then returned 2 rows instead of 0: 'polar_order_paid or polar_reconcile lacks the 0024 guard: polar_order_paid(text,text,text,text,text,integer,text)' and '... polar_reconcile(text)'. Read-only probe of the live bodies: position('--' in pg_get_functiondef) = 0 for all four 0024 functions, i.e. every -- comment was stripped on apply, while 'account_deleted' and 'user_id is null' were present. Comparing live pg_proc.prosrc with the file bodies after removing -- comments and collapsing whitespace: SAME for polar_reconcile, polar_order_paid, delete_account, account_overview. So the code is exactly the migration and the check failed on a comment. Any live check keyed on a comment marker will false-fail on every MCP-applied migration; the operator then has to judge a red check by hand, which trains them to ignore it.

### The assertion, and the broken build it must catch

A live-check assertion must hold on a database where the migration was applied with all SQL comments removed. Concretely: apply the migration with every -- comment stripped (the MCP apply path) to PGlite, run the live check, and require 0 rows; and apply the 0023-era (pre-guard) function bodies, run it again, and require the 'lacks the guard' rows. The broken build it must catch: a check that greps pg_get_functiondef for a comment marker - it returns rows on the stripped-but-correct database (false failure), which this assertion turns red. Prefer asserting on code tokens (e.g. 'v_co.user_id is null' and 'account_deleted') or on a comment-and-whitespace-normalised comparison of prosrc with the migration body.

---

# Finding 2 - Legal page finder cannot see pages under a locale folder (app/(tr)/tr/...)

Filed: 2026-10-27T20:33:40Z, plugin 0.1.36.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/rules/index.mjs findPage (line 600), used by legal.pages_present (616) and legal.kvkk_structure (709)`

Task 0025 moves Turkish pages to the /tr address prefix with a real folder: app/(tr)/tr/(legal)/privacy/page.tsx etc. scripts/rules/index.mjs:600 findPage(files, slug) uses new RegExp('^(?:src/)?app/(?:\([^/]+\)/)*' + slug + '/page\.(tsx|ts|jsx|js|mdx)$'): only route-group segments may sit between app/ and the slug, so app/(tr)/tr/(legal)/privacy/page.tsx never matches. Consequences seen in 0025: (1) the architect had to keep KVKK at app/(tr)/(legal)/kvkk/page.tsx and serve /tr/kvkk through a middleware rewrite, because moving it under tr/ would make legal.pages_present report 'required page "kvkk" does not exist' (blocker) on every turn and switch off legal.kvkk_structure (index.mjs:709, findPage(ctx.files,'kvkk')); (2) findPage returns only the FIRST match (files.find), so with an English page at app/(en)/(legal)/privacy/page.tsx and a Turkish one under app/(tr)/tr/(legal)/privacy/page.tsx, only one language is checked for content and the REVIEW REQUIRED marker; the other language's legal page is invisible to the checker. A locale prefix folder is the standard App Router i18n layout, so this hits every bilingual project.

### The assertion, and the broken build it must catch

Fixture tree with app/(en)/(legal)/privacy/page.tsx (real content) and app/(tr)/tr/(legal)/privacy/page.tsx (empty placeholder), and app/(tr)/tr/(legal)/kvkk/page.tsx with the seven KVKK sections: legal.pages_present must find kvkk (no 'does not exist'), must check EVERY match per slug, and must flag the empty Turkish privacy page. Broken build it catches: the current findPage, which reports kvkk missing and passes the bilingual pair because it only looks at the first match. Also assert app/tr/privacy/page.tsx (plain locale folder, no groups) and app/[locale]/privacy/page.tsx are found.

---

# Finding 3 - No exit to revise an approved spec on an intended change

Filed: 2026-11-02T12:20:38Z, plugin 0.1.36.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs (approval lifecycle) and scripts/risk-guard.mjs (approved-spec edit rule)`

Task 0033: the builder escalated in build because criterion 8 (Lighthouse) failed: the hero poster was the LCP element, local perf 91 vs live 100. The operator chose a spec change, a smaller webp poster. The operator ran state.mjs --set-phase plan. The architect's Edit of .mavci/tasks/0033-video-hero.md was then denied by the risk-guard PreToolUse hook: approved spec sha256 9ce2befa3071, 'only the operator can re-approve'. state.mjs has no command that withdraws or releases a spec_approved record (commands: --approve-spec, --restore-spec, --advance-phase, --block, --set-phase, ...). An operator-intended revision therefore cannot be written to the approved file. Remaining exits: (a) write a new spec file and repoint the surface task's spec field, which works around what the guard protects; (b) --block the task and re-plan it as a new task. The operator chose (b): 0033 blocked, re-planned as 0034, costing a task id and a full re-plan.

### The assertion, and the broken build it must catch

Add an operator-only state.mjs --revise-spec <id> --reason <r>. It requires phase plan, keeps the approved snapshot under .mavci/control/specs/, clears spec_approved and records the reason with a timestamp. Test: approve a spec, --set-phase plan, --revise-spec; an architect Edit of the spec is then allowed, --advance-phase plan->build is refused until --approve-spec runs again, and risk-guard still refuses --revise-spec to an agent caller. The broken build it catches is the current one: after approval no sequence of operator commands makes the spec editable again without changing the task id or the spec path.

---

# Finding 4 - Approval accepts a criteria block that verify cannot parse

Filed: 2026-11-02T12:39:05Z, plugin 0.1.36.

Filed by: not recorded. Either the main session, or an agent that did not declare itself - the queue cannot tell. Treat it as unattributed.

Target: `scripts/state.mjs approveSpec (and the architect's spec-writing guidance)`

Task 0034: the operator approved .mavci/tasks/0034-video-hero-poster.md with state.mjs --approve-spec 0034 (sha fe36c1ec7762), and it moved plan->build->verify. In verify, verify.mjs refused the spec: 'task 0034: the acceptance criteria in .mavci/tasks/0034-video-hero-poster.md could not be read - criterion 8: timeout_ms must be an integer in 1..600000'. Criterion 8 declared timeout_ms 1200000. The same value was in the approved 0033 spec. The architect wrote it, its own proof runs (run outside verify.mjs) never hit the cap, --approve-spec did not parse the block, and --advance-phase did not either. The defect surfaced only after build, when fixing it means changing approved bytes. With no revise path (finding 3), the only exit is --block and a new task id.

### The assertion, and the broken build it must catch

NOT SUPPLIED. Whoever applies this must write one before building the fix: name the broken build the assertion catches, and confirm the assertion FAILS against it first. A check that passes on its first run against the broken build is matching the wrong thing.

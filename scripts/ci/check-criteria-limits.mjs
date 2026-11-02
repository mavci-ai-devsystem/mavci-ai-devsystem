#!/usr/bin/env node
/**
 * An approval accepts nothing verify cannot run. cartoonify finding 4, 2026-11-02.
 *
 * ------------------------------------------------------------- WHY THIS EXISTS
 *
 * Task 0034: the operator approved a spec, it moved plan -> build -> verify, and
 * verify refused it: "criterion 8: timeout_ms must be an integer in 1..600000".
 * Criterion 8 declared 1200000. The same value had been approved once already,
 * in 0033. `--approve-spec` never parsed the block and `--advance-phase` never
 * did either, so the defect surfaced after build - when fixing it means changing
 * approved bytes, and with no revise path the only exit was `--block` and a new
 * task id.
 *
 * The finding supplied no assertion. This is the one it needed: THE BROKEN BUILD
 * IS 0.1.36, WHERE `--approve-spec` RECORDS AN APPROVAL FOR THAT SPEC. L2 below
 * is red against it.
 *
 * The same check runs over the other system limits a criterion can break
 * without any reader noticing until verify: a secret written into a command, a
 * machine-specific or out-of-tree path, a hardcoded plugin version (carried
 * forward item 9), a tier-3 command or a write into the control plane - which the
 * runner executes as a CHILD of verify.mjs, where risk-guard never sees it. Those
 * block approval. A criterion needing something only the operator can supply is
 * a WARNING, printed first, in plain Turkish, naming who must do it - the
 * operator asked for that, in those words: "bu adımda sen gerekeceksin".
 *
 * ------------------------------------------------------------- THE PAIRS
 *
 * Every refusal has a permission beside it (L3, L9). A check that refuses
 * everything satisfies the refusal assertions alone, and this one runs at the one
 * gate where a person decides - a false refusal there trains them to route around
 * it. L9 is the list of ordinary commands that must NOT be flagged.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const STATE = path.join(SCRIPTS, 'state.mjs');
const VERIFY = path.join(SCRIPTS, 'verify.mjs');
const ROUTE = path.join(SCRIPTS, 'route.mjs');
const LIMITS = path.join(SCRIPTS, 'lib', 'criteria-limits.mjs');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

const state = await import(pathToFileURL(STATE).href);
const { PATHS } = await import(pathToFileURL(path.join(SCRIPTS, 'config.mjs')).href);
let limits = null;
try { limits = await import(pathToFileURL(LIMITS).href); } catch (err) {
  bad(`lib/criteria-limits.mjs could not be loaded (${err.message.split('\n')[0]}): nothing checks a `
    + 'criteria block before approval, so an approval can record a spec verify cannot run.');
}

const MANIFEST = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'plugins', 'mavci-core', 'templates', 'fixtures', 'selftest-project.json'), 'utf8'));

function run(cwd, script, args) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: '', CLAUDE_PID: '' },
    });
    return { out, err: '', status: 0 };
  } catch (err) {
    return { out: err.stdout?.toString() ?? '', err: err.stderr?.toString() ?? '', status: err.status ?? -1 };
  }
}
const all = (r) => `${r.out}\n${r.err}`;

/** A fence, built rather than typed, so this source never carries three adjacent backticks. */
const F = '`'.repeat(3);
const block = (entries) => [`${F}mavci-criteria`, JSON.stringify(entries, null, 2), F].join('\n');
const spec = (entries) => ['# Task', '', '## Acceptance criteria', '', block(entries), ''].join('\n');

const cleanup = [];
function makeProject(specText) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-limits-'));
  cleanup.push(tmp);
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  state.init(tmp, MANIFEST);
  run(tmp, STATE, ['--begin-plan', 'limits fixture']);
  fs.writeFileSync(path.join(tmp, PATHS.tasks, '0001.md'), specText);
  const surface = path.join(tmp, PATHS.tasks, '0001.json');
  const s = JSON.parse(fs.readFileSync(surface, 'utf8'));
  s.spec = `${PATHS.tasks}/0001.md`;
  fs.writeFileSync(surface, JSON.stringify(s, null, 2));
  return tmp;
}
const approvalOf = (root) => state.readControlTask(root, '0001')?.spec_approved ?? null;
const snapshots = (root) => {
  const d = path.join(root, PATHS.specSnapshots);
  return fs.existsSync(d) ? fs.readdirSync(d) : [];
};

const OK_CMD = 'node -e "process.exit(0)"';
/* Built at runtime so no secret-shaped literal sits in this repository. */
const FAKE_LIVE_KEY = ['sk', 'live', 'A1b2C3d4E5f6G7h8J9k0'].join('_');

/* The 0034 shape, verbatim in the field that broke it. */
const SPEC_0034 = spec([
  { id: '1', run: OK_CMD },
  { id: '8', needs: ['shell'], run: OK_CMD, timeout_ms: 1200000 },
]);
const CLEAN = spec([
  { id: '1', run: 'npx tsc --noEmit' },
  { id: '2', run: 'grep -q "force-dynamic" app/api/x/route.ts' },
]);

try {
  if (limits) {
    const check = (text) => limits.checkCriteriaLimits(text);
    const errIds = (r) => r.errors.map((e) => e.id);

    /* L1 - the 0034 block is a BLOCKING problem, named by criterion, in Turkish. */
    {
      const r = check(SPEC_0034);
      const text = limits.limitsReport(r);
      if (r.errors.length && /\b8\b/.test(text) && /10 dakika/.test(text)) {
        ok('L1 the 0034 block (timeout_ms 1200000) is blocking, names criterion 8 and the 10-minute limit');
      } else {
        bad(`L1 the 0034 block was not reported as blocking with criterion 8 and "10 dakika": ${text.slice(0, 300)}`);
      }
    }

    /* L2 - THE ASSERTION FINDING 4 DID NOT SUPPLY. --approve-spec refuses it and
     * records nothing: no approval, no snapshot. Red against 0.1.36. */
    {
      const p = makeProject(SPEC_0034);
      const r = run(p, STATE, ['--approve-spec', '0001']);
      if (r.status !== 0 && !approvalOf(p) && snapshots(p).length === 0 && /\b8\b/.test(all(r))) {
        ok('L2 --approve-spec refuses the 0034 spec, names criterion 8, and records no approval or snapshot');
      } else {
        bad(`L2 --approve-spec on the 0034 spec: exit ${r.status}, approval recorded: ${!!approvalOf(p)}, `
          + `snapshots: ${snapshots(p).length}. This is finding 4 - the defect surfaces after build.`);
      }
    }

    /* L3 - the permission half: a clean spec is approved. */
    {
      const p = makeProject(CLEAN);
      const r = run(p, STATE, ['--approve-spec', '0001']);
      if (r.status === 0 && approvalOf(p)) ok('L3 control: a spec with ordinary criteria is approved');
      else bad(`L3 a clean spec was refused (exit ${r.status}): ${all(r).trim().slice(0, 300)}`);
    }

    /* L4 - every blocking kind, each on its own criterion, each named. */
    const KINDS = [
      ['secret literal', { id: '1', run: `curl -H "Authorization: Bearer ${FAKE_LIVE_KEY}" https://api.example.com` , needs: ['network'] }],
      ['absolute Windows path', { id: '1', run: 'node C:\\Users\\someone\\scratch\\check.js' }],
      ['home-relative path', { id: '1', run: 'cat $HOME/notes.txt' }],
      ['hardcoded plugin version', { id: '1', run: 'node "$HOME/.claude/plugins/cache/mavci/mavci-core/0.1.35/scripts/gate.mjs"' }],
      ['tier-3 command', { id: '1', run: 'rm -rf build && npm run build' }],
      ['force push', { id: '1', run: 'git push --force origin main' }],
      ['control-plane write', { id: '1', run: 'echo x > .mavci/control/state.json' }],
      ['reading .env', { id: '1', run: 'cat .env.local | grep KEY' }],
      ['undeclared secret variable', { id: '1', run: 'curl -H "x-key: $STRIPE_SECRET_KEY" localhost:3000/api', needs: ['server'] }],
      ['destructive SQL', { id: '1', run: 'psql -c "DROP TABLE users"' }],
    ];
    for (const [label, c] of KINDS) {
      const r = check(spec([c]));
      if (errIds(r).includes('1')) ok(`L4 blocks: ${label}`);
      else bad(`L4 ${label} was not blocking: ${JSON.stringify(c.run)} -> errors ${JSON.stringify(r.errors)}`);
    }

    /* L4b - and the blocking kinds reach --approve-spec, not only the pure check. */
    {
      const p = makeProject(spec([{ id: '3', run: 'git reset --hard HEAD' }]));
      const r = run(p, STATE, ['--approve-spec', '0001']);
      if (r.status !== 0 && !approvalOf(p)) ok('L4b --approve-spec refuses a tier-3 criterion too');
      else bad(`L4b --approve-spec recorded an approval for a spec running \`git reset --hard\` (exit ${r.status})`);
    }

    /* L5 - warnings: who must do it, and the operator line when it is them. */
    {
      const r = check(spec([
        { id: '1', run: OK_CMD },
        { id: '4', needs: ['browser'], run: OK_CMD },
        { id: '6', needs: ['live-key'], run: OK_CMD },
        { id: '7', needs: ['server'], run: OK_CMD },
      ]));
      const text = limits.limitsReport(r);
      const w = (id) => r.warnings.find((x) => x.id === id);
      if (!r.errors.length && w('4')?.who === 'operator' && w('6')?.who === 'operator' && w('7')?.who === 'agent'
        && /bu adımda sen gerekeceksin/i.test(text) && /kim yapacak/i.test(text)) {
        ok('L5 browser and live-key warn as the operator\'s, server as the agent\'s, and the report says "bu adımda sen gerekeceksin"');
      } else {
        bad(`L5 warnings wrong: ${JSON.stringify(r.warnings)} / ${text.slice(0, 300)}`);
      }
      const agentOnly = limits.limitsReport(check(spec([{ id: '7', needs: ['server'], run: OK_CMD }])));
      if (!/sen gerekeceksin/i.test(agentOnly)) ok('L5b control: an agent-only warning does not say the operator is needed');
      else bad('L5b "sen gerekeceksin" printed when no criterion needs the operator - a line that always fires is read by nobody');
    }

    /* L6 - THE ORDER the operator asked for: warnings first, in the approval output. */
    {
      const p = makeProject(spec([{ id: '1', run: OK_CMD }, { id: '4', needs: ['browser'], run: OK_CMD }]));
      const r = run(p, STATE, ['--approve-spec', '0001']);
      const out = all(r);
      const iWarn = out.search(/sen gerekeceksin/i);
      const iApproved = out.indexOf('spec approved');
      if (r.status === 0 && iWarn !== -1 && iApproved !== -1 && iWarn < iApproved) {
        ok('L6 the approval output opens with the warnings, before the approval line');
      } else {
        bad(`L6 approval output order wrong (exit ${r.status}, warning at ${iWarn}, approval at ${iApproved})`);
      }
      // ...and when it is refused, the warnings still come first.
      const p2 = makeProject(spec([{ id: '4', needs: ['browser'], run: OK_CMD }, { id: '8', run: OK_CMD, timeout_ms: 1200000 }]));
      const r2 = run(p2, STATE, ['--approve-spec', '0001']);
      const o2 = all(r2);
      const a = o2.search(/sen gerekeceksin/i);
      const b = o2.search(/\b8\b.*10 dakika|10 dakika.*\b8\b/);
      if (r2.status !== 0 && a !== -1 && b !== -1 && a < b) ok('L6b on a refusal too, the warnings come first');
      else bad(`L6b refusal output: exit ${r2.status}, warning at ${a}, blocker at ${b}`);
      /* L6c - THE LISTS, not only the headline. L6b passed with the blocker list
       * printed above the warning list (mutation N2): the operator line sits above
       * both, so it could not tell. */
      const iList = o2.indexOf('Uyarılar');
      const iBlock = o2.indexOf('Engeller');
      if (iList !== -1 && iBlock !== -1 && iList < iBlock) ok('L6c the warning list itself is printed before the blocker list');
      else bad(`L6c warning list at ${iList}, blocker list at ${iBlock} - the warnings are not on top`);
    }

    /* L7 - the architect's tool: verify.mjs --check-criteria, same verdict, exit code is the answer. */
    {
      const p = makeProject(SPEC_0034);
      const r = run(p, VERIFY, ['--check-criteria', '0001']);
      const p2 = makeProject(CLEAN);
      const r2 = run(p2, VERIFY, ['--check-criteria', '0001']);
      if (r.status === 1 && /10 dakika/.test(all(r)) && r2.status === 0) {
        ok('L7 verify.mjs --check-criteria exits 1 on the 0034 block and 0 on a clean one');
      } else {
        bad(`L7 --check-criteria: 0034 exit ${r.status}, clean exit ${r2.status}: ${all(r).trim().slice(0, 200)}`);
      }
    }

    /* L8 - the router's awaiting_approval output carries the report, warnings first. */
    {
      const p = makeProject(spec([{ id: '4', needs: ['browser'], run: OK_CMD }]));
      const r = run(p, ROUTE, []);
      const out = all(r);
      const iWarn = out.search(/sen gerekeceksin/i);
      const iNext = out.indexOf('next: awaiting_approval');
      if (iNext !== -1 && iWarn !== -1 && iWarn < iNext) ok('L8 the router prints the warnings above the awaiting_approval decision');
      else bad(`L8 router output: next at ${iNext}, warning at ${iWarn}: ${out.slice(0, 300)}`);
    }

    /* L9 - THE PERMISSION LIST. Ordinary criteria that must NOT be flagged. */
    const ORDINARY = [
      'npx tsc --noEmit',
      'node -e "process.exit(0)"',
      'grep -q "force-dynamic" app/api/x/route.ts',
      'npm run build > /dev/null 2>&1',
      'rm -f .tmp-check.txt',
      'npx eslint . --max-warnings 0',
      'test ! -e app/old/page.tsx',
      'git diff --quiet -- app/legal',
      'cat .env.example | grep -q STRIPE_SECRET_KEY',
      'node -e "if (!process.env.NEXT_PUBLIC_SITE_URL) process.exit(0)"',
      // Carried-forward item 9's PERMANENT form: the version read from the pin,
      // the path built from it. Found by a dry run over cartoonify's real specs:
      // the first build blocked this on $HOME, i.e. refused the recommended fix.
      'V=$(node -p "require(\'./.mavci/control/state.json\').ci_pinned_plugin_version"); '
        + 'node "$HOME/.claude/plugins/cache/mavci/mavci-core/$V/scripts/gate.mjs" --check',
    ];
    for (const cmd of ORDINARY) {
      const r = check(spec([{ id: '1', run: cmd }]));
      if (!r.errors.length) ok(`L9 not blocked: ${cmd}`);
      else bad(`L9 an ordinary criterion was BLOCKED: ${cmd} -> ${JSON.stringify(r.errors)}`);
    }

    /* L9b - a machine path inside a BROWSER criterion is the operator's machine
     * already; it warns as theirs instead of blocking. cartoonify 0022/0026 locate
     * Chrome this way. The non-browser case stays blocking (L4). */
    {
      const r = check(spec([{ id: '5', needs: ['shell', 'browser'],
        run: 'node -e "const exe=[\'C:/Program Files/Google/Chrome/Application/chrome.exe\']"' }]));
      const w = r.warnings.filter((x) => x.id === '5' && x.who === 'operator');
      if (!r.errors.length && w.length >= 2) ok('L9b a browser criterion locating Chrome warns as the operator\'s, not a blocker');
      else bad(`L9b browser criterion with a Chrome path: ${JSON.stringify(r)}`);
    }

    /* L10 - needs that the command plainly contradicts: a warning, the agent's to fix. */
    {
      const r = check(spec([{ id: '2', run: 'curl -sf http://localhost:3000/api/health' }]));
      const w = r.warnings.find((x) => x.id === '2');
      if (!r.errors.length && w && w.who === 'agent') ok('L10 a shell-only criterion calling localhost warns that it needs a server');
      else bad(`L10 undeclared server need not warned: ${JSON.stringify(r)}`);
    }
  }
} finally {
  for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS */ } }
}

if (failures.length) {
  console.error(`\ncriteria limits check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\ncriteria limits check passed: an approval accepts nothing verify cannot run, and says who is needed');

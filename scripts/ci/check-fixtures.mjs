#!/usr/bin/env node
/**
 * Every rule must FAIL its bad/ fixture and PASS its good/ fixture.
 *
 * A rule with no fixture pair fails this job. That is deliberate: an unfixtured
 * rule can regress silently on a refactor, and a check that has quietly stopped
 * firing is worse than no check, because it reads as a green tick.
 *
 * This is also where a false positive gets pinned down forever. When a rollback
 * or a waiver reveals a bad rule, the code that was wrongly flagged goes into
 * good/, and this job stops it coming back (ARCHITECTURE section 10, class B).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FX = path.join(ROOT, 'plugins/mavci-core/templates', 'fixtures');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');

// pathToFileURL is required: a dynamic import() of a Windows absolute path
// throws ERR_UNSUPPORTED_ESM_URL_SCHEME because "C:" parses as a URL scheme.
// It works on Linux CI and fails on a Windows dev machine, which is the worst
// kind of portability bug - it only shows up on the machine you did not test on.
const load = (...seg) => import(pathToFileURL(path.join(SCRIPTS, ...seg)).href);

const { RULES } = await load('rules', 'index.mjs');
const { runChecks } = await load('verify.mjs');
const state = await load('state.mjs');

const BASE_MANIFEST = {
  schema_version: 2,
  project_id: 'fixture',
  display_name: 'Fixture',
  created: '2026-01-01T00:00:00Z',
  stack: { framework: 'nextjs-14-app-router', language: 'typescript', db: 'supabase-postgres', auth: 'supabase-auth', payments: 'stripe', email: 'resend', ai: 'anthropic', package_manager: 'npm' },
  tenancy: { model: 'shared-schema', isolation: 'rls', tenant_column: 'org_id' },
  deploy: { target: 'vercel', prod_branch: 'main', site_url: 'https://fixtures.example.com' },
  environments: { prod: { supabase_ref: 'fixtureprod', protected: true } },
  env_sources: { runtime: 'vercel-project-env', required_keys: ['STRIPE_SECRET_KEY'], never_read_by_agents: true },
  risk_tier: 'standard',
  compliance: {
    jurisdictions: ['TR'], required_pages: ['kvkk'], locales: ['tr'],
    entity: {
      legal_name: 'Ornek Yazilim Anonim Sirketi',
      address: 'Ornek Mahallesi Ornek Caddesi No 1 Kadikoy Istanbul',
      email: 'destek@example.com',
      mersis: '0000000000000000',
      kep: 'ornek@hs01.kep.tr',
    },
  },
  agents: { enabled: ['mavci-builder'] },
  standards: { packs: ['nextjs-app-router', 'supabase-multitenant-rls', 'legal-tr-kvkk', 'stripe-billing'] },
};

/**
 * A rule may need a manifest the BASE cannot express.
 *
 * `tenancy.isolation` made two rules mutually exclusive by declaration:
 * `supabase.rls_enabled` runs only when isolation is `rls`, and
 * `supabase.service_role_query_scoped` runs only when it is `application-filters`.
 * One manifest cannot satisfy both, and before the split nothing in this harness had
 * to care - every rule keyed off `standards.packs`, which is a list.
 *
 * The fix is a per-rule PATCH rather than a second base manifest, so a rule that
 * needs a different declaration says so in one place and inherits everything else.
 * A rule with no entry here uses BASE_MANIFEST unchanged.
 *
 * This is not a test seam in production code: the patch lives in the harness, and a
 * rule that needs one is declaring a real precondition of its own behaviour.
 */
const MANIFEST_PATCH = {
  'supabase.service_role_query_scoped': {
    tenancy: { model: 'shared-schema', isolation: 'application-filters', tenant_column: 'company_id' },
  },
};

/** BASE_MANIFEST with any per-rule patch applied. */
function manifestFor(ruleId) {
  const patch = MANIFEST_PATCH[ruleId];
  return patch ? { ...BASE_MANIFEST, ...patch } : BASE_MANIFEST;
}

function copyTree(from, to) {
  if (!fs.existsSync(from)) return;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

async function runFixture(checkId, variant) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-fx-'));
  try {
    fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(manifestFor(checkId), null, 2));
    // Legal checks need a kvkk page to exist for every OTHER fixture, or every
    // fixture fails on legal.pages_present and the signal is lost.
    if (checkId !== 'legal.pages_present' && checkId !== 'legal.kvkk_structure') {
      const good = path.join(FX, 'legal.kvkk_structure', 'good');
      copyTree(good, tmp);
    }
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\n.env*\n');
    state.init(tmp, manifestFor(checkId));
    copyTree(path.join(FX, checkId, variant), tmp);
    // Reseal after the copy. A fixture that writes into .mavci/control/ would
    // otherwise break the integrity seal as a side effect, so its bad/ case would
    // fire twice - once for the thing it is documenting and once for the seal -
    // and the fixture would no longer say what the rule catches. The seal is
    // proved separately, by the tampering assertion below. For every fixture that
    // does not touch .mavci/control/ this is a no-op.
    state.seal(tmp);

    const { findings } = await runChecks(tmp, { scope: 'full' });
    return findings.filter((f) => f.check_id === checkId);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Every file under `dir`, recursively. A missing or empty directory returns [].
 *
 * This exists because `fs.existsSync(dir)` was the assertion here, and it is a
 * PROXY: it stands in for "the fixture is present and correct" but is satisfied
 * by an empty directory. Git cannot track an empty directory, so an empty
 * fixture dir exists ONLY on the machine that created it - the check passed on
 * every local run and failed the first time CI ever executed. A proxy that
 * cannot fail is not an assertion.
 */
function filesUnder(dir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

const failures = [];

for (const rule of RULES) {
  const dir = path.join(FX, rule.id);
  const badDir = path.join(dir, 'bad');
  const goodDir = path.join(dir, 'good');

  if (!fs.existsSync(badDir) || !fs.existsSync(goodDir)) {
    failures.push(`${rule.id}: missing fixture pair (templates/fixtures/${rule.id}/{bad,good}/)`);
    continue;
  }

  // Presence is not enough - the directory must actually carry a fixture.
  const badFiles = filesUnder(badDir);
  const goodFiles = filesUnder(goodDir);
  if (!badFiles.length || !goodFiles.length) {
    const empty = [!badFiles.length && 'bad/', !goodFiles.length && 'good/'].filter(Boolean);
    failures.push(`${rule.id}: ${empty.join(' and ')} ${empty.length > 1 ? 'are' : 'is'} EMPTY. `
      + 'Git does not track empty directories, so this fixture exists on one machine '
      + 'only and can never run in CI.');
    continue;
  }

  // state.schema_valid additionally proves the SEAL catches a hand-edit, which no
  // file fixture can express. It does not exempt the rule from the pair above.
  if (rule.id === 'state.schema_valid') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-fx-state-'));
    try {
      fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(manifestFor(rule.id), null, 2));
      copyTree(path.join(FX, 'legal.kvkk_structure', 'good'), tmp);
      state.init(tmp, manifestFor(rule.id));

      const clean = (await runChecks(tmp, { scope: 'full' })).findings.filter((f) => f.check_id === rule.id);
      if (clean.length) failures.push(`${rule.id}: fired on a freshly sealed control plane`);

      const sp = path.join(tmp, '.mavci', 'control', 'state.json');
      const s = JSON.parse(fs.readFileSync(sp, 'utf8'));
      s.phase = 'build';
      fs.writeFileSync(sp, JSON.stringify(s, null, 2));

      const tampered = (await runChecks(tmp, { scope: 'full' })).findings.filter((f) => f.check_id === rule.id);
      if (!tampered.length) failures.push(`${rule.id}: did NOT detect a control-plane edit made outside state.mjs`);
      else console.log(`  ok   ${rule.id} (detects control-plane tampering)`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // No `continue`: this rule is NOT exempt from the bad/good pair. The
    // tampering case above proves the seal; the fixture below proves the schema.
  }

  const bad = await runFixture(rule.id, 'bad');
  const good = await runFixture(rule.id, 'good');

  if (!bad.length) failures.push(`${rule.id}: did NOT fire on its bad/ fixture`);
  if (good.length) failures.push(`${rule.id}: fired on its good/ fixture - false positive: ${good[0].evidence}`);
  if (bad.length && !good.length) console.log(`  ok   ${rule.id}`);
}

if (failures.length) {
  console.error('\nfixture check FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log(`\nall ${RULES.length} rules fail their bad fixture and pass their good fixture`);

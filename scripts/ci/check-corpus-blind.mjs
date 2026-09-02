#!/usr/bin/env node
/**
 * The corpus run is blind to guardian - the half that moving the expectations did
 * not fix.
 *
 * WHAT WENT WRONG, so nobody reinstates it. `corpus/expected/` moving out of the
 * project closed one leak and left a second one untouched, and the second one was
 * in the manifest. Every guardian acceptance case reads `SUPABASE_SERVICE_ROLE_KEY`
 * directly, on purpose, so the staging root needs an exemption from
 * `next.no_service_role_client` and `next.env_centralised` or the corpus cannot run
 * at all. `config.fixture_scope` required that exemption to be DECLARED, so gate4c's
 * manifest carried `checks.fixtures: ["corpus-run"]` - and the shared agent contract
 * ordered every agent to read `.mavci/project.json` before anything else. Guardian
 * was instructed, in writing, to open the file that named the corpus directory.
 *
 * The two requirements were jointly unsatisfiable as written, and renaming the case
 * directories would not have touched it. So both sides moved:
 *
 *   THE EXEMPTION IS PLUGIN-OWNED.  `corpus-run/` is exempt with nothing declaring
 *                                   it. No project states where a case is staged,
 *                                   because no project has to.
 *   GUARDIAN DOES NOT READ THE      Its startup protocol overrides step 1 of the
 *   MANIFEST.                       shared contract, and its section 3 inputs are
 *                                   the worklist and the sources it names.
 *
 * NEITHER HALF IS SUFFICIENT ALONE, which is why this file asserts both. With only
 * the first, a later schema field naming the corpus reopens the leak against a
 * contract that still sends guardian to the manifest. With only the second, the
 * manifest still names the directory for anything else that reads it, and guardian
 * holds `Grep`.
 *
 * THE ASSERTIONS, and the broken build each must catch:
 *
 *   A-POS  a staged case produces no blocker under a manifest declaring NO fixtures
 *          broken build: 0.1.17, where the exemption came only from the declaration
 *   A-CTL  the same files at an undeclared ordinary path DO produce those blockers
 *          without it, A-POS is satisfied by rules that fire on nothing
 *   A-SEC  `secrets.no_committed_secrets` still fires inside the staging root
 *          broken build: `noCommittedSecrets` gaining its own `corpus-run` skip.
 *          NOT the one first written here, and the correction is worth keeping.
 *          The stated broken build was "the helper stops enforcing its allow-list",
 *          and mutating `isDeclaredFixture` to return true for every rule left
 *          A-SEC GREEN - because `noCommittedSecrets` never calls that helper at
 *          all. Constraint 3 holds by omission, which is stronger than the
 *          allow-list and is not what the allow-list asserts. A mutant aimed at the
 *          wrong site is a demonstration that proves nothing while looking like
 *          one, and it is the same shape as everything else in this file's subject.
 *   A-VIS  `config.fixture_scope` warns that the staging root is exempt, and the
 *          warning disappears when the stage is empty
 *          broken build: a silent exemption, which is the one thing the manifest
 *          declaration was still buying
 *   B-GRD  guardian's rendered definition never names `.mavci/project.json`
 *          broken build: guardian rendered WITHOUT its override - reconstructed
 *          here from the real contract, not described
 *   B-CTL  the other four agents still get the manifest step
 *          without it, deleting step 1 for everyone satisfies B-GRD
 *   B-SIL  guardian's rendered text never says why. A step reading "do not open the
 *          manifest, it would tell you this is a corpus run" passes B-GRD and
 *          discloses the same fact by a shorter route - so B-GRD alone is not the
 *          property. This is the assertion that catches the honest first draft of
 *          the override, which explained itself.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const load = (...seg) => import(pathToFileURL(path.join(SCRIPTS, ...seg)).href);

const { stageCase, clearStage, STAGE_DIR } = await load('corpus-stage.mjs');
const { runChecks } = await load('verify.mjs');
const { render, loadDefs, CONTRACT_PATH } = await load('build-agents.mjs');
const state = await load('state.mjs');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const check = (c, m) => (c ? ok(m) : bad(m));

const EXEMPTED = ['next.no_service_role_client', 'next.env_centralised'];
const CASE_ID = 't5w9d';

/* ================================================================== part A */

const MANIFEST = {
  schema_version: 2,
  project_id: 'blind',
  display_name: 'Blind',
  created: '2026-01-01T00:00:00Z',
  stack: { framework: 'nextjs-14-app-router', language: 'typescript', db: 'supabase-postgres', auth: 'supabase-auth', payments: 'stripe', email: 'resend', ai: 'anthropic', package_manager: 'npm' },
  tenancy: { model: 'shared-schema', isolation: 'application-filters', tenant_column: 'org_id' },
  deploy: { target: 'vercel', prod_branch: 'main', site_url: 'https://blind.example.com' },
  environments: { prod: { supabase_ref: 'blindprod', protected: true } },
  env_sources: { runtime: 'vercel-project-env', required_keys: ['STRIPE_SECRET_KEY'], never_read_by_agents: true },
  risk_tier: 'standard',
  compliance: {
    jurisdictions: ['TR'], required_pages: ['kvkk'], locales: ['tr'],
    entity: {
      legal_name: 'Ornek Yazilim Anonim Sirketi',
      address: 'Ornek Mahallesi Ornek Caddesi No 1 Kadikoy Istanbul',
      email: 'destek@example.com', mersis: '0000000000000000', kep: 'ornek@hs01.kep.tr',
    },
  },
  agents: { enabled: ['mavci-guardian'] },
  standards: { packs: ['nextjs-app-router', 'supabase-multitenant-rls'] },
  // NO `checks` KEY AT ALL. That is the point of part A: the manifest this project
  // hands to anything that reads it says nothing about a corpus, a fixture root or
  // a staging directory.
};

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
}

const rel = (p) => String(p).replace(/\\/g, '/');
const inStage = (f) => typeof f.path === 'string'
  && (rel(f.path) === STAGE_DIR || rel(f.path).startsWith(`${STAGE_DIR}/`));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-blind-'));
const project = path.join(tmp, 'project');
fs.mkdirSync(path.join(project, '.mavci'), { recursive: true });
fs.writeFileSync(path.join(project, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules\n.env*\n');
state.init(project, MANIFEST);
state.seal(project);

const staged = stageCase(project, CASE_ID);
check(staged.length > 0, `POSITIVE: case ${CASE_ID} staged - ${staged.length} file(s) under ${STAGE_DIR}/`);

const manifestText = fs.readFileSync(path.join(project, '.mavci', 'project.json'), 'utf8');
check(!manifestText.includes(STAGE_DIR),
  `POSITIVE: the manifest does not contain the string "${STAGE_DIR}" anywhere - `
  + 'without this, part A asserts nothing about the declaration');

const { findings } = await runChecks(project, { scope: 'full' });
const blockers = findings.filter((f) => inStage(f) && EXEMPTED.includes(f.check_id) && f.severity === 'blocker');
check(blockers.length === 0,
  'A-POS a staged case produces no blocker from the exempted rules, with nothing in the manifest '
  + `declaring it (found: ${blockers.map((f) => `${f.check_id} ${f.path}:${f.line}`).join(', ') || 'none'})`);

/* A-CTL: the same sources, one directory over, with no standing anywhere. If these
 * stay silent too then A-POS was measuring rules that do not fire rather than an
 * exemption that works, and it would pass against a build where both rules had been
 * deleted outright. This IS the 0.1.17 behaviour for an undeclared root. */
const control = path.join(project, 'ordinary-dir');
fs.mkdirSync(control, { recursive: true });
copyTree(path.join(project, STAGE_DIR), control);

const { findings: f2 } = await runChecks(project, { scope: 'full' });
const controlHits = f2.filter((f) => typeof f.path === 'string'
  && rel(f.path).startsWith('ordinary-dir/') && EXEMPTED.includes(f.check_id));
check(EXEMPTED.every((id) => controlHits.some((f) => f.check_id === id)),
  'A-CTL DEMONSTRATED FAILING against an undeclared ordinary directory holding the identical '
  + `sources - both exempted rules fire there (found: ${[...new Set(controlHits.map((f) => f.check_id))].join(', ') || 'none'})`);

fs.rmSync(control, { recursive: true, force: true });

/* A-SEC: the secrets check is the one that can be neither baselined nor waived, and
 * it must reach inside the staging root like anywhere else. Note WHERE the property
 * actually lives: `noCommittedSecrets` does not call `isDeclaredFixture`, so no
 * change to the fixture helper can exempt it - constraint 3 is enforced by that rule
 * never asking. The build this catches is therefore a skip added to the secrets rule
 * itself, which is the plausible one: someone silencing a noisy corpus run at the
 * first site that fires. */
const planted = path.join(project, STAGE_DIR, 'lib', 'planted.ts');
fs.writeFileSync(planted, `export const k = "sk_live_${'4eC39HqLyjWDarjtT1zdp7dc'}";\n`);
const { findings: f3 } = await runChecks(project, { scope: 'full' });
const secretHits = f3.filter((f) => f.check_id === 'secrets.no_committed_secrets' && inStage(f));
check(secretHits.length > 0,
  'A-SEC secrets.no_committed_secrets still fires inside the staging root - the exemption is two '
  + `named rules, never a directory skip (found: ${secretHits.map((f) => `${f.path}:${f.line}`).join(', ') || 'none'})`);
fs.rmSync(planted, { force: true });

/* A-VIS: an exemption nobody can see is how a narrow one becomes a wide one. The
 * declared version was auditable because it was in the manifest; this one has to be
 * auditable in the report, or it is strictly worse than what it replaced. */
const { findings: f4 } = await runChecks(project, { scope: 'full' });
const vis = f4.filter((f) => f.check_id === 'config.fixture_scope' && f.severity === 'warning'
  && rel(f.path) === STAGE_DIR);
check(vis.length === 1,
  `A-VIS config.fixture_scope warns that ${STAGE_DIR}/ is exempt, naming the rules `
  + `(found: ${vis.map((f) => f.evidence).join(' | ') || 'nothing'})`);

/* A-VIS earns its place on an empty stage: the warning has to be a fact about files
 * that are actually there, not a constant the rule always emits. */
clearStage(project);
const { findings: f5 } = await runChecks(project, { scope: 'full' });
const visEmpty = f5.filter((f) => f.check_id === 'config.fixture_scope' && rel(f.path) === STAGE_DIR);
check(visEmpty.length === 0,
  'A-VIS DEMONSTRATED not-constant: with the stage cleared the warning is gone, so it reports '
  + `covered files rather than the directory existing (found: ${visEmpty.length})`);

/* ================================================================== part B */

const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
const defs = loadDefs();
const guardianDef = defs.find((d) => d.name === 'mavci-guardian');
check(!!guardianDef, 'POSITIVE: the guardian definition loaded');

const guardianText = render(contract, guardianDef);

check(!guardianText.includes('.mavci/project.json'),
  "B-GRD guardian's rendered definition never names .mavci/project.json");

/* B-GRD's broken build, reconstructed rather than described: the same contract and
 * the same definition with the override taken away, which is exactly what shipped
 * through 0.1.17. */
const withoutOverride = { ...guardianDef };
delete withoutOverride.startup_step_1;
delete withoutOverride.inputs_intro;
delete withoutOverride.inputs;
const shippedText = render(contract, withoutOverride);
check(shippedText.includes('.mavci/project.json'),
  'B-GRD DEMONSTRATED FAILING against 0.1.17: rendering the same definition with the override '
  + "removed puts .mavci/project.json back into guardian's startup protocol");

const others = defs.filter((d) => d.name !== 'mavci-guardian');
const missing = others.filter((d) => !render(contract, d).includes('Read `.mavci/project.json`'));
check(missing.length === 0,
  'B-CTL the other four agents are still told to read the manifest - without this, deleting step 1 '
  + `for everyone would satisfy B-GRD (agents missing it: ${missing.map((d) => d.name).join(', ') || 'none'})`);

/* B-SIL: the reason is the disclosure. Guardian must not learn that a corpus, a
 * test or an evaluation exists, and the shortest route to telling it is a step that
 * explains why the manifest is off limits. */
const TELLS = ['corpus', 'fixture', 'acceptance', 'evaluat', 'being tested', 'benchmark', 'graded'];
const said = TELLS.filter((t) => guardianText.toLowerCase().includes(t));
check(said.length === 0,
  `B-SIL guardian's rendered definition carries no word that discloses the corpus (found: ${said.join(', ') || 'none'})`);

/* B-SIL's broken build: an override that reads exactly like the honest first draft. */
const explaining = {
  ...guardianDef,
  startup_step_1: 'Read the worklist named in your prompt. Do not read `.mavci/project.json`: it '
    + 'names the corpus staging directory, and a corpus run must be indistinguishable to you '
    + 'from a real one.',
};
const explainingText = render(contract, explaining);
check(!explainingText.includes('1. Read `.mavci/project.json`. It declares')
  && TELLS.some((t) => explainingText.toLowerCase().includes(t)),
  "B-SIL DEMONSTRATED FAILING against an override that explains itself - it satisfies B-GRD's "
  + 'intent while disclosing the corpus in the same sentence, which is why B-SIL is a separate '
  + 'assertion and not a restatement');

/* ---------------------------------------------------------------- teardown */

fs.rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.log(`corpus blindness check FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('corpus blindness: the staging exemption needs no manifest declaration, it stays');
console.log('visible and stays bounded to two rules, and guardian is neither told to read the');
console.log('manifest nor told why. Every assertion was demonstrated failing against its own');
console.log('broken build.');

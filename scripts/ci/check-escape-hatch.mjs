#!/usr/bin/env node
/**
 * THE ESCAPE-HATCH PROOF (ARCHITECTURE section 11).
 *
 * Scaffolds a project from templates/scaffold/, initialises the control plane,
 * and runs the full checker - using nothing but `node`. No Claude Code, no npm
 * install, no network. selftest.yml runs this in a container where `claude` is
 * not on PATH.
 *
 * It also proves the Layer-3 claim (6.8): a new project is GREEN from commit one,
 * so the first red is always a real regression. A scaffold that cannot pass its
 * own checker is a build failure here, not a surprise during onboarding.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'plugins', 'mavci-core', 'scripts');
const SCAFFOLD = path.join(ROOT, 'plugins/mavci-core/templates', 'scaffold');

const state = await import(pathToFileURL(path.join(SCRIPTS, 'state.mjs')).href);
const render = await import(pathToFileURL(path.join(SCRIPTS, 'render.mjs')).href);

/*
 * Substitution comes from render.mjs - the SAME code /mavci-core:new-project runs.
 * This used to be a hard-coded map of fake values, which meant the test data
 * could not disagree with production data and the check could never fire: nine
 * placeholders shipped unsubstituted while this stayed green. Deriving the
 * values from MANIFEST below is the point. Do not reintroduce a literal map.
 */

const MANIFEST = {
  schema_version: 2,
  project_id: 'escape-hatch-proof',
  display_name: 'Escape Hatch Proof',
  created: '2026-01-01T00:00:00Z',
  stack: { framework: 'nextjs-14-app-router', language: 'typescript', db: 'supabase-postgres', auth: 'supabase-auth', payments: 'stripe', email: 'resend', ai: 'anthropic', package_manager: 'npm' },
  tenancy: { model: 'shared-schema', isolation: 'rls', tenant_column: 'org_id' },
  deploy: { target: 'vercel', prod_branch: 'main', site_url: 'https://escape-hatch-proof.example.com' },
  environments: { prod: { supabase_ref: 'prodref', protected: true }, local: { protected: false } },
  env_sources: { runtime: 'vercel-project-env', local_file: '.env.local', required_keys: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY'], never_read_by_agents: true },
  risk_tier: 'standard',
  compliance: {
    jurisdictions: ['TR', 'EU'],
    required_pages: ['privacy', 'terms', 'kvkk', 'cookies', 'contact'],
    locales: ['tr'],
    entity: {
      legal_name: 'Ornek Yazilim Anonim Sirketi',
      address: 'Ornek Mahallesi Ornek Caddesi No 1 Kadikoy Istanbul',
      email: 'destek@example.com',
      mersis: '0000000000000000',
      kep: 'ornek@hs01.kep.tr',
    },
  },
  agents: { enabled: ['mavci-architect', 'mavci-builder', 'mavci-verifier'] },
  standards: { packs: ['nextjs-app-router', 'supabase-multitenant-rls', 'legal-tr-kvkk'] },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-escape-'));
let failed = false;

try {
  if (!fs.existsSync(SCAFFOLD)) {
    console.error('::error::templates/scaffold/ does not exist');
    process.exit(2);
  }
  fs.mkdirSync(path.join(tmp, '.mavci'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.mavci', 'project.json'), JSON.stringify(MANIFEST, null, 2));
  render.renderScaffold(tmp, MANIFEST);
  render.renderSharedConfig(tmp, MANIFEST);
  state.init(tmp, MANIFEST);

  // A placeholder reaching a generated project is a build failure. package.json
  // is the sharpest case: npm rejects a name starting with an underscore, so
  // `npm ci` dies and "green from commit one" is false.
  const surviving = render.findSurvivingPlaceholders(tmp);
  if (surviving.length) {
    console.error('::error::the generated project still contains template placeholders:');
    for (const h of surviving) console.error(`  ${h.file}: ${h.tokens.join(', ')}`);
    failed = true;
  }

  console.log('scaffolded a project with node alone; running the checker...\n');

  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(SCRIPTS, 'verify.mjs'), '--format=human'],
      { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  } catch (err) {
    out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
    code = err.status ?? 1;
  }
  console.log(out);

  if (code !== 0) {
    console.error('::error::the scaffold does NOT pass its own checker. A new project must be green '
      + 'from commit one, or the first red is noise instead of a real regression.');
    failed = true;
  }

  // The state validator must also run standalone.
  try {
    execFileSync(process.execPath, [path.join(SCRIPTS, 'state.mjs'), '--validate'],
      { cwd: tmp, stdio: 'inherit', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } });
  } catch {
    console.error('::error::state.mjs --validate failed on a freshly scaffolded project');
    failed = true;
  }

  // Every artefact must be plain text a human or jq can read.
  for (const rel of ['.mavci/project.json', '.mavci/control/state.json', '.mavci/control/integrity.json']) {
    const p = path.join(tmp, rel);
    if (!fs.existsSync(p)) { console.error(`::error::${rel} missing`); failed = true; continue; }
    try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch { console.error(`::error::${rel} is not plain JSON`); failed = true; }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) process.exit(2);
console.log('\nescape hatch proven: scaffold, control plane and checker all run on node alone.');

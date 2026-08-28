#!/usr/bin/env node
/**
 * Mavci Core - the agent generator. ARCHITECTURE section 5 (custom code C3).
 *
 * WHY THIS EXISTS
 * Claude Code has no include, inherit or partial mechanism for the BODY of an
 * agent definition (NATIVE-CAPABILITIES section 8). Without a generator, the
 * eight contract sections get copy-pasted into every agent and drift apart -
 * which is precisely the "never hand-write a prompt per agent again" problem.
 *
 * Source of truth: agent-defs/_contract.md + agent-defs/<slug>.json
 * Output:          plugins/mavci-core/agents/<name>.md  (committed)
 *                  plugins/mavci-core/agents/agent-scopes.json (read by risk-guard)
 *
 * The output is ordinary Claude Code markdown. Delete this generator and the
 * agents keep working - that is the escape-hatch requirement (section 11).
 *
 * Definitions are JSON, not YAML: parsing YAML would need a dependency, and the
 * zero-dependency guarantee is what makes `node verify.mjs` runnable in a
 * container with nothing installed. Writing YAML frontmatter is trivial;
 * parsing it is not.
 *
 *   node build-agents.mjs           write the files
 *   node build-agents.mjs --check   exit 2 if the committed files are stale (CI)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '../..');
const DEFS_DIR = path.join(REPO_ROOT, 'agent-defs');
const OUT_DIR = path.join(PLUGIN_ROOT, 'agents');
const CONTRACT = path.join(DEFS_DIR, '_contract.md');

const list = (arr) => (arr?.length ? arr.map((x) => `\`${x}\``).join(', ') : '_nothing_');
const bullets = (arr) => (arr ?? []).map((x) => `- ${x}`).join('\n');

/**
 * The honesty line. ARCHITECTURE 1.1: only the verifier and guardian are
 * natively constrained; the others are hook-only, and an agent is told the
 * truth about which of the two it is.
 */
function constraintNote(def) {
  if (def.native_constraint) {
    return 'These limits are **natively enforced**: the `Edit`, `Write` and `NotebookEdit` tools '
      + 'are absent from your context entirely. There is nothing to resist - you could not edit a '
      + 'file if you decided to.';
  }
  return 'These limits are enforced by a **PreToolUse hook**, not by your tool list. You do have '
    + '`Edit` and `Write`, because you need them for the paths in your allow list. A write outside '
    + 'that list is refused with a reason. Treat the list as the boundary, not the hook: the hook is '
    + 'a backstop, and the reason you were given the narrow scope is that the narrow scope is correct.';
}

function standardsInvocations(def) {
  const packs = def.standards_packs ?? [];
  if (!packs.length) return '_(this agent loads no standards packs)_';
  return packs.map((p) => `   - \`/mavci-core:standards-${p}\``).join('\n').trimStart();
}

function render(contract, def) {
  const frontmatterTools = def.tools.join(', ');
  const map = {
    name: def.name,
    slug: def.slug,
    title: def.title,
    description: def.description.replace(/\n/g, ' '),
    tools: frontmatterTools,
    model: def.model,
    max_turns: String(def.max_turns),
    color: def.color,
    phase: def.phase,
    role: def.role,
    allow_list: list(def.edit_scope?.allow),
    deny_list: list(def.edit_scope?.deny),
    constraint_note: constraintNote(def),
    standards_invocations: standardsInvocations(def),
    outputs_list: list(def.outputs),
    escalate_list: bullets(def.escalate_when),
  };

  let out = contract;
  for (const [k, v] of Object.entries(map)) {
    out = out.split(`{{${k}}}`).join(v);
  }

  // A leftover placeholder means the contract gained a field the defs lack.
  const leftover = out.match(/\{\{(\w+)\}\}/);
  if (leftover) throw new Error(`${def.slug}: contract placeholder {{${leftover[1]}}} has no value in the definition`);

  // disallowedTools is optional and only appears when a def sets it.
  if (def.disallowedTools?.length) {
    out = out.replace(/^tools: (.*)$/m, `tools: $1\ndisallowedTools: ${def.disallowedTools.join(', ')}`);
  }
  return out;
}

/**
 * `_note` convention.
 *
 * JSON has no comments, and a definition that records only WHAT was decided
 * loses the reason the moment the person who decided it moves on. Any key
 * beginning with `_` is documentation: it is read by humans and by whoever next
 * wonders why the builder is on Sonnet, and it is ignored by the generator.
 *
 * Use `_note` at the top level for the decision behind the whole agent, and
 * `_note_<field>` beside any individual field whose value would otherwise look
 * arbitrary. They never reach the rendered prompt, so they cost no tokens.
 */
function stripNotes(obj) {
  if (Array.isArray(obj)) return obj.map(stripNotes);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue;
      out[k] = stripNotes(v);
    }
    return out;
  }
  return obj;
}

function loadDefs({ keepNotes = false } = {}) {
  return fs.readdirSync(DEFS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(DEFS_DIR, f), 'utf8'));
      return keepNotes ? raw : stripNotes(raw);
    });
}

function build() {
  const contract = fs.readFileSync(CONTRACT, 'utf8');
  const defs = loadDefs();
  const files = new Map();

  for (const def of defs) {
    files.set(`${def.name}.md`, render(contract, def));
  }

  // risk-guard.mjs reads this at runtime to enforce per-agent edit scope.
  // Generated from the same source as the prompt, so the text an agent reads and
  // the rule that stops it can never disagree.
  const scopes = {};
  for (const def of defs) {
    scopes[def.name] = {
      phase: def.phase,
      allow: def.edit_scope?.allow ?? [],
      deny: def.edit_scope?.deny ?? [],
      native_constraint: !!def.native_constraint,
    };
  }
  files.set('agent-scopes.json', JSON.stringify(scopes, null, 2) + '\n');

  return files;
}

function main() {
  const check = process.argv.includes('--check');
  let files;
  try {
    files = build();
  } catch (err) {
    console.error(`build-agents: ${err.message}`);
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stale = [];

  for (const [name, content] of files) {
    const dest = path.join(OUT_DIR, name);
    const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
    if (current === content) continue;
    if (check) { stale.push(name); continue; }
    fs.writeFileSync(dest, content, 'utf8');
    console.log(`${current === null ? 'created' : 'updated'} agents/${name}`);
  }

  // An agent file with no definition is a leftover from a renamed or deleted def.
  const expected = new Set(files.keys());
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!expected.has(f)) {
      if (check) { stale.push(`${f} (orphaned)`); continue; }
      fs.unlinkSync(path.join(OUT_DIR, f));
      console.log(`removed orphaned agents/${f}`);
    }
  }

  if (check && stale.length) {
    console.error('generated agent files are stale or hand-edited:\n  - ' + stale.join('\n  - ')
      + '\n\nRun: node plugins/mavci-core/scripts/build-agents.mjs');
    process.exit(2);
  }
  if (check) console.log(`agents up to date (${files.size} file(s))`);
  else console.log(`built ${files.size} file(s) from ${loadDefs().length} definition(s)`);
}

main();

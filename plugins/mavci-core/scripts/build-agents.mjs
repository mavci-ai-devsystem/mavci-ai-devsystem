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
  return HOOK_NOTE;
}

/**
 * The READ half, appended when a definition declares a `read_scope`.
 *
 * An agent is told the truth about its own constraints (ARCHITECTURE 1.1), and a
 * read scope is a different KIND of constraint from the write one: guardian's write
 * limit is native - the tools are absent from its context - while its read limit is
 * a hook. One sentence covering both as "natively enforced" would be the same
 * overclaim section 1.1 was written to correct. So the two are stated separately,
 * each in the terms that are true of it.
 *
 * It gives no reason beyond the one that is honest and complete for the agent:
 * nothing in the excluded paths bears on the question it answers.
 */
function readScopeNote(def) {
  if (!def.read_scope) return '';
  const denied = (def.read_scope.deny ?? []).map((g) => '`' + g + '`').join(', ');
  return [
    '\n\n',
    'Your **reads** are bounded separately, and by a **PreToolUse hook** rather than by your ',
    "tool list. You hold `Read`, `Grep` and `Glob` over this project's source. A call naming ",
    denied,
    ' is refused with a reason, and so is a SEARCH ROOTED where those sit - including the ',
    'project root, which contains them. The search is refused rather than quietly narrowed: a ',
    'result set that differs from the one you asked for is worse than a refusal, because nothing ',
    'in the result would tell you it had been filtered. Name a directory below the root instead. ',
    'Nothing in those paths bears on the question you answer.',
  ].join('');
}

function hookNote() {
  return 'These limits are enforced by a **PreToolUse hook**, not by your tool list. You do have '
    + '`Edit` and `Write`, because you need them for the paths in your allow list. A write outside '
    + 'that list is refused with a reason. Treat the list as the boundary, not the hook: the hook is '
    + 'a backstop, and the reason you were given the narrow scope is that the narrow scope is correct.';
}

const HOOK_NOTE = hookNote();

/**
 * §2 step 1, and §3's list of what an agent may open.
 *
 * WHY THESE ARE PER-AGENT AND NOT FIXED PROSE. Both used to name
 * `.mavci/project.json` for everyone: step 1 ordered every agent to read the
 * manifest before anything else, and §3 listed it as freely readable. For four of
 * the five agents that is correct - the manifest is how they learn the stack, the
 * tenancy model and which packs apply.
 *
 * For guardian it was a leak. The guardian acceptance corpus is the only evidence
 * guardian's judgement works, and it measures nothing if guardian can tell a corpus
 * run from a real one. The manifest named the corpus staging directory outright, in
 * `checks.fixtures`, so the contract was ordering guardian to open the file that
 * gave the run away. The exemption has since moved into the plugin and the manifest
 * no longer names it - but the two fixes are separate, and this half must hold on
 * its own: a future manifest field could name the corpus again, and a contract that
 * does not send guardian there is the part that does not have to be re-audited each
 * time the schema grows.
 *
 * Guardian's replacement text states its read scope positively and gives NO REASON.
 * A step that explained why it must not read the manifest would tell guardian a
 * corpus exists, which is the same disclosure by a shorter route. `guardian.json`
 * records the reason under a `_`-prefixed key the generator drops.
 */
const DEFAULT_STARTUP_STEP_1 = [
  'Read `.mavci/project.json`. It declares the stack, tenancy model, protected',
  '   environments, risk tier and which standards packs apply. If it is missing,',
  '   this is not a connected project: stop and report `blocked_by: "not_connected"`.',
].join('\n');

const DEFAULT_STARTUP_STEP_2 = [
  'Read `.mavci/control/state.json`. If `phase` is not `{{phase}}`, **stop** and',
  '   report `status: "blocked"` with `blocked_by: "wrong_phase:<actual>"`. Do not',
  '   change the phase yourself - you cannot, and trying wastes a turn.',
].join('\n');

const DEFAULT_INPUTS_INTRO = 'You may assume these exist and may read them freely:';

const DEFAULT_INPUTS = [
  '`.mavci/project.json` - the manifest',
  '`.mavci/control/state.json` - phase, active task, retry counters',
  '`.mavci/tasks/<id>.md` - the spec for the active task',
  '`.mavci/control/tasks/<id>.json` - authoritative status and attempt count',
  '`.mavci/control/verdicts/*.json` - what failed on previous attempts, with file and line',
];

function standardsInvocations(def) {
  const packs = def.standards_packs ?? [];
  if (!packs.length) return '_(this agent loads no standards packs)_';
  return packs.map((p) => `   - \`/mavci-core:standards-${p}\``).join('\n').trimStart();
}

export function render(contract, def) {
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
    constraint_note: constraintNote(def) + readScopeNote(def),
    standards_invocations: standardsInvocations(def),
    outputs_list: list(def.outputs),
    escalate_list: bullets(def.escalate_when),
    startup_step_1: def.startup_step_1 ?? DEFAULT_STARTUP_STEP_1,
    startup_step_2: (def.startup_step_2 ?? DEFAULT_STARTUP_STEP_2).split('{{phase}}').join(def.phase),
    inputs_intro: def.inputs_intro ?? DEFAULT_INPUTS_INTRO,
    inputs_read_list: bullets(def.inputs ?? DEFAULT_INPUTS),
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

export const CONTRACT_PATH = CONTRACT;

export function loadDefs({ keepNotes = false } = {}) {
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
      // Read scope is enforced by risk-guard.mjs on PreToolUse, from THIS file, so
      // the text the agent reads and the rule that refuses it come from one source.
      read_scope: def.read_scope ?? null,
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

// Guarded so this module can be imported. check-corpus-blind.mjs renders guardian
// from a MODIFIED definition to demonstrate its assertions failing, which needs
// `render` as a function rather than as a side effect of loading the file.
if (path.basename(process.argv[1] ?? '') === 'build-agents.mjs') main();

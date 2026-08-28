#!/usr/bin/env node
/**
 * Skill and agent content must use `${CLAUDE_PLUGIN_ROOT}`, never `$CLAUDE_PLUGIN_ROOT`.
 *
 * The two forms are different mechanisms, and only one of them works here:
 *
 *   ${CLAUDE_PLUGIN_ROOT}   a PLACEHOLDER. Claude Code rewrites it to an absolute
 *                           path in skill and agent content before anything runs,
 *                           and normalises Windows separators to `/` while doing it.
 *   $CLAUDE_PLUGIN_ROOT     an ENVIRONMENT VARIABLE reference. It is exported only
 *                           to hook processes and to MCP and LSP subprocesses -
 *                           never to the Bash tool, which is what actually runs a
 *                           skill's inline `!` shell.
 *
 * Every skill and both generated agents shipped the bare form from 0.1.0 to 0.1.7.
 * `/mavci-core:doctor` is a single inline command, so it expanded to an empty
 * string, Git Bash read the remaining `/scripts/doctor.mjs` as an absolute POSIX
 * path, and MSYS translated it into the Git install directory:
 *
 *   Error: Cannot find module 'C:\Program Files\Git\scripts\doctor.mjs'
 *
 * doctor, plan, build and verify failed at skill load; new-project, connect and
 * waive failed only in the commands they hand the model. Seven releases, every
 * command in the system, one character - and CI could not see it, because the only
 * thing that had ever read a SKILL.md was `check-plugin.mjs`, which parses the
 * frontmatter and never looks at the body. That is what this file is for.
 *
 * See NATIVE-CAPABILITIES 2.10 and 2.11.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGINS = path.join(ROOT, 'plugins');

const failures = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

/**
 * The placeholders Claude Code substitutes textually into skill and agent
 * content. A bare `$NAME` reference to any of them is the same bug.
 */
const NAMES = [
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_PLUGIN_DATA',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_SKILL_DIR',
  'CLAUDE_SESSION_ID',
];

/** `$NAME` not followed by `{` - i.e. the env-var form, not the placeholder. */
const BARE = new RegExp(String.raw`\$(?!\{)(?:${NAMES.join('|')})\b`, 'g');

/**
 * The ONE scanner. Both the real tree and the controls below go through this
 * function - a control that exercises its own copy of the logic cannot disagree
 * with production, which is exactly how the `__PROJECT_ID__` gap survived a full
 * green suite (see check-placeholders.mjs).
 *
 * @returns {{line: number, text: string, token: string}[]}
 */
export function bareFormsIn(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(BARE)) {
      hits.push({ line: i + 1, text: line.trim(), token: m[0] });
    }
  });
  return hits;
}

/** Every file whose content Claude Code substitutes placeholders into. */
function targets() {
  const out = [];
  const add = (p) => { if (fs.existsSync(p)) out.push(p); };

  for (const plugin of fs.existsSync(PLUGINS) ? fs.readdirSync(PLUGINS) : []) {
    const base = path.join(PLUGINS, plugin);
    if (!fs.statSync(base).isDirectory()) continue;

    const skills = path.join(base, 'skills');
    if (fs.existsSync(skills)) {
      for (const s of fs.readdirSync(skills)) add(path.join(skills, s, 'SKILL.md'));
    }
    const agents = path.join(base, 'agents');
    if (fs.existsSync(agents)) {
      for (const a of fs.readdirSync(agents)) if (a.endsWith('.md')) add(path.join(agents, a));
    }
    // hooks.json declares `args`, and with `args` present Claude Code substitutes
    // ONLY the braced form. The bare one would reach node as a literal.
    add(path.join(base, 'hooks', 'hooks.json'));
  }

  // The generated agents are downstream of these. Catching it here is the only
  // place a fix survives `build-agents.mjs`.
  const defs = path.join(ROOT, 'agent-defs');
  if (fs.existsSync(defs)) {
    for (const d of fs.readdirSync(defs)) if (d.endsWith('.json')) add(path.join(defs, d));
  }
  return out;
}

/* --- 1. the real tree ------------------------------------------------ */
{
  const files = targets();

  // A scan that inspected nothing must not report a pass. Same fail-open class
  // as an empty standards pack list silently disabling the checker.
  if (files.length === 0) {
    bad('no SKILL.md, agent .md, hooks.json or agent-def was found to scan - '
      + 'this check inspected nothing and cannot be evidence of anything');
  } else {
    let dirty = 0;
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      for (const h of bareFormsIn(fs.readFileSync(f, 'utf8'))) {
        dirty++;
        bad(`${rel}:${h.line} uses the bare ${h.token} - write \${${h.token.slice(1)}} instead. `
          + 'The bare form is not exported to the Bash tool, so it expands to an empty string '
          + `and the path becomes absolute: ${h.text}`);
      }
    }
    if (!dirty) {
      ok(`${files.length} skill, agent, hook and agent-def file(s) use the braced placeholder form`);
    }
  }
}

/* --- 2. negative control: the scanner must actually catch one -------- */
{
  const planted = 'State: !`node "$CLAUDE_PLUGIN_ROOT/scripts/state.mjs" --show`\n';
  const hits = bareFormsIn(planted);
  if (hits.length === 1 && hits[0].token === '$CLAUDE_PLUGIN_ROOT' && hits[0].line === 1) {
    ok('negative control: a planted bare $CLAUDE_PLUGIN_ROOT is detected');
  } else {
    bad(`negative control FAILED: planted one bare form, scanner returned ${JSON.stringify(hits)}. `
      + 'The scan does not work, so the pass above is meaningless.');
  }
}

/* --- 3. positive control: the correct form must NOT be flagged ------- */
{
  // Without this, a scanner that flagged every occurrence of the name would pass
  // check 2 and fail the whole repo forever. A control has to be able to
  // disagree in both directions.
  const correct = 'State: !`node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --show`\n'
    + 'and `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` are fine too.\n';
  const hits = bareFormsIn(correct);
  if (hits.length === 0) {
    ok('positive control: the braced ${CLAUDE_PLUGIN_ROOT} form is not flagged');
  } else {
    bad(`positive control FAILED: the correct braced form was flagged ${JSON.stringify(hits)}. `
      + 'This check would block every correct file.');
  }
}

/* --- 4. control: a real file on disk, scanned end to end ------------- */
{
  // 2 and 3 test the regex on strings. This proves the file-reading path works,
  // because that is the part that actually runs against the repo.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-skillph-'));
  try {
    const f = path.join(tmp, 'SKILL.md');
    fs.writeFileSync(f, [
      '# x',
      '',
      'ok:  !`node "${CLAUDE_PLUGIN_ROOT}/a.mjs"`',
      'bad: !`node "$CLAUDE_PLUGIN_ROOT/b.mjs"`',
      '',
    ].join('\n'));
    const hits = bareFormsIn(fs.readFileSync(f, 'utf8'));
    if (hits.length === 1 && hits[0].line === 4) {
      ok('control: a file holding both forms yields exactly the bare one, at the right line');
    } else {
      bad(`control FAILED: expected one hit on line 4, got ${JSON.stringify(hits)}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`\nskill placeholder check FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(2);
}
console.log('\nskill placeholder check passed: skill and agent content uses the substituted form.');

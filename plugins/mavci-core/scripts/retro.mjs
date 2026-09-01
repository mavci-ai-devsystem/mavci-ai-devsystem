#!/usr/bin/env node
/**
 * Mavci Core - the escalation channel. Gate 4c, finding 4.
 *
 * WHY THIS FILE EXISTS
 * Seven places in this plugin trap an agent and tell it to run
 * `/mavci-core:retro`: the gate's crash arm, its retry ceiling, the task retry
 * ceiling, a crashed check's remedy, doctor's queued-lesson warning, and two
 * skills. Every one of them is a point where the agent has authority to REPORT
 * and no authority to FIX. Until 0.1.12 the command did not exist, so all seven
 * pointed at nothing, and the Gate 4c findings survived only because an agent
 * chose to write a file into `.mavci/lessons/` by hand.
 *
 * That is not a channel. That is luck with good manners. This file is the
 * channel.
 *
 * THE AUTHORITY SPLIT, WHICH IS THE WHOLE DESIGN
 *   --record   an AGENT may run this. It writes a finding into
 *              `.mavci/lessons/`, which is agent-writable surface, not the
 *              control plane. Reporting must never need permission it cannot
 *              get, or the trap closes again.
 *   --apply    OPERATOR only. Carries the finding into the system repository,
 *              where it changes how every downstream project is built.
 *   --clear    OPERATOR only. Deleting the record of an unfixed problem is an
 *              act of authority, not of tidying.
 *
 * `risk-guard.mjs` enforces that split by CALLER, exactly as it does for
 * `state.mjs`: `agent_type` is set for a subagent and absent in the main
 * session (NATIVE-CAPABILITIES 4.9). The split is not enforced here, because a
 * script cannot know who ran it - which is why the guard, not this file, is
 * where `check-risk-guard.mjs` asserts it.
 *
 * WHAT --apply DOES AND DELIBERATELY DOES NOT DO
 * It copies the pending lessons file into the marketplace clone's `docs/lessons/`
 * and prints the next steps. It does not commit, does not bump `plugin.json`,
 * and does not push or tag: those are listed under "Ask me before" in the system
 * repo's CLAUDE.md, and a command that did them would be the agent editing what
 * governs it through a longer pipe.
 *
 * THE QUEUE IS A DIRECTORY (0.1.13, from this command's own first run)
 * `--record` writes to one canonical file, but `.mavci/lessons/` holds whatever
 * anyone put there - and what was actually there, the first time this ran, was
 * `pending-system-change-0.1.12.md`, written by hand before the command existed.
 * 0.1.12 read one fixed path in two places: here and `doctor.checkLessons`. So
 * `doctor` answered "is anything queued?" by testing a path it had chosen in
 * advance, and `--clear` would have deleted the applied file and left the open
 * one behind with the only pointer to it gone. Every reader now enumerates the
 * directory, and every message names the files it found.
 *
 * CLI
 *   --record "<title>" --finding "<text>" [--target <p>] [--check <id>]
 *                                         [--assertion "<text>"] [--broken-build "<text>"]
 *   --list             one line per queued file, then one per finding in it
 *   --show             every queued file, each under its own path
 *   --apply            copy them all into the system repo clone, print next steps
 *   --clear [<name>]   delete a queued file (after it has been applied). The name
 *                      is required whenever more than one is queued.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, MARKETPLACE_NAME, COMMAND_PREFIX } from './config.mjs';
import { abs, exists, readJsonOrNull, readTextOrNull, writeTextAtomic, nowIso } from './lib/fsx.mjs';
import { buildRedactor } from './redact.mjs';
import { pluginVersion, projectRoot } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every queued file starts with this. `--record` appends to the bare form. */
export const PENDING_STEM = 'pending-system-change';

/** The file `--record` writes. One canonical target for machine writes; it is
 *  the only member of the queue this command creates, and never the only one
 *  it must read. */
export const PENDING = `${PATHS.lessons}/${PENDING_STEM}.md`;

/**
 * Every queued findings file, repo-relative POSIX, sorted.
 *
 * `doctor` imports this rather than composing a path of its own. Two readers
 * each deciding for themselves what the queue is IS the 0.1.13 defect, and the
 * fix is one definition, not two matching ones.
 */
export function queuedLessons(root) {
  let names;
  try {
    names = fs.readdirSync(abs(root, PATHS.lessons));
  } catch (err) {
    // No lessons directory means nothing has ever been filed - that is an empty
    // queue, and reporting it as one is correct. Anything else (permissions, a
    // file where the directory should be) means the queue COULD NOT BE READ,
    // which is not the same fact and must not be returned as if it were.
    // Invariant 5: an unchecked control is not a working control.
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => n.startsWith(PENDING_STEM) && n.toLowerCase().endsWith('.md'))
    .sort()
    .map((n) => `${PATHS.lessons}/${n}`);
}

/** What distinguishes one queued file from another: '' or e.g. '-0.1.12'. */
function queueSuffix(relPath) {
  return path.basename(relPath).slice(PENDING_STEM.length).replace(/\.md$/i, '');
}

/* ------------------------------------------------- the finding heading
 * ONE definition, used to write and to read. `record()` builds a heading with
 * `findingHeading`; `parseFindings` matches a pattern built from the same
 * pieces. Change the separator and both change together, or neither does.
 *
 * That is the 0.1.13 fix, and the shape of it matters more than the character
 * that provoked it. 0.1.12 wrote `# Finding 3 - x` with U+002D and matched on
 * a literal that required U+002D, while every heading a human had typed used
 * U+2014. The parser therefore counted machine-written findings, missed human
 * ones, reported zero for a file holding two, and would have appended a second
 * `# Finding 1` under an existing one. Widening the regex to accept both dashes
 * fixes the COUNT and leaves the disagreement in place - the next divergence in
 * spacing or wording lands exactly the same way.
 *
 * Normalisation happens ON READ and never on write. The queue is prose a human
 * edits; rewriting their punctuation to suit a parser edits evidence nobody
 * asked to be edited. `parseFindings` matches against a normalised COPY and
 * then slices the title out of the original - the dash table is one BMP code
 * unit to one, so the copy is index-for-index the same length as the source.
 */
const FINDING_PREFIX = '# Finding';
const FINDING_SEP = ' - ';
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FINDING_RE = new RegExp(`^${rx(FINDING_PREFIX)} (\\d+)${rx(FINDING_SEP)}(.+)$`, 'gm');

/**
 * U+2010..U+2015 (hyphen, non-breaking hyphen, figure/en/em dash, horizontal
 * bar), the minus sign, the hyphen bullet, and the small and full-width forms.
 * Every one is a single BMP code unit, which is what keeps the normalised copy
 * index-for-index aligned with the source. Written as escapes on purpose: a
 * literal class here would be eight look-alike glyphs in a file whose invariant
 * is that a reviewer can read it.
 */
const DASHES = /[\u2010-\u2015\u2212\u2043\uFE58\uFE63\uFF0D]/g;

export function findingHeading(n, title) {
  return `${FINDING_PREFIX} ${n}${FINDING_SEP}${title}`;
}

/** @returns {{n: number, title: string}[]} - titles verbatim from the source. */
export function parseFindings(text) {
  const norm = text.replace(DASHES, '-');
  const found = [];
  for (const m of norm.matchAll(FINDING_RE)) {
    const start = m.index + m[0].length - m[2].length;
    found.push({ n: Number(m[1]), title: text.slice(start, start + m[2].length) });
  }
  return found;
}

function die(msg, code = 1) {
  console.error(`retro: ${msg}`);
  process.exit(code);
}

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

/* ------------------------------------------------------------- recording */

function nextFindingNumber(text) {
  let n = 0;
  for (const f of parseFindings(text)) n = Math.max(n, f.n);
  return n + 1;
}

function header(root) {
  const projectId = readJsonOrNull(abs(root, PATHS.manifest))?.project_id ?? 'unknown';
  return `# Queued for the next system release - apply with \`${COMMAND_PREFIX}retro --apply\`\n`
    + `\n`
    + `Recorded: ${nowIso().slice(0, 10)}, plugin ${pluginVersion()}, project ${projectId}.\n`
    + `\n`
    + `Each finding below was filed from inside a project, by whoever hit it, at the moment\n`
    + `they hit it. Nothing here is fixed. \`${COMMAND_PREFIX}retro --apply\` carries this file into\n`
    + `the system repository; only an operator can run that, and only an operator can delete\n`
    + `this file.\n`;
}

/**
 * Append one finding to the pending file.
 *
 * Everything written passes through the redactor first. A finding is very often
 * a quoted error string, and an error string is one of the likeliest places for
 * a key to appear - the whole point of filing it is that something went wrong
 * in a way nobody predicted. `.mavci/lessons/` is committed to the project
 * repository, so an unredacted paste here is a committed secret.
 */
export function record(root, { title, finding, target, check, assertion, brokenBuild }) {
  if (!title || title === true) die(`--record needs a title: --record "<title>" --finding "<what you saw>"`);
  if (!finding || finding === true) die('--record needs --finding "<what you saw>". A title alone is not a report.');

  const dir = abs(root, PATHS.lessons);
  if (!exists(dir)) fs.mkdirSync(dir, { recursive: true });

  const p = abs(root, PENDING);
  const existing = readTextOrNull(p);
  const body = existing ?? header(root);
  const n = nextFindingNumber(body);

  const r = buildRedactor(root, readJsonOrNull(abs(root, PATHS.manifest)));
  const clean = (s) => (typeof s === 'string' ? r.redact(s) : s);

  const parts = [
    ``,
    `---`,
    ``,
    findingHeading(n, clean(title)),
    ``,
    `Filed: ${nowIso()}, plugin ${pluginVersion()}.`,
  ];
  if (target && target !== true) parts.push(``, `Target: \`${clean(target)}\``);
  if (check && check !== true) parts.push(``, `Check: \`${clean(check)}\``);
  parts.push(``, clean(finding).trim(), ``);

  // The assertion section is the house format, and it is not decoration: a
  // finding filed without one is a complaint. CLAUDE.md's rule is that a class-A
  // change needs a class-B check, so the report has to carry the shape of the
  // check. When the filer does not supply one, the placeholder says so in the
  // words the next reader needs, rather than leaving the section out and letting
  // its absence look like an oversight.
  parts.push(`### The assertion, and the broken build it must catch`, ``);
  parts.push(assertion && assertion !== true
    ? clean(assertion).trim()
    : 'NOT SUPPLIED. Whoever applies this must write one before building the fix: name the '
      + 'broken build the assertion catches, and confirm the assertion FAILS against it first. '
      + 'A check that passes on its first run against the broken build is matching the wrong thing.');
  if (brokenBuild && brokenBuild !== true) {
    parts.push(``, `Broken build: ${clean(brokenBuild).trim()}`);
  }
  parts.push(``);

  writeTextAtomic(p, body.replace(/\n+$/, '\n') + parts.join('\n'));
  return { path: PENDING, number: n };
}

/* ---------------------------------------------------------------- apply */

/** Where `/plugin` keeps marketplace clones. Mirrors doctor.mjs `clonePath`. */
function clonePath() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'plugins', 'marketplaces', MARKETPLACE_NAME);
}

/**
 * The system repository this plugin is RUNNING FROM.
 *
 * Two candidates, and the order matters. First the checkout this file lives in
 * (`<plugin>/../..`); only then the marketplace clone.
 *
 * A normal install makes those the same directory - the plugin runs from inside
 * the clone - so the order is invisible there. It stops being invisible on a
 * development machine, where the operator has both a working checkout and a
 * clone. The first draft preferred the clone and wrote the lesson into
 * `~/.claude/plugins/marketplaces/mavci`, which is a real git checkout but not
 * the one the operator is editing: the finding would have landed in a directory
 * they were never going to open, and `git status` in the repo they WERE editing
 * would have shown nothing.
 *
 * Preferring the running copy makes the rule simple and always true: a finding
 * is applied to the repository whose code produced it.
 *
 * Both candidates are confirmed by a marker file rather than by path shape,
 * because a wrong guess writes a lesson into some unrelated repository.
 */
function systemRepo() {
  const candidates = [path.resolve(HERE, '..', '..', '..'), clonePath()];
  for (const c of candidates) {
    if (exists(path.join(c, '.claude-plugin', 'marketplace.json'))) return c;
  }
  return null;
}

/**
 * What --apply would carry, decided before anything is written.
 *
 * Separate from `apply` for two reasons. It is the whole decision - which files
 * go, and under what name - so it is what a self-test needs to assert, and
 * asserting it does not require letting a test write into a real system repo.
 * And it lets the collision check run over the WHOLE queue first: applying two
 * files one at a time and dying on the second leaves the operator half applied,
 * with no way to tell from the tree which half.
 *
 * The destination keeps the queued file's own suffix, so the two that provoked
 * this - `pending-system-change.md` and `pending-system-change-0.1.12.md` - land
 * as `<project>-<date>.md` and `<project>-<date>-0.1.12.md` rather than one
 * silently overwriting the other.
 */
export function applyPlan(root, { projectId, stamp } = {}) {
  const id = projectId ?? readJsonOrNull(abs(root, PATHS.manifest))?.project_id ?? 'unknown-project';
  const day = stamp ?? nowIso().slice(0, 10);
  return queuedLessons(root).map((rel) => ({
    src: rel,
    destName: `${id}-${day}${queueSuffix(rel)}.md`,
  }));
}

function apply(root) {
  const plan = applyPlan(root);
  if (!plan.length) {
    die(`nothing to apply: no ${PENDING_STEM}*.md in ${PATHS.lessons}. File a finding first with `
      + `\`${COMMAND_PREFIX}retro\`.`, 1);
  }
  const repo = systemRepo();
  if (!repo) {
    // "Could not check" is never a pass (invariant 5), and neither is "could not
    // carry". Failing here with the manual step spelled out is strictly better
    // than writing the file somewhere plausible.
    die('could not locate the system repository. Looked for .claude-plugin/marketplace.json in:\n'
      + `  ${clonePath()}\n`
      + `  ${path.resolve(HERE, '..', '..', '..')}\n`
      + `Copy ${PENDING} into the system repo's docs/lessons/ by hand instead - that is all this `
      + 'command does, and doing it by hand loses nothing but the provenance header.', 1);
  }

  const projectId = readJsonOrNull(abs(root, PATHS.manifest))?.project_id ?? 'unknown-project';
  const destDir = path.join(repo, 'docs', 'lessons');

  // Every destination checked before any of them is written.
  const clash = plan.filter((x) => exists(path.join(destDir, x.destName)));
  if (clash.length) {
    die(`${clash.map((x) => path.join('docs', 'lessons', x.destName)).join(', ')} already exists in `
      + 'the system repo. A second apply on the same day would overwrite the first, and a lesson is '
      + 'evidence. Rename or merge it by hand. Nothing was applied.', 1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  for (const x of plan) {
    const provenance = `<!-- Applied by ${COMMAND_PREFIX}retro --apply on ${nowIso()}\n`
      + `     from project ${projectId}, plugin ${pluginVersion()}, queued as ${x.src}.\n`
      + `     Copied verbatim below this line. Paths inside are relative to the project it was\n`
      + `     filed from, not to this repository. -->\n\n`;
    fs.writeFileSync(path.join(destDir, x.destName),
      provenance + fs.readFileSync(abs(root, x.src), 'utf8'));
    console.log(`applied ${x.src} -> ${path.join('docs', 'lessons', x.destName)} in ${repo}`);
  }
  console.log('');
  console.log('Next, in the system repo, and none of it done for you:');
  console.log(`  1. read it, and decide which findings become changes`);
  console.log(`  2. for each one: write the assertion FIRST and watch it fail against this build`);
  console.log(`  3. build the fix, add its fixtures, wire the check into CI`);
  console.log(`  4. bump plugins/mavci-core/.claude-plugin/plugin.json - nothing reaches any`);
  console.log(`     project until that number changes`);
  console.log(`  5. commit, push, tag`);
  console.log(`\nThen, back here, once per file:`);
  for (const x of plan) console.log(`  ${COMMAND_PREFIX}retro --clear ${path.basename(x.src)}`);
  console.log('That deletion is an operator act and the risk guard refuses it to an agent: it is the');
  console.log('record of an unfixed problem, and it must not disappear because a turn went badly.');
  return plan.map((x) => path.join(destDir, x.destName));
}

/* ----------------------------------------------------------------- CLI */

function main() {
  const root = projectRoot();
  const argv = process.argv.slice(2);

  if (argv.includes('--record')) {
    if (!exists(abs(root, PATHS.manifest))) {
      die('not a Mavci project: .mavci/project.json not found. A finding is filed against a '
        + 'project, so run this from one.', 1);
    }
    const { path: rel, number } = record(root, {
      title: arg('--record'),
      finding: arg('--finding'),
      target: arg('--target'),
      check: arg('--check'),
      assertion: arg('--assertion'),
      brokenBuild: arg('--broken-build'),
    });
    console.log(`filed finding ${number} in ${rel}`);
    console.log('It is queued, not fixed. doctor reports it every run until an operator applies it.');
    return;
  }

  if (argv.includes('--list')) {
    const files = queuedLessons(root);
    if (!files.length) { console.log(`nothing queued (no ${PENDING_STEM}*.md in ${PATHS.lessons})`); return; }
    for (const f of files) {
      const text = readTextOrNull(abs(root, f));
      if (text === null) { console.log(`${f}: UNREADABLE - it is queued and its contents are unknown`); continue; }
      const found = parseFindings(text);
      console.log(`${f}: ${found.length} finding(s)`);
      for (const x of found) console.log(`  ${x.n}. ${x.title}`);
    }
    return;
  }

  if (argv.includes('--show')) {
    const files = queuedLessons(root);
    if (!files.length) { console.log(`nothing queued (no ${PENDING_STEM}*.md in ${PATHS.lessons})`); return; }
    for (const f of files) {
      const text = readTextOrNull(abs(root, f));
      process.stdout.write(`\n===== ${f} =====\n`);
      process.stdout.write(text === null ? '(unreadable)\n' : text);
    }
    return;
  }

  if (argv.includes('--apply')) { apply(root); return; }

  // --clear names its target whenever there is more than one thing it could
  // mean. 0.1.12 deleted the canonical file unconditionally, so applying and
  // clearing with a hand-written file also queued removed the record of one
  // problem and left the other with nothing pointing at it - doctor watched the
  // same fixed path, so it went quiet too. A bare --clear is now only allowed
  // where it is unambiguous.
  if (argv.includes('--clear')) {
    const files = queuedLessons(root);
    if (!files.length) { console.log('nothing to clear'); return; }
    const asked = arg('--clear');
    if (asked === true || asked === undefined) {
      if (files.length > 1) {
        die(`${files.length} files are queued, so --clear needs to be told which:\n`
          + files.map((f) => `  ${COMMAND_PREFIX}retro --clear ${path.basename(f)}`).join('\n')
          + '\nNothing was deleted. Clearing one and leaving the rest is fine; clearing one WITHOUT '
          + 'knowing the rest are there is how the record of an unfixed problem disappears.', 1);
      }
      fs.rmSync(abs(root, files[0]));
      console.log(`cleared ${files[0]}`);
      return;
    }
    const target = files.find((f) => path.basename(f) === path.basename(String(asked)));
    if (!target) {
      die(`${asked} is not queued. Queued now:\n${files.map((f) => `  ${f}`).join('\n')}`, 1);
    }
    fs.rmSync(abs(root, target));
    const left = queuedLessons(root);
    console.log(`cleared ${target}`);
    if (left.length) console.log(`still queued: ${left.map((f) => path.basename(f)).join(', ')}`);
    return;
  }

  console.log([
    'usage: retro.mjs <command>',
    '  --record "<title>" --finding "<text>" [--target <path>] [--check <id>]',
    '                     [--assertion "<text>"] [--broken-build "<text>"]',
    '                                 file a finding against the system (agents may do this)',
    '  --list                         every queued file, and the findings in it',
    '  --show                         print every queued file',
    '  --apply                        carry them into the system repo  (operator only)',
    '  --clear [<name>]               delete one queued file           (operator only)',
    '                                 the name is required when more than one is queued',
  ].join('\n'));
  process.exit(2);
}

// basename, not endsWith. `scripts/ci/check-retro.mjs` ends with "retro.mjs",
// so the endsWith form ran the CLI - printing usage and exiting 2 - the moment
// the self-test imported this module. The house form is copied from state.mjs;
// it is wrong there too, and harmless only because no file is named to collide.
if (process.argv[1] && path.basename(process.argv[1]) === 'retro.mjs') main();

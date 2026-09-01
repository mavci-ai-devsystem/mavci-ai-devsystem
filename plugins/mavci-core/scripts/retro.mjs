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
 * CLI
 *   --record "<title>" --finding "<text>" [--target <p>] [--check <id>]
 *                                         [--assertion "<text>"] [--broken-build "<text>"]
 *   --list       one line per queued finding
 *   --show       the whole pending file
 *   --apply      copy into the system repo clone and print the next steps
 *   --clear      delete the pending file (after it has been applied)
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

/** The one filename doctor already watches for (`checkLessons`). Spelled once. */
export const PENDING = `${PATHS.lessons}/pending-system-change.md`;

/**
 * A finding heading, so `--list` can count them and `--apply` can name them.
 * Deliberately a literal marker rather than "any h1": the file is prose that a
 * human also edits by hand, and a parser that guesses at structure would report
 * a different count than the reader sees.
 */
const FINDING_RE = /^# Finding (\d+) - (.+)$/gm;

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
  for (const m of text.matchAll(FINDING_RE)) n = Math.max(n, Number(m[1]));
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
    `# Finding ${n} - ${clean(title)}`,
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

function apply(root) {
  const src = abs(root, PENDING);
  if (!exists(src)) {
    die(`nothing to apply: ${PENDING} does not exist. File a finding first with `
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
  const stamp = nowIso().slice(0, 10);
  const destDir = path.join(repo, 'docs', 'lessons');
  const destName = `${projectId}-${stamp}.md`;
  const dest = path.join(destDir, destName);

  if (exists(dest)) {
    die(`${path.relative(repo, dest)} already exists in the system repo. A second apply on the same `
      + 'day would overwrite the first, and a lesson is evidence. Rename or merge it by hand.', 1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const provenance = `<!-- Applied by ${COMMAND_PREFIX}retro --apply on ${nowIso()}\n`
    + `     from project ${projectId}, plugin ${pluginVersion()}.\n`
    + `     Copied verbatim below this line. Paths inside are relative to the project it was\n`
    + `     filed from, not to this repository. -->\n\n`;
  fs.writeFileSync(dest, provenance + fs.readFileSync(src, 'utf8'));

  console.log(`applied to ${path.join('docs', 'lessons', destName)} in ${repo}\n`);
  console.log('Next, in the system repo, and none of it done for you:');
  console.log(`  1. read it, and decide which findings become changes`);
  console.log(`  2. for each one: write the assertion FIRST and watch it fail against this build`);
  console.log(`  3. build the fix, add its fixtures, wire the check into CI`);
  console.log(`  4. bump plugins/mavci-core/.claude-plugin/plugin.json - nothing reaches any`);
  console.log(`     project until that number changes`);
  console.log(`  5. commit, push, tag`);
  console.log(`\nThen, back here: \`${COMMAND_PREFIX}retro --clear\` to retire the queued file.`);
  console.log('That deletion is an operator act and the risk guard refuses it to an agent: it is the');
  console.log('record of an unfixed problem, and it must not disappear because a turn went badly.');
  return dest;
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
    const text = readTextOrNull(abs(root, PENDING));
    if (!text) { console.log(`nothing queued (${PENDING} does not exist)`); return; }
    const found = [...text.matchAll(FINDING_RE)];
    console.log(`${found.length} finding(s) queued in ${PENDING}:`);
    for (const m of found) console.log(`  ${m[1]}. ${m[2]}`);
    return;
  }

  if (argv.includes('--show')) {
    const text = readTextOrNull(abs(root, PENDING));
    if (!text) { console.log(`nothing queued (${PENDING} does not exist)`); return; }
    process.stdout.write(text);
    return;
  }

  if (argv.includes('--apply')) { apply(root); return; }

  if (argv.includes('--clear')) {
    const p = abs(root, PENDING);
    if (!exists(p)) { console.log('nothing to clear'); return; }
    fs.rmSync(p);
    console.log(`cleared ${PENDING}`);
    return;
  }

  console.log([
    'usage: retro.mjs <command>',
    '  --record "<title>" --finding "<text>" [--target <path>] [--check <id>]',
    '                     [--assertion "<text>"] [--broken-build "<text>"]',
    '                                 file a finding against the system (agents may do this)',
    '  --list                         one line per queued finding',
    '  --show                         print the queued file',
    '  --apply                        carry it into the system repo   (operator only)',
    '  --clear                        delete the queued file          (operator only)',
  ].join('\n'));
  process.exit(2);
}

if (process.argv[1] && process.argv[1].endsWith('retro.mjs')) main();

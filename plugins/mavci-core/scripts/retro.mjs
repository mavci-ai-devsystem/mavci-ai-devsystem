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
 *   --amend <n> --title "<t>" --text <path|-> [--was <path|->] [--file <name>]
 *                      append a dated addendum to a queued finding, carrying its own
 *                      provenance. It never edits the finding's own text, and it
 *                      refuses to edit provenance at all - see "amending" below.
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

/**
 * Every finding in a queue file, with the bounds of the block it owns.
 *
 * ONE scanner. `parseFindings` is a projection of this rather than a second
 * matcher, for the reason `findingHeading` and `FINDING_RE` share their pieces:
 * two readers of one format is what produced 0.1.13.
 *
 * A block runs from its own heading to the next heading, or to end of file for
 * the last one. That boundary is what `--amend` inserts before, and it is the
 * whole reason offsets are exported at all.
 *
 * @returns {{n: number, title: string, start: number, end: number}[]}
 */
export function findingBlocks(text) {
  const norm = text.replace(DASHES, '-');
  const found = [];
  for (const m of norm.matchAll(FINDING_RE)) {
    const titleAt = m.index + m[0].length - m[2].length;
    found.push({
      n: Number(m[1]),
      title: text.slice(titleAt, titleAt + m[2].length),
      start: m.index,
      end: text.length,
    });
  }
  for (let i = 0; i < found.length - 1; i += 1) found[i].end = found[i + 1].start;
  return found;
}

/** @returns {{n: number, title: string}[]} - titles verbatim from the source. */
export function parseFindings(text) {
  return findingBlocks(text).map(({ n, title }) => ({ n, title }));
}

/* -------------------------------------------------- the amendment heading
 * gate6 finding 12. Same construction as the finding heading and for the same
 * reason: one definition, used to write and to read.
 *
 * THE WORD IS "Addendum" BECAUSE THE QUEUE'S WORD IS "Addendum" - twelve hand-
 * written blocks in one file, before this command existed. Choosing a synonym
 * for the machine form would recreate the 0.1.13 defect deliberately: a writer
 * and a reader that agree with each other and not with what a human types.
 *
 * Both hand forms are recognised. `### Addendum to finding N - t` names its
 * target; the older `### Addendum - t` is POSITIONAL and belongs to the finding
 * whose block it sits in. The explicit target wins when both are available,
 * because the queue's later hand blocks were appended at the end of the file
 * and now sit inside other findings' blocks - position would attribute them to
 * whatever they landed under.
 */
const AMEND_PREFIX = '### Addendum';
const AMEND_TARGET = ' to finding ';
const AMEND_RE = new RegExp(
  `^${rx(AMEND_PREFIX)}(?:${rx(AMEND_TARGET)}(\\d+))?${rx(FINDING_SEP)}(.+)$`, 'gm');

/** The attestation an amendment carries, and the needle that finds one. */
const AMEND_STAMP = 'Amended by:';
const AMEND_STAMP_RE = new RegExp(`^Amended .*${rx(AMEND_STAMP)}`, 'm');

export function amendmentHeading(n, title) {
  return `${AMEND_PREFIX}${AMEND_TARGET}${n}${FINDING_SEP}${title}`;
}

/**
 * Every amendment in a queue file, hand-written and tool-written alike.
 *
 * This is the reader finding 12 asks for by name: *"the check must compare
 * blocks WITHIN a queue file for stamp presence, not verify the writer stamps
 * what it writes."* An assertion that `--amend` stamps its own output passes
 * against a queue full of unstamped hand edits, because the defect is text that
 * never went through this command at all.
 *
 * WHAT `stamped` MEANS, STATED NARROWLY. It is the SHAPE of a stamp, nothing
 * more. What makes a stamp evidence is that this writer is the only thing that
 * emits one and `risk-guard.mjs` constrains what this writer may be told to put
 * in it. A human who types the line by hand produces something this reader
 * cannot distinguish, and no reader of a text file could. Saying so here is
 * cheaper than someone later reading `stamped: true` as a guarantee.
 *
 * @returns {{finding: number|null, title: string, stamped: boolean,
 *            positional: boolean, start: number, end: number}[]}
 */
export function parseAmendments(text) {
  const blocks = findingBlocks(text);
  const norm = text.replace(DASHES, '-');
  const found = [];
  for (const m of norm.matchAll(AMEND_RE)) {
    const titleAt = m.index + m[0].length - m[2].length;
    const declared = m[1] === undefined ? null : Number(m[1]);
    const owner = blocks.find((b) => m.index >= b.start && m.index < b.end) ?? null;
    found.push({
      finding: declared ?? owner?.n ?? null,
      title: text.slice(titleAt, titleAt + m[2].length),
      positional: declared === null,
      start: m.index,
      end: text.length,
      _owner: owner,
    });
  }
  for (let i = 0; i < found.length; i += 1) {
    const nextAmend = found[i + 1]?.start ?? Infinity;
    const blockEnd = found[i]._owner?.end ?? text.length;
    found[i].end = Math.min(nextAmend, blockEnd);
    found[i].stamped = AMEND_STAMP_RE.test(text.slice(found[i].start, found[i].end));
    delete found[i]._owner;
  }
  return found;
}

/**
 * A finding's BODY: its block, up to the first amendment in it.
 *
 * `--was` resolves against this and not against the whole block, so a quote
 * cannot come back green by matching an EARLIER amendment's quotation of it.
 * The superseded words are said to come from the body above, and that is the
 * text they are checked against.
 */
export function findingBody(text, block) {
  const inside = parseAmendments(text).filter((a) => a.start >= block.start && a.start < block.end);
  return text.slice(block.start, inside.length ? inside[0].start : block.end);
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
export function record(root, { title, finding, target, check, assertion, brokenBuild, agent }) {
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
    ``,
    // PROVENANCE. A finding written by the main session and one written by a haiku
    // agent are different evidence, and an operator applying this queue changes how
    // every downstream project is built. The value is not self-declared: risk-guard
    // denies an agent's --record unless --agent names the caller it actually is, so
    // an agent can neither file anonymously nor file as somebody else.
    agent && agent !== true
      ? `Filed by: **${clean(String(agent))}** (agent). Provenance enforced at the risk guard, `
        + `not self-declared. Weigh it accordingly before applying.`
      // NOT "the main session". The guard allows an agent to file without declaring
      // itself - the channel must never close - so an absent value means UNKNOWN, and
      // asserting the operator wrote it would be a false attribution on the one field
      // an operator uses to decide how much scrutiny a finding needs.
      : `Filed by: not recorded. Either the main session, or an agent that did not declare `
        + `itself - the queue cannot tell. Treat it as unattributed.`,
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

/* --------------------------------------------------------------- amending
 * gate6 finding 12. Design: docs/retro-amend-design.md in the system repo.
 *
 * TWO ANSWERS DECIDE WHAT THIS IS, and both are load-bearing.
 *
 * 1. IT APPENDS. No path here edits a filed byte. This file already holds that
 *    rule one scale down - dashes are normalised on READ and never on write,
 *    because "rewriting their punctuation to suit a parser edits evidence
 *    nobody asked to be edited" - and a replaced sentence is that act with a
 *    larger diff. `--apply` copies the queue verbatim into the system repo's
 *    docs/lessons/, so a replacement erases the fact that anybody looked twice.
 *    The queue's own finding 18 addendum puts it best: a queue entry that reads
 *    as though it was filed at the right width is worse than one that shows
 *    where it was wrong.
 *
 *    The cost is real: a reader who reads the body and stops acts on the
 *    uncorrected claim. It is paid on the READER side - `--list` reports how
 *    many amendments a finding carries and how many are unstamped. Nothing
 *    writes into a body to announce a correction.
 *
 *    And it is inserted at the END OF ITS TARGET'S BLOCK, not the end of the
 *    file. Four of the twelve hand-written blocks were tail-appended and later
 *    findings were filed after them, so the addenda to findings 17, 20 and 22
 *    now sit buried inside other findings' blocks, hundreds of lines from what
 *    they amend. That is what append-at-end decays into; it is what a hand edit
 *    does because it is cheap, and this has no such excuse.
 *
 * 2. IT CARRIES ITS OWN PROVENANCE, never the finding's. The queue settles it:
 *    finding 18's addendum was written "by the writer of the finding", the
 *    addenda to 17, 20 and 22 "at the operator's direction", and every body is
 *    stamped `**main** (agent)`. Inheritance would report every one of those
 *    operator corrections as agent-authored - a false attribution on the one
 *    field an operator uses to decide how much scrutiny a finding needs. Its
 *    own timestamp and plugin version too: finding 18 was filed on 0.1.28 and
 *    corrected against evidence from the 0.1.27 run, and one stamp cannot carry
 *    two versions.
 *
 *    THE TRAP NEXT DOOR: eight of the twelve hand blocks open with "at the
 *    operator's direction". That is a claim about who DIRECTED, written by the
 *    party being directed - self-declaration, which is the exact thing a stamp
 *    exists to replace. The guard can only enforce who RAN the command, so that
 *    is all the stamp says, and it says so in words. A `--directed-by` flag
 *    would be a self-declared field wearing a stamp's clothes, and worse than
 *    the prose because it would look enforced.
 *
 * WHAT IT REFUSES, AND WHY THE REFUSAL IS THE POINT. It does not edit
 * provenance. Correcting text and asserting authorship are different acts, and
 * a retroactive `Filed by:` is a claim about who wrote the original made by
 * someone who was not necessarily there - on the field this whole finding
 * exists to protect. Finding 23 of the gate6 queue is the live case: it is the
 * one body reading `Filed by: not recorded`, and it stays that way. The refusal
 * is explicit rather than a gap, because a gap reads as an oversight and gets
 * built by the next person.
 */

/** Flags that would set or change attribution. Refused by name. */
const ATTRIBUTION_FLAGS = [
  '--filed-by', '--attribute', '--attribution', '--provenance',
  '--stamp', '--as', '--author', '--directed-by',
];

/**
 * Amendment prose comes from a FILE or from stdin. Never from an argument.
 *
 * On 2026-09-04 finding 16 reached the gate6 queue through `--record` having
 * lost four backticked words to shell command substitution - `blocked` twice,
 * `done` and `failed` once each. The prose was passed inside a double-quoted
 * argument and bash evaluated the backticks before `retro.mjs` ever saw them.
 * One of the four was the exact word the finding is about, and two of the gaps
 * left grammatical sentences, so a reader would take them for typos.
 *
 * A door prose can come through is a door every caller uses, and the loss is
 * silent. So an inline value is REFUSED rather than accepted as a convenience.
 *
 * `--record` is knowingly left as it is - see the design note. It is the
 * trapped-agent path, seven messages point at it, and making the reporting
 * channel harder to reach is the worst outcome available here.
 */
function readProse(value, flag) {
  if (value === undefined || value === true) {
    die(`${flag} needs a path, or - for stdin. It does not take prose: an argument goes through `
      + 'the shell, and on 2026-09-04 that ate four backticked words out of a finding on the way in.');
  }
  if (value === '-') {
    try {
      return fs.readFileSync(0, 'utf8');
    } catch (err) {
      die(`${flag} - was given but stdin could not be read (${err?.code ?? err?.message}). Write the `
        + 'text to a file and pass its path instead.');
    }
  }
  const text = readTextOrNull(path.resolve(value));
  if (text === null) {
    die(`${flag} takes a PATH or -, never prose, and there is no file at ${JSON.stringify(value)}.\n`
      + '  Write the text to a file and pass the path, or pipe it and pass -.\n'
      + '  The reason is measured: prose passed as an argument goes through the shell, and on '
      + '2026-09-04 a finding reached the queue having lost four backticked words that way - one of '
      + 'them the exact word the finding was about.');
  }
  return text;
}

/** Whitespace-collapsed, dash-normalised copy. For comparing quotes only. */
const forCompare = (s) => s.replace(DASHES, '-').replace(/\s+/g, ' ').trim();

/**
 * Append one amendment to a finding already in the queue.
 *
 * @param {string} root
 * @param {{file?: string, number: number, title: string, text: string,
 *          was?: string|null, agent?: string|null}} opts
 */
export function amend(root, { file, number, title, text, was = null, agent = null }) {
  if (!Number.isInteger(number) || number < 1) {
    die('--amend needs the number of the finding to amend, e.g. `--amend 18`.');
  }
  if (!title || title === true) {
    die('--amend needs --title "<short heading>". An addendum with no heading is invisible in --list.');
  }

  const files = queuedLessons(root);
  if (!files.length) {
    die(`nothing queued (no ${PENDING_STEM}*.md in ${PATHS.lessons}), so there is no finding `
      + `${number} to amend.`, 1);
  }

  // WHICH FILE. The --clear precedent, one verb along: the queue is a directory,
  // two queued files can each hold a finding 18, and amending the wrong one is
  // silent - the correction lands on a different finding and both files still
  // look right.
  const holders = files.filter((f) => {
    const t = readTextOrNull(abs(root, f));
    return t !== null && findingBlocks(t).some((b) => b.n === number);
  });
  let target;
  if (file && file !== true) {
    target = files.find((f) => path.basename(f) === path.basename(String(file)));
    if (!target) die(`${file} is not queued. Queued now:\n${files.map((f) => `  ${f}`).join('\n')}`, 1);
  } else if (holders.length > 1) {
    die(`${holders.length} queued files hold a finding ${number}, so --amend needs to be told which:\n`
      + holders.map((f) => `  ${COMMAND_PREFIX}retro --amend ${number} --file ${path.basename(f)} ...`).join('\n')
      + '\nNothing was written. Choosing silently would put the correction on a different finding, '
      + 'and both files would still look right.', 1);
  } else {
    target = holders[0];
  }
  if (!target) {
    die(`no queued file holds a finding ${number}. Queued now:\n`
      + files.map((f) => `  ${f}`).join('\n'), 1);
  }

  const p = abs(root, target);
  const body = readTextOrNull(p);
  if (body === null) die(`${target} could not be read, so nothing can be appended to it.`, 1);

  const block = findingBlocks(body).find((b) => b.n === number);
  if (!block) die(`${target} holds no finding ${number}.`, 1);

  const r = buildRedactor(root, readJsonOrNull(abs(root, PATHS.manifest)));
  const clean = (s) => (typeof s === 'string' ? r.redact(s) : s);

  // THE QUOTE MUST RESOLVE. Finding 17's shape - a citation that does not
  // resolve is stored exactly like one that does - and it is cheap to close
  // here because both strings are in hand. Compared on a normalised COPY,
  // never on disk: a quote re-wrapped by whoever copied it is the same quote,
  // and one whose em dash was retyped as a hyphen is 0.1.13 in other clothes.
  let quote = null;
  if (was !== null && was !== undefined) {
    quote = clean(was).trim();
    if (!quote) die('--was was given and is empty. Omit it rather than quoting nothing: the '
      + 'amendment then says outright that it ADDS rather than corrects.');
    if (!forCompare(findingBody(body, block)).includes(forCompare(quote))) {
      die(`the --was quote does not appear in finding ${number}'s body in ${target}, so nothing was `
        + 'written. A superseded quote is a citation, and a citation that does not resolve is stored '
        + 'exactly like one that does - no reader downstream can tell them apart.\n'
        + `  looked for: ${JSON.stringify(forCompare(quote).slice(0, 120))}\n`
        + '  Compared with whitespace collapsed and dashes normalised, so re-wrapping is not the '
        + 'cause. Check it is the body you meant: a quote of an earlier AMENDMENT does not count, '
        + 'deliberately.', 1);
    }
  }

  const parts = [
    ``,
    amendmentHeading(number, clean(title)),
    ``,
    // ITS OWN stamp: its own time, its own plugin version, its own caller.
    `Amended ${nowIso()}, plugin ${pluginVersion()}. `
      + (agent && agent !== true
        ? `${AMEND_STAMP} **${clean(String(agent))}** (agent). Provenance enforced at the risk guard, `
          + 'not self-declared. It attests to who RAN this command, and to nothing about who directed it.'
        // Not "the operator". The guard lets an agent amend without declaring
        // itself - the channel must never close - so an absent value is UNKNOWN.
        : `${AMEND_STAMP} not recorded. Either the main session, or an agent that did not declare `
          + 'itself - the queue cannot tell. Treat it as unattributed.'),
    ``,
    clean(text).trim(),
    ``,
    quote
      ? `**Superseded, quoted verbatim from the body above:** ${quote}`
      : 'No superseded text quoted: this amendment ADDS to the finding rather than correcting it.',
    ``,
  ];

  // INSERTED, NOT APPENDED. Everything before `block.end` and everything after
  // it is carried through untouched: this relocates bytes and rewrites none.
  const head = body.slice(0, block.end).replace(/\n+$/, '\n');
  const tail = body.slice(block.end);
  writeTextAtomic(p, head + parts.join('\n') + (tail.startsWith('\n') ? '' : '\n') + tail);
  return { path: target, finding: number };
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
export function systemRepo({ here = HERE, clone = clonePath() } = {}) {
  // The clone is NOT a candidate, and its absence here is the whole fix.
  // gate5 2026-09-03: with it in this list, an agent running from
  // ~/.claude/plugins/cache/ missed on the first candidate and applied a
  // finding into ~/.claude/plugins/marketplaces/mavci, which the next
  // propagation resets. --apply reported success. The documented workflow is
  // apply THEN clear, so an operator following it destroys the only durable
  // copy. Refusing is correct when no source checkout is found: writing to a
  // tree that will be reset looks like it worked, and the loss is invisible
  // until someone goes looking for a finding that is gone. `clone` is still
  // a parameter so the refusal can NAME the path it declined to write to.
  const candidates = [path.resolve(here, '..', '..', '..')];
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

/**
 * Where a finding goes when the system repository cannot be reached.
 *
 * NOT under `plugins/`. That whole subtree is generated state: the marketplace
 * clone is reset by `git checkout -B main origin/main` on every propagation and
 * the cache is re-populated per version, which is why `systemRepo()` refuses the
 * clone at all (gate5 2026-09-03). An escrow inside it would be the same defect
 * with a friendlier message.
 */
export function escrowDir({ configDir } = {}) {
  const base = configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
  return path.join(base, 'mavci-lessons');
}

/**
 * Carry the queue into the system repository, or - when there is none to reach -
 * put it somewhere that survives the project being deleted.
 *
 * THE ESCROW IS NOT A FALLBACK TARGET FOR THE APPLY. It is the answer to a
 * different question. `--apply` refusing was correct and stayed correct for
 * three consecutive sessions, and in all three the findings survived because a
 * person remembered to copy a file out of a directory that exists to be thrown
 * away. A refusal that depends on the operator paying attention is not a control
 * over anything; it is the memory dependency this whole apparatus exists to
 * remove, restated as advice.
 *
 * So the bytes are written BEFORE the message is composed, and the message
 * reports what did NOT happen. Escrowing is not applying: the finding has not
 * reached the repository that governs every project, `ok` is false, and the CLI
 * exits non-zero. Reporting it as an apply would be invariant 5 through the far
 * door - "could not carry" recorded as "carried".
 *
 * Returns rather than exits, so the branch the CLI runs is the branch a test can
 * run. Same split as `lib/release-gate.mjs` and `cutTag`: the decision is
 * testable, the exit is the CLI's.
 */
export function apply(root, { repo = systemRepo(), configDir } = {}) {
  const plan = applyPlan(root);
  if (!plan.length) {
    return { ok: false, written: [], escrow: { dir: null, written: [] },
      message: `nothing to apply: no ${PENDING_STEM}*.md in ${PATHS.lessons}. File a finding first `
        + `with \`${COMMAND_PREFIX}retro\`.` };
  }
  if (!repo) return escrowQueue(root, plan, { configDir });

  const projectId = readJsonOrNull(abs(root, PATHS.manifest))?.project_id ?? 'unknown-project';
  const destDir = path.join(repo, 'docs', 'lessons');

  // Every destination checked before any of them is written.
  const clash = plan.filter((x) => exists(path.join(destDir, x.destName)));
  if (clash.length) {
    return { ok: false, written: [], escrow: { dir: null, written: [] },
      message: `${clash.map((x) => path.join('docs', 'lessons', x.destName)).join(', ')} already `
        + 'exists in the system repo. A second apply on the same day would overwrite the first, and '
        + 'a lesson is evidence. Rename or merge it by hand. Nothing was applied.' };
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
  return { ok: true, written: plan.map((x) => path.join(destDir, x.destName)),
    escrow: { dir: null, written: [] }, message: null };
}

/**
 * The escrow write. Same collision rule as the repo side, and for the same
 * reason: a lesson is evidence, so a second run on the same day must not replace
 * the first. Nothing is written when any destination is taken - the operator is
 * told, and the queue in the project is left exactly as it was.
 */
function escrowQueue(root, plan, { configDir } = {}) {
  const dir = escrowDir({ configDir });
  const projectId = readJsonOrNull(abs(root, PATHS.manifest))?.project_id ?? 'unknown-project';
  const looked = path.resolve(HERE, '..', '..', '..');

  const clash = plan.filter((x) => exists(path.join(dir, x.destName)));
  if (clash.length) {
    return { ok: false, written: [], escrow: { dir, written: [] },
      message: 'could not locate the system repository, and the durable copy already exists:\n'
        + clash.map((x) => `  ${path.join(dir, x.destName)}`).join('\n')
        + '\nNothing was written and nothing in the project was touched. A lesson is evidence, so '
        + 'the escrow is not overwritten. Merge or rename the copy above if this run is different.' };
  }

  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const x of plan) {
    const dest = path.join(dir, x.destName);
    const provenance = `<!-- ESCROWED by ${COMMAND_PREFIX}retro --apply on ${nowIso()}\n`
      + `     from project ${projectId}, plugin ${pluginVersion()}, queued as ${x.src}.\n`
      + `     THIS IS NOT AN APPLY. The system repository could not be located from this install,\n`
      + `     so the finding was written here to survive the project directory being deleted.\n`
      + `     It has NOT reached the repository that governs every project; carrying it there is\n`
      + `     still owed. Copied verbatim below this line; paths inside are relative to the\n`
      + `     project it was filed from. -->\n\n`;
    fs.writeFileSync(dest, provenance + fs.readFileSync(abs(root, x.src), 'utf8'));
    written.push(dest);
  }

  return { ok: false, written: [], escrow: { dir, written },
    message: 'could not locate the system repository. Looked for .claude-plugin/marketplace.json in:'
      + `\n  ${looked}\n`
      + 'It is NOT written to the marketplace clone, which propagation resets:\n'
      + `  ${clonePath()}\n\n`
      + 'THE FINDINGS ARE SAFE. They were written, before this message, to:\n'
      + written.map((f) => `  ${f}`).join('\n')
      + '\n\nThat directory is outside the project and outside <config>/plugins, so it survives both '
      + 'the project being deleted and the next propagation.\n'
      + 'NOT APPLIED: the findings have not reached the system repository. Carry them there from a '
      + 'machine holding the source checkout.\n'
      + `Do NOT run \`${COMMAND_PREFIX}retro --clear\` yet - the queue in this project is still the `
      + 'record of an unfixed problem, and clearing it now leaves only the escrow.' };
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
      agent: arg('--agent'),
    });
    console.log(`filed finding ${number} in ${rel}`);
    console.log('It is queued, not fixed. doctor reports it every run until an operator applies it.');
    return;
  }

  if (argv.includes('--amend')) {
    if (!exists(abs(root, PATHS.manifest))) {
      die('not a Mavci project: .mavci/project.json not found. An amendment is filed against a '
        + 'finding in this project\'s queue, so run this from the project.', 1);
    }
    // REFUSED BY NAME, not absent. Correcting text and asserting authorship are
    // different acts, and only the first is this verb's. A retroactive stamp is
    // a claim about who wrote the original, made by someone who was not
    // necessarily there, on the one field this command exists to protect.
    const asked = argv.find((a) => ATTRIBUTION_FLAGS.includes(a.split('=')[0]));
    if (asked) {
      die(`${asked} would edit provenance, and --amend corrects TEXT only.\n`
        + '  A `Filed by:` line records who observed and wrote the finding. Setting it afterwards is '
        + 'an assertion about authorship, not a correction, and whoever runs this may not have been '
        + 'there - which is the whole reason the field is enforced at the risk guard rather than '
        + 'self-declared.\n'
        + '  An amendment carries its OWN stamp instead: who ran THIS command, when, on which plugin '
        + 'version. That is written for you and cannot be set by a flag.\n'
        + '  A finding filed without attribution stays unattributed. Record why in the amendment '
        + 'text, where it is visibly somebody\'s account rather than a stamp.', 1);
    }
    const { path: rel, finding } = amend(root, {
      file: arg('--file'),
      number: Number(arg('--amend')),
      title: arg('--title'),
      text: readProse(arg('--text'), '--text'),
      was: argv.includes('--was') ? readProse(arg('--was'), '--was') : null,
      agent: arg('--agent'),
    });
    console.log(`amended finding ${finding} in ${rel}`);
    console.log('The finding\'s own text is untouched: an amendment is appended inside its block, '
      + 'never written over it.');
    return;
  }

  if (argv.includes('--list')) {
    const files = queuedLessons(root);
    if (!files.length) { console.log(`nothing queued (no ${PENDING_STEM}*.md in ${PATHS.lessons})`); return; }
    for (const f of files) {
      const text = readTextOrNull(abs(root, f));
      if (text === null) { console.log(`${f}: UNREADABLE - it is queued and its contents are unknown`); continue; }
      const found = parseFindings(text);
      // THE STAMP ACCOUNTING IS THE OTHER HALF OF "APPEND, NEVER REPLACE".
      // Appending means the body still reads as filed, so a reader who stops at
      // the body acts on an uncorrected claim. Nothing may write into a body to
      // announce that - so the INDEX says it, at the moment a reader is choosing
      // what to read. And it counts hand-written blocks: twelve of them reached
      // one queue before this command existed, and a reader that saw only what
      // this writer writes would report none of them.
      const amendments = parseAmendments(text);
      const unstamped = amendments.filter((a) => !a.stamped).length;
      console.log(`${f}: ${found.length} finding(s)`
        + (amendments.length ? `, ${amendments.length} addendum(a)` : '')
        + (unstamped ? `, ${unstamped} UNSTAMPED` : ''));
      for (const x of found) {
        console.log(`  ${x.n}. ${x.title}`);
        const mine = amendments.filter((a) => a.finding === x.n);
        if (mine.length) {
          const u = mine.filter((a) => !a.stamped).length;
          console.log(`     ${mine.length} addendum(a), ${u} unstamped`);
        }
      }
      const orphans = amendments.filter((a) => a.finding === null
        || !found.some((x) => x.n === a.finding));
      for (const a of orphans) {
        console.log(`  (addendum naming finding ${a.finding ?? '?'}, which is not in this file: ${a.title})`);
      }
      if (unstamped) {
        console.log('     UNSTAMPED means the block carries no attestation of who wrote it - a hand '
          + 'edit, typographically identical to text this writer stamped. Weigh it accordingly.');
      }
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

  // The decision is `apply`'s; the exit is the CLI's. A non-zero status on the
  // escrow path is deliberate: the bytes are durable, and the finding has still
  // not reached the repository that governs every project.
  if (argv.includes('--apply')) {
    const r = apply(root);
    if (r.ok) return;
    die(r.message, 1);
  }

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
    '  --amend <n> --title "<t>" --text <path|->  [--was <path|->] [--file <name>]',
    '                                 append a dated addendum to a queued finding. It carries its',
    '                                 own stamp; it never edits the finding. --text and --was take',
    '                                 a PATH or -, never prose - an argument goes through the shell',
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

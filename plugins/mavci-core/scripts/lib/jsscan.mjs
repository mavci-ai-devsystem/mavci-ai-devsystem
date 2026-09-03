/**
 * Mavci Core - source blanking, so regex rules stop lying.
 *
 * Every rule that greps JS/TS runs against a BLANKED copy: comments and string
 * bodies replaced by spaces of identical length, so character offsets and line
 * numbers still line up with the original file.
 *
 * Without this, `// createClient(supabase) is created at module scope` in a
 * comment is a violation, and `const sql = "DROP TABLE x"` in a fixture is a
 * destructive migration. Those are exactly the false positives that make an
 * operator reach for disableAllHooks (ROADMAP R5), so it is worth 60 lines.
 *
 * Not a parser. It only needs to know where code is not.
 */

const SPACE = ' ';

function blankRun(out, from, to) {
  for (let i = from; i < to && i < out.length; i++) {
    if (out[i] !== '\n') out[i] = SPACE;
  }
}

/* ------------------------------------------------------ REGEX LITERALS
 *
 * This scanner knew about comments, quoted strings and template literals, and
 * NOTHING about regex literals - so every delimiter inside a regex was read as
 * an opener. `const INLINE = /!`([^`]+)`/g;` opens a template-literal state on
 * the first backtick, and every byte after that point in the file is blanked.
 *
 * The consequence is not a false positive. It is a SILENT FALSE NEGATIVE: a rule
 * cannot match what it cannot see, so it reports nothing and the file passes.
 * Measured across `scripts/ci/`, four of thirty-six files scanned differently
 * than they read, hiding real `exec*Sync` calls from the very rule that exists to
 * police them - including a live unpinned one at `check-scribe-refs.mjs:182`.
 * CLAUDE.md has recorded the backtick-in-regex symptom since 0.1.12 and the
 * consequence was never followed through.
 *
 * THE REGEX BODY IS SKIPPED, NOT BLANKED, and that choice is the conservative
 * one. Blanking it would be consistent with how strings are treated and would
 * also mean every rule suddenly sees LESS inside a regex than it does today -
 * which is a loosening, in shipped code that decides enforcement on every
 * project. Skipping fixes the state machine and changes nothing else: what a rule
 * sees inside a regex is exactly what it saw before. The only behaviour that
 * changes is that the REST OF THE FILE stops being blanked, which is strictly
 * more visible, never less.
 *
 * Still not a parser. `/` is division or a regex depending on the previous
 * significant token, and this uses the standard heuristic rather than a grammar.
 * Where it is unsure it treats the `/` as division - the reading that leaves the
 * scanner in the state it is already in, so an ambiguous case can only ever
 * behave the way it does today.
 */
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?',
  '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>', '\n']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new',
  'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** Is the `/` at `i` the start of a regex literal, rather than division? */
function startsRegex(src, i) {
  let k = i - 1;
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
  if (k < 0) return true;                       // first token in the file
  const p = src[k];
  if (REGEX_PRECEDERS.has(p)) return true;
  if (/[A-Za-z0-9_$]/.test(p)) {
    // An identifier before `/` is usually a value being divided. A KEYWORD is not.
    let s = k;
    while (s >= 0 && /[A-Za-z0-9_$]/.test(src[s])) s--;
    return REGEX_KEYWORDS.has(src.slice(s + 1, k + 1));
  }
  return false;                                  // `)` and `]` end a value: division
}

/** Index just past the closing `/` of the regex starting at `i`, or -1. */
function endOfRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '\n') return -1;                   // regexes do not span lines: not one
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      j += 1;
      while (j < src.length && /[a-z]/.test(src[j])) j += 1;   // flags
      return j;
    }
    j += 1;
  }
  return -1;
}

/**
 * @param {string} src
 * @returns {string} same length, same newlines, comment and string bodies blanked
 */
export function blankSource(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // line comment
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blankRun(out, i, j);
      i = j;
      continue;
    }

    // block comment
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blankRun(out, i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }

    // regex literal - skipped whole, contents untouched. It must be recognised
    // BEFORE the string and template cases, or its own delimiters open them.
    if (c === '/' && startsRegex(src, i)) {
      const end = endOfRegex(src, i);
      if (end !== -1) { i = end; continue; }
      // Unterminated on this line: not a regex after all. Fall through and let
      // the remaining cases read it exactly as they did before.
    }

    // quoted strings
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++;
        if (src[j] === '\n') break; // unterminated: stop at the line end
        j++;
      }
      blankRun(out, i + 1, j);
      i = j + 1;
      continue;
    }

    // template literal - keep ${...} expressions visible, blank the literal text
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0) {
          if (src[j] === '}') depth--;
          j++;
          continue;
        }
        if (src[j] === '`') break;
        out[j] = src[j] === '\n' ? '\n' : SPACE;
        j++;
      }
      i = j + 1;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Blank COMMENTS only, preserving string bodies. Same length, same newlines.
 *
 * Use this for rules that must read a string literal's contents - a config value
 * such as `output: 'export'` - while still ignoring a comment that discusses it.
 * `blankSource` would blank the string body too, which silently turns the rule
 * off. Both directions were caught by the fixture harness; keeping the two
 * functions separate is what stops them being confused again.
 */
export function blankComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j++;
      blankRun(out, i, j);
      i = j;
      continue;
    }
    if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blankRun(out, i, Math.min(j + 2, n));
      i = j + 2;
      continue;
    }
    // Skip over string bodies without touching them, so a quoted `//` or `/*`
    // inside a URL does not start a phantom comment.
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Character offsets in `blanked` that sit at brace depth 0, i.e. module scope.
 * Used by next.supabase_client_in_function: a client created at depth 0 is a
 * module-scope singleton, which is the bug.
 */
export function depthMap(blanked) {
  const depths = new Int16Array(blanked.length);
  let depth = 0;
  for (let i = 0; i < blanked.length; i++) {
    const c = blanked[i];
    if (c === '{' || c === '(' || c === '[') { depths[i] = depth; depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth = Math.max(0, depth - 1); depths[i] = depth; continue; }
    depths[i] = depth;
  }
  return depths;
}

/** All match objects for `re` against `blanked`, each with its index. */
export function matchAll(blanked, re) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  const out = [];
  let m;
  while ((m = rx.exec(blanked)) !== null) {
    out.push({ index: m.index, match: m[0], groups: m.slice(1) });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

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

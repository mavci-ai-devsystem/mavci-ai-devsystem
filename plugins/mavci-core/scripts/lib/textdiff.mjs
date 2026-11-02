/**
 * Mavci Core - a line diff for showing an operator what changed in a spec.
 *
 * Used at re-approval after `state.mjs --revise-spec`: the operator approved one
 * document, withdrew that approval, and is now asked to approve another. What
 * they need to read is the difference, not 60 KB of spec again.
 *
 * Zero dependencies (invariant 1). Common prefix and suffix are trimmed first,
 * because a revision usually touches a few lines of a long file; the middle is
 * diffed by longest common subsequence. If the middle is too large to diff in
 * reasonable memory, it is reported as replaced whole - SAID SO, never silently
 * shortened, because a diff that drops lines without saying so is a reviewer
 * reading half a change and approving all of it.
 */

const MAX_CELLS = 4_000_000;

function splitLines(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = s.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Edit script: [{op:' '|'-'|'+', line, a, b}] with 1-based line numbers. */
export function lineDiff(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre
    && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const ops = [];
  for (let i = 0; i < pre; i++) ops.push({ op: ' ', line: a[i], a: i + 1, b: i + 1 });

  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const n = am.length;
  const m = bm.length;
  let whole = false;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    whole = true;
    am.forEach((line, i) => ops.push({ op: '-', line, a: pre + i + 1, b: null }));
    bm.forEach((line, j) => ops.push({ op: '+', line, a: null, b: pre + j + 1 }));
  } else {
    // L[i][j] = LCS length of am[i..] and bm[j..], in one flat array.
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1
          : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && am[i] === bm[j]) {
        ops.push({ op: ' ', line: am[i], a: pre + i + 1, b: pre + j + 1 }); i++; j++;
      } else if (j < m && (i === n || L[i * w + j + 1] >= L[(i + 1) * w + j])) {
        ops.push({ op: '+', line: bm[j], a: null, b: pre + j + 1 }); j++;
      } else {
        ops.push({ op: '-', line: am[i], a: pre + i + 1, b: null }); i++;
      }
    }
  }
  for (let k = 0; k < suf; k++) {
    const ai = a.length - suf + k;
    const bi = b.length - suf + k;
    ops.push({ op: ' ', line: a[ai], a: ai + 1, b: bi + 1 });
  }
  const added = ops.filter((o) => o.op === '+').length;
  const removed = ops.filter((o) => o.op === '-').length;
  return { ops, added, removed, whole };
}

/**
 * Render as hunks with `context` lines around each change. The output is capped
 * at `maxLines`; past the cap it SAYS how many lines were not shown.
 */
export function renderDiff(oldText, newText, { context = 2, maxLines = 200 } = {}) {
  const { ops, added, removed, whole } = lineDiff(oldText, newText);
  if (!added && !removed) return { text: '', added, removed, truncated: 0, whole };
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => {
    if (o.op === ' ') return;
    for (let d = Math.max(0, k - context); d <= Math.min(ops.length - 1, k + context); d++) keep[d] = true;
  });
  const out = [];
  let prevKept = -2;
  ops.forEach((o, k) => {
    if (!keep[k]) return;
    if (k !== prevKept + 1) {
      const startA = o.a ?? ops.slice(k).find((x) => x.a)?.a ?? '?';
      const startB = o.b ?? ops.slice(k).find((x) => x.b)?.b ?? '?';
      out.push(`@@ eski satır ${startA}, yeni satır ${startB} @@`);
    }
    out.push(`${o.op} ${o.line}`);
    prevKept = k;
  });
  let truncated = 0;
  if (out.length > maxLines) {
    truncated = out.length - maxLines;
    out.length = maxLines;
    out.push(`... ${truncated} satır daha gösterilmedi. Tam fark için iki dosyayı karşılaştırın.`);
  }
  if (whole) out.unshift('(Değişen bölüm satır satır karşılaştırılamayacak kadar büyük; bütün olarak değişmiş gösteriliyor.)');
  return { text: out.join('\n'), added, removed, truncated, whole };
}

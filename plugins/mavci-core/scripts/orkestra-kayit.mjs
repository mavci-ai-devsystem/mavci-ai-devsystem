#!/usr/bin/env node
/**
 * Mavci Core - orkestra's machine-wide ledgers. Used by skills/orkestra and
 * skills/agy-cli. Zero dependencies, Node 22.
 *
 * Two files, both under ~/.mavci/ (%USERPROFILE%\.mavci\ on Windows), shared by
 * every project on the machine because the quotas they track are per ACCOUNT,
 * not per project:
 *
 *   agy-kota.md            one row per agy call: date, project, job, model, tokens
 *   bekleyen-gorseller.md  images that could not be produced yet (no Nim credit,
 *                          no Gemini API key) - produced in order later
 *
 * Why a program and not prose: on 2026-11-06 one README summary through agy cost
 * 780,173 tokens, about 44% of the weekly Gemini quota, and nothing stopped it.
 * The operator set a 200,000-token ceiling per JOB. A ceiling a model is asked
 * to remember is a ceiling that holds until the day it matters, so the number is
 * here and the exit status carries it.
 *
 * Exit status: 0 ok, 1 the call failed or the input is unreadable,
 * 2 usage error, 3 STOP AND ASK THE OPERATOR (ceiling reached, or the token
 * count could not be read - "could not check" is never "under the ceiling").
 *
 * CLI:
 *   --agy-record <sonuc.json> --out <sonuc.md> --project <ad> --job <is> --model <id>
 *   --estimate <file>... [--project <ad> --job <is>]
 *   --week
 *   --image-pending --project <ad> --target <yol> --prompt-file <yol>
 *   --image-list
 *   --image-done <no>
 *   --selftest
 *
 * MAVCI_HOME overrides the ledger directory (the self-test uses it).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CEILING = 200000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Bytes to tokens, measured: 2 MB of markdown cost 780,173 tokens through
// gemini-3.8-flash-high, i.e. ~0.39 tokens per byte once agy's own reads and
// prompt are included. 0.4 per byte plus a fixed 15k for agy's system prompt.
const TOKENS_PER_BYTE = 0.4;
const CALL_OVERHEAD = 15000;

export function ledgerDir() {
  return process.env.MAVCI_HOME || path.join(os.homedir(), '.mavci');
}
const kotaFile = () => path.join(ledgerDir(), 'agy-kota.md');
const imageFile = () => path.join(ledgerDir(), 'bekleyen-gorseller.md');

// A table cell: no pipe, no newline, so one call is always exactly one row.
const cell = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();

export const group = (model) => (/^gemini/i.test(String(model)) ? 'Gemini' : 'Claude/GPT');

const KOTA_HEAD = [
  '# agy kota kaydı',
  '',
  'Makine geneli: bu bilgisayardaki tüm projeler aynı kaydı kullanır. Her agy',
  'çağrısı bir satır. Yazan: mavci-core `orkestra-kayit.mjs`. Elle düzenleme.',
  'Tarihler UTC. Gemini ve Claude/GPT kotaları ayrıdır ve haftalık yenilenir.',
  '',
  '| tarih (UTC) | proje | iş | model | token |',
  '|---|---|---|---|---|',
  '',
].join('\n');

export function readKota() {
  const f = kotaFile();
  if (!fs.existsSync(f)) return [];
  const rows = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = /^\|\s*(\d{4}-\d{2}-\d{2}T[^|]*?)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/.exec(line);
    if (!m) continue;
    const tokens = Number(m[5].trim());
    rows.push({ date: m[1], project: m[2].trim(), job: m[3].trim(), model: m[4].trim(),
      tokens: Number.isFinite(tokens) ? tokens : null });
  }
  return rows;
}

export function appendKota({ project, job, model, tokens, date = new Date() }) {
  fs.mkdirSync(ledgerDir(), { recursive: true });
  const f = kotaFile();
  if (!fs.existsSync(f)) fs.writeFileSync(f, KOTA_HEAD);
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const t = Number.isFinite(tokens) ? String(tokens) : '?';
  fs.appendFileSync(f, `| ${iso} | ${cell(project)} | ${cell(job)} | ${cell(model)} | ${t} |\n`);
}

const recent = (rows, now) => rows.filter((r) => now - Date.parse(r.date) < WEEK_MS);

export function jobTotal(rows, project, job, now = Date.now()) {
  return recent(rows, now).filter((r) => r.project === cell(project) && r.job === cell(job))
    .reduce((s, r) => s + (r.tokens ?? 0), 0);
}

export function weekTotals(rows, now = Date.now()) {
  const out = { Gemini: 0, 'Claude/GPT': 0, calls: 0, unknown: 0 };
  for (const r of recent(rows, now)) {
    out.calls++;
    if (r.tokens == null) { out.unknown++; continue; }
    out[group(r.model)] += r.tokens;
  }
  return out;
}

const fmt = (n) => n.toLocaleString('en-US').replace(/,/g, '.');
const weekLine = (w) =>
  `son 7 gün: Gemini ${fmt(w.Gemini)} · Claude/GPT ${fmt(w['Claude/GPT'])} token (${w.calls} çağrı` +
  (w.unknown ? `, ${w.unknown} çağrının token sayısı okunamadı` : '') + ')';

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) o[a.slice(2)] = true;
      else { o[a.slice(2)] = next; i++; }
    } else o._.push(a);
  }
  return o;
}

function need(o, keys) {
  const miss = keys.filter((k) => typeof o[k] !== 'string' || !o[k]);
  if (miss.length) { console.error(`eksik: ${miss.map((k) => '--' + k).join(', ')}`); process.exit(2); }
}

function agyRecord(o) {
  need(o, ['agy-record', 'out', 'project', 'job', 'model']);
  let raw;
  try { raw = fs.readFileSync(o['agy-record'], 'utf8'); } catch {
    console.error(`agy çıktısı okunamadı: ${o['agy-record']}`); return 1;
  }
  let j;
  try { j = JSON.parse(raw); } catch {
    console.error('agy JSON vermedi. İlk 300 karakter (kota/giriş mesajı olabilir):');
    console.error(raw.slice(0, 300));
    appendKota({ project: o.project, job: o.job, model: o.model, tokens: NaN });
    return 1;
  }
  const tokens = Number(j?.usage?.total_tokens);
  appendKota({ project: o.project, job: o.job, model: o.model, tokens });
  const rows = readKota();
  const total = jobTotal(rows, o.project, o.job);
  const w = weekTotals(rows);
  if (j.status !== 'SUCCESS' || !j.response) {
    console.error(`agy başarısız: status=${j.status}. Yanıtın ilk 300 karakteri:`);
    console.error(String(j.response ?? j.error ?? '').slice(0, 300));
    console.log(weekLine(w));
    return 1;
  }
  fs.writeFileSync(o.out, j.response);
  console.log(`tokens=${Number.isFinite(tokens) ? tokens : '?'} is_toplami=${total} tavan=${CEILING}`);
  console.log(weekLine(w));
  if (!Number.isFinite(tokens)) {
    console.log('DUR: token sayısı okunamadı, tavan kontrol EDİLEMEDİ. Kullanıcıya sor, onay almadan bu işe devam etme.');
    return 3;
  }
  if (total > CEILING) {
    console.log(`DUR: "${o.job}" işi ${fmt(total)} token harcadı, tavan ${fmt(CEILING)}. Kullanıcıya sor, onay almadan devam etme.`);
    return 3;
  }
  return 0;
}

export function estimateFiles(files) {
  let bytes = 0;
  for (const f of files) bytes += fs.statSync(f).size;
  return { bytes, tokens: Math.ceil(bytes * TOKENS_PER_BYTE) + CALL_OVERHEAD };
}

function estimate(o) {
  const files = o._.concat(typeof o.estimate === 'string' ? [o.estimate] : []);
  if (!files.length) { console.error('--estimate en az bir dosya ister'); return 2; }
  let e;
  try { e = estimateFiles(files); } catch (err) { console.error(`dosya okunamadı: ${err.message}`); return 1; }
  const spent = o.project && o.job ? jobTotal(readKota(), o.project, o.job) : 0;
  const total = e.tokens + spent;
  console.log(`tahmin=${e.tokens} (${files.length} dosya, ${fmt(e.bytes)} bayt) daha_once=${spent} toplam=${total} tavan=${CEILING}`);
  if (total > CEILING) {
    console.log(`DUR: bu iş tahminen ${fmt(total)} token harcar, tavan ${fmt(CEILING)}. Dosyaları azalt ya da kullanıcıya sor.`);
    return 3;
  }
  return 0;
}

const IMG_HEAD = [
  '# Bekleyen görseller',
  '',
  'Makine geneli. Nim kredisi yokken ve GEMINI_API_KEY tanımlı değilken',
  'üretilemeyen görseller. Kredi gelince ya da anahtar tanımlanınca sırayla',
  'üretilir. Yazan: mavci-core `orkestra-kayit.mjs`. Satır silinmez; durum değişir.',
  '',
  '| no | tarih (UTC) | proje | hedef dosya | istem | durum |',
  '|---|---|---|---|---|---|',
  '',
].join('\n');

const IMG_RE = /^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|\s*$/;

export function readImages() {
  const f = imageFile();
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').map((l) => IMG_RE.exec(l)).filter(Boolean)
    .map((m) => ({ no: Number(m[1]), date: m[2].trim(), project: m[3].trim(), target: m[4].trim(),
      prompt: m[5].trim(), status: m[6].trim() }));
}

function imagePending(o) {
  need(o, ['project', 'target', 'prompt-file']);
  let prompt;
  try { prompt = fs.readFileSync(o['prompt-file'], 'utf8'); } catch {
    console.error(`istem dosyası okunamadı: ${o['prompt-file']}`); return 1;
  }
  if (!prompt.trim()) { console.error('istem dosyası boş'); return 1; }
  fs.mkdirSync(ledgerDir(), { recursive: true });
  const f = imageFile();
  if (!fs.existsSync(f)) fs.writeFileSync(f, IMG_HEAD);
  const no = readImages().reduce((m, r) => Math.max(m, r.no), 0) + 1;
  const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.appendFileSync(f, `| ${no} | ${iso} | ${cell(o.project)} | ${cell(o.target)} | ${cell(prompt)} | bekliyor |\n`);
  console.log(`bekleyen görsel #${no} eklendi: ${f}`);
  return 0;
}

function imageList() {
  const open = readImages().filter((r) => r.status === 'bekliyor');
  if (!open.length) { console.log('bekleyen görsel yok'); return 0; }
  for (const r of open) console.log(`#${r.no} ${r.project} -> ${r.target} : ${r.prompt}`);
  return 0;
}

function imageDone(o) {
  const no = Number(o['image-done']);
  if (!Number.isInteger(no)) { console.error('--image-done bir numara ister'); return 2; }
  const f = imageFile();
  if (!fs.existsSync(f)) { console.error('bekleyen görsel listesi yok'); return 1; }
  const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  let hit = false;
  const out = fs.readFileSync(f, 'utf8').split('\n').map((l) => {
    const m = IMG_RE.exec(l);
    if (!m || Number(m[1]) !== no || m[6].trim() !== 'bekliyor') return l;
    hit = true;
    return l.replace(/\|\s*bekliyor\s*\|\s*$/, `| üretildi ${iso} |`);
  });
  if (!hit) { console.error(`#${no} bekleyen listede yok`); return 1; }
  fs.writeFileSync(f, out.join('\n'));
  console.log(`#${no} üretildi olarak işaretlendi`);
  return 0;
}

function selftest() {
  const failures = [];
  const check = (c, m) => { if (c) console.log(`  ok   ${m}`); else { failures.push(m); console.log(`  FAIL ${m}`); } };
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mavci-orkestra-'));
  const env = { ...process.env, MAVCI_HOME: home };
  const run = (...a) => spawnSync(process.execPath, [process.argv[1], ...a],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const w = (name, body) => { const p = path.join(home, name); fs.writeFileSync(p, body); return p; };
  const rec = (json, job, model = 'gemini-3.8-flash-low') =>
    run('--agy-record', json, '--out', path.join(home, `${job}.md`), '--project', 'P', '--job', job, '--model', model);

  console.log('orkestra ledgers:');
  const ok1 = w('ok.json', JSON.stringify({ status: 'SUCCESS', response: 'merhaba', usage: { total_tokens: 1000 } }));
  let r = rec(ok1, 'is-a');
  check(r.status === 0 && fs.readFileSync(path.join(home, 'is-a.md'), 'utf8') === 'merhaba',
    'a successful call exits 0 and writes the response');
  process.env.MAVCI_HOME = home;
  check(readKota().length === 1 && readKota()[0].tokens === 1000, 'the call is one ledger row carrying its tokens');

  const big = w('big.json', JSON.stringify({ status: 'SUCCESS', response: 'x', usage: { total_tokens: 199500 } }));
  r = rec(big, 'is-a');
  check(r.status === 3 && /DUR/.test(r.stdout), 'the JOB total crossing 200k stops with exit 3, though the call alone is under it');
  r = rec(big, 'is-b');
  check(r.status === 0, 'a different job under the ceiling is not stopped by another job\'s spend');

  const nousage = w('nou.json', JSON.stringify({ status: 'SUCCESS', response: 'x' }));
  r = rec(nousage, 'is-c');
  check(r.status === 3 && /okunamad/.test(r.stdout), 'an unreadable token count is STOP, never "under the ceiling"');

  const fail = w('fail.json', JSON.stringify({ status: 'ERROR', response: 'quota exceeded', usage: { total_tokens: 50 } }));
  fs.rmSync(path.join(home, 'is-d.md'), { force: true });
  r = rec(fail, 'is-d');
  check(r.status === 1 && !fs.existsSync(path.join(home, 'is-d.md')) && /quota exceeded/.test(r.stderr),
    'a failed call exits 1, writes no result, and shows the message agy gave');
  r = rec(w('junk.json', 'Error: login required'), 'is-e');
  check(r.status === 1 && /login required/.test(r.stderr), 'non-JSON output exits 1 and shows its first characters');

  r = rec(w('pipe.json', JSON.stringify({ status: 'SUCCESS', response: 'x', usage: { total_tokens: 7 } })), 'a|b\nc');
  const last = fs.readFileSync(path.join(home, 'agy-kota.md'), 'utf8').trim().split('\n').pop();
  check(last.split('|').length === 7, 'a pipe or newline in a field cannot break the row into extra columns');

  // weekly totals: groups, and the 7-day window
  appendKota({ project: 'P', job: 'eski', model: 'gemini-3.8-flash-high', tokens: 999999,
    date: new Date(Date.now() - 8 * 24 * 3600 * 1000) });
  appendKota({ project: 'P', job: 'k', model: 'claude-sonnet-4-6', tokens: 700 });
  const wt = weekTotals(readKota());
  check(wt.Gemini === 1000 + 199500 + 199500 + 50 + 7 && wt['Claude/GPT'] === 700,
    'weekly totals split Gemini from Claude/GPT and exclude rows older than 7 days');
  r = run('--week');
  check(r.status === 0 && /Gemini/.test(r.stdout) && /okunamad/.test(r.stdout), '--week reports both groups and names unreadable rows');

  const small = w('small.txt', 'a'.repeat(1000));
  const large = w('large.txt', 'a'.repeat(600000));
  check(run('--estimate', small).status === 0, 'a small input is estimated under the ceiling');
  r = run('--estimate', large);
  check(r.status === 3 && /DUR/.test(r.stdout), 'a 600 KB input is estimated over the ceiling and stops');
  check(run('--estimate', small, '--project', 'P', '--job', 'is-a').status === 3,
    'the estimate adds what the job already spent');

  const pf = w('istem.txt', 'kırmızı bir kupa, beyaz arka plan');
  r = run('--image-pending', '--project', 'P', '--target', 'public/kupa.png', '--prompt-file', pf);
  check(r.status === 0 && readImages().length === 1 && readImages()[0].status === 'bekliyor', 'a pending image is listed as waiting');
  check(/kupa\.png/.test(run('--image-list').stdout), '--image-list shows it');
  check(run('--image-done', '1').status === 0 && readImages()[0].status.startsWith('üretildi'), '--image-done marks it produced, keeping the row');
  check(/bekleyen görsel yok/.test(run('--image-list').stdout), 'a produced image is no longer listed');
  check(run('--image-done', '1').status === 1, 'marking an already-produced image again is refused');

  console.log('');
  if (failures.length) { console.error(`orkestra-kayit selftest FAILED (${failures.length}):`); for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
  console.log('orkestra-kayit: ledger, ceiling, weekly totals and pending images behave');
}

function main() {
  const o = args(process.argv.slice(2));
  if (o.selftest) return selftest();
  let code;
  if (o['agy-record']) code = agyRecord(o);
  else if ('estimate' in o) code = estimate(o);
  else if (o.week) { console.log(weekLine(weekTotals(readKota()))); console.log(`kayıt: ${kotaFile()}`); code = 0; }
  else if (o['image-pending']) code = imagePending(o);
  else if (o['image-list']) code = imageList();
  else if (o['image-done']) code = imageDone(o);
  else { console.error('kullanım: --agy-record | --estimate | --week | --image-pending | --image-list | --image-done | --selftest'); code = 2; }
  process.exit(code);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'orkestra-kayit.mjs') main();

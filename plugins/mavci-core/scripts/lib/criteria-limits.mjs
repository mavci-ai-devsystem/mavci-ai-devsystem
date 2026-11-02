/**
 * Mavci Core - what an approval may accept. cartoonify finding 4, 2026-11-02.
 *
 * Task 0034 was approved with a criterion verify could not read (`timeout_ms`
 * 1200000 against a 600000 ceiling). `--approve-spec` never parsed the block and
 * `--advance-phase` never did either, so the defect surfaced only after build,
 * when fixing it meant changing approved bytes. An approval that accepts what the
 * next gate rejects is not a gate; it is a slower way of finding out (0.1.14's
 * sentence, one gate over).
 *
 * So the block is read HERE, by the parser verify uses - `parseCriteriaBlock` -
 * and never by a second one. Then the limits a criterion can break silently:
 *
 *   BLOCKING (the approval is refused, nothing is recorded)
 *     the block cannot be read                 - verify would refuse it
 *     a secret written into a command          - it lands in the verdict's evidence
 *     a secret variable with no `live-key`     - an undeclared need, finding 4's shape
 *     a machine-specific or home-relative path - runs on one machine, fails in CI
 *     a hardcoded plugin version in a path     - stale at the next release (item 9)
 *     a tier-3 command, destructive SQL        - the runner executes criteria as
 *     a write into the control plane             CHILDREN of verify.mjs, and
 *     reading a .env file                        risk-guard never sees a child
 *
 *   WARNING (printed first, in Turkish, with who must act)
 *     a capability only the operator can supply (browser, live-key)
 *     a capability an agent can supply (server, network, write-outside-tree)
 *     a command that contradicts its own `needs` (localhost with `shell` only)
 *     a path that climbs out of the repository, a spec with no block
 *
 * THE TIER-3 LIST IS IMPORTED FROM risk-guard.mjs, never copied. A second list
 * of the same thing is the defect this repository has paid for most often.
 *
 * THE REPORT IS IN TURKISH on the operator's instruction: it is read at the one
 * point the chain stops for a person, and that person reads Turkish. Warnings come
 * FIRST, and when any criterion needs the operator the report opens by saying so
 * in the operator's own words - "bu adımda sen gerekeceksin".
 *
 * Pure apart from `scan`, which the caller supplies so the project's own secret
 * values can be matched; the default matches the shape classes only.
 */

import os from 'node:os';
import { parseCriteriaBlock, CRITERIA_FENCE } from './criteria.mjs';
import { CRITERION_TIMEOUT_CEILING_MS } from '../config.mjs';
import { buildRedactor } from '../redact.mjs';
import { HARD_BLOCK, DESTRUCTIVE_SQL } from '../risk-guard.mjs';

/** Who supplies each capability. browser and live-key are the operator's: no
 *  agent opens a real viewport, and secrets are entered by the operator only. */
const NEED_OWNER = {
  browser: 'operator',
  'live-key': 'operator',
  server: 'agent',
  network: 'agent',
  'write-outside-tree': 'agent',
};

const NEED_TEXT = {
  browser: 'gerçek bir tarayıcı gerektiriyor. Ajanlar tarayıcı açamaz: doğrulamada sayfaya senin '
    + 'bakman ve bunu `--have browser` ile bildirmen gerekecek; yoksa bu ölçüt "çalıştırılamadı" '
    + 'sayılır ve sonuç "eksik" olur.',
  'live-key': 'canlı bir gizli anahtar gerektiriyor. Anahtarı yalnız sen girersin; ajan onu göremez ve '
    + 'yazamaz. Doğrulamadan önce anahtarı ortama senin koyman gerekecek.',
  server: 'çalışan bir uygulama sunucusu gerektiriyor. Komut sunucuyu kendisi başlatıp kapatmalı: '
    + 'doğrulama sırasında açık bir `next dev` ya da `next start` varsa doğrulama reddedilir.',
  network: 'dış bir servise bağlanıyor. Ağ yoksa ya da servis kapalıysa çalışmaz.',
  'write-outside-tree': 'proje klasörünün dışına yazıyor. Komut bıraktığı dosyaları kendisi silmeli.',
};

const WHO_TEXT = { operator: 'operatör (sen)', agent: 'ajan', architect: 'ajan (planlayıcı spec\'i düzeltir)' };

/** Same split risk-guard uses (its `subcommands`, 5.5). */
const subcommands = (cmd) => cmd.split(/&&|\|\||;|\||&|\n/).map((s) => s.trim()).filter(Boolean);

const SECRET_VAR = /(?:\$\{?|process\.env\.)([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|_KEY|APIKEY)[A-Z0-9_]*)/;
const MACHINE_PATH = [
  { re: /(^|[\s"'=(])[A-Za-z]:[\\/]/, what: 'bir Windows sürücü yolu' },
  { re: /(^|[\s"'=(])\/[a-z]\/[A-Za-z]/, what: 'bir Git Bash sürücü yolu' },
  { re: /\$\{?HOME\b|%USERPROFILE%|(^|[\s"'=(])~[\\/]/, what: 'kullanıcının ev klasörü' },
  { re: /(^|[\s"'=(])\/(Users|home)\//, what: 'bir kullanıcı klasörü' },
];
const PLUGIN_VERSION_PATH = /mavci-core[\\/]\d+\.\d+\.\d+/;
const PLUGIN_CACHE_ROOT = /(?:\$\{?HOME\}?|~)[\\/]\.claude[\\/]plugins[\\/]cache[\\/]mavci[\\/]mavci-core[\\/]/g;
const CONTROL_WRITE = /(>>?|\btee\b|\bcp\b|\bmv\b|\brm\b|\bsed\s+-i|\bwriteFileSync\b)[^|;&\n]*\.mavci[\\/](control\b|project\.json)/;
const ENV_READ = /(^|[\s;&|(])(cat|head|tail|type|less|more|strings|xxd|od|grep|source|\.)\s+(?:[^|;&]*[\s"'/])?\.env(\.(local|development|production|test)(\.local)?)?(?=$|[\s"'|;&)])/;
const LOCALHOST = /\b(localhost|127\.0\.0\.1)(:\d+)?\b/;
const BROWSERISH = /\b(lighthouse|playwright|puppeteer|chromium|chrome-launcher)\b/i;
const REMOTE_URL = /https?:\/\/(?!localhost|127\.0\.0\.1)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CLIMBS_OUT = /(^|[\s"'=(])\.\.[\\/]/;

/** The block's entries as plain JSON, or []. For warnings only - never a verdict. */
function lenientEntries(specText) {
  const fence = '`'.repeat(3);
  const re = new RegExp(`^[ \\t]*${fence}[ \\t]*${CRITERIA_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)^[ \\t]*${fence}[ \\t]*$`, 'm');
  const m = re.exec(specText);
  if (!m) return [];
  try {
    const v = JSON.parse(m[1]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function defaultScan() {
  return buildRedactor(os.tmpdir(), null).scanRepoText;
}

/**
 * @param {string} specText
 * @param {{ scan?: (text: string) => Array }} [opts]  secret matcher; pass the
 *   project's `buildRedactor(root, manifest).scanRepoText` to match its own values
 * @returns {{ count: number, errors: Array, warnings: Array, operatorIds: string[] }}
 */
export function checkCriteriaLimits(specText, { scan } = {}) {
  const errors = [];
  const warnings = [];
  const err = (id, text) => errors.push({ id, who: 'architect', text });
  const warn = (id, who, text) => warnings.push({ id, who, text });

  const parsed = parseCriteriaBlock(specText ?? '');
  if (!parsed.ok) {
    const id = (/criterion ([^:\s]+):/.exec(parsed.error) ?? [])[1] ?? '?';
    const timeout = /timeout_ms/.test(parsed.error)
      ? ` Süre sınırı en fazla ${CRITERION_TIMEOUT_CEILING_MS} ms (10 dakika); daha uzun süren bir `
        + 'ölçüt parçalara bölünmeli.'
      : '';
    err(id, `ölçüt bloğu okunamıyor (${parsed.error}). Doğrulama bu bloğu okuyamaz; onaylansa bile `
      + `verify aşamasında durur.${timeout}`);
    /* The parser is all-or-nothing, so one bad field would hide every OTHER
     * criterion's warning - and the operator asked for those first, refusal or
     * not. So the entries are read leniently for their `needs` alone. This adds
     * warnings and never removes an error: the refusal above stands. */
    const raw = lenientEntries(specText ?? '');
    for (const e of raw) {
      if (!Array.isArray(e?.needs)) continue;
      for (const n of e.needs) {
        if (n === 'shell' || typeof n !== 'string') continue;
        warn(String(e.id ?? '?'), NEED_OWNER[n] ?? 'operator', NEED_TEXT[n] ?? `\`${n}\` gerektiriyor.`);
      }
    }
    const operatorIds = [...new Set(warnings.filter((w) => w.who === 'operator').map((w) => w.id))];
    return { count: raw.length, errors, warnings, operatorIds };
  }
  if (!parsed.criteria) {
    warn('-', 'agent', `spec'te \`${CRITERIA_FENCE}\` bloğu yok, yani ölçütleri hiçbir program `
      + 'çalıştırmayacak; doğrulama "eksik" sonucunda durur. Planlayıcı bloğu eklemeli.');
    return { count: 0, errors, warnings, operatorIds: [] };
  }

  const findSecrets = scan ?? defaultScan();
  for (const c of parsed.criteria) {
    const run = String(c.run);
    const needs = new Set(c.needs);

    if (findSecrets(run).length) {
      err(c.id, 'komutun içine bir gizli anahtar yazılmış. Komut doğrulama kaydına olduğu gibi geçer; '
        + 'anahtar orada herkesin okuyacağı yerde durur. Anahtar ortam değişkeninden okunmalı ve '
        + 'ölçüt `needs: ["live-key"]` beyan etmeli.');
    }
    const sv = SECRET_VAR.exec(run);
    if (sv && !needs.has('live-key')) {
      err(c.id, `komut gizli bir değişken kullanıyor (${sv[1]}) ama \`needs\` içinde \`live-key\` yok. `
        + 'Beyan edilmemiş bir ihtiyaç doğrulamada "başarısız" görünür, oysa sorun kodda değildir.');
    }
    /* The plugin cache under $HOME is the ONE home-relative root a criterion
     * legitimately needs - carried-forward item 9's permanent form builds the
     * gate path from the pinned version there. It is removed before the machine
     * path test; a LITERAL version in it is still refused just below. */
    const pathRun = run.replace(PLUGIN_CACHE_ROOT, '');
    for (const p of MACHINE_PATH) {
      if (!p.re.test(pathRun)) continue;
      if (needs.has('browser')) {
        // A browser criterion already depends on the operator's machine (a real
        // viewport), so a located browser binary is that dependency, not a new one.
        warn(c.id, 'operator', `komut ${p.what} içeriyor (büyük olasılıkla tarayıcının yeri). Bu ölçüt `
          + 'yalnız o yolun bulunduğu bilgisayarda çalışır.');
      } else {
        err(c.id, `komut ${p.what} içeriyor. Ölçüt proje kökünde çalışır; bu yol yalnız bir `
          + 'bilgisayarda vardır ve CI\'da ya da başka bir makinede bozulur. Proje içi göreli yol kullanılmalı.');
      }
      break;
    }
    if (PLUGIN_VERSION_PATH.test(run)) {
      err(c.id, 'komut eklentinin sabit bir sürüm numarasını içeren yolu kullanıyor. Bir sonraki sürümde '
        + 'bu yol eskir ve onaylı spec değiştirilemez. Sürüm `.mavci/control/state.json` içindeki '
        + '`ci_pinned_plugin_version` alanından okunmalı.');
    }
    const hard = [];
    for (const sub of subcommands(run)) {
      for (const h of HARD_BLOCK) {
        const backstop = new RegExp(h.re.source.replace(/^\^/, '(?:^|[\\s"\'])'));
        if (h.re.test(sub) || backstop.test(sub)) hard.push(h.why);
      }
    }
    if (/(psql|supabase|pg_|mysql)/i.test(run)) {
      for (const d of DESTRUCTIVE_SQL) if (d.re.test(run)) hard.push(d.why);
    }
    if (hard.length) {
      err(c.id, `komut yasak bir işlem içeriyor (${[...new Set(hard)].join(', ')}). Ölçütler doğrulama `
        + 'programının alt işlemi olarak çalışır ve risk koruması onları göremez; bu yüzden onaydan önce '
        + 'durdurulur.');
    }
    if (CONTROL_WRITE.test(run)) {
      err(c.id, 'komut `.mavci/control/` ya da proje ayarına yazıyor. Kontrol klasörünü yalnız sistem '
        + 'komutları değiştirir; bir ölçüt onu değiştirirse doğrulamanın kendi kaydı bozulur.');
    }
    if (ENV_READ.test(run)) {
      err(c.id, 'komut bir `.env` dosyasını okuyor. Gizli değerler hiçbir ajana ya da kayda gösterilmez.');
    }

    for (const n of c.needs) {
      if (n === 'shell') continue;
      warn(c.id, NEED_OWNER[n] ?? 'operator', NEED_TEXT[n] ?? `\`${n}\` gerektiriyor.`);
    }
    if (needs.size === 1 && needs.has('shell')) {
      if (LOCALHOST.test(run)) {
        warn(c.id, 'agent', 'komut yerel bir sunucuya bağlanıyor ama `needs` içinde `server` yok. '
          + 'Sunucu açık değilse ölçüt "başarısız" görünür. Planlayıcı `needs: ["server"]` eklemeli.');
      }
      if (BROWSERISH.test(run)) {
        warn(c.id, 'agent', 'komut bir tarayıcı aracı kullanıyor ama `needs` içinde `browser` yok. '
          + 'Planlayıcı bunu beyan etmeli; beyan edilince bu ölçüt senin işin olur.');
      }
      if (REMOTE_URL.test(run)) {
        warn(c.id, 'agent', 'komut dış bir adrese bağlanıyor ama `needs` içinde `network` yok.');
      }
    }
    if (CLIMBS_OUT.test(run)) {
      warn(c.id, 'agent', 'komut `../` ile proje klasörünün dışına çıkabilir. Ölçüt proje kökünde çalışır; '
        + 'planlayıcı yolun proje içinde kaldığını doğrulamalı.');
    }
  }

  const operatorIds = [...new Set(warnings.filter((w) => w.who === 'operator').map((w) => w.id))];
  return { count: parsed.criteria.length, errors, warnings, operatorIds };
}

/** The plain-Turkish report. Warnings first; the operator line first of all. */
export function limitsReport(result) {
  const { count, errors, warnings, operatorIds } = result;
  const lines = [];
  lines.push(`Ölçüt kontrolü: ${count} ölçüt, ${warnings.length} uyarı, ${errors.length} engel.`);
  if (operatorIds.length) {
    lines.push('');
    // Written as the operator said it, not upper-cased: Turkish upper case turns
    // "i" into "İ", and a reader searching for their own words would miss it.
    lines.push(`DİKKAT - Bu adımda sen gerekeceksin: ölçüt ${operatorIds.join(', ')} ajanın yapamayacağı bir şey `
      + 'istiyor. Ne yapman gerektiği aşağıda.');
  }
  const item = (x) => {
    const label = x.id === '-' ? 'Spec' : `Ölçüt ${x.id}`;
    return [`  - ${label}: ${x.text}`, `    Bunu kim yapacak: ${WHO_TEXT[x.who] ?? x.who}.`];
  };
  if (warnings.length) {
    lines.push('');
    lines.push('Uyarılar (onayı durdurmaz):');
    for (const w of warnings) lines.push(...item(w));
  }
  if (errors.length) {
    lines.push('');
    lines.push('Engeller (bunlar düzelmeden onay verilmez):');
    for (const e of errors) lines.push(...item(e));
  }
  if (!warnings.length && !errors.length) lines.push('Sorun yok.');
  return lines.join('\n');
}

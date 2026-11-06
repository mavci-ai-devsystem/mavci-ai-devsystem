---
name: agy-cli
description: Antigravity CLI (agy) ile tek seferlik iş çalıştırma, girdiyi dosya listesiyle verme, çıktıyı dosyaya alma, token'ı makine genelindeki kota kaydına yazma, 200.000 token tavanı ve hata/kota durumunda ne yapılacağı. Orkestra toplu veri işini, uzun okumayı, orta seviye kodu ya da mimari ikinci görüşü agy'ye verdiğinde kullan.
---

# agy (Antigravity CLI)

Orkestranın Google işçisi. Google, 18 Haziran 2026'dan beri Gemini CLI'ı
kişisel hesaplara kapattı; yerine geçen araç agy. Ne zaman kullanılacağı
`orkestra` skill'inde yazar; bu dosya yalnız NASIL çağrılacağını anlatır.

## Token tavanı ve kota kaydı (her çağrıda, istisnasız)

- **Her iş için tavan 200.000 token.** Bir iş birden çok çağrıdan oluşabilir;
  tavan işin son 7 gündeki toplamına uygulanır.
- **Çağırmadan önce tahmin et.** Girdi dosyalarıyla:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/orkestra-kayit.mjs" --estimate <dosya>... --project <proje> --job <iş>`
  Çıkış 3 ise (`DUR`) çağırma: dosyaları azalt ya da kullanıcıya sor.
- **Her çağrıdan sonra kaydet** (aşağıdaki 3. adım). Bu komut yanıtı dosyaya
  çıkarır, token'ı `%USERPROFILE%\.mavci\agy-kota.md` kaydına yazar (tarih,
  proje, iş, model, token), iş toplamını ve son 7 günün Gemini /
  Claude-GPT toplamlarını yazar.
- **Çıkış 3 = DUR.** İş toplamı tavanı geçti ya da token sayısı okunamadı.
  Kullanıcıya sor; onay almadan bu işe devam etme.
- Haftalık durum: `node "${CLAUDE_PLUGIN_ROOT}/scripts/orkestra-kayit.mjs" --week`.
  Tüm projeler aynı kaydı kullanır. Kaydı elle düzenleme.
- 2026-11-06 ölçümü: 2 MB / 60 dosyalık bir okuma 780.173 token yedi, Gemini
  haftalık kotasının ~%44'ü. Gemini ve Claude/GPT grubu kotaları AYRIDIR ve
  haftalık yenilenir.

## Girdi: yalnız gereken dosyalar

agy'ye "repoyu gez" denmez. Lider işin gerektirdiği dosyaları TEK TEK seçer,
listeyi `dosyalar.txt`'ye yazar, girdi dosyası o listeden kurulur. agy iş
klasöründe çalıştığı için başka bir dosyayı göremez.

## Doğrulanmış bilgiler (2026-11-06, agy 1.5.2, bu makinede denendi)

- Kurulum: `%LOCALAPPDATA%\agy\bin\agy.exe`, kullanıcı PATH'inde. Git Bash
  için `~/.local/bin/agy` kısayolu da var: PATH'i eski kalmış bir oturumda bile
  `agy` adı çalışır. Kısayol yoksa ve `agy` bulunamazsa kullanıcıya bildir.
- Tek seferlik çalıştırma: `-p "<istem>"`. Süre sınırı: `--print-timeout 600s`.
- Çalışma klasörü bayrağı YOK (`--add-dir` yalnız ek klasör ekler); agy
  başlatıldığı klasörde çalışır.
- Modeller (`agy models`): `gemini-3.8-flash-low`, `gemini-3.8-flash-medium`,
  `gemini-3.8-flash-high`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`,
  `gpt-oss-120b-medium`. Gemini Pro yok. `gemini-*` Gemini kotasından,
  diğerleri Claude/GPT kotasından yer.
- Salt okunur: `--mode plan`. Dosya yazan iş (kod): `--mode accept-edits`
  (denendi: Sonnet 4.6 iki dosyayı yazdı). `--dangerously-skip-permissions`
  orkestrada KULLANILMAZ.
- Çıktı: `--output-format json` →
  `{"status":"SUCCESS","response":"...","usage":{"total_tokens":...}}`.
  Başarıyı `status` ile anla, çıkış koduyla değil.
- **stdin OKUNMAZ.** Girdi dosyaya yazılır, agy'ye o dosyayı okuması söylenir.
- İstemde açıkça "read_file / write_file aracını kullan, run_command kullanma"
  denmeli; denmezse agy komut çalıştırmaya kalkıyor, başsız modda izin
  otomatik reddediliyor ve hiç çıktı üretmiyor.
- `--mode plan`'da istemde "son yanıtın metnin KENDİSİ olsun; plan, artifact ya
  da dosya oluşturma" denmeli; denmezse yanıtı bir plan dosyasına sarıyor.
- Büyük dosya: "dosyanın TAMAMINI oku, gerekirse parça parça" de ve son satırda
  `OKUNAN_DOSYA=<n>` yazdır; lider girdideki dosya sayısıyla karşılaştırır.
- Görsel üretimi YOK (araç listesinde görsel aracı yok; iki modda, iki modelde
  soruldu). Görsel işi orkestra'daki Nim akışına gider.
- `/usage` `-p` ile kota raporu DÖNMEDİ; token her çağrının JSON'undaki
  `usage.total_tokens` alanından okunur.
- Ölçüm: Sonnet 4.6 ile tek dosyalık yardımcı fonksiyon + test: 6.857 token.

## Model seçimi

| İş | Model | Mod |
|---|---|---|
| Basit / toplu veri | `gemini-3.8-flash-low` | `plan` (yazacaksa `accept-edits`) |
| Basit iş, Gemini kotası dolu | `gpt-oss-120b-medium` | aynı |
| Uzun belge / repo okuma | `gemini-3.8-flash-high` | `plan` |
| Orta seviye kod | `claude-sonnet-4-6` | `accept-edits` |
| Mimari ikinci görüş | `claude-opus-4-6-thinking` | `plan` |

## Çağrı kalıbı: üç ayrı Bash komutu

İzin kuralı `Bash(agy -p:*)` yalnız `agy -p` ile BAŞLAYAN komutu yakalar;
parantez ya da `cd ... &&` ile başlayan komutu yakalamaz. Bu yüzden klasöre
geçiş ayrı komuttur (Bash aracında çalışma klasörü komutlar arasında kalır).

**Adım 0 (lider):** iş klasörünü kur, girdiyi listeden hazırla, tahmini al.

```bash
D="<proje-kökü>/.mavci/orkestra/<iş-adı>"; mkdir -p "$D"
# dosyalar.txt: lider gereken dosyaları elle yazar, satır başına bir yol
grep -v -i -E '(^|/)\.env|secret|credential|\.pem$|\.key$' "$D/dosyalar.txt" \
  | while IFS= read -r f; do printf '\n===== %s =====\n' "$f"; cat "$f"; done > "$D/girdi.md"
node "${CLAUDE_PLUGIN_ROOT}/scripts/orkestra-kayit.mjs" --estimate "$D/girdi.md" --project <proje> --job <iş-adı>
```

**Adım 1 (ayrı komut):** `cd "<proje-kökü>/.mavci/orkestra/<iş-adı>"`

**Adım 2 (ayrı komut, doğrudan `agy -p` ile başlar):**

```bash
agy -p "Use the read_file tool (never run_command) to read girdi.md in the current directory. Read the WHOLE file, in chunks if needed. Your final reply must BE the result text itself: do not create a plan, an artifact or any file. <istem>. İlk 5 satıra kısa özet yaz." --model gemini-3.8-flash-high --mode plan --output-format json --print-timeout 600s > sonuc.json 2> sonuc.err
```

**Adım 3 (aynı klasörde):** kaydet ve yanıtı çıkar; sonra proje köküne dön.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orkestra-kayit.mjs" --agy-record sonuc.json --out sonuc.md --project <proje> --job <iş-adı> --model <model>
```

Çıkış 0: lider yalnız `head -5 sonuc.md` okur. 1: başarısız (mesaj ekranda).
3: DUR, kullanıcıya sor. Her durumda sonra `cd "<proje-kökü>"`.

Kod işinde istem "write_file ile şu dosyaları oluştur, başka dosya yaratma"
der; mod `accept-edits`. Kodu lider her zaman kendisi kontrol eder (dosyayı
okur, testi kendisi çalıştırır).

## Gizlilik

agy'ye giden her şey Google'a gider (Claude/GPT modelleri de agy üzerinden).
`.env*`, anahtar, token, şifre, gizli dosya, müşteri kişisel verisi ve
kullanıcının telefon numarası ASLA gönderilmez. Commit edilmemiş başkasının işi
gönderilmez. agy'ye repoyu kendisi gezdirme; girdi dosyasını sen hazırla.

## Hata ve kota

**Çıkış kodu 0 başarı demek DEĞİL**; sonucu Adım 3 belirler.

| Belirti | Ne yapılır |
|---|---|
| `jetski: no output produced` | İstem "read_file kullan, run_command kullanma" demiyor; düzeltip bir kez daha dene. |
| JSON değil, ya da `status` SUCCESS değil | Adım 3'ün yazdığı ilk 300 karakteri lidere bildir, tahmin yürütme. |
| Kota doldu | Orkestra'daki yedeğe geç (Gemini dolduysa `gpt-oss-120b-medium`, o da doluysa Claude alt ajan). Aynı modeli tekrar deneme. |
| Adım 3 çıkış 3 | DUR. Kullanıcıya iş toplamını ve tavanı söyle, onay iste. |
| Giriş istiyor | Dur. Kullanıcıya: PowerShell'de `agy` yazıp Google ile giriş yapsın. |
| `agy` bulunamadı | `~/.local/bin/agy` kısayolunu kontrol et; yoksa kullanıcıya bildir, yedeğe geç. |

**Kota mesajı henüz görülmedi.** İlk görüldüğünde (Adım 3 ilk 300 karakteri
basar) metnini tarih ve modelle birlikte bu tabloya ekle ve kullanıcıya söyle;
skill değişikliği mavci-core'un yeni sürümüyle yayılır.

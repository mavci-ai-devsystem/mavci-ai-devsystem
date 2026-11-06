---
name: orkestra
description: Bu oturumu LİDER yapar - lider az iş yapar, işi böler, agy (Antigravity CLI) ve Claude alt ajanlarına dağıtır ve sonucu kendisi kontrol eder. Claude limitini korumak birinci önceliktir. Kullanıcı "orkestra" dediğinde, ya da iş birden çok parçaya bölünebilen toplu veri, uzun okuma veya kod işi olduğunda kullan.
argument-hint: "<yapılacak iş>"
---

# Orkestra

İstenen iş: `$ARGUMENTS`

Sen LİDERSİN. Kendin az iş yaparsın: planlar, böler, dağıtır, kontrol eder,
karar verirsin. Kullanıcının Claude aboneliği PRO ve limiti dar; **Claude
limitini korumak birinci önceliktir.** Bir işi bir işçi yapabiliyorsa sen
yapma.

Aracın nasıl çağrılacağı ayrı skill'dedir: `/mavci-core:agy-cli`. agy'yi
ilk kez çağırmadan önce o skill'i oku. (Gemini CLI, 18 Haziran 2026'dan beri
kişisel hesaplara kapalı; Google işçisi artık agy.)

## Kurallar

1) Akış her işte: **Bilgi topla → Böl → Çalıştır → Kontrol et → Düzelt.**

2) İş dağılımı (soldan sağa: önce ilki, olmazsa sıradaki):
   - Basit/toplu veri işleri (temizleme, çeviri, toplu metin) → **agy
     `gemini-3.8-flash-low`** → Gemini kotası dolarsa **agy
     `gpt-oss-120b-medium`** (Claude/GPT grubu) → o da olmazsa **Claude Haiku
     alt ajan**.
   - Uzun belge / büyük repo okuma → **agy `gemini-3.8-flash-high`** (yalnız
     gereken dosyalar) → kota yoksa **Claude Sonnet alt ajan**.
   - Orta seviye kod → ÖNCE **agy `claude-sonnet-4-6`** (Google kotasından
     yer, kullanıcının Claude Pro limitini korur) → başarısız olursa ya da kota
     yoksa **Claude Sonnet alt ajan**. Kodu her durumda lider kontrol eder.
   - Görsel → ÖNCE **Nim** (`/nim:nim-generate`) → Nim kredisi yetersizse
     **Gemini API görsel modeli** (yalnız `GEMINI_API_KEY` tanımlıysa) → o da
     yoksa **bekleme listesi**. Ayrıntı aşağıda "Görsel akışı".
   - Planlama, bölme, kontrol, mimari karar → **lider (bu oturum)**. Emin
     olunmayan mimari kararda agy `claude-opus-4-6-thinking`'den ikinci görüş
     al, iki görüşü karşılaştırıp karar ver.
   - Gizlilik: agy'ye, Nim'e ve Gemini API'ye .env, anahtar ve gizli dosyalar
     asla gönderilmez.

3) Bağlam koruma: her alt ajan / dış araç çıktısını
   `.mavci/orkestra/<iş-adı>/` altına dosya olarak yazar; lidere sadece en
   fazla 5 satırlık özet + dosya yolu döner. Lider ham çıktıyı ana sohbete
   basmaz.

4) Her işçiye TEK iş tipi verilir. Bağımsız işler paralel çalıştırılır;
   birbirine bağlı işler sırayla.

5) Keşif/okuma işçileri salt okunur çalışır: commit edilmemiş işe ve gizli
   bilgilere (.env, anahtarlar) dokunmaz.

6) Kontrol adımında lider çıktıları kendisi doğrular (test çalıştır, dosyayı
   aç, sayıları kontrol et); sorun varsa ilgili işçiye düzeltme gönderir.

7) Her işin sonunda lider kullanıcıya kısa sonuç verir: ne yapıldı, hangi
   araç hangi işi yaptı, açık kalan ne.

## Token tavanı ve kota (agy)

- agy'ye verilen her iş için **tavan 200.000 token**. Çağırmadan önce tahmin
  al; tavan aşılacak gibiyse ya da bir çağrıdan sonra kayıt komutu `DUR`
  (çıkış 3) derse **dur, kullanıcıya sor, onay almadan devam etme.**
- Her agy çağrısının token'ı makine genelindeki
  `%USERPROFILE%.mavciagy-kota.md` kaydına yazılır; tüm projeler aynı kaydı
  kullanır. Haftalık toplam bu kayıttan hesaplanır (`--week`). Komutlar
  `agy-cli` skill'inde.
- agy'ye her işte yalnız gereken dosyaların listesi verilir; "repoyu gez"
  denmez.
- Gemini grubu ve Claude/GPT grubu kotaları ayrı, haftalık yenilenir.

## Görsel akışı

1. Nim: üretmeden önce `get_credit_balance` ile krediye bak. Yeterliyse
   `/nim:nim-generate` ile üret.
2. **Kredi yetersizse ASLA kredi satın alma, plan yükseltme ya da
   `purchase_credits` çağırma** (`nim-credits` skill'i satın almayı önerse
   bile). Kullanıcıya tek satırla söyle.
3. Kredi yoksa: `GEMINI_API_KEY` ortam değişkeni tanımlıysa Gemini API görsel
   modeli (Nano Banana). Değişkenin yalnız VAR/YOK durumuna bak
   (`[ -n "$GEMINI_API_KEY" ]`); değerini asla yazdırma. Bu yol henüz
   denenmedi: ilk kullanımda model adını ve çıktıyı doğrula, sonra buraya yaz.
4. O da yoksa ya da çalışmazsa görseli bekleme listesine yaz ve kullanıcıya
   bildir. İstemi önce bir dosyaya yaz, sonra:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/orkestra-kayit.mjs" --image-pending --project <proje> --target <hedef-dosya> --prompt-file <istem-dosyası>`
   Liste: `%USERPROFILE%.mavciekleyen-gorseller.md`.
5. Nim kredisi gelince ya da anahtar tanımlanınca `--image-list` ile bekleyenleri
   sırayla üret; her biri üretilip dosyası doğrulanınca `--image-done <no>`.

## Araç durumu (2026-11-06)

- agy 1.5.2 çalışıyor; tek seferlik çağrı, dosyadan okuma, dosya yazma
  (`claude-sonnet-4-6`, `accept-edits`) ve JSON çıktı doğrulandı. Gemini Pro
  yok. agy görsel üretemez. Ayrıntı `agy-cli` skill'inde.
- Nim: bağlı, kredi bakiyesi okunabiliyor (`get_credit_balance`).
- Gemini API görsel: `GEMINI_API_KEY` bu makinede tanımlı değildi.

Bir araç çalışmıyorsa sessizce atlama: kullanıcıya tek satırla söyle ve
kuraldaki yedeğe geç.

## Nasıl uygulanır

### 1. Bilgi topla

Lider yalnız bölmeye yetecek kadar okur: dosya listesi, boyutlar, satır
sayıları (`git ls-files`, `wc -l`). Büyük içeriği kendisi okumaz; okuma işi
agy'ye gider.

### 2. Böl

Her parça için bir satır yaz: iş adı, iş tipi, işçi, girdi, çıktı dosyası,
neye bağlı. Bir parçaya iki iş tipi düşüyorsa ikiye böl. İş adı kısa, Türkçe
karaktersiz ve tirelidir (`urun-temizleme`, `readme-ozet`).

İlk kez kullanılan bir projede `.mavci/orkestra/` satırını `.gitignore`'a
ekle: bunlar çalışma dosyalarıdır, commit edilmez (ara dosyalar büyük olabilir).
Kontrol scriptleri yalnız `orkestra/` içeren bir `.mavci/` klasörünü proje
saymaz (0.1.39'dan beri), Mavci sistem reposunda da klasörü silmen gerekmez.

### 3. Çalıştır

- **agy:** `agy-cli` skill'indeki kalıpla: önce tahmin, sonra üç ayrı komut
  (klasöre `cd`, doğrudan `agy -p ...`, kayıt); kayıt `DUR` derse dur ve sor. Birbirinden
  bağımsız dış araç çağrılarını `run_in_background: true` ile AYNI ANDA başlat;
  bitince bildirim gelir, beklerken yoklama yapma.
- **Claude alt ajan:** Agent aracı, `subagent_type: "general-purpose"`,
  `model: "haiku"` (toplu veri yedeği) veya `model: "sonnet"` (orta seviye
  kod). Bağımsız alt ajanları tek mesajda birlikte gönder.
- Her işçiye verilen istemde şu dört şey bulunur: tek iş tanımı, girdinin
  yeri, çıktının yazılacağı tam yol, "lidere en fazla 5 satır özet + dosya
  yolu dön" talimatı. Okuma işçisine ayrıca: "salt okunur çalış, `.env*` ve
  gizli dosyalara dokunma, commit edilmemiş işi okuma."

Mavci projesinde (`.mavci/project.json` varsa) uygulama kodu işi yine
`/mavci-core:ship` zinciriyle yapılır; orkestra plan → onay → build →
verify → ship kapılarını atlamaz. Sonnet alt ajan o zincirin dışında
uygulama koduna yazmaz.

### 4. Kontrol et

İşçinin "bitti" demesine güvenme; dosyayı aç ve kendin doğrula:
dosya var mı ve boş değil mi (`ls -la`, `wc -l`), sayılar tutuyor mu (girdi
satırı = çıktı satırı), kod ise test / build çalıştı mı, görsel ise dosya
gerçekten oluştu mu. Çok büyük çıktıda tamamını değil örnek satırları oku.

### 5. Düzelt

Sorun varsa ilgili işçiye neyin yanlış olduğunu ve hangi dosyayı
düzelteceğini yazarak geri gönder. Aynı işçi iki kez başarısız olursa bir
sonraki yedeğe geç; üçüncüde dur ve kullanıcıya sor.

## Sonuç raporu

Kullanıcıya kısa, sade Türkçe:

- **Ne yapıldı** — en fazla 5 madde.
- **Hangi araç hangi işi yaptı** — örn. "agy: 12 README okudu, özet
  çıkardı · Haiku: 300 ürünü temizledi".
- **Açık kalan** — yapılamayanlar ve nedeni; dosya yolları.

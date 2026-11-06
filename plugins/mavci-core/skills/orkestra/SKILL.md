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

2) İş dağılımı:
   - Basit/toplu veri işleri (temizleme, çeviri, toplu metin) → **agy**
     (hızlı/ucuz model). Kota dolarsa → **Claude Haiku alt ajan**.
   - Uzun belge / büyük repo okuma → **agy** (uzun bağlamlı Gemini modeli).
     Yedek: **Claude Sonnet alt ajan**.
   - Görsel üretimi → **agy** (görsel üretebildiği doğrulandıysa; üretemiyorsa
     skill'e not et ve kullanıcıya söyle). **2026-11-06 durumu: agy CLI görsel
     üretemiyor (doğrulandı); görsel istenirse kullanıcıya bunu söyle.**
   - Orta seviye kod → **Claude Sonnet alt ajan**.
   - Planlama, bölme, kontrol, mimari karar → **lider (bu oturum)**. Emin
     olunmayan mimari kararda agy'ye ikinci görüş sor, iki görüşü
     karşılaştırıp karar ver.
   - Gizlilik: agy'ye .env, anahtar ve gizli dosyalar asla gönderilmez.

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

## Araç durumu (2026-11-06)

- agy 1.5.2 çalışıyor; tek seferlik çağrı, dosyadan okuma ve JSON çıktı
  doğrulandı. Modeller: gemini-3.8-flash-low/medium/high (Gemini Pro yok).
  Görsel üretimi yok. Ayrıntı `agy-cli` skill'inde.

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
Mavci sistem reposunun kendisinde çalışıyorsan, iş bitince `.mavci/` klasörünü
kaldır: orada `.mavci/` bulunması `check-scribe-refs.mjs`'in repoyu proje
sanıp yerelde hata vermesine yol açar (CI'da klasör olmadığı için etkilenmez).

### 3. Çalıştır

- **agy:** Bash ile, `agy-cli` skill'indeki kalıpla; çıktı dosyaya, hata ayrı dosyaya. Birbirinden
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

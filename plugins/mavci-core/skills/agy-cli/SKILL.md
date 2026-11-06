---
name: agy-cli
description: Antigravity CLI (agy) ile tek seferlik iş çalıştırma, girdiyi dosyayla verme, çıktıyı dosyaya alma ve hata/kota durumunda ne yapılacağı. Orkestra toplu veri işini, uzun belge/repo okumayı ya da mimari ikinci görüşü agy'ye verdiğinde kullan.
---

# agy (Antigravity CLI)

Orkestranın Google işçisi. Google, 18 Haziran 2026'dan beri Gemini CLI'ı
kişisel hesaplara kapattı; yerine geçen araç agy. Ne zaman kullanılacağı
`orkestra` skill'inde yazar; bu dosya yalnız NASIL çağrılacağını anlatır.

## Doğrulanmış bilgiler (2026-11-06, agy 1.5.2, bu makinede denendi)

- Kurulum: `%LOCALAPPDATA%\agy\bin\agy.exe`, kullanıcı PATH'inde en başta.
  PATH değişikliğinden ÖNCE açılmış bir oturum `agy`yi bulamaz; o zaman tam
  yolu kullan: `"$LOCALAPPDATA/agy/bin/agy.exe"`.
- Tek seferlik çalıştırma: `-p "<istem>"` (`--print`). Süre sınırı:
  `--print-timeout 600s` (varsayılan 0 = sınırsız bekler).
- Model: `--model <id>`. Liste: `agy models`. O gün görülenler:
  `gemini-3.8-flash-low`, `gemini-3.8-flash-medium`, `gemini-3.8-flash-high`,
  `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`.
  **Listede Gemini Pro yok.**
- Salt okunur: `--mode plan`. Okuma ve tarama işçileri HER ZAMAN bununla
  çalışır. `--dangerously-skip-permissions` orkestrada KULLANILMAZ.
- Çıktı: `--output-format json` şunu verir:
  `{"status":"SUCCESS","response":"...","usage":{"total_tokens":...}}`.
  Başarıyı `status` ile anla, çıkış koduyla değil (aşağıya bak).
- **stdin OKUNMAZ.** Boruyla verilen metin modele ulaşmadı (denendi). Girdi
  bir dosyaya yazılır ve agy'ye o dosyayı okuması söylenir.
- Dosya okutma: istemde açıkça "read_file aracını kullan, run_command
  kullanma" denmeli. Denmezse agy komut çalıştırmaya kalkıyor, başsız modda
  bu izin otomatik reddediliyor ve hiç çıktı üretmiyor.
- `--mode plan`'da agy cevabı bir "uygulama planı" dosyasına
  (`~/.gemini/antigravity-cli/brain/.../plan.md`) sarıp yanıtta yalnız ona
  link verdi (denendi). İstemde "son yanıtın metnin KENDİSİ olsun; plan,
  artifact ya da dosya oluşturma" denince düzeldi.
- Büyük dosya: istemde "dosyanın TAMAMINI oku, gerekirse parça parça" de ve
  son satırda okuduğu bölüm sayısını yazdır (`OKUNAN_DOSYA=<n>`); lider bunu
  girdideki bölüm sayısıyla karşılaştırır. 2 MB / 60 dosyalık bir girdi
  `gemini-3.8-flash-high` ile 273 sn sürdü, 780.173 token harcadı, 60/60
  okundu. Büyük okumalar kotayı hızlı yer.
- **Görsel üretimi YOK.** agy'nin araç listesi: read_file, write_file,
  edit_file, run_command, search_web, invoke_subagent, define_subagent,
  manage_subagents, manage_task, schedule, send_message, ask_question.
  İki modda ve iki modelde soruldu, ikisinde de görsel aracı yok.
- `/usage`: `-p` ile verildiğinde kota raporu DÖNMEDİ (normal istem gibi
  işlendi). Etkileşimli modda denenmedi. Harcanan token her çağrının JSON
  çıktısındaki `usage.total_tokens` alanından okunur.

## Model seçimi

- Toplu, basit işler (temizleme, çeviri, toplu metin): `gemini-3.8-flash-low`.
- Uzun belge / repo okuma, rapor, mimari ikinci görüş: `gemini-3.8-flash-high`
  (listedeki en güçlü Gemini; Pro yok).
- agy içindeki Claude/GPT modellerini orkestra kullanmaz; Claude işi Claude
  alt ajanına gider.

## Çağrı kalıbı

Her iş kendi klasöründe çalışır. agy o klasörde başlatılır, böylece çalışma
alanında yalnız ona verilen girdi dosyası olur.

```bash
D=".mavci/orkestra/<iş-adı>"; mkdir -p "$D"
# 1) girdiyi dosyaya yaz (örnek: izlenen md dosyaları, gizli dosyalar hariç)
git ls-files -- '*.md' \
  | grep -v -i -E '(^|/)\.env|secret|credential|\.pem$|\.key$' \
  | while IFS= read -r f; do printf '\n===== %s =====\n' "$f"; cat "$f"; done \
  > "$D/girdi.md"
# 2) agy'yi o klasörde, salt okunur, JSON çıktıyla çalıştır
( cd "$D" && agy -p "Use the read_file tool (never run_command) to read girdi.md in the current directory. Read the WHOLE file, in chunks if needed. Your final reply must BE the result text itself: do not create a plan, an artifact or any file. <istem>. İlk 5 satıra kısa özet yaz, sonra ayrıntıya geç." \
    --model gemini-3.8-flash-high --mode plan --output-format json --print-timeout 600s \
) > "$D/sonuc.json" 2> "$D/sonuc.err"
# 3) yanıtı dosyaya çıkar; başarısızsa çıkış kodu 1
node -e "const fs=require('fs');let j;try{j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'))}catch(e){console.error('agy JSON vermedi');process.exit(1)}if(j.status!=='SUCCESS'||!j.response){console.error('agy basarisiz: '+j.status);process.exit(1)}fs.writeFileSync(process.argv[2],j.response);console.log('tokens='+j.usage.total_tokens)" "$D/sonuc.json" "$D/sonuc.md"
```

Lider yalnız `head -5 "$D/sonuc.md"` okur.

## Gizlilik

agy'ye giden her şey Google'a gider. `.env*`, anahtar, token, şifre, gizli
dosya, müşteri kişisel verisi ve kullanıcının telefon numarası ASLA
gönderilmez. Girdi `git ls-files` ile izlenen dosyalardan kurulur; commit
edilmemiş iş gönderilmez. agy'ye repoyu kendisi gezdirme; girdi dosyasını
sen hazırla.

## Hata ve kota

**Çıkış kodu 0 başarı demek DEĞİL.** İzin reddi durumunda agy çıkış kodu 0
ile şu satırı yazıp hiç yanıt üretmedi (denendi):
`jetski: no output produced — a tool required the "command" permission ...`

| Belirti | Ne yapılır |
|---|---|
| `jetski: no output produced` | İstem "read_file kullan, run_command kullanma" demiyor; düzeltip bir kez daha dene. |
| JSON değil, ya da `status` SUCCESS değil | `.err` ve `.json` ilk 5 satırını lidere bildir, tahmin yürütme. |
| Kota doldu | Toplu işte Claude Haiku alt ajana, uzun okumada Claude Sonnet alt ajana geç. Tekrar tekrar deneme. |
| Giriş istiyor | Dur. Kullanıcıya: PowerShell'de `agy` yazıp Google ile giriş yapsın. |
| `agy` bulunamadı | Tam yolu dene; o da yoksa kullanıcıya bildir, yedeğe geç. |

Kota dolduğunda agy'nin yazdığı mesaj henüz görülmedi; ilk görüldüğünde
metnini bu tabloya ekle.

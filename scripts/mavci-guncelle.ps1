# mavci-guncelle.ps1 - mavci-core eklentisini bu bilgisayarda yeni surume tasir.
#
# Sirasiyla: marketplace klasorune gec, git fetch origin,
# git checkout -B main origin/main, claude plugin uninstall mavci-core@mavci,
# claude plugin install mavci-core@mavci --scope user. Bir adim basarisiz
# olursa durur ve hangi adimda kaldigini soyler.
#
# Neden Turkce harfler \u kodu ile yazili: repo kurali dosyalari BOM'suz UTF-8
# ister, Windows PowerShell 5.1 ise BOM'suz dosyayi ANSI okur ve harfleri
# bozar. Dosyanin kendisi ASCII kalir, metin calisirken cozulur.

# Native komutlarin stderr'i (git ilerleme mesajlari) PS 5.1'de 'Stop' ile
# hata sayilir; karar yalniz cikis koduna gore verilir.
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function T([string]$s) { [regex]::Unescape($s) }
# T yalniz betigin kendi metnine uygulanir; yol ve komut ciktisi (ters egik
# cizgi icerir) ayri parametreyle, cozulmeden eklenir.
function Tamam([string]$s, [string]$ek = '') { Write-Host ((T "[tamam] $s") + $ek) -ForegroundColor Green }
function Dur([string]$adim, [string]$neden) {
  Write-Host ((T "[HATA] $adim ad\u0131m\u0131nda durdu: ") + $neden) -ForegroundColor Red
  Write-Host (T "Sonraki ad\u0131mlar \u00e7al\u0131\u015ft\u0131r\u0131lmad\u0131.") -ForegroundColor Red
  exit 1
}
function Calistir([string]$adim, [scriptblock]$komut) {
  $global:LASTEXITCODE = 0
  try { $cikti = & $komut 2>&1 | ForEach-Object { "$_" } | Where-Object { $_.Trim() } | Out-String } catch { Dur $adim $_.Exception.Message }
  if ($LASTEXITCODE -ne 0) {
    $ozet = ($cikti.Trim() -split "`n" | Select-Object -Last 1)
    Dur $adim ((T "\u00e7\u0131k\u0131\u015f kodu ") + "$LASTEXITCODE - $ozet")
  }
}

$klasor = Join-Path $env:USERPROFILE '.claude\plugins\marketplaces\mavci'

# 1) marketplace klasorune gec
if (-not (Test-Path $klasor)) { Dur '1/5 klas\u00f6re ge\u00e7' ((T 'klas\u00f6r yok: ') + $klasor) }
$eski = Get-Location
try {
  Set-Location $klasor
  Tamam '1/5 klas\u00f6re ge\u00e7ildi: ' $klasor

  # 2) git fetch origin
  Calistir '2/5 git fetch' { git fetch origin }
  Tamam '2/5 GitHub''dan son s\u00fcr\u00fcm \u00e7ekildi (git fetch origin)'

  # 3) git checkout -B main origin/main
  Calistir '3/5 git checkout' { git checkout -B main origin/main }
  $commit = (git rev-parse --short HEAD).Trim()
  Tamam "3/5 klas\u00f6r son s\u00fcr\u00fcme ta\u015f\u0131nd\u0131 (commit $commit)"

  # 4) claude plugin uninstall
  Calistir '4/5 eklentiyi kald\u0131r' { claude plugin uninstall mavci-core@mavci }
  Tamam '4/5 eski eklenti kald\u0131r\u0131ld\u0131'

  # 5) claude plugin install --scope user
  Calistir '5/5 eklentiyi y\u00fckle' { claude plugin install mavci-core@mavci --scope user }
  Tamam '5/5 yeni eklenti y\u00fcklendi (t\u00fcm projeler i\u00e7in)'

  # yuklenen surum: kurulum kaydindan, yoksa klasordeki plugin.json'dan
  $surum = $null
  $kayit = Join-Path $env:USERPROFILE '.claude\plugins\installed_plugins.json'
  if (Test-Path $kayit) {
    try {
      $j = Get-Content $kayit -Raw -Encoding UTF8 | ConvertFrom-Json
      $kayitlar = $j.plugins.'mavci-core@mavci'
      $user = $kayitlar | Where-Object { $_.scope -eq 'user' } | Select-Object -First 1
      if ($user) { $surum = $user.version }
    } catch { }
  }
  if (-not $surum) {
    $pj = Join-Path $klasor 'plugins\mavci-core\.claude-plugin\plugin.json'
    $surum = (Get-Content $pj -Raw -Encoding UTF8 | ConvertFrom-Json).version
  }
  Write-Host ''
  Write-Host (T "Y\u00fcklenen s\u00fcr\u00fcm: mavci-core $surum") -ForegroundColor Cyan
  Write-Host (T "UYARI: Claude Code'u kapat\u0131p yeniden a\u00e7. A\u00e7\u0131k oturumlar eski s\u00fcr\u00fcmle \u00e7al\u0131\u015fmaya devam eder.") -ForegroundColor Yellow
} finally {
  Set-Location $eski
}

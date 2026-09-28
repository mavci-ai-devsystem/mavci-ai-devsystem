export const metadata = { title: 'KVKK Aydinlatma Metni' }

export default function Page() {
  return (
    <main className="prose mx-auto p-8">
      <h1>KVKK Aydinlatma Metni</h1>
      {/* REVIEW REQUIRED - draft text. A lawyer must review this before launch.
          Only the operator removes this marker, and only after that review: deleting it
          asserts a review that did not happen. It is a warning while you build and a
          blocker before you ship. */}
      <h2>Veri sorumlusunun kimligi</h2>
      <p>DRAFT — NOT A REGISTERED ENTITY — REVIEW REQUIRED, DRAFT — REVIEW REQUIRED. MERSIS: DRAFT — NO MERSIS — REVIEW REQUIRED.</p>
      <h2>Isleme amaclari</h2>
      <p>Hesap olusturma ve yonetimi, abonelik ve faturalama, destek taleplerinin
      karsilanmasi, guvenlik ve kotuye kullanimin onlenmesi, yasal
      yukumluluklerin yerine getirilmesi.</p>
      <h2>Hukuki sebep</h2>
      <p>KVKK m.5/2-c uyarinca sozlesmenin kurulmasi ve ifasi, m.5/2-c uyarinca
      hukuki yukumlulugun yerine getirilmesi ve m.5/2-f uyarinca mesru menfaat.</p>
      <h2>Aktarim</h2>
      <p>Kisisel verileriniz, hizmetin sunulabilmesi amaciyla yurt disinda yerlesik
      su hizmet saglayicilara aktarilmaktadir: barindirma icin Vercel, veritabani
      ve kimlik dogrulama icin Supabase, odeme icin Stripe, e-posta gonderimi icin
      Resend.</p>
      <h2>Saklama suresi</h2>
      <p>Veriler, uyelik suresince ve uyeligin sona ermesinden itibaren ilgili
      mevzuatta ongorulen zamanasimi sureleri boyunca saklanir.</p>
      <h2>Ilgili kisinin haklari</h2>
      <p>KVKK m.11 uyarinca: verilerinizin islenip islenmedigini ogrenme, bilgi
      talep etme, isleme amacini ogrenme, duzeltilmesini veya silinmesini isteme,
      aktarildigi ucuncu kisileri bilme ve zararin giderilmesini talep etme
      haklarina sahipsiniz.</p>
      <h2>Basvuru yontemi</h2>
      <p>Taleplerinizi DRAFT — NO KEP — REVIEW REQUIRED adresine KEP uzerinden veya mavcimavci1983@gmail.com adresine
      e-posta ile iletebilirsiniz. Basvurunuz en gec otuz gun icinde
      sonuclandirilir.</p>
    </main>
  )
}

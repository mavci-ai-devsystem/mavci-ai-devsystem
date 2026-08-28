export const metadata = { title: 'Gizlilik Politikasi' }

export default function Page() {
  return (
    <main className="prose mx-auto p-8">
      <h1>Gizlilik Politikasi</h1>
      {/* REVIEW REQUIRED - draft text. A lawyer must review this before launch.
          This marker is a warning during development and a blocker at /mavci:release. */}
      <h2>Topladigimiz veriler</h2>
      <p>Hesap bilgileri (ad, e-posta), abonelik ve fatura kayitlari, uygulama
      kullanim kayitlari ve destek yazismalari. Odeme karti bilgileri tarafimizca
      saklanmaz; odeme islemleri Stripe uzerinden yurutulur.</p>
      <h2>Kullanim amaci</h2>
      <p>Hizmetin sunulmasi, abonelik yonetimi, guvenlik ve kotuye kullanimin
      onlenmesi, yasal yukumluluklerin yerine getirilmesi.</p>
      <h2>Ucuncu taraflar</h2>
      <p>Barindirma icin Vercel, veritabani ve kimlik dogrulama icin Supabase,
      odeme icin Stripe, e-posta icin Resend hizmetlerinden yararlanilmaktadir.</p>
      <h2>Haklariniz</h2>
      <p>KVKK ve GDPR kapsaminda verilerinize erisme, duzeltme, silme ve isleme
      faaliyetine itiraz etme hakkina sahipsiniz. Talepleriniz icin iletisim
      sayfamizdaki adresleri kullanabilirsiniz.</p>
    </main>
  )
}

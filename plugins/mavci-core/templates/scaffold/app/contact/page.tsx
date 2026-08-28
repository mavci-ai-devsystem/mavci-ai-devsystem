export const metadata = { title: 'Iletisim' }

export default function Contact() {
  return (
    <main className="prose mx-auto p-8">
      <h1>Iletisim</h1>
      <h2>Sirket bilgileri</h2>
      <p>Unvan: __LEGAL_NAME__</p>
      <p>Adres: __ADDRESS__</p>
      <p>E-posta: __EMAIL__</p>
      <p>MERSIS: __MERSIS__</p>
      <p>KEP: __KEP__</p>
      <h2>Destek</h2>
      <p>Destek talepleriniz icin yukaridaki e-posta adresini kullanabilirsiniz.
      Talepler mesai gunlerinde en gec iki is gunu icinde yanitlanir. KVKK
      kapsamindaki basvurular icin KVKK sayfamizda belirtilen yontemleri
      kullaniniz.</p>
    </main>
  )
}

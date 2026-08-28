export const metadata = { title: 'Kullanim Sartlari' }

export default function Page() {
  return (
    <main className="prose mx-auto p-8">
      <h1>Kullanim Sartlari</h1>
      {/* REVIEW REQUIRED - draft text. A lawyer must review this before launch.
          This marker is a warning during development and a blocker at /mavci:release. */}
      <h2>Hizmetin kapsami</h2>
      <p>Bu sozlesme, __DISPLAY_NAME__ hizmetinin kullanimina iliskin sartlari
      duzenler. Hizmeti kullanarak bu sartlari kabul etmis sayilirsiniz.</p>
      <h2>Hesap ve sorumluluk</h2>
      <p>Hesap guvenliginden kullanici sorumludur. Hesap bilgilerinin ucuncu
      kisilerle paylasilmasi durumunda dogacak zararlardan kullanici sorumludur.</p>
      <h2>Abonelik ve odeme</h2>
      <p>Abonelikler donemsel olarak yenilenir. Iptal, mevcut donem sonunda
      gecerli olur. Cayma hakki ve iade kosullari yurulukteki mevzuata tabidir.</p>
      <h2>Fesih</h2>
      <p>Sartlarin ihlali halinde hesap askiya alinabilir veya kapatilabilir.
      Kullanici diledigi zaman hesabini kapatabilir.</p>
      <h2>Uygulanacak hukuk</h2>
      <p>Bu sozlesmeye Turkiye Cumhuriyeti hukuku uygulanir.</p>
    </main>
  )
}

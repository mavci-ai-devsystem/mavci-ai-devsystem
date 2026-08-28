export const metadata = { title: 'Cerez Politikasi' }

export default function Page() {
  return (
    <main className="prose mx-auto p-8">
      <h1>Cerez Politikasi</h1>
      {/* REVIEW REQUIRED - draft text. A lawyer must review this before launch.
          This marker is a warning during development and a blocker at /mavci:release. */}
      <h2>Cerez nedir</h2>
      <p>Cerezler, ziyaret ettiginiz siteler tarafindan cihaziniza kaydedilen
      kucuk metin dosyalaridir.</p>
      <h2>Kullandigimiz cerezler</h2>
      <p>Zorunlu cerezler: oturum yonetimi ve guvenlik icin gereklidir, devre
      disi birakilamaz. Analitik ve pazarlama cerezleri yalnizca acik rizaniz
      ile calistirilir.</p>
      <h2>Yonetimi</h2>
      <p>Tarayici ayarlarinizdan cerezleri silebilir veya engelleyebilirsiniz.
      Zorunlu cerezlerin engellenmesi hizmetin calismasini etkileyebilir.</p>
      <h2>Ucuncu taraf cerezleri</h2>
      <p>Reklam veya analitik saglayicilar kendi cerezlerini kullanabilir. Bu
      cerezler yalnizca riza verildikten sonra yuklenir.</p>
    </main>
  )
}

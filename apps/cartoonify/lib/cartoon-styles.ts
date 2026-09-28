/**
 * Single source of truth for the cartoon style presets, used by both
 * components/cartoonify-form.tsx (client) and app/api/cartoonify/route.ts
 * (server). Neither of those files may restate a style id, a label or a
 * prompt of its own.
 *
 * The prompts are product copy, not secrets, so this file is safe to bundle
 * client-side. That is not what makes the allow-list a control: the control is
 * that the server maps an incoming id through CARTOON_STYLES and rejects
 * anything not in it, so a caller can never supply prompt text of its own.
 *
 * Every preset is an original description of a drawing technique. No preset
 * names, imitates or alludes to a studio, a franchise or a character.
 *
 * WHAT IS STORED AND WHAT IS DERIVED
 * Stored: id, name, description, axis coordinates, the assertion column, and
 * the prompt BODY. Derived: `group` (from the coordinates), which closing
 * constant applies (from the F coordinate), and the full `prompt` (body plus
 * that constant). A style is never written from a name; it is written from a
 * coordinate and named afterwards.
 */

/**
 * The two closing constants, defined once and composed onto every body.
 *
 * They are never retyped into a prompt. At thirty presets a typo in one
 * retyped copy would silently stop that single style preserving composition,
 * and nothing anywhere would check it.
 *
 * `preserve` withholds geometry; `exaggerate` licenses it and steps the
 * preserved object down from the subject to the subject's recognisability.
 * Which one applies follows from the F coordinate and is not a free choice.
 */
export const CLOSING = {
  preserve: 'Konuyu ve kompozisyonu koru, yalnızca çizim üslubunu değiştir.',
  exaggerate:
    'Konunun tanınabilirliğini ve kompozisyonu koru; karakteristik hatları ve oranları abartarak değiştir.',
} as const

export type ClosingId = keyof typeof CLOSING

/** The six axes. A style is a point in this space; its medium is derived. */
export type Boundary = 'B1' | 'B2' | 'B3' | 'B4' | 'B5'
export type Tone = 'T1' | 'T2' | 'T3' | 'T4' | 'T5'
export type Chroma = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
export type Surface = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
export type Form = 'F1' | 'F2' | 'F3' | 'F4'
export type Depth = 'D1' | 'D2' | 'D3' | 'D4'

export type Coords = {
  readonly B: Boundary; readonly T: Tone; readonly C: Chroma
  readonly S: Surface; readonly F: Form; readonly D: Depth
}

/**
 * Where each axis is asserted. `null` is only legal for the one value per
 * axis that means "no instruction given" — B3, C1, S1, D1 — and `constant`
 * only for F1, which Constant A already states. Every other coordinate must
 * name a clause.
 *
 * THIRTEEN COORDINATES WERE ASSERTED BY NOTHING. The set review found eleven
 * by asking the same question of all thirty in a row; they were invisible
 * per-slot and per-group. Writing this column out found TWO MORE that the
 * review had missed — stretched-caricature never said its edges dissolve,
 * torn-paper never said its tone was flat. The column found more while being
 * built than the review found by running, which is the argument for it being
 * a stored column rather than a review pass: a pass is run when someone
 * remembers to, a column is filled every time a style is added.
 *
 * DO NOT MOVE coords/asserts OUT OF THIS FILE. They cost roughly 4.6 KB in
 * the client bundle and a separate file would save that. It would also let
 * them drift from the prompt they describe, which is the single thing keeping
 * them together prevents. The bytes are the price of the guarantee.
 */
export type AssertSource = 'opening' | 'attr' | 'constant' | 'null'
export type Asserts = { readonly [K in keyof Coords]: AssertSource }

export type CartoonGroup = 'cizgi' | 'boya' | 'baski' | 'kesme'

type StyleSource = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly coords: Coords | null
  readonly asserts: Asserts | null
  readonly body: string
}

export const STYLE_SOURCE = [
  {
    id: 'classic',
    name: 'Klasik Karikatür',
    description: 'Canlı renkler ve temiz hatlarla dengeli bir çizgi film görünümü.',
    // Outside the axis grid: this is the default, not one choice among many.
    // A request with no `style` field routes here, so this string is the
    // pre-styles contract: editing it changes the output every older client
    // gets. This prompt is pinned byte-for-byte by task 0004 criterion 4,
    // which composes STYLE_SOURCE[0].body + ' ' + CLOSING.preserve and asserts
    // it equal to the frozen literal recorded there. Do not edit.
    coords: null,
    asserts: null,
    body:
      'Bu fotoğrafı canlı renkli, temiz hatlı bir karikatür/çizgi film çizimine dönüştür.',
  },
  {
    id: 'bold-ink',
    name: 'Kalın Mürekkep',
    description: 'Kalın siyah konturlar ve düz renk alanlarıyla yüksek kontrast.',
    coords: { B: 'B1', T: 'T2', C: 'C1', S: 'S1', F: 'F1', D: 'D1' },
    asserts: { B: 'opening', T: 'opening', C: 'null', S: 'null', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı kalın siyah mürekkep konturları ve düz, gölgesiz renk alanlarıyla yüksek kontrastlı bir çizime dönüştür. Ara tonlar yerine keskin ışık-gölge ayrımı kullan, çizgi kalınlığı belirgin olsun.',
  },
  {
    id: 'cel-frame',
    name: 'Çizgi Film',
    description: 'Kalın kontur ve iki kademeli gölgeyle bir animasyon karesi.',
    coords: { B: 'B1', T: 'T3', C: 'C1', S: 'S1', F: 'F1', D: 'D3' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'attr', F: 'constant', D: 'attr' },
    body:
      'Bu fotoğrafı kalın konturlu, canlı renkli bir çizgi film karesine dönüştür. Her renk alanı iki koyuluk kademesine ayrılsın, gölge sınırları sert olsun; gölge biçimleri hacmi kursun. Gren ve fırça izi kullanma.',
  },
  {
    id: 'hatched-line',
    name: 'Tarama Çizgi',
    description: 'Kâğıt üzerinde çapraz tarama ile kurulmuş tek renkli çizim.',
    coords: { B: 'B2', T: 'T5', C: 'C5', S: 'S2', F: 'F1', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı kâğıt üzerine ince çizgiyle yapılmış tek renkli bir çizime dönüştür. Düz renk alanı yerine tarama çizgileri kullan; koyuluk çizgi sıklığı ve çapraz taramayla kurulsun. Kâğıdın greni görünsün.',
  },
  {
    id: 'line-wash',
    name: 'Sulu Çizgi',
    description: 'İnce çizgi ve sulandırılmış boyayla soluk, yumuşak bir çizim.',
    coords: { B: 'B2', T: 'T1', C: 'C4', S: 'S2', F: 'F1', D: 'D1' },
    asserts: { B: 'opening', T: 'opening', C: 'attr', S: 'attr', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı ince çizgi ve sulandırılmış boyayla yapılmış bir çizime dönüştür. Renk geçişleri yumuşak ve soluk olsun, doygunluk düşük kalsın; kâğıdın dokusu görünsün. Tarama çizgileri ve nokta kullanma.',
  },
  {
    id: 'two-ink',
    name: 'İki Mürekkep',
    description: 'Kalın kontur ve iki renkle sınırlı, sadeleştirilmiş çizim.',
    coords: { B: 'B1', T: 'T2', C: 'C2', S: 'S1', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'null', F: 'attr', D: 'null' },
    body:
      'Bu fotoğrafı kalın konturlu, iki mürekkeple sınırlı bir çizime dönüştür. Biçimler sadeleştirilsin, ayrıntı azalsın ama oranlar korunsun; renk alanları düz olsun. Renk geçişi ve kademeli gölge kullanma.',
  },
  {
    id: 'mass-caricature',
    name: 'Şişirilmiş Karikatür',
    description: 'Kütleleri şişirilmiş, yassı ve canlı renkli bir karikatür.',
    coords: { B: 'B1', T: 'T3', C: 'C1', S: 'S1', F: 'F3', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'null', F: 'attr', D: 'attr' },
    body:
      'Bu fotoğrafı kalın konturlu, canlı renkli bir karikatüre dönüştür. Baş ve gövde kütleleri şişirilsin, biçimler yuvarlatılsın; renk alanları iki koyuluk kademesine ayrılsın. Hacimlendirme kullanma, görüntü yassı kalsın.',
  },
  {
    id: 'feature-caricature',
    name: 'Portre Karikatür',
    description: 'Yalnızca en ayırt edici hatları abartan, taramalı portre.',
    coords: { B: 'B2', T: 'T5', C: 'C4', S: 'S3', F: 'F3', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'attr', D: 'null' },
    body:
      'Bu fotoğrafı kâğıda ince çizgiyle yapılmış bir karikatüre dönüştür. Yalnızca en ayırt edici iki üç hat abartılsın, gerisi gerçeğe yakın kalsın. Koyuluk taramayla kurulsun, kalem basıncı görünsün. Doygun renk kullanma.',
  },
  {
    id: 'reduced-caricature',
    name: 'Keskin Karikatür',
    description: 'Her hattı en keskin biçimine indirgeyen iki renkli karikatür.',
    coords: { B: 'B2', T: 'T2', C: 'C2', S: 'S1', F: 'F3', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'null', F: 'attr', D: 'null' },
    body:
      'Bu fotoğrafı ince kesintili çizgiyle iki renkli bir karikatüre dönüştür. Her hat en keskin biçimine indirgensin; abartı büyüklükte değil, biçimler arasındaki karşıtlıkta olsun. Renk alanları düz, taramasız olsun.',
  },
  {
    id: 'soft-pastel',
    name: 'Yumuşak Suluboya',
    description: 'Suluboya dokusunda, pastel tonlarda yumuşak bir illüstrasyon.',
    coords: { B: 'B5', T: 'T1', C: 'C4', S: 'S3', F: 'F1', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'attr', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı yumuşak pastel tonlarda, suluboya dokusunda bir illüstrasyona dönüştür. Kenarlar yumuşak ve dağılan fırça izleri şeklinde olsun, renk geçişleri hafif ve soluk kalsın, koyu kontur kullanma.',
  },
  {
    id: 'flat-colour',
    name: 'Düz Renk',
    description: 'Kontursuz, düz renk alanlarından oluşan sade bir görsel.',
    coords: { B: 'B3', T: 'T2', C: 'C1', S: 'S1', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'null', S: 'attr', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı kontursuz, düz renk alanlarından oluşan sade bir görsele dönüştür. Her bölge tek renk değeri taşısın; biçimler sadeleştirilsin, ayrıntı azalsın. Gren ve fırça izi kullanma, yüzey temiz olsun.',
  },
  {
    id: 'opaque-paint',
    name: 'Örtücü Boya',
    description: 'Örtücü mat boyayla, sıcak paletle yapılmış bir tablo.',
    coords: { B: 'B3', T: 'T2', C: 'C3', S: 'S3', F: 'F1', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'attr', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı örtücü mat boyayla yapılmış bir tabloya dönüştür. Kontur kullanma, renk renge dayansın. Renkler sıcak palete sınırlı kalsın; fırça darbeleri ve kalın sürülmüş boya görünsün, renk alanları düz olsun.',
  },
  {
    id: 'thick-paint',
    name: 'Kalın Boya',
    description: 'Kalın sürülmüş boya ve yumuşak geçişlerle hacimli bir çalışma.',
    coords: { B: 'B5', T: 'T1', C: 'C1', S: 'S3', F: 'F2', D: 'D4' },
    asserts: { B: 'attr', T: 'attr', C: 'null', S: 'opening', F: 'attr', D: 'attr' },
    body:
      'Bu fotoğrafı kalın sürülmüş boyayla yapılmış bir boya çalışmasına dönüştür. Kenarlar yumuşasın, ton sürekli olsun, hacim geçişle kurulsun; fırça darbeleri belirgin görünsün. Ayrıntı azalsın ama oranları abartma.',
  },
  {
    id: 'stretched-caricature',
    name: 'Uzun Karikatür',
    description: 'Oranları tek eksende uzatılmış, izsiz ve yumuşak bir karikatür.',
    coords: { B: 'B5', T: 'T1', C: 'C1', S: 'S1', F: 'F3', D: 'D4' },
    asserts: { B: 'attr', T: 'opening', C: 'null', S: 'opening', F: 'attr', D: 'attr' },
    body:
      'Bu fotoğrafı yumuşak geçişli, kontursuz ve izsiz bir karikatüre dönüştür. Oranlar tek bir eksende gerdirilsin; şişirme değil uzatma olsun. Hacim sürekli tonla kurulsun. Fırça izi ve doku kullanma, yüzey temiz kalsın.',
  },
  {
    id: 'combed-paint',
    name: 'Akışkan Boya',
    description: 'Taraklanmış akışkan çizgilerle kurulmuş sade bir boya yüzeyi.',
    coords: { B: 'B5', T: 'T5', C: 'C3', S: 'S2', F: 'F2', D: 'D1' },
    asserts: { B: 'attr', T: 'opening', C: 'attr', S: 'opening', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı taraklanmış akışkan çizgilerle kâğıda yapılmış sade bir boya yüzeyine dönüştür. Kontur kullanma, kenarlar boyanın akışıyla belirsin. Ton çizgilerin yönüyle kurulsun; renkler sıcak palete sınırlı kalsın.',
  },
  {
    id: 'wet-paper',
    name: 'Islak Kâğıt',
    description: 'Islak kâğıtta iki renkle yayılan yumuşak geçişler.',
    coords: { B: 'B3', T: 'T1', C: 'C2', S: 'S2', F: 'F1', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'opening', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı ıslak kâğıda iki renkle yapılmış bir boyamaya dönüştür. Kontur kullanma, renk renge dayansın. Renkler zeminde yayılıp yumuşak geçişler kursun; üçüncü renk kullanma. Kâğıdın greni görünsün.',
  },
  {
    id: 'single-ink',
    name: 'Tek Mürekkep',
    description: 'Tek mürekkeple, üç kademeli tonla kurulmuş bir çalışma.',
    coords: { B: 'B5', T: 'T3', C: 'C5', S: 'S2', F: 'F1', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'opening', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı tek mürekkeple kâğıda yapılmış bir ton çalışmasına dönüştür. Kontur kullanma, kenarlar yumuşasın. Ton üç ayrı koyuluk kademesine ayrılsın, gölge sınırları sert olsun. Fırça izi ve kalın boya kullanma.',
  },
  {
    id: 'retro-print',
    name: 'Retro Baskı',
    description: 'Eski matbaa baskısı gibi noktalı doku ve sınırlı sıcak palet.',
    coords: { B: 'B3', T: 'T4', C: 'C2', S: 'S4', F: 'F1', D: 'D1' },
    asserts: { B: 'null', T: 'attr', C: 'attr', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı eski matbaa baskısını andıran bir çizime dönüştür: görünür noktalı tram dokusu, hafif kaymış renk katmanları, kirli beyaz kâğıt zemin ve turuncu, hardal, koyu mavi ile sınırlı sıcak bir palet.',
  },
  {
    id: 'carved-block',
    name: 'Oyma Baskı',
    description: 'Elle oyulmuş kalıptan basılmış, kalın konturlu tek renkli baskı.',
    coords: { B: 'B1', T: 'T2', C: 'C5', S: 'S4', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'opening', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı elle oyulmuş kalıptan basılmış, kalın konturlu tek renkli bir baskıya dönüştür. Ayrıntı kalıba oyulabilecek kadar azalsın. Siyah alanlar tram değil düz basılmış düzlem olsun; mürekkep eşit örtmesin.',
  },
  {
    id: 'wood-block',
    name: 'Ahşap Baskı',
    description: 'Ahşap bloktan basılmış, oyulmuş tarama çizgileriyle kurulmuş baskı.',
    coords: { B: 'B1', T: 'T5', C: 'C5', S: 'S4', F: 'F1', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'opening', S: 'opening', F: 'constant', D: 'null' },
    body:
      'Bu fotoğrafı ahşap bir bloktan basılmış tek renkli bir baskıya dönüştür. Düz siyah alan kullanma; koyuluk oyulmuş tarama çizgileriyle kurulsun. Konturlar kalın ve uçlarda incelen çizgiler olsun; ahşap damarı görünsün.',
  },
  {
    id: 'screen-print',
    name: 'Elek Baskı',
    description: 'Elekten geçirilmiş, birkaç düz biçime indirgenmiş üç renkli baskı.',
    coords: { B: 'B3', T: 'T2', C: 'C2', S: 'S4', F: 'F2', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'attr', S: 'opening', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı elekten geçirilerek basılmış, birkaç düz biçime indirgenmiş bir baskıya dönüştür. Kontur kullanma; biçimler yalnızca renk sınırıyla ayrılsın. Üç renkle sınırlı kal; kenarlar keskin, katmanlar kaymasın.',
  },
  {
    id: 'newsprint-caricature',
    name: 'Gazete Karikatürü',
    description: 'Ucuz gazete kâğıdında iri tramlı, asimetrisi büyütülmüş karikatür.',
    coords: { B: 'B2', T: 'T4', C: 'C5', S: 'S4', F: 'F3', D: 'D1' },
    asserts: { B: 'attr', T: 'attr', C: 'opening', S: 'opening', F: 'attr', D: 'null' },
    body:
      'Bu fotoğrafı ucuz gazete kâğıdına basılmış tek renkli bir baskıya dönüştür. Çizgiler ince kalsın; ince tram kullanma, nokta iri ve seyrek olsun, emici kâğıtta yayılsın. Yüzdeki sağ-sol farkı büyütülsün.',
  },
  {
    id: 'engraved-plate',
    name: 'Kazıma Baskı',
    description: 'Metal plakaya kazınmış, şişip incelen çizgilerle hacim.',
    coords: { B: 'B2', T: 'T5', C: 'C5', S: 'S4', F: 'F1', D: 'D4' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'opening', F: 'constant', D: 'attr' },
    body:
      'Bu fotoğrafı metal plakaya kazınmış tek renkli, ince çizgili bir baskıya dönüştür. Eşit kalınlıkta çizgi kullanma; çizgiler ortada şişip uçlarda incelsin, hacim çizgi sıklığıyla kurulsun. Kenarda kalıp izi kalsın.',
  },
  {
    id: 'double-pass',
    name: 'Çift Geçiş',
    description: 'İki mürekkebin üst üste binmesinden doğan üçüncü koyuluk.',
    coords: { B: 'B3', T: 'T3', C: 'C5', S: 'S4', F: 'F2', D: 'D1' },
    asserts: { B: 'null', T: 'attr', C: 'attr', S: 'opening', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı iki geçişin taşıyabileceği kadar sadeleşmiş, üst üste basılmış bir baskıya dönüştür. İki mürekkep kullan; üçüncü mürekkep kullanma, üçüncü koyuluk çakışmadan gelsin. Üç koyuluk: zemin, geçiş, çakışma.',
  },
  {
    id: 'paper-cutout',
    name: 'Kâğıt Kesme',
    description: 'Üst üste yerleştirilmiş renkli kâğıt parçalarından kolaj etkisi.',
    coords: { B: 'B4', T: 'T2', C: 'C1', S: 'S5', F: 'F2', D: 'D2' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'opening', F: 'attr', D: 'attr' },
    body:
      'Bu fotoğrafı elle kesilmiş renkli kâğıt parçalarından yapılmış bir kolaja dönüştür. Biçimler sade ve düz renkli olsun, kenarlar hafif düzensiz kesilmiş görünsün, katmanlar arasında yumuşak gölgeler bulunsun.',
  },
  {
    id: 'torn-paper',
    name: 'Yırtık Kâğıt',
    description: 'Elle yırtılmış, lifli kenarlı kâğıt katmanlarından bir yüzey.',
    coords: { B: 'B4', T: 'T2', C: 'C4', S: 'S2', F: 'F1', D: 'D2' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'constant', D: 'attr' },
    body:
      'Bu fotoğrafı elle yırtılmış kâğıt katmanlarından oluşan bir yüzeye dönüştür. Kesik kenar kullanma; kenarlar yırtık ve lifli olsun. Renkler soluk ve düz kalsın, kâğıdın greni görünsün; katmanlar gölge bıraksın.',
  },
  {
    id: 'three-tone-panel',
    name: 'Üç Renk Pano',
    description: 'Üç renge indirgenmiş, kesilmiş kâğıtla kurulmuş yassı bir pano.',
    coords: { B: 'B4', T: 'T3', C: 'C2', S: 'S5', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'opening', S: 'opening', F: 'opening', D: 'attr' },
    body:
      'Bu fotoğrafı üç renge indirgenmiş, kesilmiş kâğıtla kurulmuş sade bir panoya dönüştür. Her bölge üç koyuluk kademesine ayrı parçalarla bölünsün. Katmanlar arası gölge kullanma, yüzey tamamen yassı kalsın.',
  },
  {
    id: 'wood-inlay',
    name: 'Ahşap Kaplama',
    description: 'Kesilmiş ahşap parçalarında damarın verdiği ton geçişi.',
    coords: { B: 'B4', T: 'T1', C: 'C3', S: 'S5', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'opening', D: 'null' },
    body:
      'Bu fotoğrafı kesilmiş ahşap parçalarından yapılmış sade bir kaplamaya dönüştür. Düz renk kullanma; ton geçişini malzemenin kendi damarı versin. Renkler sıcak toprak tonlarına sınırlı kalsın, lif ve damar görünsün.',
  },
  {
    id: 'fabric-applique',
    name: 'Kumaş Aplike',
    description: 'Kesilip dikilmiş kumaş parçalarıyla üç kademeli bir aplike.',
    coords: { B: 'B4', T: 'T3', C: 'C4', S: 'S5', F: 'F1', D: 'D2' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'constant', D: 'attr' },
    body:
      'Bu fotoğrafı kesilmiş kumaş parçalarından dikilmiş bir aplikeye dönüştür. Her bölge üç koyuluk kademesine ayrı parçalarla bölünsün; renkler soluk kalsın. Keskin kenar kullanma; parçalar üst üste binip gölge bıraksın.',
  },
  {
    id: 'modelled-caricature',
    name: 'Yoğrulmuş Karikatür',
    description: 'Biçimi değil ifadeyi abartan, elde yoğrulmuş hacimli bir karikatür.',
    coords: { B: 'B4', T: 'T1', C: 'C4', S: 'S5', F: 'F3', D: 'D4' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'attr', D: 'attr' },
    body:
      'Bu fotoğrafı elde yoğrulmuş malzemeden yapılmış bir karikatüre dönüştür. Biçim değil ifade abartılsın; hatların şekli değil yaptığı hareket uç noktaya taşınsın. Hacim sürekli tonla kurulsun, renkler soluk kalsın.',
  },
  {
    id: 'thread-work',
    name: 'İplik İşleme',
    description: 'Yönlü iplik çizgileriyle kurulmuş, canlı renkli bir işleme.',
    coords: { B: 'B4', T: 'T5', C: 'C1', S: 'S5', F: 'F2', D: 'D1' },
    asserts: { B: 'opening', T: 'attr', C: 'attr', S: 'opening', F: 'opening', D: 'attr' },
    body:
      'Bu fotoğrafı kumaş üzerine iplikle işlenmiş sade bir çalışmaya dönüştür. Düz renk alanı yerine yönlü iplik çizgileri kullan; koyuluk iplik sıklığı ve yönüyle kurulsun. Renkler canlı olsun, katman gölgesi kullanma.',
  },
] as const satisfies readonly StyleSource[]

/**
 * Style ids are wire values: the client sends one and the server matches it
 * against this list. They must stay ASCII [a-z0-9-].
 *
 * A Turkish-named style tempts a Turkish id, and I/ı and i/İ casing under a
 * Turkish locale fails SILENTLY in a matcher rather than loudly. This project
 * has hit that class of bug twice. The types below turn that from a rule in a
 * document into a compile error from `npm run typecheck`.
 */
type SlugChar =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z'
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '-'

type IsSlug<S extends string> = S extends ''
  ? true
  : S extends `${infer H}${infer T}`
    ? H extends SlugChar ? IsSlug<T> : false
    : false

type AllStyleIds = (typeof STYLE_SOURCE)[number]['id']

type NonSlugIds = AllStyleIds extends infer U
  ? U extends string
    ? IsSlug<U> extends true ? never : U
    : never
  : never

/** Fails to compile, naming the offending id, if any id leaves [a-z0-9-]. */
const _idsAreAsciiSlugs: [NonSlugIds] extends [never]
  ? true
  : ['STYLE ID MUST MATCH /^[a-z0-9-]+$/ — offending id:', NonSlugIds] = true
void _idsAreAsciiSlugs

/**
 * Group membership is DERIVED, never assigned. The ordering is the design
 * decision: a print with a heavy carved line belongs with the prints, because
 * what makes it what it is is the pressing rather than the line.
 * `classic` has no coordinates and therefore no group: it is what happens when
 * no choice is made, not one choice among four.
 */
export function deriveGroup(coords: Coords | null): CartoonGroup | null {
  if (coords === null) return null
  if (coords.S === 'S4') return 'baski'
  if (coords.B === 'B4') return 'kesme'
  if (coords.B === 'B1' || coords.B === 'B2') return 'cizgi'
  return 'boya'
}

/** Which closing constant applies. Follows from F; not a free choice. */
export function closingFor(coords: Coords | null): ClosingId {
  if (coords === null) return 'preserve'
  return coords.F === 'F1' || coords.F === 'F2' ? 'preserve' : 'exaggerate'
}

export type CartoonStyle = {
  /** Stable wire value. Sent in FormData and matched against this list. */
  readonly id: string
  /** Turkish label shown to the visitor. */
  readonly name: string
  /** One line under the label, so the choice means something before the render. */
  readonly description: string
  /** Derived from the coordinates; null for the default. */
  readonly group: CartoonGroup | null
  readonly coords: Coords | null
  readonly asserts: Asserts | null
  /** The instruction sent upstream. Never accepted from the client. */
  readonly prompt: string
}

export const CARTOON_STYLES: readonly CartoonStyle[] = STYLE_SOURCE.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  group: deriveGroup(s.coords),
  coords: s.coords,
  asserts: s.asserts,
  prompt: s.body + ' ' + CLOSING[closingFor(s.coords)],
}))

/**
 * The Turkish labels shown on the picker, one per group. Proposed in task
 * 0004 §6 and settled by the operator at the plan gate; quoted exactly by
 * task 0004 criterion 9. Nothing under app/ or components/ may restate one —
 * see criterion 7.
 */
export const GROUP_LABELS: Record<CartoonGroup, string> = {
  cizgi: 'Çizgi ve Mürekkep',
  boya: 'Boya ve Fırça',
  baski: 'Baskı',
  kesme: 'Kesme ve Kolaj',
}

/** The order the four groups render in. `classic` sits outside all of them. */
export const STYLE_GROUP_ORDER: readonly CartoonGroup[] = ['cizgi', 'boya', 'baski', 'kesme']

export type StyleGroup = {
  readonly id: CartoonGroup
  readonly label: string
  readonly styles: readonly CartoonStyle[]
}

/** Grouping, derived from CARTOON_STYLES; never a second hand-maintained list. */
export const STYLE_GROUPS: readonly StyleGroup[] = STYLE_GROUP_ORDER.map((id) => ({
  id,
  label: GROUP_LABELS[id],
  styles: CARTOON_STYLES.filter((style) => style.group === id),
}))

/**
 * The amplification bound: how many upstream generations one accepted
 * request may cause. This is NOT a rate limit — it says nothing about how
 * many requests one caller may send, only how many images one request may
 * produce. See ADR 0006 for what does and does not bound request rate.
 */
export const MAX_STYLES_PER_REQUEST = 1

export type CartoonStyleId = (typeof STYLE_SOURCE)[number]['id']

/** Applied when a request sends no `style` field at all. */
export const DEFAULT_CARTOON_STYLE_ID: CartoonStyleId = 'classic'

/** The allow-list test. Anything this rejects never reaches the upstream call. */
export function isCartoonStyleId(value: unknown): value is CartoonStyleId {
  return (
    typeof value === 'string' &&
    CARTOON_STYLES.some((style) => style.id === value)
  )
}

/** Resolves an id already known to be in the allow-list to its preset. */
export function getCartoonStyle(id: CartoonStyleId): CartoonStyle {
  const style = CARTOON_STYLES.find((candidate) => candidate.id === id)
  // Unreachable while the argument is a CartoonStyleId; kept so a future
  // widening of the type fails loudly here rather than sending `undefined`
  // upstream as a prompt.
  if (!style) {
    throw new Error('Unknown cartoon style id: ' + id)
  }
  return style
}

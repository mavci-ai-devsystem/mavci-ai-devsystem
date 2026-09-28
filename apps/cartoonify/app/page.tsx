import type { Metadata } from 'next'
import Link from 'next/link'
import { GROUP_LABELS, STYLE_GROUPS } from '@/lib/cartoon-styles'
import UploadControl from '@/components/upload-control'

export const metadata: Metadata = {
  title: 'AI Photo to Cartoon Workshop — Cartoonify',
}

export default function Home() {
  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="workshop-badge">Cartoonify Workshop</p>
        <h1>AI Photo to Cartoon Workshop</h1>
        <p className="hero-lede">
          Upload a portrait, choose from every Cartoonify style in a visual gallery, generate in one click, and download instantly.
        </p>

        <div className="hero-pair">
          <figure>
            <img src="/hero/before.webp" alt="Original uploaded portrait" />
            <figcaption>Original photo</figcaption>
          </figure>
          <figure>
            <img src="/hero/after.webp" alt="Generated cartoon output" />
            <figcaption>Cartoon result</figcaption>
          </figure>
        </div>

        <UploadControl />

        <p className="kvkk-notice">
          Uploaded images are transferred to <strong>OpenAI</strong> servers in the <strong>United States</strong> for generation.
          Images are not stored on this website before or after processing. See the <Link href="/kvkk">KVKK Disclosure</Link>.
        </p>
      </section>

      <section className="group-intro">
        <h2>Full style system, organized in four creative groups</h2>
        <p>Every generation uses the same supported Cartoonify style identifiers and backend flow.</p>
        <ul className="group-preview">
          {STYLE_GROUPS.map((group) => (
            <li key={group.id} data-style-group={group.id}>
              <span className="group-preview-name">{GROUP_LABELS[group.id]}</span>
              <span className="group-preview-count">{group.styles.length} styles</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="how-it-works">
        <h2>Workshop flow</h2>
        <ol className="how-steps">
          <li>Upload your image with drag & drop or file browser.</li>
          <li>Preview your image and pick one visual style card.</li>
          <li>Generate, review, and download your final cartoon.</li>
        </ol>
      </section>
    </main>
  )
}

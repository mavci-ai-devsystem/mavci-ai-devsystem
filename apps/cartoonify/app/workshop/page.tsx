'use client'

import Link from 'next/link'
import CartoonifyForm from '@/components/cartoonify-form'
import UploadControl from '@/components/upload-control'
import { useUpload } from '@/components/upload-state'

export default function Workshop() {
  const { previewUrl } = useUpload()

  if (!previewUrl) {
    return (
      <main className="workshop-page">
        <section className="workshop-empty">
          <p className="workshop-badge">AI Cartoon Workshop</p>
          <h1>Create a premium cartoon portrait in seconds</h1>
          <p className="workshop-empty-lede">
            Upload a photo, explore every Cartoonify style in a visual gallery, and generate your result with one click.
          </p>

          <UploadControl redirectOnSelect={false} />

          <p className="workshop-empty-note">
            Want to review the product overview first? <Link href="/">Go to the home page</Link>.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="workshop-page">
      <CartoonifyForm />
    </main>
  )
}

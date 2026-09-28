import type { Metadata, Viewport } from 'next'
import './globals.css'
import { UploadProvider } from '@/components/upload-state'

const SITE_URL = 'https://cartoonify.vercel.app'

const TITLE = 'Cartoonify — AI Photo to Cartoon Workshop'
const DESCRIPTION =
  'Transform your photo into premium cartoon artwork in seconds with Cartoonify. Upload, choose a style, generate, and download instantly.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    locale: 'en_US',
    type: 'website',
    url: SITE_URL,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UploadProvider>{children}</UploadProvider>
        <footer>
          <a href="/privacy">Privacy</a>{' | '}
          <a href="/terms">Terms</a>{' | '}
          <a href="/kvkk">KVKK</a>{' | '}
          <a href="/cookies">Cookies</a>{' | '}
          <a href="/contact">Contact</a>
        </footer>
      </body>
    </html>
  )
}

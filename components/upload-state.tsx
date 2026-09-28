'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'

type UploadState = {
  file: File | null
  previewUrl: string | null
  setUpload: (file: File | null) => void
}

const UploadContext = createContext<UploadState | null>(null)

/**
 * The chosen photograph, held above both routes.
 *
 * This provider is mounted by app/layout.tsx, and a layout persists across
 * client transitions between the routes it contains. That is the whole
 * mechanism: `/` unmounts and `/workshop` mounts while this component stays
 * alive, so the File chosen on the landing page is still here when the
 * workshop renders, and pressing Back returns to `/` with it still chosen.
 *
 * Nothing is persisted. A hard load of /workshop - a refresh, a deep link, a
 * restored tab - mounts this empty, and that is deliberate: writing the
 * visitor's photograph to their disk would contradict the KVKK notice, which
 * says the image is not stored. The workshop route renders an empty state and
 * a way back rather than pretending otherwise.
 */
export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  function release() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  // The object URL is owned here, not by whichever route is mounted. A
  // revocation in a route component's unmount effect would destroy the preview
  // during the transition to /workshop, which is exactly the bug this
  // arrangement creates if it is done halfway.
  useEffect(() => release, [])

  function setUpload(next: File | null) {
    release()
    setFile(next)

    if (!next) {
      setPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(next)
    objectUrlRef.current = url
    setPreviewUrl(url)
  }

  return (
    <UploadContext.Provider value={{ file, previewUrl, setUpload }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload(): UploadState {
  const ctx = useContext(UploadContext)
  if (!ctx) {
    throw new Error('useUpload was called outside UploadProvider')
  }
  return ctx
}

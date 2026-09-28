'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_CARTOON_STYLE_ID,
  getCartoonStyle,
  isCartoonStyleId,
  STYLE_GROUPS,
  type CartoonStyleId,
} from '@/lib/cartoon-styles'
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/image-constraints'
import { useUpload } from './upload-state'
import StyleCard from './style-card'

type Status = 'idle' | 'loading' | 'error' | 'success'

type ApiResponse = { ok: true; image: string } | { ok: false; code: string; message: string }

const CLIENT_MESSAGES = {
  invalidType: 'This file type is not supported. Please upload a PNG, JPEG, or WEBP image.',
  tooLarge: 'Image is too large. Please choose a smaller file.',
  noFile: 'No image selected. Please upload a file to continue.',
  network: 'A network issue occurred. Please try again.',
}

function validateFile(file: File): string | null {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return CLIENT_MESSAGES.invalidType
  }
  if (file.size > MAX_FILE_BYTES) {
    return CLIENT_MESSAGES.tooLarge
  }
  return null
}

export default function CartoonifyForm() {
  const { file, previewUrl, setUpload } = useUpload()

  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [styleId, setStyleId] = useState<CartoonStyleId>(DEFAULT_CARTOON_STYLE_ID)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (status !== 'loading') {
      setProgress(0)
      return
    }

    setProgress(8)
    const timer = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return prev
        const jump = prev < 35 ? 8 : prev < 70 ? 5 : 2
        return Math.min(92, prev + jump)
      })
    }, 320)

    return () => window.clearInterval(timer)
  }, [status])

  function handleStyleSelect(value: string) {
    if (isCartoonStyleId(value)) {
      setStyleId(value)
    }
  }

  function handleReplaceFile(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null

    if (!nextFile) {
      return
    }

    const validationError = validateFile(nextFile)
    if (validationError) {
      setMessage(validationError)
      setStatus('error')
      return
    }

    setUpload(nextFile)
    setStatus('idle')
    setResultUrl(null)
    setMessage(null)
  }

  function handleRemoveFile() {
    setUpload(null)
    setStyleId(DEFAULT_CARTOON_STYLE_ID)
    setResultUrl(null)
    setMessage(null)
    setStatus('idle')
  }

  function handleCreateAnother() {
    setResultUrl(null)
    setMessage(null)
    setStatus('idle')
    setProgress(0)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!file) {
      setStatus('error')
      setMessage(CLIENT_MESSAGES.noFile)
      return
    }

    const validationError = validateFile(file)
    if (validationError) {
      setStatus('error')
      setMessage(validationError)
      return
    }

    setStatus('loading')
    setMessage(null)

    try {
      const body = new FormData()
      body.append('image', file)
      body.append('style', styleId)

      const response = await fetch('/api/cartoonify', { method: 'POST', body })
      const data = (await response.json()) as ApiResponse

      if (!data.ok) {
        setStatus('error')
        setMessage(data.message)
        return
      }

      setResultUrl(data.image)
      setStatus('success')
      setProgress(100)
    } catch {
      setStatus('error')
      setMessage(CLIENT_MESSAGES.network)
    }
  }

  const canSubmit = status !== 'loading' && previewUrl !== null
  const selectedStyle = getCartoonStyle(styleId)
  const allStyles = useMemo(
    () => [getCartoonStyle(DEFAULT_CARTOON_STYLE_ID), ...STYLE_GROUPS.flatMap((group) => group.styles)],
    []
  )

  const canvasImageUrl = resultUrl ?? previewUrl
  const isResultVisible = Boolean(resultUrl)

  return (
    <div data-state={status} className="cartoonify-workshop">
      <header className="workshop-header">
        <p className="workshop-badge">AI Cartoon Workshop</p>
        <h1>Turn your photo into premium cartoon art</h1>
        <p>
          Upload once, pick any style from the full visual gallery, generate, and download in seconds.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="workshop-shell">
        <section className="workspace-stage" aria-label="Generation workspace">
          <div className="workspace-stage-head">
            <h2>{isResultVisible ? 'Step 4 • Final image' : 'Step 2 • Preview'}</h2>
            <div className="workspace-stage-head-right">
              {status === 'loading' ? <span className="status-chip">Processing</span> : null}
              {status === 'success' ? <span className="status-chip success">Ready</span> : null}
              {status === 'error' ? <span className="status-chip error">Issue detected</span> : null}
              <div className="workspace-stage-controls">
                <label htmlFor="replace-image-input" className="ghost-button">
                  Replace image
                </label>
                <button type="button" className="ghost-button" onClick={handleRemoveFile}>
                  Remove
                </button>
              </div>
            </div>
          </div>

          <input
            id="replace-image-input"
            className="visually-hidden"
            type="file"
            accept={ALLOWED_MIME_TYPES.join(',')}
            onChange={handleReplaceFile}
          />

          <div className="workspace-stage-image-wrap" data-canvas-state={status}>
            {status === 'loading' ? (
              <div className="processing-canvas" role="status" aria-live="polite">
                <p>Applying style and rendering your cartoon…</p>
                <div className="progress-track" aria-hidden="true">
                  <span className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <small>{progress}%</small>
              </div>
            ) : canvasImageUrl ? (
              <img
                src={canvasImageUrl}
                alt={isResultVisible ? 'Generated cartoon image' : 'Uploaded original image'}
                className="workspace-stage-image"
              />
            ) : (
              <p className="result-empty">Upload an image to start your workshop.</p>
            )}
          </div>

          <div className="workspace-cta-block">
            {!isResultVisible ? (
              <button type="submit" className="generate-button" disabled={!canSubmit}>
                {status === 'loading' ? 'Generating…' : 'Generate cartoon'}
              </button>
            ) : (
              <div className="result-actions workspace-result-actions">
                <a className="primary-download" download="karikatur.png" href={resultUrl ?? undefined}>
                  Download
                </a>
                <button type="button" className="ghost-button" onClick={handleCreateAnother}>
                  Create another
                </button>
              </div>
            )}
            <p className="workspace-style-hint">
              Selected style: <strong>{selectedStyle.name}</strong>
            </p>
          </div>

          {status === 'error' && message ? (
            <p className="error-text" role="alert">
              {message}
            </p>
          ) : null}
        </section>

        <aside className="style-sidebar" aria-label="Style gallery">
          <div className="style-sidebar-head">
            <h2>Step 3 • Choose style</h2>
            <p>{allStyles.length} styles available</p>
          </div>

          <div className="style-gallery" aria-describedby="cartoonify-style-description">
            {[{ id: 'default', label: 'Default', styles: [getCartoonStyle(DEFAULT_CARTOON_STYLE_ID)] }, ...STYLE_GROUPS].map(
              (group) => (
                <fieldset key={group.id} className="style-group">
                  <legend>{group.label}</legend>
                  <div className="style-grid">
                    {group.styles.map((style) => (
                      <StyleCard
                        key={style.id}
                        style={style}
                        checked={styleId === style.id}
                        disabled={status === 'loading'}
                        onSelect={handleStyleSelect}
                      />
                    ))}
                  </div>
                </fieldset>
              )
            )}

            <p id="cartoonify-style-description" className="style-description-live">
              {selectedStyle.description}
            </p>
          </div>
        </aside>
      </form>
    </div>
  )
}

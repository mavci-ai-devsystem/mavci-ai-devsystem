'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ALLOWED_MIME_TYPES, MAX_FILE_BYTES } from '@/lib/image-constraints'
import { useUpload } from './upload-state'

type UploadControlProps = {
  redirectOnSelect?: boolean
  title?: string
  description?: string
}

const CLIENT_MESSAGES = {
  invalidType: 'This file type is not supported. Please upload a PNG, JPEG, or WEBP image.',
  tooLarge: 'Image is too large. Please choose a smaller file.',
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

export default function UploadControl({
  redirectOnSelect = true,
  title = 'Drop an image to start',
  description = 'Drag & drop your photo here, or click to browse from your device.',
}: UploadControlProps) {
  const router = useRouter()
  const { setUpload } = useUpload()
  const [message, setMessage] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleSelectedFile(file: File | null) {
    if (!file) {
      setUpload(null)
      setMessage(null)
      return
    }

    const validationError = validateFile(file)
    if (validationError) {
      setUpload(null)
      setMessage(validationError)
      return
    }

    setMessage(null)
    setUpload(file)

    if (redirectOnSelect) {
      router.push('/workshop')
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    handleSelectedFile(event.target.files?.[0] ?? null)
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
    handleSelectedFile(event.dataTransfer.files?.[0] ?? null)
  }

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }

  return (
    <section className="upload-control" aria-labelledby="upload-control-title">
      <input
        id="cartoonify-image-input"
        className="visually-hidden"
        name="image"
        type="file"
        accept={ALLOWED_MIME_TYPES.join(',')}
        aria-describedby="cartoonify-upload-help cartoonify-upload-message"
        onChange={handleFileChange}
      />

      <label
        htmlFor="cartoonify-image-input"
        className="upload-dropzone"
        data-dragging={isDragging ? 'true' : 'false'}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <span className="upload-dropzone-eyebrow">Step 1 • Upload</span>
        <h2 id="upload-control-title">{title}</h2>
        <p>{description}</p>
        <span className="upload-dropzone-button">Browse files</span>
      </label>

      <p id="cartoonify-upload-help" className="upload-help">
        Supported: PNG, JPEG, WEBP • Max size: {Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB
      </p>

      <p id="cartoonify-upload-message" className="upload-message" aria-live="polite" role="status">
        {message}
      </p>
    </section>
  )
}

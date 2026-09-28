'use client'

import { useMemo, useState } from 'react'
import type { CartoonStyle } from '@/lib/cartoon-styles'

export default function StyleCard({
  style,
  checked,
  disabled,
  onSelect,
}: {
  style: CartoonStyle
  checked: boolean
  disabled: boolean
  onSelect: (id: string) => void
}) {
  const previewSources = useMemo(
    () => ['/style-samples/' + style.id + '.webp', '/styles/' + style.id + '.webp'],
    [style.id]
  )
  const [sourceIndex, setSourceIndex] = useState(0)
  const currentPreviewSource = previewSources[sourceIndex]

  return (
    <label className="style-card" data-style-group={style.group ?? undefined}>
      <input
        type="radio"
        name="style"
        value={style.id}
        checked={checked}
        disabled={disabled}
        onChange={() => onSelect(style.id)}
      />
      {currentPreviewSource ? (
        <img
          className="style-card-preview"
          src={currentPreviewSource}
          alt={style.name + ' style preview'}
          width={320}
          height={320}
          loading="lazy"
          onError={() => setSourceIndex((prev) => prev + 1)}
        />
      ) : null}
      <span className="style-card-name">{style.name}</span>
      <span className="style-card-description">{style.description}</span>
    </label>
  )
}

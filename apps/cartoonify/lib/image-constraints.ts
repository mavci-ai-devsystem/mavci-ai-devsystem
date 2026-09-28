/**
 * Single source of truth for the image upload contract used by both
 * components/cartoonify-form.tsx (client) and app/api/cartoonify/route.ts
 * (server). Neither of those files may restate a MIME string or a byte
 * number of its own — see criterion 22.
 *
 * Pure constants and pure functions only. No secrets. Safe to bundle
 * client-side.
 */

/**
 * The upstream model this feature calls on /v1/images/edits.
 *
 * It lives here, not at the call site, because the allow-list below is a
 * property OF THIS MODEL and nothing else. System finding 10: the two were
 * declared in different files by different concerns, agreed only by
 * coincidence, and swapping the model would have left validation cheerfully
 * accepting uploads the endpoint rejects every time — presenting as an
 * intermittent outage, because the catch block returns the same generic
 * message it returns for a genuine one.
 */
export const IMAGE_MODEL = 'gpt-image-1'

/**
 * The rendering quality requested on /v1/images/edits.
 *
 * It is pinned here for the same reason IMAGE_MODEL is: left unset, the
 * upstream applies its own default of `auto` and the tier — and therefore the
 * per-image cost — is decided by the provider, silently and per call. An
 * unstated default is not a choice; this is.
 *
 * The union is narrower than the SDK's own `ImageEditParams['quality']`, which
 * also admits 'standard', 'auto' and null. Those are excluded deliberately:
 * 'standard' belongs to dall-e-2, and 'auto' is the unpinned behaviour this
 * constant exists to remove.
 */
export type ImageQuality = 'low' | 'medium' | 'high'

export const IMAGE_QUALITY: ImageQuality = 'medium'

/**
 * What each upstream model actually accepts on /v1/images/edits.
 *
 * Changing IMAGE_MODEL now changes the allow-list, the client's `accept`
 * attribute and the server's check together, so the drift finding 10
 * describes is not merely unlikely — it cannot be expressed.
 */
const MODEL_ACCEPTS = {
  'gpt-image-1': ['image/png', 'image/jpeg', 'image/webp'],
  'dall-e-2': ['image/png'],
} as const

/** The only MIME types this feature accepts, in either direction. */
export const ALLOWED_MIME_TYPES = MODEL_ACCEPTS[IMAGE_MODEL]

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/**
 * 4 MiB, not a rounder number, because Vercel caps a serverless function
 * request body at 4.5 MB. A larger ceiling would pass locally and fail only
 * in production. Do not raise it.
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4194304

/**
 * What the sniffer can RECOGNISE, which is a property of the magic-byte
 * tables below and not of the model. It is deliberately wider than
 * ALLOWED_MIME_TYPES: under a narrower model a JPEG is still correctly
 * identified as a JPEG and then refused by the allow-list, rather than
 * being unrecognisable.
 */
const DETECTABLE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type DetectableMimeType = (typeof DETECTABLE_MIME_TYPES)[number]

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]

function bytesStartWith(bytes: Uint8Array, magic: number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false
  }
  return true
}

/**
 * Reads magic bytes to determine the real image type. The `type` field on a
 * FormData file is supplied by the client and is not evidence — this is.
 */
export function sniffImageType(bytes: Uint8Array): DetectableMimeType | null {
  if (bytesStartWith(bytes, PNG_MAGIC)) return 'image/png'
  if (bytesStartWith(bytes, JPEG_MAGIC)) return 'image/jpeg'
  if (bytesStartWith(bytes, RIFF_MAGIC) && bytesStartWith(bytes, WEBP_MAGIC, 8)) {
    return 'image/webp'
  }
  return null
}

const FILE_EXTENSIONS: Record<DetectableMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * The filename sent in the multipart upload.
 *
 * An extensionless filename is a known trigger for upstream 400
 * invalid_request_error responses about file format, independent of the
 * declared MIME type (system finding 10, closing section). The upload was
 * previously named 'upload' with no extension.
 */
export function uploadFilename(type: DetectableMimeType): string {
  return 'upload.' + FILE_EXTENSIONS[type]
}

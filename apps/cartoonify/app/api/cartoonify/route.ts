import OpenAI, { toFile } from 'openai'
import {
  DEFAULT_CARTOON_STYLE_ID,
  getCartoonStyle,
  isCartoonStyleId,
  MAX_STYLES_PER_REQUEST,
} from '@/lib/cartoon-styles'
import { getEnv, hasOpenAIKey } from '@/lib/env'
import {
  ALLOWED_MIME_TYPES,
  IMAGE_MODEL,
  IMAGE_QUALITY,
  MAX_FILE_BYTES,
  sniffImageType,
  uploadFilename,
} from '@/lib/image-constraints'

// Rendered per request, never cached — this route calls a paid upstream API
// with visitor-supplied bytes. next.route_force_dynamic.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Derived from maxDuration so the transport budget cannot drift from the
// route's own ceiling again — see task 0002 finding 11. Never a literal.
const UPSTREAM_TIMEOUT_MS = Math.floor(maxDuration * 1000 * 0.75)
const PROBE_TIMEOUT_MS = Math.floor(maxDuration * 1000 * 0.1)
const UPSTREAM_MAX_RETRIES = 0

type ErrorCode =
  | 'NO_FILE'
  | 'INVALID_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_STYLE'
  | 'MISSING_API_KEY'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_UNREACHABLE'

// Fixed Turkish constants, one per code. Never the upstream error text, never
// a caught exception's detail, never the key name — see §5.2 of the spec on
// why MISSING_API_KEY does not name the environment variable.
const ERROR_MESSAGES: Record<ErrorCode, string> = {
  NO_FILE: 'Bir görsel seçmediniz. Lütfen bir dosya yükleyin.',
  INVALID_TYPE: 'Bu dosya türü desteklenmiyor. Lütfen PNG, JPEG veya WEBP formatında bir görsel yükleyin.',
  FILE_TOO_LARGE: 'Görsel çok büyük. Lütfen daha küçük bir dosya seçin.',
  INVALID_STYLE: 'Seçtiğiniz karikatür stili geçersiz. Lütfen listeden bir stil seçin.',
  MISSING_API_KEY: 'Hizmet şu anda kullanılamıyor. Lütfen daha sonra tekrar deneyin.',
  UPSTREAM_ERROR: 'Karikatür servisi bu isteği işleyemedi. Sorunun nedeni bilinmiyor; aynı isteği tekrar denemek sonucu değiştirmeyebilir.',
  UPSTREAM_UNREACHABLE: 'Karikatür servisine ulaşılamadı. Sorun geçici olabilir; bir süre sonra tekrar deneyebilirsiniz.',
}

function errorResponse(code: ErrorCode, status: number): Response {
  return Response.json(
    { ok: false, code, message: ERROR_MESSAGES[code] },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request): Promise<Response> {
  // 1. Reject oversized requests before ever touching the body.
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > MAX_FILE_BYTES + 65536) {
    return errorResponse('FILE_TOO_LARGE', 400)
  }

  // 2. Parse the form; no `image` field or not a file → NO_FILE.
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return errorResponse('NO_FILE', 400)
  }

  const field = form.get('image')
  if (!(field instanceof File)) {
    return errorResponse('NO_FILE', 400)
  }
  const file = field

  // 3. Byte ceiling, checked against the real upload, not just the header.
  if (file.size > MAX_FILE_BYTES) {
    return errorResponse('FILE_TOO_LARGE', 400)
  }

  // 4. The declared MIME type is client-supplied and not evidence on its own,
  //    but a value outside the allow-list is rejected before we even read
  //    the bytes.
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return errorResponse('INVALID_TYPE', 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // 5. Magic-byte sniffing is the real control: the declared type must agree
  //    with what the bytes actually are.
  const sniffed = sniffImageType(bytes)
  if (sniffed === null || sniffed !== file.type) {
    return errorResponse('INVALID_TYPE', 400)
  }

  // 6. The style is an id, never prompt text. An absent field is the
  //    pre-styles contract and gets the default; a present one must be in the
  //    allow-list, so no caller can steer the upstream prompt.
  //
  //    form.getAll, not form.get: FormData.get silently returns the first of
  //    N repeated fields, which would leave MAX_STYLES_PER_REQUEST an
  //    accident of an API's behaviour rather than an enforced decision. This
  //    cap bounds amplification — how many upstream generations one accepted
  //    request can cause — and is not a rate limit: it says nothing about how
  //    many requests one caller may send. See ADR 0006.
  const styleFields = form.getAll('style')
  if (styleFields.length > MAX_STYLES_PER_REQUEST) {
    return errorResponse('INVALID_STYLE', 400)
  }
  const styleField = styleFields.length > 0 ? styleFields[0] : null
  let styleId = DEFAULT_CARTOON_STYLE_ID
  if (styleField !== null) {
    if (!isCartoonStyleId(styleField)) {
      return errorResponse('INVALID_STYLE', 400)
    }
    styleId = styleField
  }
  const style = getCartoonStyle(styleId)

  // 7. Only now does the key check happen — every validation failure above
  //    is observable with no key configured at all.
  if (!hasOpenAIKey()) {
    return errorResponse('MISSING_API_KEY', 503)
  }

  try {
    // 8. Client and key are constructed here, inside the handler, never at
    //    module scope (criteria 3 and 10).
    const client = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: UPSTREAM_TIMEOUT_MS,
      maxRetries: UPSTREAM_MAX_RETRIES,
    })
    const uploadable = await toFile(bytes, uploadFilename(sniffed), { type: sniffed })

    const result = await client.images.edit({
      image: uploadable,
      model: IMAGE_MODEL,
      prompt: style.prompt,
      size: '1024x1024',
      quality: IMAGE_QUALITY,
    })

    const b64 = result.data?.[0]?.b64_json

    // 9. Any thrown error or empty result becomes a generic upstream failure.
    if (!b64) {
      return errorResponse('UPSTREAM_ERROR', 502)
    }

    // 10. Success.
    return Response.json(
      { ok: true, image: `data:image/png;base64,${b64}` },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (unknownError) {
    // Logged server-side for operators; never forwarded to the response body.
    console.error('cartoonify: upstream call failed', unknownError)

    if (unknownError instanceof OpenAI.APIConnectionError) {
      await logSmallBodyProbe()
      return errorResponse('UPSTREAM_UNREACHABLE', 502)
    }

    return errorResponse('UPSTREAM_ERROR', 502)
  }
}

// A large multipart upload can be cut mid-request by a provider that has
// already computed a rejection, so a transport error alone is not evidence of
// a transport problem (finding 12). This probe asks a small request what the
// large one structurally cannot: did any HTTP response arrive at all? It is
// diagnostics only — logged server-side, never surfaced to the caller — and
// it must never throw, since a probe failure must not replace the designed
// 502 with an unhandled error.
async function logSmallBodyProbe(): Promise<void> {
  try {
    const probeClient = new OpenAI({
      apiKey: getEnv().OPENAI_API_KEY,
      timeout: PROBE_TIMEOUT_MS,
      maxRetries: 0,
    })
    await probeClient.models.list()
    console.error('cartoonify: upstream probe result=reached status=200')
  } catch (probeError) {
    if (probeError instanceof OpenAI.APIConnectionError) {
      console.error('cartoonify: upstream probe result=unreachable', probeError)
    } else {
      const status = probeError instanceof OpenAI.APIError ? probeError.status : 'unknown'
      console.error('cartoonify: upstream probe result=reached status=' + String(status), probeError)
    }
  }
}

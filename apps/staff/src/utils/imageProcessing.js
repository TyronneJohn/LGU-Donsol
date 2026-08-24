// Automated, non-AI pre-upload validation for site monitoring photos:
// format/size validation, dimension + EXIF/GPS extraction, and basic
// objective quality checks (resolution / brightness / sharpness). Everything
// here is computed directly from the file's own bytes and pixels in the
// browser, using only the standard File/Image/Canvas APIs — no machine
// learning, no external service, no API key.
//
// This only gates whether a photo gets uploaded at all (see
// ProjectMonitoringDetail.jsx's handleSubmitUpdate) — its result is never
// written to ai_analysis_result. The real Gemini-backed AI analysis of an
// uploaded photo happens server-side afterwards, via
// supabase/functions/analyze-project-image and src/utils/imageAnalysis.js,
// which is what actually populates public.ai_analysis_status /
// ai_analysis_result.

export const IMAGE_STAGE_LABELS = {
  BEFORE: 'Before',
  DURING: 'During',
  AFTER: 'After',
  ISSUE: 'Issue',
  OTHER: 'Other',
}

// project_images rows are inserted with PENDING, then flipped to PROCESSED
// or FAILED once analyze-project-image (Gemini) finishes — see
// ProjectMonitoringDetail.jsx and src/utils/imageAnalysis.js.
export const IMAGE_PROCESSING_STATUS_LABELS = {
  PENDING: 'Processing',
  PROCESSED: 'Complete',
  FAILED: 'Failed',
  NOT_APPLICABLE: 'Not available',
}

export function getProcessingStatusTone(status) {
  switch (status) {
    case 'PROCESSED':
      return 'green'
    case 'FAILED':
      return 'red'
    case 'PENDING':
      return 'blue'
    case 'NOT_APPLICABLE':
    default:
      return 'neutral'
  }
}

export const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // 8 MB

const LOW_RESOLUTION_WIDTH = 640
const LOW_RESOLUTION_HEIGHT = 480
const DARK_BRIGHTNESS_THRESHOLD = 40 // mean luminance, 0-255 scale
const BRIGHT_BRIGHTNESS_THRESHOLD = 215
// Heuristic starting point for the variance-of-Laplacian sharpness estimate
// below — not tuned against a labeled set of real site photos. Revisit if it
// proves too strict/lenient in practice.
const BLUR_VARIANCE_THRESHOLD = 60
const SAMPLE_MAX_DIMENSION = 300 // downsample target for brightness/sharpness sampling
// EXIF lives near the start of a JPEG (each segment is capped at 64 KB by
// the format itself), so only the leading bytes need to be read — avoids
// pulling the whole (up to 8 MB) file into memory just to inspect its header.
const EXIF_SCAN_BYTES = 128 * 1024

function validateFile(file) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return `Unsupported format (${file.type || 'unknown'}). Only JPEG, PNG, and WebP are supported.`
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum supported size is 8 MB.`
  }
  if (file.size === 0) {
    return 'File is empty.'
  }
  return null
}

function readImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, objectUrl })
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image could not be opened or read. The file may be corrupted.'))
    }
    img.src = objectUrl
  })
}

function samplePixels(img) {
  const scale = Math.min(1, SAMPLE_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, width, height)

  try {
    const imageData = ctx.getImageData(0, 0, width, height)
    return { data: imageData.data, width, height }
  } catch {
    // Best-effort only — if the canvas can't be read back for any reason,
    // brightness/sharpness are simply omitted rather than failing the whole
    // processing result.
    return null
  }
}

function toGrayscale(data, width, height) {
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return gray
}

function computeBrightness(gray) {
  let sum = 0
  for (let i = 0; i < gray.length; i++) sum += gray[i]
  return sum / gray.length
}

// Classic "variance of Laplacian" sharpness estimate: a fixed, deterministic
// edge-detection filter (not a learned/AI model). Low variance across the
// filtered image means few sharp edges were found, which suggests a blurry
// photo.
function computeSharpnessVariance(gray, width, height) {
  const laplacian = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      laplacian.push(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width])
    }
  }
  if (laplacian.length === 0) return 0
  const mean = laplacian.reduce((a, b) => a + b, 0) / laplacian.length
  return laplacian.reduce((a, b) => a + (b - mean) * (b - mean), 0) / laplacian.length
}

// ---- EXIF / GPS, parsed directly from the file's raw bytes (JPEG only —
// PNG/WebP don't carry EXIF in a comparably standard way, so gps/camera
// fields are simply omitted for those formats). Hand-written parser, no
// library: covers standard single-segment little/big-endian EXIF, which is
// what the vast majority of phone/camera JPEGs use. Absence of EXIF, or an
// exotic/malformed layout this parser doesn't recognize, is treated as "no
// EXIF available" rather than a processing failure. ----------------------

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function readIfd(view, tiffStart, ifdOffset, little, isGps) {
  const get16 = (o) => view.getUint16(o, little)
  const get32 = (o) => view.getUint32(o, little)
  const count = get16(ifdOffset)
  const tags = {}

  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12
    const tag = get16(entryOffset)
    const type = get16(entryOffset + 2)
    const numValues = get32(entryOffset + 4)
    const valueSize = (TYPE_SIZES[type] ?? 1) * numValues
    const valueOffset = valueSize > 4 ? tiffStart + get32(entryOffset + 8) : entryOffset + 8

    if (type === 2) {
      let text = ''
      for (let b = 0; b < numValues - 1; b++) text += String.fromCharCode(view.getUint8(valueOffset + b))
      tags[tag] = { text }
    } else if (isGps && type === 5) {
      const rationals = []
      for (let r = 0; r < numValues; r++) {
        const num = get32(valueOffset + r * 8)
        const den = get32(valueOffset + r * 8 + 4)
        rationals.push(den === 0 ? 0 : num / den)
      }
      tags[tag] = { rationals }
    } else if (numValues === 1 && (type === 3 || type === 4)) {
      tags[tag] = { value: type === 3 ? get16(valueOffset) : get32(valueOffset) }
    }
  }
  return { tags }
}

function dmsToDecimal([degrees = 0, minutes = 0, seconds = 0]) {
  return degrees + minutes / 60 + seconds / 3600
}

function parseTiff(view, tiffStart) {
  const little = view.getUint16(tiffStart) === 0x4949
  const get32 = (o) => view.getUint32(o, little)

  const ifd0Offset = get32(tiffStart + 4)
  const ifd0 = readIfd(view, tiffStart, tiffStart + ifd0Offset, little, false)

  const result = {
    make: ifd0.tags[0x010f]?.text?.trim() || null,
    model: ifd0.tags[0x0110]?.text?.trim() || null,
    orientation: ifd0.tags[0x0112]?.value ?? null,
    dateTime: ifd0.tags[0x0132]?.text?.trim() || null,
    gps: null,
  }

  const exifIfdOffset = ifd0.tags[0x8769]?.value
  if (typeof exifIfdOffset === 'number') {
    const exifIfd = readIfd(view, tiffStart, tiffStart + exifIfdOffset, little, false)
    const dateTimeOriginal = exifIfd.tags[0x9003]?.text?.trim()
    if (dateTimeOriginal) result.dateTime = dateTimeOriginal
  }

  const gpsIfdOffset = ifd0.tags[0x8825]?.value
  if (typeof gpsIfdOffset === 'number') {
    const gpsIfd = readIfd(view, tiffStart, tiffStart + gpsIfdOffset, little, true)
    const lat = gpsIfd.tags[2]?.rationals
    const latRef = gpsIfd.tags[1]?.text
    const lon = gpsIfd.tags[4]?.rationals
    const lonRef = gpsIfd.tags[3]?.text
    if (lat && lon) {
      result.gps = {
        latitude: dmsToDecimal(lat) * (latRef === 'S' ? -1 : 1),
        longitude: dmsToDecimal(lon) * (lonRef === 'W' ? -1 : 1),
      }
    }
  }

  return result
}

function readExif(buffer) {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null // not a JPEG (SOI marker)

  let offset = 2
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) break
    if (marker === 0xffda) break // Start of Scan — image data follows, no more markers
    const segmentLength = view.getUint16(offset + 2)
    if (marker === 0xffe1) {
      const exifStart = offset + 4
      if (
        exifStart + 6 <= view.byteLength &&
        view.getUint32(exifStart) === 0x45786966 && // "Exif"
        view.getUint16(exifStart + 4) === 0x0000
      ) {
        try {
          return parseTiff(view, exifStart + 6)
        } catch {
          return null // malformed/unrecognized EXIF layout — treat as unavailable
        }
      }
    }
    offset += 2 + segmentLength
  }
  return null
}

// ---- Public entry point --------------------------------------------------

// Never throws — every path resolves to { status, result }. status is one
// of 'PROCESSED' | 'FAILED', matching public.ai_analysis_status.
export async function processImageFile(file) {
  const validationError = validateFile(file)
  if (validationError) {
    return { status: 'FAILED', result: { error: validationError, failed_at: new Date().toISOString() } }
  }

  let img
  let objectUrl
  try {
    ;({ img, objectUrl } = await readImageElement(file))
  } catch (err) {
    return { status: 'FAILED', result: { error: err.message, failed_at: new Date().toISOString() } }
  }

  try {
    const width = img.naturalWidth
    const height = img.naturalHeight

    const checks = {
      resolution: width < LOW_RESOLUTION_WIDTH || height < LOW_RESOLUTION_HEIGHT ? 'Low resolution' : 'Pass',
      brightness: 'Not evaluated',
      sharpness: 'Not evaluated',
    }

    const sample = samplePixels(img)
    if (sample) {
      const gray = toGrayscale(sample.data, sample.width, sample.height)
      const brightness = computeBrightness(gray)
      checks.brightness =
        brightness < DARK_BRIGHTNESS_THRESHOLD
          ? 'Too dark'
          : brightness > BRIGHT_BRIGHTNESS_THRESHOLD
            ? 'Too bright'
            : 'Pass'

      const sharpnessVariance = computeSharpnessVariance(gray, sample.width, sample.height)
      checks.sharpness = sharpnessVariance < BLUR_VARIANCE_THRESHOLD ? 'Possibly blurry' : 'Pass'
    }

    let exif = null
    if (file.type === 'image/jpeg') {
      try {
        exif = readExif(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer())
      } catch {
        exif = null // EXIF parsing is best-effort; absence is not a processing failure
      }
    }

    const result = {
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      width,
      height,
      gps_metadata_available: Boolean(exif?.gps),
      gps: exif?.gps ?? null,
      camera_make: exif?.make ?? null,
      camera_model: exif?.model ?? null,
      captured_at: exif?.dateTime ?? (file.lastModified ? new Date(file.lastModified).toISOString() : null),
      checks,
      processed_at: new Date().toISOString(),
    }

    return { status: 'PROCESSED', result }
  } catch (err) {
    return {
      status: 'FAILED',
      result: { error: err?.message ?? 'Image processing failed.', failed_at: new Date().toISOString() },
    }
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

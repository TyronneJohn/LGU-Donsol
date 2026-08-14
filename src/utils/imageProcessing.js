// Real (non-AI) client-side image processing for site monitoring photos:
// reads actual pixel dimensions and combines them with the file's own
// metadata. The result is stored as project_images.ai_analysis_result with
// ai_analysis_status = 'PROCESSED', which the DB (guard_project_image_updates)
// locks down after insert so it can't be edited later by the uploader.

export function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        size_bytes: file.size,
        mime_type: file.type || null,
        file_captured_at: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        processed_at: new Date().toISOString(),
      })
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`Could not read "${file.name}" as an image.`))
    }

    img.src = objectUrl
  })
}

export function formatImageMetadata(result) {
  if (!result || !result.width || !result.height) return null
  const sizeMb = result.size_bytes ? (result.size_bytes / (1024 * 1024)).toFixed(1) : null
  return sizeMb ? `${result.width}×${result.height} · ${sizeMb} MB` : `${result.width}×${result.height}`
}

// Upload rules for project documents (the project-documents bucket):
// Engineering's Program of Works and technical documents, and the Admin
// edit dialog. The size limit is also enforced by the bucket itself
// (20261011120000_project_documents_upload_limits.sql) — keep them in sync.

export const ALLOWED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png']

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

// For the file picker's `accept` attribute, so the dialog only offers
// allowed files in the first place.
export const DOCUMENT_ACCEPT = ALLOWED_DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`).join(',')

export const DOCUMENT_RULES_TEXT = 'PDF, Word, Excel, JPG or PNG — up to 20 MB each.'

function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}

// Why a file can't be uploaded, or null if it's fine.
export function documentRejectionReason(file) {
  if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extensionOf(file.name))) {
    return 'file type not allowed'
  }
  if (file.size > MAX_DOCUMENT_BYTES) return 'larger than 20 MB'
  if (file.size === 0) return 'file is empty'
  return null
}

// Validates a picker's selection. If any file breaks the rules, the whole
// selection is refused (the picker is cleared and a toast names each bad
// file) so what the input shows always matches what will be uploaded.
// Returns the accepted files, or [] when refused.
export function pickDocuments(event, toast) {
  const files = Array.from(event.target.files ?? [])
  const rejected = files
    .map((file) => ({ file, reason: documentRejectionReason(file) }))
    .filter((entry) => entry.reason)

  if (rejected.length === 0) return files

  event.target.value = ''
  toast.error(
    rejected.length === 1 ? 'File not allowed' : 'Some files are not allowed',
    `${rejected.map((entry) => `${entry.file.name}: ${entry.reason}`).join('; ')}. Allowed: ${DOCUMENT_RULES_TEXT}`,
  )
  return []
}

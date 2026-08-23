// Browsers can render PDFs and common image formats natively when opened
// directly — nothing else here needs help. Word/Excel/PowerPoint have no
// built-in browser renderer at all (they always force a download,
// regardless of the URL/headers), so those are instead routed through
// Microsoft's free Office Online Viewer, which can render a preview of the
// file in-browser given just a URL to fetch it from. A Supabase signed URL
// works fine as that URL — the signature in the query string IS the access
// grant, no extra auth header required, so Microsoft's server can fetch it
// directly just like a browser would.
const OFFICE_VIEWER_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'])

function getExtension(fileName) {
  return fileName?.split('.').pop()?.toLowerCase() ?? ''
}

/**
 * Returns the URL "View" should actually open: the file's own signed URL
 * for anything a browser can render natively, or a Microsoft Office Online
 * Viewer URL wrapping it for Word/Excel/PowerPoint. Anything else (a format
 * with no browser renderer and no Office viewer support) falls back to the
 * raw signed URL — the browser will just download it, same as before.
 */
export function getDocumentViewUrl(signedUrl, fileName) {
  const ext = getExtension(fileName)
  if (OFFICE_VIEWER_EXTENSIONS.has(ext)) {
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(signedUrl)}`
  }
  return signedUrl
}

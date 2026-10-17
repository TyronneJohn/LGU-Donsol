import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { formatDate } from '../utils/format'

// Public pages only ever receive BEFORE/DURING/AFTER photos
// (get_public_project_transparency()); ISSUE/OTHER are staff-only.
const PHOTO_STAGE_LABELS = { BEFORE: 'Before', DURING: 'During', AFTER: 'After', ISSUE: 'Issue', OTHER: 'Other' }

function photoAlt(photo) {
  return `${PHOTO_STAGE_LABELS[photo.image_stage] ?? 'Site'} photo, ${formatDate(photo.captured_at)}`
}

function photoCaption(photo) {
  const stage = PHOTO_STAGE_LABELS[photo.image_stage]
  return `${stage ? `${stage} · ` : ''}${formatDate(photo.captured_at)}`
}

// Full-screen view of one stage's photos, opened from the map pin's photo
// gallery (PinPhotoGallery). Portaled to <body> at z-1100 so it sits above
// both the project modal and Leaflet's own layers. Keys are caught in the
// capture phase so Esc closes only this, not the project modal under it.
export default function PhotoViewerDialog({ title, photos, startIndex, reportLabels, onClose }) {
  const [index, setIndex] = useState(startIndex)
  const photo = photos[index]
  const step = (delta) => setIndex((i) => (i + delta + photos.length) % photos.length)

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowRight') {
        setIndex((i) => (i + 1) % photos.length)
      } else if (event.key === 'ArrowLeft') {
        setIndex((i) => (i - 1 + photos.length) % photos.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [photos.length, onClose])

  const reportLabel = reportLabels?.get(photo.project_update_id)

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close project photos"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-project-photos-title"
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2
              id="public-project-photos-title"
              className="flex items-center gap-1.5 text-base font-semibold text-slate-800"
            >
              <Camera className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
              Project Photos
            </h2>
            <p className="mt-0.5 truncate text-xs text-slate-500">{title}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
          <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-900">
            <img src={photo.signedUrl} alt={photoAlt(photo)} className="max-h-[68vh] w-auto max-w-full object-contain" />
            {photos.length > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() => step(-1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-slate-700 shadow hover:bg-white"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => step(1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1.5 text-slate-700 shadow hover:bg-white"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {reportLabel ? `${reportLabel} · ` : ''}
              {photoCaption(photo)}
            </span>
            <span className="tabular-nums">
              {index + 1} / {photos.length}
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

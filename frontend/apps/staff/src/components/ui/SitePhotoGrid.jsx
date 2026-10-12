import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronLeft, ChevronRight, Info, X } from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import { formatDateTime } from '@shared/utils/format'
import { IMAGE_STAGE_LABELS } from '../../utils/imageProcessing'

function DetailRow({ label, children }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-slate-700">{children}</dd>
    </div>
  )
}

// The photo's own record details — shown in the photo viewer's (i) popover.
function PhotoDetails({ image, stageLabel }) {
  return (
    <dl className="space-y-1.5">
      {stageLabel ? <DetailRow label="Stage">{stageLabel}</DetailRow> : null}
      <DetailRow label="File name">{image.file_name || 'No file name recorded'}</DetailRow>
      {image.created_at ? <DetailRow label="Uploaded">{formatDateTime(image.created_at)}</DetailRow> : null}
      {image.uploader?.full_name ? <DetailRow label="Uploaded by">{image.uploader.full_name}</DetailRow> : null}
      {image.latitude != null && image.longitude != null ? (
        <DetailRow label="Location">
          <a
            href={`https://www.google.com/maps?q=${image.latitude},${image.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {Number(image.latitude).toFixed(6)}, {Number(image.longitude).toFixed(6)}
          </a>
        </DetailRow>
      ) : (
        <DetailRow label="Location">No GPS recorded</DetailRow>
      )}
    </dl>
  )
}

// In-app photo viewer — photos open over the page instead of in a new
// browser tab, so the user never leaves the system. Arrow keys / buttons step
// through the other photos in the same grid; Escape or the backdrop closes.
// Portaled to <body> at the same z-index as ConfirmDialog so it sits above
// Leaflet's map panes and controls on pages that also show a map.
//
// The photo is stretched to a large viewing area (up to 1024px wide and 80%
// of the screen height), even when the file itself is smaller than that
// (many uploads are low-resolution images well under the screen size). The
// dialog itself is click-through so the dark area around the photo still
// closes it.
//
// The (i) button toggles a small popover right under it with the photo's
// details. It stays open while stepping through photos so a reviewer can check each
// photo's details in turn.
function PhotoViewer({
  images,
  index,
  onIndexChange,
  detailsOpen,
  onDetailsOpenChange,
  onClose,
}) {
  const image = images[index]
  const hasMultiple = images.length > 1

  const showPrevious = useCallback(
    () => onIndexChange((index - 1 + images.length) % images.length),
    [index, images.length, onIndexChange],
  )
  const showNext = useCallback(
    () => onIndexChange((index + 1) % images.length),
    [index, images.length, onIndexChange],
  )

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowLeft' && hasMultiple) showPrevious()
      else if (event.key === 'ArrowRight' && hasMultiple) showNext()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [hasMultiple, onClose, showPrevious, showNext])

  // The <img> box fills the whole area and object-contain letterboxes the
  // picture inside it, so a click on the <img> may actually land on the dark
  // bars beside the picture. Treat those like a backdrop click.
  function handleImageClick(event) {
    const img = event.currentTarget
    if (!img.naturalWidth || !img.naturalHeight) return
    const box = img.getBoundingClientRect()
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight)
    const width = img.naturalWidth * scale
    const height = img.naturalHeight * scale
    const x = event.clientX - box.left - (box.width - width) / 2
    const y = event.clientY - box.top - (box.height - height) / 2
    if (x < 0 || y < 0 || x > width || y > height) onClose()
  }

  if (!image) return null
  const stageLabel = IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage
  const photoLabel = `${stageLabel ? `${stageLabel} photo` : 'Site photo'}${hasMultiple ? ` ${index + 1} of ${images.length}` : ''}`

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center p-2 sm:p-4">
      <button type="button" aria-label="Close photo" onClick={onClose} className="fixed inset-0 bg-slate-950/95" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={photoLabel}
        className="pointer-events-none relative flex h-full w-full flex-col items-center gap-2"
      >
        <div className="relative z-10 flex w-full items-center justify-between gap-3 text-sm text-white">
          <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            {stageLabel ? <Badge tone="neutral">{stageLabel}</Badge> : null}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {hasMultiple ? (
              <span className="text-xs text-white/70">
                {index + 1} / {images.length}
              </span>
            ) : null}
            <div className="relative">
              <button
                type="button"
                onClick={() => onDetailsOpenChange(!detailsOpen)}
                aria-label={detailsOpen ? 'Hide photo details' : 'Show photo details'}
                aria-expanded={detailsOpen}
                title={detailsOpen ? 'Hide photo details' : 'Show photo details'}
                className={`rounded-md p-1.5 hover:bg-white/15 ${detailsOpen ? 'bg-white/15' : ''}`}
              >
                <Info className="h-5 w-5" aria-hidden="true" />
              </button>
              {detailsOpen ? (
                <div
                  role="dialog"
                  aria-label="Photo details"
                  className="animate-pop-in absolute right-0 top-full z-10 mt-2 w-72 max-w-[calc(100vw-1rem)] space-y-2 rounded-xl bg-white p-4 shadow-2xl ring-1 ring-slate-900/10 sm:w-80"
                >
                  <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Photo details</h2>
                  <PhotoDetails image={image} stageLabel={stageLabel} />
                </div>
              ) : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 hover:bg-white/15">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center">
          {image.signedUrl ? (
            <img
              src={image.signedUrl}
              alt={photoLabel}
              title={image.file_name || undefined}
              onClick={handleImageClick}
              className="pointer-events-auto h-full max-h-[80vh] w-full object-contain"
            />
          ) : (
            <div className="pointer-events-auto flex h-64 w-full items-center justify-center rounded-lg bg-slate-800 text-sm text-slate-300">
              Photo could not be loaded.
            </div>
          )}

          {hasMultiple ? (
            <>
              <button
                type="button"
                onClick={showPrevious}
                aria-label="Previous photo"
                className="pointer-events-auto absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white hover:bg-slate-900/80"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={showNext}
                aria-label="Next photo"
                className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-900/60 p-2 text-white hover:bg-slate-900/80"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Site-photo grid: thumbnail + stage. Shared by Engineering's monitoring
// detail page, MPDC's read-only monitoring view, and Admin's project
// oversight page. AI analysis is one per monitoring update, not per photo —
// see components/UpdateComparison.jsx.
export default function SitePhotoGrid({ images }) {
  const [viewerIndex, setViewerIndex] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const closeViewer = useCallback(() => setViewerIndex(null), [])

  if (!images || images.length === 0) return null

  // Only photos that actually have a URL can be stepped through in the
  // viewer — a failed signed URL would just be a blank stop.
  const viewableImages = images.filter((image) => image.signedUrl)

  function openViewer(image) {
    setDetailsOpen(false)
    setViewerIndex(viewableImages.indexOf(image))
  }

  return (
    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 md:grid-cols-4">
      {images.map((image) => (
        <div key={image.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => openViewer(image)}
            disabled={!image.signedUrl}
            aria-label={`View ${image.file_name ?? 'site photo'}`}
            className="block w-full cursor-zoom-in disabled:cursor-default"
          >
            {image.signedUrl ? (
              <img
                src={image.signedUrl}
                alt={image.file_name ?? 'Site photo'}
                className="h-28 w-full object-cover"
              />
            ) : (
              <div className="flex h-28 w-full items-center justify-center bg-slate-100">
                <Camera className="h-6 w-6 text-slate-300" aria-hidden="true" />
              </div>
            )}
          </button>
          <div className="p-2">
            <Badge tone="neutral">{IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage}</Badge>
          </div>
        </div>
      ))}

      {viewerIndex != null ? (
        <PhotoViewer
          images={viewableImages}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          detailsOpen={detailsOpen}
          onDetailsOpenChange={setDetailsOpen}
          onClose={closeViewer}
        />
      ) : null}
    </div>
  )
}

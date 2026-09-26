import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import { formatDateTime } from '@shared/utils/format'
import {
  IMAGE_STAGE_LABELS,
  IMAGE_PROCESSING_STATUS_LABELS,
  getProcessingStatusTone,
} from '../../utils/imageProcessing'

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// Defensive re-validation of what's stored in ai_analysis_result — the
// analyze-project-image Edge Function already validates Gemini's response
// before saving it as PROCESSED, but this component never trusts stored data
// blindly on the way back out either.
function isValidAiResult(result) {
  return (
    result &&
    typeof result.observed_activity === 'string' &&
    isStringArray(result.visible_materials) &&
    typeof result.site_condition === 'string' &&
    isStringArray(result.potential_issues) &&
    typeof result.image_quality === 'string' &&
    typeof result.confidence === 'number' &&
    Number.isFinite(result.confidence) &&
    typeof result.observation === 'string'
  )
}

// analyze-project-image records why it gave up (missing API key, quota,
// safety block, unreadable file...) in result.error. Showing it is the
// difference between "the AI thing is broken again" and a reason someone can
// actually act on — a quota message means wait, a configuration one means an
// admin has to set the key.
function AnalysisFailure({ result, onRetry, retrying, compact = false }) {
  const reason = typeof result?.error === 'string' ? result.error : null
  const text = compact ? 'text-[11px]' : 'text-sm'
  return (
    <>
      <p className={`${text} text-red-600`}>AI analysis could not be completed.</p>
      {reason ? <p className={`${text} text-slate-500`}>{reason}</p> : null}
      <p className={`${text} text-slate-400`}>The uploaded photo is still available.</p>
      {onRetry ? (
        // Most of the reasons this fails are transient or fixable — a rate
        // limit, a timeout, a key an admin has since configured — but the
        // analysis only ever ran on upload, so without this the only way to
        // get one was to upload the photo again.
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={`inline-flex items-center gap-1 pt-0.5 ${text} font-medium text-blue-700 hover:text-blue-800 disabled:cursor-not-allowed disabled:text-slate-400`}
        >
          <RefreshCw
            className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} ${retrying ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {retrying ? 'Retrying...' : 'Retry analysis'}
        </button>
      ) : null}
    </>
  )
}

// Compact AI summary on each grid card: what the photo shows (two lines) and
// whether anything was flagged. The full, organized analysis lives in the
// photo viewer's side panel, next to the photo it describes, so a reviewer can
// check each claim against the picture — see AnalysisPanel below.
function AiSummary({ status, result, onRetry, retrying, onViewAnalysis }) {
  if (status === 'PENDING') {
    return <p className="text-[11px] text-slate-500">Processing image...</p>
  }

  if (status === 'FAILED') {
    return (
      <div className="space-y-0.5 border-t border-slate-100 pt-1.5">
        <AnalysisFailure result={result} onRetry={onRetry} retrying={retrying} compact />
      </div>
    )
  }

  if (status !== 'PROCESSED' || !isValidAiResult(result)) return null

  const issueCount = result.potential_issues.length

  return (
    <div className="space-y-1 border-t border-slate-100 pt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">AI-assisted observation</p>
      <p className="line-clamp-2 text-[11px] text-slate-600">{result.observed_activity}</p>
      <p className={`text-[11px] font-medium ${issueCount > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
        {issueCount > 0
          ? `${issueCount} potential ${issueCount === 1 ? 'issue' : 'issues'} noted`
          : 'No visible issues noted'}
      </p>
      {onViewAnalysis ? (
        <button
          type="button"
          onClick={onViewAnalysis}
          className="text-[11px] font-medium text-blue-700 hover:text-blue-800"
        >
          View analysis
        </button>
      ) : null}
    </div>
  )
}

function PanelSection({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

// The organized, full view of one photo's analysis. Ordered by what a
// reviewer acts on: what the photo shows, then anything flagged, then the
// supporting detail — with the model's standard "one photo can't prove much"
// caveat last, since it reads much the same on every photo.
function AnalysisBody({ result }) {
  const confidence = Math.round(Math.min(100, Math.max(0, result.confidence)))
  const issues = result.potential_issues

  return (
    <div className="space-y-5">
      <PanelSection title="Summary">
        <p className="text-sm leading-relaxed text-slate-700">{result.observed_activity}</p>
      </PanelSection>

      <PanelSection title="Potential issues">
        {issues.length > 0 ? (
          <ul className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            {issues.map((issue) => (
              <li key={issue} className="flex gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            No visible issues noted
          </p>
        )}
      </PanelSection>

      <PanelSection title="Confidence">
        <div className="flex items-center gap-3">
          <div
            role="meter"
            aria-label="AI confidence"
            aria-valuenow={confidence}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
          >
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${confidence}%` }} />
          </div>
          <span className="text-sm font-semibold text-slate-700">{confidence}%</span>
        </div>
        <p className="text-xs text-slate-400">Based only on how clearly the photo shows what is described.</p>
      </PanelSection>

      <PanelSection title="Site condition">
        <p className="text-sm text-slate-600">{result.site_condition}</p>
      </PanelSection>

      <PanelSection title="Visible materials">
        {result.visible_materials.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {result.visible_materials.map((material) => (
              <span key={material} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {material}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">None identifiable</p>
        )}
      </PanelSection>

      <PanelSection title="Image quality">
        <p className="text-sm text-slate-600">{result.image_quality}</p>
      </PanelSection>

      <PanelSection title="Limitations">
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{result.observation}</p>
      </PanelSection>
    </div>
  )
}

function DetailRow({ label, children }) {
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-24 shrink-0 text-slate-400">{label}</dt>
      <dd className="min-w-0 flex-1 break-all text-slate-700">{children}</dd>
    </div>
  )
}

// The analysis itself (whatever state it's in) plus the photo's own record
// details — shared by the "View analysis" dialog and the photo viewer's side
// panel. The file name lives here rather than on the card or the viewer
// header — it's usually camera noise (1000005503.jpg, Screenshot ...png) but
// still an audit signal (a "Screenshot", or a name pointing to another place,
// hints the photo isn't an original site shot).
function AnalysisContent({ image, stageLabel, onRetry, retrying }) {
  const status = image.ai_analysis_status
  const result = image.ai_analysis_result

  return (
    <>
      {status === 'PROCESSED' && isValidAiResult(result) ? (
        <AnalysisBody result={result} />
      ) : status === 'FAILED' ? (
        <div className="space-y-1">
          <AnalysisFailure result={result} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : status === 'PENDING' ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          Processing image...
        </p>
      ) : (
        <p className="text-sm text-slate-500">No AI analysis is available for this photo.</p>
      )}

      <PanelSection title="Photo details">
        <dl className="space-y-1.5">
          {stageLabel ? <DetailRow label="Stage">{stageLabel}</DetailRow> : null}
          <DetailRow label="File name">{image.file_name || 'No file name recorded'}</DetailRow>
          {image.created_at ? <DetailRow label="Uploaded">{formatDateTime(image.created_at)}</DetailRow> : null}
          {image.uploader?.full_name ? <DetailRow label="Uploaded by">{image.uploader.full_name}</DetailRow> : null}
        </dl>
      </PanelSection>
    </>
  )
}

function AnalysisFooter({ image }) {
  const result = image.ai_analysis_result
  const hasAnalysis = image.ai_analysis_status === 'PROCESSED' && isValidAiResult(result)
  const analyzedAt = hasAnalysis && typeof result.analyzed_at === 'string' ? result.analyzed_at : null
  const model = hasAnalysis && typeof result.model === 'string' ? result.model : null

  return (
    <div className="border-t border-slate-200 px-4 py-2.5">
      <p className="text-[11px] italic text-slate-400">
        AI-assisted observation only — not an official engineering inspection.
      </p>
      {analyzedAt || model ? (
        <p className="mt-0.5 text-[11px] text-slate-400">
          {[analyzedAt ? `Analyzed ${formatDateTime(analyzedAt)}` : null, model].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

// "View analysis" on a grid card: a compact dialog, card-shaped like the grid
// card itself (small photo on top, then the analysis) rather than the
// full-screen photo viewer. The photo preview still opens the full viewer for
// a closer look.
function AnalysisDialog({ image, onClose, onOpenPhoto, onRetry, retrying }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const stageLabel = IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close analysis"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Photo analysis and details"
        className="animate-pop-in relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="relative shrink-0">
          {image.signedUrl ? (
            <button
              type="button"
              onClick={onOpenPhoto}
              aria-label="View full photo"
              title="View full photo"
              className="block w-full cursor-zoom-in"
            >
              <img
                src={image.signedUrl}
                alt={stageLabel ? `${stageLabel} photo` : 'Site photo'}
                className="h-40 max-h-[25vh] w-full object-cover"
              />
            </button>
          ) : (
            <div className="flex h-24 w-full items-center justify-center bg-slate-100">
              <Camera className="h-6 w-6 text-slate-300" aria-hidden="true" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-2 top-2 rounded-full bg-slate-900/60 p-1.5 text-white hover:bg-slate-900/80"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-4 py-3">
          {stageLabel ? <Badge tone="neutral">{stageLabel}</Badge> : null}
          <Badge tone={getProcessingStatusTone(image.ai_analysis_status)}>
            AI Analysis: {IMAGE_PROCESSING_STATUS_LABELS[image.ai_analysis_status] ?? image.ai_analysis_status}
          </Badge>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <AnalysisContent image={image} stageLabel={stageLabel} onRetry={onRetry} retrying={retrying} />
        </div>

        <AnalysisFooter image={image} />
      </div>
    </div>,
    document.body,
  )
}

// Side panel of the photo viewer, toggled by its (i) button.
function AnalysisPanel({ image, stageLabel, onRetry, retrying, onClose }) {
  return (
    <aside
      aria-label="Photo analysis and details"
      className="animate-pop-in pointer-events-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-900/10 landscape:w-80 landscape:flex-none landscape:lg:w-96"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold text-slate-800">AI-assisted observation</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide analysis panel"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        <AnalysisContent image={image} stageLabel={stageLabel} onRetry={onRetry} retrying={retrying} />
      </div>

      <AnalysisFooter image={image} />
    </aside>
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
// The (i) button toggles the analysis panel: beside the photo whenever the
// screen is landscape (desktops, landscape tablets and phones — stacking it
// under the photo would leave a short screen almost no room to read it),
// below the photo on portrait screens. It stays open while stepping
// through photos so a reviewer can go through each photo's analysis in turn.
function PhotoViewer({
  images,
  index,
  onIndexChange,
  panelOpen,
  onPanelOpenChange,
  onClose,
  onRetryAnalysis,
  retryingImageId,
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
        <div className="flex w-full items-center justify-between gap-3 text-sm text-white">
          <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            {stageLabel ? <Badge tone="neutral">{stageLabel}</Badge> : null}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {hasMultiple ? (
              <span className="text-xs text-white/70">
                {index + 1} / {images.length}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onPanelOpenChange(!panelOpen)}
              aria-label={panelOpen ? 'Hide analysis and details' : 'Show analysis and details'}
              aria-pressed={panelOpen}
              title={panelOpen ? 'Hide analysis and details' : 'Show analysis and details'}
              className={`rounded-md p-1.5 hover:bg-white/15 ${panelOpen ? 'bg-white/15' : ''}`}
            >
              <Info className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 hover:bg-white/15">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-3 landscape:flex-row landscape:items-stretch landscape:justify-center">
          <div
            className={`relative flex w-full max-w-5xl items-center justify-center ${
              panelOpen ? 'h-[38vh] shrink-0 landscape:h-auto landscape:min-h-0 landscape:flex-1' : 'min-h-0 flex-1'
            }`}
          >
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

          {panelOpen ? (
            <AnalysisPanel
              image={image}
              stageLabel={stageLabel}
              onRetry={onRetryAnalysis ? () => onRetryAnalysis(image.id) : null}
              retrying={retryingImageId === image.id}
              onClose={() => onPanelOpenChange(false)}
            />
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Site-photo grid: thumbnail + stage + AI-assisted observation status/result.
// Shared by Engineering's own monitoring detail page, MPDC's read-only
// monitoring view, and Admin's project oversight page, so all three render the
// same evidence the same way.
//
// onRetryAnalysis is optional and is what makes a failed analysis re-runnable.
// Callers only pass it where the viewer is actually allowed to run one:
// analyze-project-image accepts Engineering (as uploader or project owner) and
// admins, so MPDC's view leaves it out rather than offering a button that
// would come back 403.
export default function SitePhotoGrid({ images, onRetryAnalysis, retryingImageId }) {
  const [viewerIndex, setViewerIndex] = useState(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [analysisImageId, setAnalysisImageId] = useState(null)
  const closeViewer = useCallback(() => setViewerIndex(null), [])
  const closeAnalysis = useCallback(() => setAnalysisImageId(null), [])

  if (!images || images.length === 0) return null

  // Only photos that actually have a URL can be stepped through in the
  // viewer — a failed signed URL would just be a blank stop.
  const viewableImages = images.filter((image) => image.signedUrl)

  // Looked up by id on every render so a retried analysis shows its new
  // result as soon as the caller reloads the images.
  const analysisImage = images.find((image) => image.id === analysisImageId) ?? null

  function openViewer(image) {
    setPanelOpen(false)
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
          <div className="space-y-1.5 p-2">
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="neutral">{IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage}</Badge>
              <Badge tone={getProcessingStatusTone(image.ai_analysis_status)}>
                AI Analysis: {IMAGE_PROCESSING_STATUS_LABELS[image.ai_analysis_status] ?? image.ai_analysis_status}
              </Badge>
            </div>
            <AiSummary
              status={image.ai_analysis_status}
              result={image.ai_analysis_result}
              onRetry={onRetryAnalysis ? () => onRetryAnalysis(image.id) : null}
              retrying={retryingImageId === image.id}
              onViewAnalysis={() => setAnalysisImageId(image.id)}
            />
          </div>
        </div>
      ))}

      {analysisImage ? (
        <AnalysisDialog
          image={analysisImage}
          onClose={closeAnalysis}
          onOpenPhoto={() => {
            closeAnalysis()
            openViewer(analysisImage)
          }}
          onRetry={onRetryAnalysis ? () => onRetryAnalysis(analysisImage.id) : null}
          retrying={retryingImageId === analysisImage.id}
        />
      ) : null}

      {viewerIndex != null ? (
        <PhotoViewer
          images={viewableImages}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          panelOpen={panelOpen}
          onPanelOpenChange={setPanelOpen}
          onClose={closeViewer}
          onRetryAnalysis={onRetryAnalysis}
          retryingImageId={retryingImageId}
        />
      ) : null}
    </div>
  )
}

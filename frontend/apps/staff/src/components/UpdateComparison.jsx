import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Images, RefreshCw, Sparkles, X } from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import Button from './ui/Button'
import { formatDate, formatDateTime } from '@shared/utils/format'
import { analyzeProjectUpdate } from '../utils/imageAnalysis'

// One AI analysis per monitoring update (analyze-project-update Edge
// Function): the update's photos against photos from every earlier update.
// The analysis runs automatically when Engineering submits an update; the
// "Compare with previous photos" button opens this side-by-side view and
// runs it itself only when it hasn't finished (or failed) — once saved, it is
// never paid for twice.

const SAME_SITE = {
  LIKELY_SAME: { label: 'Likely the same site', flag: false },
  POSSIBLY_DIFFERENT: { label: 'Possibly a different site', flag: true },
  CANNOT_DETERMINE: { label: 'Same site cannot be determined', flag: false },
}

const PROGRESS = {
  CONSISTENT: { label: 'Consistent with reported progress', flag: false },
  INCONSISTENT: { label: 'Not consistent with reported progress', flag: true },
  CANNOT_DETERMINE: { label: 'Progress consistency cannot be determined', flag: false },
}

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

function isValidResult(result) {
  return (
    result &&
    typeof result.summary === 'string' &&
    isStringArray(result.visible_materials) &&
    typeof result.site_condition === 'string' &&
    isStringArray(result.potential_issues) &&
    typeof result.image_quality === 'string' &&
    typeof result.confidence === 'number' &&
    typeof result.observation === 'string'
  )
}

function isValidComparison(comparison) {
  return (
    comparison &&
    SAME_SITE[comparison.same_site] &&
    typeof comparison.same_site_reason === 'string' &&
    isStringArray(comparison.changes_since_previous) &&
    PROGRESS[comparison.progress_consistency] &&
    typeof comparison.progress_reason === 'string' &&
    typeof comparison.timeline_summary === 'string'
  )
}

function updateLabel(update) {
  const progress = update.progress_percentage != null ? `${update.progress_percentage}%` : 'Update'
  return `${progress} · ${formatDate(update.report_date)}`
}

// Same order the pages list updates in, oldest first.
function compareUpdates(a, b) {
  const byDate = (a.report_date ?? '').localeCompare(b.report_date ?? '')
  return byDate !== 0 ? byDate : (a.created_at ?? '').localeCompare(b.created_at ?? '')
}

// One-line status for an update entry in a history list.
export function UpdateAnalysisFlag({ update }) {
  const status = update.ai_analysis_status
  const result = update.ai_analysis_result

  if (status === 'PENDING') {
    return <p className="mt-2 text-xs text-slate-500">AI comparison is running...</p>
  }
  if (status === 'FAILED') {
    return <p className="mt-2 text-xs text-slate-500">AI comparison could not be completed.</p>
  }
  if (status !== 'PROCESSED' || !isValidResult(result)) return null

  if (!isValidComparison(result.comparison)) {
    return <p className="mt-2 text-xs text-slate-500">AI analysis complete · no earlier photos to compare with.</p>
  }

  const site = SAME_SITE[result.comparison.same_site]
  const progress = PROGRESS[result.comparison.progress_consistency]
  const flagged = site.flag || progress.flag
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${flagged ? 'text-red-700' : 'text-slate-600'}`}>
      {flagged ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      {site.label} · {progress.label.charAt(0).toLowerCase() + progress.label.slice(1)}
    </p>
  )
}

// One photo in a side-by-side strip, captioned with its update.
function Thumbnail({ image, caption, highlight = false }) {
  const frame = `block overflow-hidden rounded-md bg-slate-100 ${highlight ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-200'}`
  return (
    <figure className="w-36 shrink-0">
      {image.signedUrl ? (
        <a href={image.signedUrl} target="_blank" rel="noreferrer" className={frame} title="Open full photo">
          <img src={image.signedUrl} alt="Site photo" className="aspect-4/3 w-full object-cover" loading="lazy" />
        </a>
      ) : (
        <div className={`${frame} aspect-4/3`} />
      )}
      <figcaption className="mt-1 truncate text-[11px] text-slate-500">{caption}</figcaption>
    </figure>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

function AnalysisResult({ result }) {
  const comparison = isValidComparison(result.comparison) ? result.comparison : null
  const confidence = Math.round(Math.min(100, Math.max(0, result.confidence)))

  return (
    <div className="space-y-5">
      {comparison ? (
        <div className="space-y-3 rounded-lg border border-slate-200 p-4">
          {[
            [SAME_SITE[comparison.same_site], comparison.same_site_reason],
            [PROGRESS[comparison.progress_consistency], comparison.progress_reason],
          ].map(([verdict, reason]) => (
            <div key={verdict.label} className="flex gap-2">
              {verdict.flag ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
              <div>
                <p className={`text-sm font-medium ${verdict.flag ? 'text-red-700' : 'text-slate-800'}`}>{verdict.label}</p>
                <p className="text-sm text-slate-600">{reason}</p>
              </div>
            </div>
          ))}

          <Section title="Changes since the previous update">
            {comparison.changes_since_previous.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                {comparison.changes_since_previous.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No visible changes noted.</p>
            )}
          </Section>

          <Section title="Across all photos">
            <p className="text-sm text-slate-700">{comparison.timeline_summary}</p>
          </Section>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
          No earlier photos to compare with — this is the first update with photos.
        </p>
      )}

      <Section title="What the new photos show">
        <p className="text-sm text-slate-700">{result.summary}</p>
      </Section>

      <Section title="Potential issues">
        {result.potential_issues.length > 0 ? (
          <ul className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            {result.potential_issues.map((issue) => (
              <li key={issue} className="flex gap-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {issue}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No visible issues noted.</p>
        )}
      </Section>

      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="Site condition">
          <p className="text-sm text-slate-600">{result.site_condition}</p>
        </Section>
        <Section title="Image quality">
          <p className="text-sm text-slate-600">{result.image_quality}</p>
        </Section>
        <Section title="Visible materials">
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
        </Section>
        <Section title="Confidence">
          <p className="text-sm font-semibold text-slate-700">{confidence}%</p>
        </Section>
      </div>

      <Section title="Limitations">
        <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">{result.observation}</p>
      </Section>

      <p className="text-[11px] italic text-slate-400">
        AI-assisted observation only — not an official engineering inspection.
        {result.analyzed_at ? ` Analyzed ${formatDateTime(result.analyzed_at)}.` : ''}
      </p>
    </div>
  )
}

export function UpdateComparisonModal({ update, updates, images, isNew = false, onClose, onAnalyzed }) {
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const startedRef = useRef(false)

  const newPhotos = images.filter((image) => image.project_update_id === update.id)
  const earlierUpdates = updates
    .filter((entry) => entry.id !== update.id && compareUpdates(entry, update) < 0)
    .sort(compareUpdates)
  // Every earlier photo in one row, oldest first, each captioned with its update.
  const previousPhotos = earlierUpdates.flatMap((entry) =>
    images
      .filter((image) => image.project_update_id === entry.id)
      .map((image) => ({ image, caption: updateLabel(entry) })),
  )

  const saved = update.ai_analysis_status === 'PROCESSED' ? update.ai_analysis_result : null
  const result = outcome?.status === 'PROCESSED' ? outcome.result : saved
  const failure = outcome?.status === 'FAILED' ? outcome.result?.error : null
  const stillPending = outcome?.status === 'PENDING'
  const usedPreviousIds = new Set(isValidResult(result) ? (result.previous_image_ids ?? []) : [])

  async function run() {
    setRunning(true)
    const next = await analyzeProjectUpdate(update.id)
    setOutcome(next)
    setRunning(false)
    if (next?.status === 'PROCESSED') await onAnalyzed?.()
  }

  // Runs the analysis on open only when there's no saved result yet.
  useEffect(() => {
    if (startedRef.current || saved || newPhotos.length === 0) return
    startedRef.current = true
    run()
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  let analysis
  if (newPhotos.length === 0) {
    analysis = <p className="text-sm text-slate-500">This update has no photos to compare.</p>
  } else if (running) {
    analysis = (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
        Comparing photos... this can take up to a minute.
      </p>
    )
  } else if (isValidResult(result)) {
    analysis = <AnalysisResult result={result} />
  } else {
    analysis = (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          {stillPending
            ? 'The comparison is still running. Check again in a moment.'
            : failure
              ? `The comparison could not be completed: ${failure}`
              : 'This update has not been compared yet.'}
        </p>
        <Button type="button" size="sm" variant="secondary" icon={RefreshCw} onClick={run}>
          {stillPending ? 'Check again' : failure ? 'Try again' : 'Run comparison'}
        </Button>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-1050 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-comparison-title"
        className="animate-pop-in relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="update-comparison-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Images className="h-4 w-4 text-blue-600" aria-hidden="true" />
              Compare with previous photos
            </h2>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
              {updateLabel(update)}
              {isNew ? <Badge tone="blue">New</Badge> : null}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">
                Previous photos{previousPhotos.length > 0 ? ` (${previousPhotos.length})` : ''}
              </h3>
              {previousPhotos.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No earlier photos for this project.</p>
              ) : (
                <>
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                    {previousPhotos.map(({ image, caption }) => (
                      <Thumbnail key={image.id} image={image} caption={caption} />
                    ))}
                  </div>
                  {usedPreviousIds.size > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      The AI compared {usedPreviousIds.size} of these, covering every earlier update.
                    </p>
                  ) : null}
                </>
              )}
            </section>

            <section className="min-w-0 rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                New photos{newPhotos.length > 0 ? ` (${newPhotos.length})` : ''}
                {isNew ? <Badge tone="blue">New</Badge> : null}
              </h3>
              {newPhotos.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No photos in this update.</p>
              ) : (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  {newPhotos.map((image) => (
                    <Thumbnail key={image.id} image={image} caption={updateLabel(update)} highlight />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Sparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
              AI analysis
            </h3>
            {analysis}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { Camera } from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import {
  IMAGE_STAGE_LABELS,
  IMAGE_PROCESSING_STATUS_LABELS,
  getProcessingStatusTone,
} from '../../utils/imageProcessing'

// Read-only, single labeled line — keeps the detail block below skimmable
// instead of a wall of text.
function DetailLine({ label, value }) {
  if (!value) return null
  return (
    <p className="text-[11px] text-slate-500">
      <span className="font-medium text-slate-600">{label}:</span> {value}
    </p>
  )
}

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

// Gemini's structured, advisory-only observation for one photo. Never an
// "official" finding — see the heading and caption below, and
// supabase/functions/analyze-project-image for the prompt that constrains
// what Gemini is allowed to claim.
function AiObservation({ status, result }) {
  if (status === 'PENDING') {
    return <p className="text-[11px] text-slate-500">Processing image...</p>
  }

  if (status === 'FAILED') {
    return (
      <div className="space-y-0.5 border-t border-slate-100 pt-1.5">
        <p className="text-[11px] text-red-600">AI analysis could not be completed.</p>
        <p className="text-[11px] text-slate-400">The uploaded photo is still available.</p>
      </div>
    )
  }

  if (status !== 'PROCESSED' || !isValidAiResult(result)) return null

  return (
    <div className="space-y-1 border-t border-slate-100 pt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">AI-assisted observation</p>
      <DetailLine label="Observed activity" value={result.observed_activity} />
      <DetailLine
        label="Visible materials"
        value={result.visible_materials.length > 0 ? result.visible_materials.join(', ') : 'None identifiable'}
      />
      <DetailLine label="Site condition" value={result.site_condition} />
      <DetailLine
        label="Potential issues"
        value={result.potential_issues.length > 0 ? result.potential_issues.join(', ') : 'None noted'}
      />
      <DetailLine label="Image quality" value={result.image_quality} />
      <DetailLine label="Confidence" value={`${Math.round(result.confidence)}%`} />
      <DetailLine label="Observation" value={result.observation} />
      <p className="pt-0.5 text-[10px] italic text-slate-400">
        AI-assisted observation only — not an official engineering inspection.
      </p>
    </div>
  )
}

// Read-only site-photo grid: thumbnail + stage + AI-assisted observation
// status/result. Shared by Engineering's own monitoring detail page, MPDC's
// read-only monitoring view, and Admin's project oversight page, so all three
// render the same evidence the same way.
export default function SitePhotoGrid({ images }) {
  if (!images || images.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {images.map((image) => (
        <div key={image.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <a href={image.signedUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="block">
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
          </a>
          <div className="space-y-1.5 p-2">
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="neutral">{IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage}</Badge>
              <Badge tone={getProcessingStatusTone(image.ai_analysis_status)}>
                AI Analysis: {IMAGE_PROCESSING_STATUS_LABELS[image.ai_analysis_status] ?? image.ai_analysis_status}
              </Badge>
            </div>
            <AiObservation status={image.ai_analysis_status} result={image.ai_analysis_result} />
          </div>
        </div>
      ))}
    </div>
  )
}

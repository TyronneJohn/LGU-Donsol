import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Landmark, MapPin, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import Badge from '@shared/components/ui/Badge'
import ProjectMap from '@shared/components/ProjectMap'
import PinPhotoGallery from '@shared/components/PinPhotoGallery'
import PhotoViewerDialog from '@shared/components/PhotoViewerDialog'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { formatCurrency, formatDate } from '@shared/utils/format'

// Every site photo of one project, newest first, with signed URLs for the
// pin's photo gallery. Staff see all stages (ISSUE/OTHER included) — RLS
// on project_images and the project-images bucket allows any staff role.
// Only loads while the modal is open.
function useProjectPhotos(projectId, enabled) {
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!enabled || !projectId) return undefined
    let cancelled = false

    async function load() {
      setLoading(true)
      setPhotos([])
      const { data: rows, error } = await supabase
        .from('project_images')
        .select('id, project_update_id, storage_path, image_stage, captured_at, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error || !rows?.length) {
        setLoading(false)
        return
      }

      const { data: signed } = await supabase.storage
        .from('project-images')
        .createSignedUrls(
          rows.map((row) => row.storage_path),
          3600,
        )
      if (cancelled) return
      const urlByPath = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]))
      setPhotos(
        rows
          .map((row) => ({
            ...row,
            captured_at: row.captured_at ?? row.created_at,
            signedUrl: urlByPath.get(row.storage_path) ?? null,
          }))
          .filter((photo) => photo.signedUrl),
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectId, enabled])

  return { photos, loading }
}

// "See Location" focused map view for a single project — opened from a
// project detail page (Admin/MPDC/Engineering/BAC), never from a
// dashboard-wide list. Deliberately takes one `project` and always renders
// ProjectMap with a single-item array, so only that project's marker can
// ever appear here. Clicking the pin opens the same photo panel as the
// public site. With `showDetails`, the project's details and budget are
// listed above the map, like the public site's project modal; `procurement` (when the page loads it, null if none
// yet) adds the contract amount.
export default function LocationModal({ open, project, onClose, showDetails = false, procurement }) {
  const { photos, loading } = useProjectPhotos(project?.id, open)
  // { photos, index } while the full-screen photo viewer is open.
  const [viewer, setViewer] = useState(null)
  const mapProjects = useMemo(() => (project ? [project] : []), [project])

  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open || !project) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-modal-title"
        className="animate-pop-in relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="location-modal-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <MapPin className="h-4 w-4 text-blue-600" aria-hidden="true" />
              {project.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {project.project_code}
              {project.barangay ? ` · Brgy. ${project.barangay}` : ''}
            </p>
            {project.status ? (
              <div className="mt-1.5">
                <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                  {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                </Badge>
              </div>
            ) : null}
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

        {showDetails ? <ProjectDetails project={project} procurement={procurement} /> : null}

        <p className="mb-2 text-xs text-slate-400">Tap the pin to see the project&apos;s site photos.</p>
        <ProjectMap
          projects={mapProjects}
          height="min(480px, 60vh)"
          renderCardMedia={() => (
            <PinPhotoGallery
              photos={photos}
              loading={loading}
              onOpen={(list, index) => setViewer({ photos: list, index })}
            />
          )}
        />
      </div>

      {viewer ? (
        <PhotoViewerDialog
          title={project.title}
          photos={viewer.photos}
          startIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </div>,
    document.body,
  )
}

function ProjectDetails({ project, procurement }) {
  const budget = project.approved_budget ?? project.estimated_cost
  const contractAmount = procurement?.contract_amount ?? null
  const share =
    budget && contractAmount !== null ? Math.min(100, Math.max(0, (contractAmount / budget) * 100)) : null

  return (
    <div className="mb-4">
      {project.description ? <p className="mb-4 text-sm text-slate-600">{project.description}</p> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label="Category">{project.project_category || '—'}</Field>
        <Field label="Funding Source">{project.funding_source || '—'}</Field>
        <Field label="Location">{project.location_text || '—'}</Field>
        <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
        <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
        {project.start_date_actual ? (
          <Field label="Actual Start">{formatDate(project.start_date_actual)}</Field>
        ) : null}
        {project.end_date_actual ? (
          <Field label="Actual Completion">{formatDate(project.end_date_actual)}</Field>
        ) : null}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Landmark className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Budget
        </h3>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Approved Budget" value={formatCurrency(budget)} />
          <Stat label="POW Amount" value={formatCurrency(project.pow_amount)} />
          {procurement !== undefined ? (
            <Stat
              label="Contract Amount"
              value={contractAmount !== null ? formatCurrency(contractAmount) : 'Not yet awarded'}
            />
          ) : null}
        </div>
        {share !== null ? (
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${share}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Contract amount is {share.toFixed(1)}% of the approved budget.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <MapPin className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Project Location
        </h3>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 text-slate-700">{children}</p>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-slate-800">{value}</p>
    </div>
  )
}

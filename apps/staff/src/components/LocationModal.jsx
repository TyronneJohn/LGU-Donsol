import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, X } from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import ProjectMap from '@shared/components/ProjectMap'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'

// "See Location" focused map view for a single project — opened from a
// project detail page (Admin/MPDC/Engineering/BAC), never from a
// dashboard-wide list. Deliberately takes one `project` and always renders
// ProjectMap with a single-item array, so only that project's marker can
// ever appear here.
export default function LocationModal({ open, project, onClose }) {
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
        className="animate-pop-in relative w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
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

        <ProjectMap projects={[project]} height="420px" />
      </div>
    </div>,
    document.body,
  )
}

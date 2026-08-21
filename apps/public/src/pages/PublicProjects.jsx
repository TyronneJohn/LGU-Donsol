import { useEffect, useMemo, useState } from 'react'
import { FolderKanban, MapPin, Search, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { isWithinDonsol } from '@shared/utils/geo'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import ProjectMap from '@shared/components/ProjectMap'

const STATUS_FILTERS = [
  'APPROVED',
  'FOR_PROCUREMENT',
  'FOR_IMPLEMENTATION',
  'ONGOING',
  'COMPLETED',
]

export default function PublicProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [barangayFilter, setBarangayFilter] = useState('ALL')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    async function loadProjects() {
      const { data, error } = await supabase
        .from('public_projects_view')
        .select('*')
        .order('published_at', { ascending: false })

      if (!error) setProjects(data ?? [])
      setLoading(false)
    }
    loadProjects()
  }, [])

  const barangays = useMemo(
    () => [...new Set(projects.map((p) => p.barangay).filter(Boolean))].sort(),
    [projects],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return projects.filter((project) => {
      if (statusFilter !== 'ALL' && project.status !== statusFilter) return false
      if (barangayFilter !== 'ALL' && project.barangay !== barangayFilter) return false
      if (term && !`${project.title} ${project.project_code ?? ''}`.toLowerCase().includes(term)) {
        return false
      }
      return true
    })
  }, [projects, search, statusFilter, barangayFilter])

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-xl font-semibold text-slate-800">Published Projects</h1>
      <p className="mt-2 text-sm text-slate-500">
        Project listings below reflect only projects that have been reviewed and published by
        MPDC.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by project title or code"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="ALL">All statuses</option>
          {STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {PROJECT_STATUS_LABELS[status] ?? status}
            </option>
          ))}
        </select>
        {barangays.length > 0 ? (
          <select
            value={barangayFilter}
            onChange={(event) => setBarangayFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All barangays</option>
            {barangays.map((barangay) => (
              <option key={barangay} value={barangay}>
                {barangay}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="mt-6">
        {loading ? (
          <LoadingState label="Loading published projects..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={projects.length === 0 ? 'No published projects yet' : 'No projects match your search'}
            description={
              projects.length === 0
                ? 'Project listings will be available here once approved projects are published by MPDC.'
                : 'Try a different search term or filter.'
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setSelected(project)}
                className="flex flex-col items-start gap-2 rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-sm shadow-slate-200/60 transition-shadow hover:shadow-md"
              >
                <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                  {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                </Badge>
                <h2 className="text-sm font-semibold text-slate-800">{project.title}</h2>
                <p className="text-xs text-slate-500">{project.project_code}</p>
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {project.barangay || '—'}
                </p>
                <p className="text-xs font-medium text-slate-600">
                  {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected ? (
        <PublicProjectDetail project={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  )
}

function PublicProjectDetail({ project, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const hasLocation = isWithinDonsol(project.latitude, project.longitude)

  return (
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
        aria-labelledby="public-project-detail-title"
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="public-project-detail-title" className="text-base font-semibold text-slate-800">
              {project.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {project.project_code}
              {project.barangay ? ` · Brgy. ${project.barangay}` : ''}
            </p>
            <div className="mt-1.5">
              <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                {PROJECT_STATUS_LABELS[project.status] ?? project.status}
              </Badge>
            </div>
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

        {project.description ? (
          <p className="mb-4 text-sm text-slate-600">{project.description}</p>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Field label="Category">{project.project_category || '—'}</Field>
          <Field label="Funding Source">{project.funding_source || '—'}</Field>
          <Field label="Budget">{formatCurrency(project.approved_budget ?? project.estimated_cost)}</Field>
          <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
          <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
          <Field label="Published">{formatDate(project.published_at)}</Field>
        </div>

        {hasLocation ? (
          <ProjectMap projects={[project]} height="320px" />
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-xs text-slate-400">
            No location on file for this project.
          </p>
        )}
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

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FolderKanban, Search, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'

const STATUS_FILTERS = ['ONGOING', 'COMPLETED']

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

      if (!error) setProjects((data ?? []).filter((p) => STATUS_FILTERS.includes(p.status)))
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
          <>
            <p className="mb-3 text-xs text-slate-500">
              Showing <span className="font-medium text-slate-700">{filtered.length}</span>{' '}
              {filtered.length === 1 ? 'project' : 'projects'}
            </p>

            {/* Below laptop width, one card per project — nine table columns can't fit
                a phone or tablet screen without sideways scrolling. */}
            <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
              {filtered.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(project)}
                    className="flex h-full w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-blue-300 hover:bg-blue-50/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-slate-800">{project.title}</p>
                      <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {project.project_code}
                      {project.barangay ? ` · Brgy. ${project.barangay}` : ''}
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div>
                        <dt className="text-xs text-slate-400">Approved Budget</dt>
                        <dd className="text-slate-700">{formatCurrency(project.approved_budget ?? project.estimated_cost)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Fund Source</dt>
                        <dd className="text-slate-700">{project.funding_source || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">Target Start</dt>
                        <dd className="text-slate-700">{formatDate(project.start_date_planned)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-400">
                          {project.status === 'COMPLETED' ? 'Date Completed' : 'Target Completion'}
                        </dt>
                        <dd className="text-slate-700">
                          {formatDate(project.status === 'COMPLETED' ? project.end_date_actual : project.end_date_planned)}
                        </dd>
                      </div>
                    </dl>
                  </button>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:block">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-linear-to-r from-blue-800 to-blue-600">
                    <tr className="divide-x divide-white/20">
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/90">Project</th>
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/90">Location</th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-white/90">Approved Budget</th>
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/90">Fund Source</th>
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/90">Schedule</th>
                      <th scope="col" className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white/90">Status</th>
                      <th scope="col" className="w-10 px-2 py-3"><span className="sr-only">Open</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300">
                    {filtered.map((project) => (
                      <tr
                        key={project.id}
                        tabIndex={0}
                        onClick={() => setSelected(project)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelected(project)
                          }
                        }}
                        className="group cursor-pointer divide-x divide-slate-300 transition-colors hover:bg-blue-50/50 focus:bg-blue-50/50 focus:outline-none"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800 group-hover:text-blue-700">{project.title}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{project.project_code}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{project.barangay || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-right font-medium tabular-nums text-slate-700">
                          {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{project.funding_source || '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          <p>
                            {formatDate(project.start_date_planned)}
                            <span className="mx-1.5 text-slate-300">→</span>
                            {formatDate(project.end_date_planned)}
                          </p>
                          {project.status === 'COMPLETED' ? (
                            <p className="mt-0.5 text-xs text-emerald-600">
                              Completed {formatDate(project.end_date_actual)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                            {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-3 text-slate-300 group-hover:text-blue-500">
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
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
          {project.start_date_actual ? (
            <Field label="Actual Start">{formatDate(project.start_date_actual)}</Field>
          ) : null}
          {project.end_date_actual ? (
            <Field label="Actual Completion">{formatDate(project.end_date_actual)}</Field>
          ) : null}
          <Field label="Published">{formatDate(project.published_at)}</Field>
        </div>
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

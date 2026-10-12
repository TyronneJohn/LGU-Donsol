import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FolderKanban,
  Landmark,
  MapPin,
  Search,
  X,
} from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { formatCurrency, formatDate } from '@shared/utils/format'
import {
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  SECTOR_LABELS,
  SECTOR_ORDER,
} from '@shared/utils/projectStatus'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import ProjectMap from '@shared/components/ProjectMap'
import { isWithinDonsol } from '@shared/utils/geo'

// Public rows can only exist from APPROVED onward (MPDC publishes while
// APPROVED, and apply_monitoring_progress() auto-publishes at ONGOING), so
// every published project is listed, whatever stage it is in — the same
// scope as MPDC's physical 20% Development Fund transparency board.
const STATUS_ORDER = Object.keys(PROJECT_STATUS_LABELS)

// A/B/C grouping of the transparency board. Projects without a sector
// (created before 20260824100000_project_sector.sql) fall into a last group.
const SECTOR_GROUPS = [
  ...SECTOR_ORDER.map((key, index) => ({
    key,
    label: `${String.fromCharCode(65 + index)}. ${SECTOR_LABELS[key]}`,
  })),
  { key: null, label: 'Other Projects' },
]

function budgetOf(project) {
  return Number(project.approved_budget ?? project.estimated_cost ?? 0)
}

export default function PublicProjects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [sectorFilter, setSectorFilter] = useState('ALL')
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

  const statuses = useMemo(
    () => STATUS_ORDER.filter((status) => projects.some((p) => p.status === status)),
    [projects],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return projects.filter((project) => {
      if (statusFilter !== 'ALL' && project.status !== statusFilter) return false
      if (sectorFilter !== 'ALL' && project.sector !== sectorFilter) return false
      if (barangayFilter !== 'ALL' && project.barangay !== barangayFilter) return false
      if (term && !`${project.title} ${project.project_code ?? ''}`.toLowerCase().includes(term)) {
        return false
      }
      return true
    })
  }, [projects, search, statusFilter, sectorFilter, barangayFilter])

  const groups = useMemo(
    () =>
      SECTOR_GROUPS.map((group) => {
        const groupProjects = filtered.filter((p) => (p.sector ?? null) === group.key)
        return {
          ...group,
          projects: groupProjects,
          subtotal: groupProjects.reduce((sum, p) => sum + budgetOf(p), 0),
        }
      }).filter((group) => group.projects.length > 0),
    [filtered],
  )

  const grandTotal = useMemo(() => filtered.reduce((sum, p) => sum + budgetOf(p), 0), [filtered])

  return (
    <div>
      <section>
        <div className="mx-auto max-w-6xl px-4 pb-8 pt-12">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Published Projects
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-blue-100/85">
            Project listings below reflect only projects that have been reviewed and published by
            MPDC.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-16">
        <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-lg shadow-blue-950/10">
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
            {statuses.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS_LABELS[status] ?? status}
              </option>
            ))}
          </select>
          <select
            value={sectorFilter}
            onChange={(event) => setSectorFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="ALL">All sectors</option>
            {SECTOR_ORDER.map((sector) => (
              <option key={sector} value={sector}>
                {SECTOR_LABELS[sector]}
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
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-lg shadow-blue-950/10">
              <LoadingState label="Loading published projects..." />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-lg shadow-blue-950/10">
              <EmptyState
                icon={FolderKanban}
                title={projects.length === 0 ? 'No published projects yet' : 'No projects match your search'}
                description={
                  projects.length === 0
                    ? 'Project listings will be available here once approved projects are published by MPDC.'
                    : 'Try a different search term or filter.'
                }
              />
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-blue-100/80">
                Showing <span className="font-semibold text-white">{filtered.length}</span>{' '}
                {filtered.length === 1 ? 'project' : 'projects'}
              </p>

              {/* Below laptop width, one card per project — nine table columns can't fit
                  a phone or tablet screen without sideways scrolling. */}
              <div className="space-y-5 lg:hidden">
                {groups.map((group) => (
                  <section key={group.key ?? 'other'}>
                    <div className="mb-2 flex items-baseline justify-between gap-3 rounded-lg bg-white/95 px-3 py-2 shadow-sm">
                      <h2 className="text-sm font-semibold text-blue-900">{group.label}</h2>
                      <p className="text-sm font-semibold tabular-nums text-slate-700">{formatCurrency(group.subtotal)}</p>
                    </div>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {group.projects.map((project) => (
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
                  </section>
                ))}
                <div className="flex items-baseline justify-between gap-3 rounded-lg bg-blue-900 px-3 py-2.5 text-white shadow-sm">
                  <p className="text-sm font-semibold uppercase tracking-wide">Total</p>
                  <p className="text-sm font-semibold tabular-nums">{formatCurrency(grandTotal)}</p>
                </div>
              </div>

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
                    {groups.map((group) => (
                    <tbody key={group.key ?? 'other'} className="divide-y divide-slate-300 border-t border-slate-300">
                      <tr className="bg-blue-50">
                        <th scope="colgroup" colSpan={2} className="px-4 py-2 text-left text-sm font-semibold text-blue-900">
                          {group.label}
                        </th>
                        <td className="px-4 py-2 whitespace-nowrap text-right font-semibold tabular-nums text-blue-900">
                          {formatCurrency(group.subtotal)}
                        </td>
                        <td colSpan={4} className="px-4 py-2 text-xs text-slate-500">
                          {group.projects.length} {group.projects.length === 1 ? 'project' : 'projects'}
                        </td>
                      </tr>
                      {group.projects.map((project) => (
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
                    ))}
                    <tfoot className="border-t-2 border-blue-800 bg-blue-900 text-white">
                      <tr>
                        <th scope="row" colSpan={2} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">
                          Total
                        </th>
                        <td className="px-4 py-3 whitespace-nowrap text-right font-semibold tabular-nums">
                          {formatCurrency(grandTotal)}
                        </td>
                        <td colSpan={4} />
                      </tr>
                    </tfoot>
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
    </div>
  )
}

function PublicProjectDetail({ project, onClose }) {
  const { loading, data, photos, photosLoading } = useProjectTransparency(project.id)
  const [photosOpen, setPhotosOpen] = useState(false)
  const photoGroups = useMemo(() => groupPhotosByUpdate(photos, data?.updates ?? []), [photos, data])

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
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        {/* Header stays put while only the body below scrolls, so the close
            button is always in reach no matter how far down the map is. */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-5">
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
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-5 pt-4">
          {project.description ? (
            <p className="mb-4 text-sm text-slate-600">{project.description}</p>
          ) : null}

          <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label="Sector">{SECTOR_LABELS[project.sector] ?? '—'}</Field>
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

          <ProjectTransparency loading={loading} data={data} />

          <div className="border-t border-slate-100 pt-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <MapPin className="h-4 w-4 text-blue-600" aria-hidden="true" />
              Project Location
            </h3>
            {project.location_text || project.barangay ? (
              <p className="mb-2 text-xs text-slate-500">
                {[project.location_text, project.barangay ? `Brgy. ${project.barangay}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
            {/* Same gate the staff detail pages use: a coordinate outside Donsol
                is never shown as though it were a real project site. */}
            <ProjectMap
              projects={isWithinDonsol(project.latitude, project.longitude) ? [project] : []}
              height="min(360px, 45vh)"
              renderCardFooter={() => (
                <ProjectPhotosButton
                  loading={loading || photosLoading}
                  count={photos.length}
                  onClick={() => setPhotosOpen(true)}
                />
              )}
            />
          </div>
        </div>
      </div>

      {photosOpen ? (
        <ProjectPhotosDialog title={project.title} groups={photoGroups} onClose={() => setPhotosOpen(false)} />
      ) : null}
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

// Only BEFORE/DURING/AFTER photos are ever returned by
// get_public_project_transparency(); ISSUE/OTHER stay internal.
const PHOTO_STAGE_LABELS = { BEFORE: 'Before', DURING: 'During', AFTER: 'After' }

// Budget utilization, procurement, progress reports and site photos for one
// published project. Everything comes from the get_public_project_transparency()
// RPC (20261004140000_public_photos_by_update.sql), which returns a curated
// field list and only for visibility = 'PUBLIC' projects. The public site
// never reads procurement / project_updates / project_images directly.
// Photos are shown from the map pin's card (ProjectPhotosDialog), not inline.
function useProjectTransparency(projectId) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [photos, setPhotos] = useState([])
  const [photosLoading, setPhotosLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setPhotosLoading(true)
      setPhotos([])
      const { data: doc, error } = await supabase.rpc('get_public_project_transparency', {
        p_project_id: projectId,
      })
      if (cancelled) return
      setData(error ? null : doc)
      setLoading(false)
      if (error || !doc) {
        setPhotosLoading(false)
        return
      }

      const withUrls = await Promise.all(
        (doc.photos ?? []).map(async (photo) => {
          const { data: signed } = await supabase.storage
            .from('project-images')
            .createSignedUrl(photo.storage_path, 3600)
          return { ...photo, signedUrl: signed?.signedUrl ?? null }
        }),
      )
      if (cancelled) return
      setPhotos(withUrls.filter((photo) => photo.signedUrl))
      setPhotosLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  return { loading, data, photos, photosLoading }
}

function ProjectTransparency({ loading, data }) {
  if (loading) {
    return (
      <div className="mb-4 border-t border-slate-100 pt-4">
        <LoadingState label="Loading budget and progress details..." />
      </div>
    )
  }

  if (!data) return null

  return (
    <>
      <BudgetUtilization data={data} />
      <ProgressReports progress={data.progress_percentage} updates={data.updates ?? []} />
    </>
  )
}

// One group per progress report (newest first, matching the Physical
// Progress list), each holding the photos uploaded with it. Photos not tied
// to a published report (e.g. uploaded straight to the project) go last.
function groupPhotosByUpdate(photos, updates) {
  const byUpdate = new Map()
  for (const photo of photos) {
    const key = photo.project_update_id ?? null
    if (!byUpdate.has(key)) byUpdate.set(key, [])
    byUpdate.get(key).push(photo)
  }

  const groups = []
  for (const update of updates) {
    const updatePhotos = byUpdate.get(update.id)
    if (!updatePhotos) continue
    byUpdate.delete(update.id)
    groups.push({
      key: update.id,
      label: `Progress report · ${formatDate(update.report_date)}`,
      progress: update.progress_percentage,
      photos: updatePhotos,
    })
  }

  const rest = [...byUpdate.values()].flat()
  if (rest.length > 0) {
    groups.push({ key: 'other', label: 'Other site photos', progress: null, photos: rest })
  }
  return groups
}

function photoAlt(photo) {
  return `${PHOTO_STAGE_LABELS[photo.image_stage] ?? 'Site'} photo, ${formatDate(photo.captured_at)}`
}

function photoCaption(photo) {
  const stage = PHOTO_STAGE_LABELS[photo.image_stage]
  return `${stage ? `${stage} · ` : ''}${formatDate(photo.captured_at)}`
}

// Rendered inside the map pin's details card (ProjectMap renderCardFooter).
function ProjectPhotosButton({ loading, count, onClick }) {
  if (loading) return <p className="text-xs text-slate-400">Loading project photos...</p>
  if (count === 0) return <p className="text-xs text-slate-400">No project photos posted yet.</p>

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
    >
      <Camera className="h-3.5 w-3.5" aria-hidden="true" />
      View Project Photos ({count})
    </button>
  )
}

// Opened from the map pin's card. Portaled to <body> at z-1100 so it sits
// above both the project modal and Leaflet's own layers. Keys are caught in
// the capture phase so Esc closes only this, not the project modal under it.
function ProjectPhotosDialog({ title, groups, onClose }) {
  const flat = useMemo(() => groups.flatMap((group) => group.photos.map((photo) => ({ ...photo, group }))), [groups])
  const [index, setIndex] = useState(null)
  const viewing = index === null ? null : flat[index]

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (index === null) onClose()
        else setIndex(null)
      } else if (index !== null && event.key === 'ArrowRight') {
        setIndex((i) => (i + 1) % flat.length)
      } else if (index !== null && event.key === 'ArrowLeft') {
        setIndex((i) => (i - 1 + flat.length) % flat.length)
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [index, flat.length, onClose])

  const step = (delta) => setIndex((i) => (i + delta + flat.length) % flat.length)

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Close project photos"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-project-photos-title"
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-5">
          <div className="flex min-w-0 items-start gap-2">
            {viewing ? (
              <button
                type="button"
                aria-label="Back to all photos"
                onClick={() => setIndex(null)}
                className="-ml-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
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

        {viewing ? (
          <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
            <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-lg bg-slate-900">
              <img
                src={viewing.signedUrl}
                alt={photoAlt(viewing)}
                className="max-h-[60vh] w-auto max-w-full object-contain"
              />
              {flat.length > 1 ? (
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
                {viewing.group.label} · {photoCaption(viewing)}
              </span>
              <span className="tabular-nums">
                {index + 1} / {flat.length}
              </span>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto px-5 pb-5 pt-4">
            {groups.map((group) => (
              <section key={group.key} className="mb-5 last:mb-0">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-600">{group.label}</h3>
                  {hasValue(group.progress) ? (
                    <Badge tone="blue">{Number(group.progress).toFixed(0)}%</Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {group.photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setIndex(flat.findIndex((p) => p.id === photo.id))}
                      className="group block overflow-hidden rounded-lg border border-slate-200 text-left"
                    >
                      <img
                        src={photo.signedUrl}
                        alt={photoAlt(photo)}
                        loading="lazy"
                        className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <p className="px-1.5 py-1 text-[11px] text-slate-500">{photoCaption(photo)}</p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function hasValue(value) {
  return value !== null && value !== undefined
}

function BudgetUtilization({ data }) {
  const contract = data.contract
  const budget = data.approved_budget
  const contractAmount = contract?.awarded ? contract.contract_amount : null
  const share =
    budget && hasValue(contractAmount) ? Math.min(100, Math.max(0, (contractAmount / budget) * 100)) : null

  return (
    <div className="mb-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <Landmark className="h-4 w-4 text-blue-600" aria-hidden="true" />
        Budget Utilization
      </h3>

      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <Stat label="Approved Budget" value={formatCurrency(budget)} />
        <Stat
          label="Contract Amount"
          value={hasValue(contractAmount) ? formatCurrency(contractAmount) : 'Not yet awarded'}
        />
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

      {contract ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Procurement</p>
            <Badge tone={PROCUREMENT_STATUS_TONES[contract.status]}>
              {PROCUREMENT_STATUS_LABELS[contract.status] ?? contract.status}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label="Mode of Procurement">{contract.mode_of_procurement || '—'}</Field>
            <Field label="Approved Budget for the Contract">{formatCurrency(contract.abc_amount)}</Field>
            {contract.awarded ? (
              <>
                <Field label="Contractor">{contract.contractor_name || '—'}</Field>
                <Field label="Contract No.">{contract.contract_number || '—'}</Field>
                <Field label="Contract Signed">{formatDate(contract.contract_signed_date)}</Field>
                <Field label="Notice to Proceed">{formatDate(contract.notice_to_proceed_date)}</Field>
                <Field label="Contract Duration">
                  {contract.contract_duration_days ? `${contract.contract_duration_days} days` : '—'}
                </Field>
                <Field label="Expected Completion">{formatDate(contract.expected_completion_date)}</Field>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

    </div>
  )
}

function ProgressReports({ progress, updates }) {
  const percent = hasValue(progress) ? Number(progress) : null

  return (
    <div className="mb-4 border-t border-slate-100 pt-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <ClipboardList className="h-4 w-4 text-blue-600" aria-hidden="true" />
        Physical Progress
      </h3>

      {percent !== null ? (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Accomplishment</span>
            <span className="font-semibold text-slate-700">{percent.toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}

      {updates.length === 0 ? (
        <p className="text-xs text-slate-500">No progress reports have been posted yet.</p>
      ) : (
        <ol className="space-y-2">
          {updates.map((update) => (
            <li key={update.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">{formatDate(update.report_date)}</span>
                {hasValue(update.progress_percentage) ? (
                  <Badge tone="blue">{Number(update.progress_percentage).toFixed(0)}%</Badge>
                ) : null}
              </div>
              {update.narrative_report ? (
                <p className="mt-1.5 whitespace-pre-line text-slate-600">{update.narrative_report}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
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

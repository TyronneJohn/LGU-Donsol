import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, FolderKanban, MapPin, MapPinOff, RotateCcw, Search } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import ProjectMap from '../../components/ProjectMap'
import { formatCurrency } from '../../utils/format'
import { getFlagTone } from '../../utils/decisionSupport'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '../../utils/projectStatus'
import { loadGeoProjects } from '../../utils/loadGeoProjects'
import { exportProjectsToExcel, toExportRow } from '../../utils/exportProjects'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

const DSS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'BEHIND_SCHEDULE', label: 'Behind Schedule' },
  { value: 'STALE', label: 'Stale' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'ATTENTION', label: 'Requiring Attention (any flag)' },
]

function isValidCoordinate(lat, lng) {
  const latNum = Number(lat)
  const lngNum = Number(lng)
  return (
    lat !== null &&
    lng !== null &&
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180
  )
}

function matchesDssFilter(project, dssFilter) {
  if (!dssFilter) return true
  const flags = project.flags ?? []
  if (dssFilter === 'ATTENTION') return flags.length > 0
  return flags.some((flag) => flag.type === dssFilter)
}

/**
 * ONE shared Geo Mapping page, reused by MPDC/Engineering/BAC/Admin — each
 * role only supplies its own scope/routing/labels via props; the data
 * loading (loadGeoProjects), filtering UI, invalid-coordinate handling, DSS
 * surfacing, and map rendering (ProjectMap) all live here exactly once.
 * Always read-only — no prop exists for editing project data from this page
 * for any role. A map-rendering failure (see ProjectMap's own error
 * boundary) never takes down this page: the count summary, "Requiring
 * Attention" section, project list, and "without coordinates" list are all
 * siblings of the map, not children of it.
 *
 * @param {string} homePath - role's dashboard route, e.g. "/mpdc"
 * @param {string} description - PageHeader subtitle
 * @param {(projects: object[], ctx: { user: object, profile: object|null }) => object[]} [filterRelevant] - narrows the full staff-visible project list to what this role cares about; omit to show everything
 * @param {(project: object) => string|null|undefined} getDetailHref - role-appropriate "View Project" destination
 * @param {boolean} [showDss] - show DSS flags, the DSS filter, and the "Requiring Attention" section (not for BAC)
 * @param {boolean} [showExport] - show the Excel export action
 */
export default function GeoMappingPage({
  homePath,
  description = 'Where projects are located, based on the coordinates recorded on each project.',
  filterRelevant,
  getDetailHref,
  showDss = false,
  showExport = false,
}) {
  const toast = useToast()
  const { user } = useAuth()

  const [profile, setProfile] = useState(null)
  const [allProjects, setAllProjects] = useState([])
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [statusFilter, setStatusFilter] = useState('')
  const [barangayFilter, setBarangayFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [officeFilter, setOfficeFilter] = useState('')
  const [dssFilter, setDssFilter] = useState('')
  const [search, setSearch] = useState('')

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, name').order('name', { ascending: true })
    if (!error) setOffices(data ?? [])
  }

  // Guaranteed to reach the finally below on every path — success, a
  // Supabase error, or any unexpected thrown error — so `loading` can never
  // get stuck true, matching the fix already applied to the MPDC dashboard.
  async function loadAll() {
    setLoading(true)
    setLoadError(null)

    try {
      const [profileResult, geoResult] = await Promise.all([
        supabase.from('profiles').select('office_id').eq('id', user.id).maybeSingle(),
        loadGeoProjects(supabase),
      ])

      if (profileResult.error) throw profileResult.error

      setProfile(profileResult.data ?? null)
      setAllProjects(geoResult.projects)
      geoResult.warnings.forEach((warning) =>
        toast.error('Could not load some monitoring/procurement data', warning.message),
      )
    } catch (error) {
      setLoadError(error.message || 'Something went wrong while loading projects.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOffices()
    loadAll()
  }, [])

  const relevantProjects = useMemo(() => {
    if (!filterRelevant) return allProjects
    return filterRelevant(allProjects, { user, profile })
  }, [allProjects, filterRelevant, user, profile])

  const barangayOptions = useMemo(
    () => [...new Set(relevantProjects.map((p) => p.barangay).filter(Boolean))].sort(),
    [relevantProjects],
  )
  const categoryOptions = useMemo(
    () => [...new Set(relevantProjects.map((p) => p.project_category).filter(Boolean))].sort(),
    [relevantProjects],
  )

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase()
    return relevantProjects.filter((project) => {
      if (statusFilter && project.status !== statusFilter) return false
      if (barangayFilter && project.barangay !== barangayFilter) return false
      if (categoryFilter && project.project_category !== categoryFilter) return false
      if (officeFilter && project.office_id !== officeFilter) return false
      if (showDss && !matchesDssFilter(project, dssFilter)) return false
      if (!term) return true
      return (
        project.title?.toLowerCase().includes(term) || project.project_code?.toLowerCase().includes(term)
      )
    })
  }, [relevantProjects, statusFilter, barangayFilter, categoryFilter, officeFilter, dssFilter, showDss, search])

  const mappableProjects = useMemo(
    () => filteredProjects.filter((p) => isValidCoordinate(p.latitude, p.longitude)),
    [filteredProjects],
  )
  const unmappableProjects = useMemo(
    () => filteredProjects.filter((p) => !isValidCoordinate(p.latitude, p.longitude)),
    [filteredProjects],
  )
  const attentionProjects = useMemo(
    () => (showDss ? filteredProjects.filter((p) => p.flags?.length > 0) : []),
    [filteredProjects, showDss],
  )

  async function handleExport() {
    setExporting(true)
    try {
      exportProjectsToExcel(filteredProjects.map(toExportRow))
      toast.success('Export ready', `${filteredProjects.length} project(s) exported.`)
    } catch (error) {
      toast.error('Could not export projects', error.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Geo Mapping"
        description={description}
        breadcrumbs={[{ label: 'Dashboard', to: homePath }, { label: 'Geo Mapping' }]}
        actions={
          showExport ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={handleExport}
              loading={exporting}
              disabled={loading || filteredProjects.length === 0}
            >
              Export Filtered (Excel)
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or code"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} max-w-[190px]`}>
          <option value="">All statuses</option>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select value={barangayFilter} onChange={(event) => setBarangayFilter(event.target.value)} className={`${inputClass} max-w-[170px]`}>
          <option value="">All barangays</option>
          {barangayOptions.map((barangay) => (
            <option key={barangay} value={barangay}>
              {barangay}
            </option>
          ))}
        </select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={`${inputClass} max-w-[170px]`}>
          <option value="">All project types</option>
          {categoryOptions.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select value={officeFilter} onChange={(event) => setOfficeFilter(event.target.value)} className={`${inputClass} max-w-[200px]`}>
          <option value="">All offices</option>
          {offices.map((office) => (
            <option key={office.id} value={office.id}>
              {office.name}
            </option>
          ))}
        </select>
        {showDss ? (
          <select value={dssFilter} onChange={(event) => setDssFilter(event.target.value)} className={`${inputClass} max-w-[220px]`}>
            {DSS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                DSS: {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : loadError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Unable to load projects"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={loadAll}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <div className={`grid grid-cols-2 gap-3 ${showDss ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" /> Total Projects
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{filteredProjects.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Mapped Projects
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{mappableProjects.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                <MapPinOff className="h-3.5 w-3.5" aria-hidden="true" /> Without Coordinates
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{unmappableProjects.length}</p>
            </div>
            {showDss ? (
              <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Requiring Attention
                </p>
                <p className={`mt-1 text-2xl font-semibold ${attentionProjects.length > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                  {attentionProjects.length}
                </p>
              </div>
            ) : null}
          </div>

          <ProjectMap projects={mappableProjects} getDetailHref={getDetailHref} showDss={showDss} />

          {showDss && attentionProjects.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Projects Requiring Attention
              </h2>
              <ul className="mt-3 space-y-2">
                {attentionProjects.map((project) => {
                  const detailHref = getDetailHref?.(project)
                  const body = (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{project.title}</span>
                        <span className="text-xs text-slate-500">{project.project_code}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {project.flags.map((flag) => (
                          <Badge key={flag.type} tone={getFlagTone(flag.severity)}>
                            {flag.type.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    </>
                  )
                  return (
                    <li key={project.id} className="rounded-md border border-amber-100 bg-white p-3">
                      {detailHref ? (
                        <a href={detailHref} className="block hover:opacity-80">
                          {body}
                        </a>
                      ) : (
                        body
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
            <h2 className="text-sm font-semibold text-slate-800">Project List ({filteredProjects.length})</h2>
            {filteredProjects.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No projects match the current filters.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Title</th>
                      <th className="py-2 pr-3 font-medium">Barangay</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Office</th>
                      <th className="py-2 pr-3 font-medium">Budget</th>
                      <th className="py-2 pr-3 font-medium">Progress</th>
                      {showDss ? <th className="py-2 pr-3 font-medium">DSS</th> : null}
                      <th className="py-2 pr-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProjects.map((project) => {
                      const detailHref = getDetailHref?.(project)
                      return (
                        <tr key={project.id}>
                          <td className="py-2 pr-3 text-slate-800">
                            {project.title}
                            <span className="ml-1.5 text-xs text-slate-400">{project.project_code}</span>
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{project.barangay || '—'}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 text-slate-600">{project.offices?.name || '—'}</td>
                          <td className="py-2 pr-3 text-slate-600">
                            {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {project.progress_percentage != null ? `${project.progress_percentage}%` : '—'}
                          </td>
                          {showDss ? (
                            <td className="py-2 pr-3">
                              {project.flags?.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {project.flags.map((flag) => (
                                    <Badge key={flag.type} tone={getFlagTone(flag.severity)}>
                                      {flag.type.replace('_', ' ')}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                          ) : null}
                          <td className="py-2 pr-3 text-right">
                            {detailHref ? (
                              <Button to={detailHref} variant="ghost" size="sm">
                                View Project
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPinOff className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <span>
                Projects without coordinates:{' '}
                <span className="font-medium text-slate-800">{unmappableProjects.length}</span>
              </span>
            </div>
            {unmappableProjects.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {unmappableProjects.map((project) => {
                  const detailHref = getDetailHref?.(project)
                  return (
                    <li key={project.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <div>
                        <span className="text-slate-800">{project.title}</span>
                        <span className="ml-2 text-xs text-slate-400">Barangay: {project.barangay || '—'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-500">
                          {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                        </span>
                        {detailHref ? (
                          <Button to={detailHref} variant="ghost" size="sm">
                            View Project
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

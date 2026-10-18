import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Globe, GlobeLock, Search } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Pagination from '../../components/ui/Pagination'
import { usePagination } from '../../hooks/usePagination'
import SearchInput from '../../components/ui/SearchInput'
import { matchesProjectSearch } from '../../utils/projectSearch'
import StatusTabs from '../../components/ui/StatusTabs'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { exportProjectsToExcel, toExportRow } from '../../utils/exportProjects'

const QUARTER_MONTHS = {
  1: [0, 2], // Jan-Mar
  2: [3, 5], // Apr-Jun
  3: [6, 8], // Jul-Sep
  4: [9, 11], // Oct-Dec
}

const selectClass =
  'rounded-md border border-slate-400 dark:border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

function currentQuarter() {
  return Math.floor(new Date().getMonth() / 3) + 1
}

function quarterRange(quarter, year) {
  const [startMonth, endMonth] = QUARTER_MONTHS[quarter]
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, endMonth + 1, 0) // last day of the quarter's final month
  const toIso = (d) => d.toISOString().slice(0, 10)
  return { start: toIso(start), end: toIso(end) }
}

// MPDC's publish window is enforced server-side (RLS): visibility/
// published_at/published_by can only be changed on a project while its
// status is APPROVED (see projects_update_scoped in
// 20260811100000_initial_schema.sql). Projects that already moved past
// APPROVED but were published earlier still show here, read-only, so MPDC
// can see what's currently live on the public site.
export default function PublishedProjects() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [togglingId, setTogglingId] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') ?? ''
  const [exporting, setExporting] = useState(false)
  const [reportQuarter, setReportQuarter] = useState(currentQuarter())
  const [reportYear, setReportYear] = useState(new Date().getFullYear())

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_code, title, status, visibility, published_at, estimated_cost, approved_budget, offices(name)')
      .or('status.eq.APPROVED,visibility.eq.PUBLIC')
      .order('updated_at', { ascending: false })

    if (error) {
      toast.error('Could not load projects', error.message)
    } else {
      setProjects(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  async function handleToggle(project) {
    const publishing = project.visibility !== 'PUBLIC'

    const confirmed = await confirm({
      title: publishing ? 'Publish this project?' : 'Unpublish this project?',
      description: publishing
        ? 'This project will become visible to the public on the citizen-facing site.'
        : 'This project will be removed from the public site immediately.',
      confirmLabel: publishing ? 'Publish' : 'Unpublish',
      tone: publishing ? 'default' : 'danger',
    })
    if (!confirmed) return

    setTogglingId(project.id)
    const { error } = await supabase
      .from('projects')
      .update({
        visibility: publishing ? 'PUBLIC' : 'PRIVATE',
        published_at: publishing ? new Date().toISOString() : null,
        published_by: publishing ? user.id : null,
      })
      .eq('id', project.id)

    if (error) {
      toast.error('Could not update visibility', error.message)
    } else {
      toast.success(publishing ? 'Project published' : 'Project unpublished')
      await loadProjects()
    }
    setTogglingId(null)
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { start, end } = quarterRange(reportQuarter, reportYear)

      // Only projects currently live on the public site are exported.
      // "Active during the quarter": the project's planned schedule overlaps
      // the selected quarter at all, so a project spanning several quarters
      // still shows up in each one instead of only its start quarter.
      const { data: projectRows, error } = await supabase
        .from('projects')
        .select(
          `id, project_code, title, description, project_category, sector, barangay, location_text,
           estimated_cost, approved_budget,
           start_date_planned, end_date_planned, start_date_actual, end_date_actual,
           status, created_at`,
        )
        .eq('visibility', 'PUBLIC')
        .lte('start_date_planned', end)
        .or(`end_date_planned.is.null,end_date_planned.gte.${start}`)
        .order('title', { ascending: true })

      if (error) throw error

      const rows = projectRows ?? []
      const ids = rows.map((p) => p.id)

      const { data: updates } = ids.length
        ? await supabase
            .from('project_updates')
            .select('project_id, progress_percentage, issues_encountered, report_date')
            .in('project_id', ids)
            .order('report_date', { ascending: false })
        : { data: [] }

      const latestUpdateByProject = new Map()
      for (const update of updates ?? []) {
        if (!latestUpdateByProject.has(update.project_id)) latestUpdateByProject.set(update.project_id, update)
      }

      const enriched = rows.map((project) => {
        const latestUpdate = latestUpdateByProject.get(project.id)
        return {
          ...project,
          progress_percentage: latestUpdate?.progress_percentage ?? null,
          latest_issues: latestUpdate?.issues_encountered ?? null,
        }
      })

      await exportProjectsToExcel(enriched.map(toExportRow), {
        quarterLabel: `Q${reportQuarter} ${reportYear}`,
        periodEnd: new Date(end).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }),
        filenamePrefix: `LGU-Donsol-Q${reportQuarter}-${reportYear}-Published-Projects`,
      })
      toast.success(
        'Export ready',
        `${enriched.length} published project(s) exported for Q${reportQuarter} ${reportYear}.`,
      )
    } catch (error) {
      toast.error('Could not export projects', error.message)
    } finally {
      setExporting(false)
    }
  }

  const searchedProjects = useMemo(
    () => projects.filter((project) => matchesProjectSearch(project, search)),
    [projects, search],
  )
  const filteredProjects = statusFilter
    ? searchedProjects.filter((project) => project.status === statusFilter)
    : searchedProjects

  function updateStatusFilter(value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('status', value)
    else next.delete('status')
    setSearchParams(next, { replace: true })
  }

  const pagination = usePagination(filteredProjects, [search, statusFilter])

  return (
    <div>
      <PageHeader
        title="Published Projects"
        description="Manage what's visible on the public site."
        breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'Published Projects' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Report quarter"
              value={reportQuarter}
              onChange={(event) => setReportQuarter(Number(event.target.value))}
              className={selectClass}
            >
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
            <select
              aria-label="Report year"
              value={reportYear}
              onChange={(event) => setReportYear(Number(event.target.value))}
              className={selectClass}
            >
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Button icon={Download} onClick={handleExport} loading={exporting}>
              Download Excel Report
            </Button>
          </div>
        }
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search by project title, code, or office" />
      {!loading && projects.length > 0 ? (
        <StatusTabs projects={searchedProjects} value={statusFilter} onChange={updateStatusFilter} />
      ) : null}

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No projects available to publish"
          description="Projects appear here once they've been endorsed to BAC (status: Endorsed to BAC)."
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          description="Try a different status tab or search term."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Est. Cost</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Visibility</th>
                <th className="px-4 py-2.5 font-medium">Published</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagination.pageItems.map((project) => {
                const isPublic = project.visibility === 'PUBLIC'
                const canToggle = project.status === 'APPROVED'
                return (
                  <tr key={project.id}>
                    <td className="px-4 py-2.5 text-slate-800">{project.project_code ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                    <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={isPublic ? 'green' : 'neutral'}>{isPublic ? 'Public' : 'Private'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(project.published_at)}</td>
                    <td className="px-4 py-2.5">
                      {canToggle ? (
                        <Button
                          variant={isPublic ? 'secondary' : 'primary'}
                          size="sm"
                          icon={isPublic ? GlobeLock : Globe}
                          loading={togglingId === project.id}
                          onClick={() => handleToggle(project)}
                        >
                          {isPublic ? 'Unpublish' : 'Publish'}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">Publish window closed</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading ? <Pagination {...pagination} /> : null}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FolderKanban, Plus, RotateCcw } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { MONITORING_VISIBLE_STATUSES } from '@shared/utils/projectStatus'
import { useToast } from '../../hooks/useToast'
import { useAnnualBudget } from '../../hooks/useAnnualBudget'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import StatTile from '../../components/ui/StatTile'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { formatCurrency } from '@shared/utils/format'
import { exportProjectsToExcel, toExportRow } from '../../utils/exportProjects'

// Ongoing/Completed link into Monitoring, which shows exactly that status,
// cross-office. Total/Submitted span every status (or a pre-approval status
// Monitoring deliberately excludes) so they link into All Projects instead —
// the general cross-office, every-status list.
const STAT_TILES = [
  { key: 'total', label: 'Total Projects', to: '/mpdc/all-projects' },
  { key: 'submitted', label: 'Submitted to Engineering', to: '/mpdc/all-projects?status=SUBMITTED_FOR_REVIEW' },
  { key: 'ongoing', label: 'Ongoing', to: '/mpdc/monitoring?status=ONGOING' },
  { key: 'completed', label: 'Completed', to: '/mpdc/monitoring?status=COMPLETED' },
]

const QUARTER_MONTHS = {
  1: [0, 2], // Jan-Mar
  2: [3, 5], // Apr-Jun
  3: [6, 8], // Jul-Sep
  4: [9, 11], // Oct-Dec
}

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

export default function MpdcDashboard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})
  const [reportQuarter, setReportQuarter] = useState(currentQuarter())
  const [reportYear, setReportYear] = useState(new Date().getFullYear())
  const budget = useAnnualBudget()

  // Every exit from this function — success, a query error, or any
  // unexpected thrown error — goes through the single finally below, so
  // `loading` is guaranteed to end up false. Previously the query-error path
  // set loading=false but never set `counts`, and the render below checked
  // `loading || !counts` — meaning a failed request left the page stuck
  // showing "Loading dashboard..." forever even though `loading` itself had
  // correctly become false. `loadError` now drives a distinct, visible error
  // state instead of relying on `counts` staying null to imply failure.
  async function loadSummary() {
    setLoading(true)
    setLoadError(null)

    try {
      const { data: rows, error } = await supabase.from('projects').select('id, status')

      if (error) throw error

      const projects = rows ?? []
      const byStatus = (status) => projects.filter((p) => p.status === status).length

      const tally = {}
      for (const project of projects) tally[project.status] = (tally[project.status] ?? 0) + 1
      setStatusTally(tally)

      setCounts({
        total: projects.length,
        submitted: byStatus('SUBMITTED_FOR_REVIEW'),
        ongoing: byStatus('ONGOING'),
        completed: byStatus('COMPLETED'),
      })
    } catch (error) {
      setLoadError(error.message || 'Something went wrong while loading the dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  async function handleExportAll() {
    setExporting(true)
    try {
      const { start, end } = quarterRange(reportQuarter, reportYear)

      // "Active during the quarter": the project's planned schedule overlaps
      // the selected quarter at all, so a project spanning several quarters
      // still shows up in each one instead of only its start quarter. Scoped
      // to APPROVED-onward statuses (mirrors MONITORING_VISIBLE_STATUSES) —
      // Draft/Submitted/Returned/Rejected projects aren't programmed yet and
      // don't belong in an accomplishment report.
      const { data: projectRows, error } = await supabase
        .from('projects')
        .select(
          `id, project_code, title, description, project_category, sector, barangay, location_text,
           estimated_cost, approved_budget,
           start_date_planned, end_date_planned, start_date_actual, end_date_actual,
           status, created_at`,
        )
        .in('status', MONITORING_VISIBLE_STATUSES)
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
        filenamePrefix: `LGU-Donsol-Q${reportQuarter}-${reportYear}-Project-Report`,
      })
      toast.success('Export ready', `${enriched.length} project(s) exported for Q${reportQuarter} ${reportYear}.`)
    } catch (error) {
      toast.error('Could not export projects', error.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Projects you're planning, submitting for review, or overseeing."
      />

      {loading ? (
        <LoadingState label="Loading dashboard..." />
      ) : loadError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Unable to load dashboard"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={loadSummary}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-3">
            <StatTile
              label={`Remaining Budget — ${budget.year}`}
              value={budget.loading ? '—' : budget.ceiling != null ? formatCurrency(budget.remaining) : 'Not set'}
              featured
            />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {STAT_TILES.map((tile) => (
              <StatTile key={tile.key} label={tile.label} value={counts[tile.key]} to={tile.to} />
            ))}
          </div>
        </>
      )}

      {!loading && !loadError ? <ProjectStatusCharts counts={statusTally} /> : null}

      <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Quick Actions</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button icon={Plus} to="/mpdc/projects/new">
            Create Project
          </Button>
          <Button icon={FolderKanban} variant="secondary" to="/mpdc/projects">
            View Projects
          </Button>
        </div>

        <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">Accomplishment Report</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label="Report quarter"
            value={reportQuarter}
            onChange={(event) => setReportQuarter(Number(event.target.value))}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
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
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button icon={Download} variant="secondary" onClick={handleExportAll} loading={exporting}>
            Download Excel Report
          </Button>
        </div>
      </div>
    </div>
  )
}

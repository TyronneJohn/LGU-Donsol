import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FolderKanban, Plus, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { exportProjectsToExcel, toExportRow } from '../../utils/exportProjects'

const STAT_TILES = [
  { key: 'total', label: 'Total Projects' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Submitted to Engineering' },
  { key: 'endorsed', label: 'Endorsed to BAC' },
  { key: 'procurement', label: 'In Procurement' },
  { key: 'implementation', label: 'Under Implementation' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'attention', label: 'Requiring Attention (DSS)', tone: 'amber' },
]

export default function MpdcDashboard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})

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

      // The DSS engine (see supabase/migrations/20260817100000_dss_automatic_
      // evaluation.sql onward) persists its current decision directly on
      // each project row, so this is a single count query instead of
      // fetching every monitoring-eligible project's updates and
      // recomputing flags client-side. NULL/ON_TRACK/COMPLETED are excluded
      // by "not in (...)" naturally (NULL NOT IN (...) is unknown, not
      // true, so those rows never match) — same "anything the DSS flagged"
      // meaning the old client-side flag count had.
      let attention = 0
      const { count: attentionCount, error: attentionError } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .not('dss_decision', 'in', '(ON_TRACK,COMPLETED)')

      if (attentionError) {
        // Supplementary to the headline counts — degrade to "unknown" (0)
        // for the DSS tile instead of failing the whole dashboard, but
        // still surface it instead of hiding it.
        toast.error('Could not load DSS summary', attentionError.message)
      } else {
        attention = attentionCount ?? 0
      }

      setCounts({
        total: projects.length,
        draft: byStatus('DRAFT'),
        submitted: byStatus('SUBMITTED_FOR_REVIEW'),
        endorsed: byStatus('APPROVED'),
        procurement: byStatus('FOR_PROCUREMENT'),
        implementation: byStatus('FOR_IMPLEMENTATION'),
        ongoing: byStatus('ONGOING'),
        completed: byStatus('COMPLETED'),
        attention,
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
      const { data: projectRows, error } = await supabase
        .from('projects')
        .select(
          `id, project_code, title, description, project_category, barangay, location_text,
           latitude, longitude, estimated_cost, approved_budget, funding_source,
           start_date_planned, end_date_planned, start_date_actual, end_date_actual,
           status, created_at,
           offices(name)`,
        )
        .order('created_at', { ascending: false })

      if (error) throw error

      const rows = projectRows ?? []
      const ids = rows.map((p) => p.id)

      const [updatesResult, procurementResult] = ids.length
        ? await Promise.all([
            supabase
              .from('project_updates')
              .select('project_id, progress_percentage, report_date')
              .in('project_id', ids)
              .order('report_date', { ascending: false }),
            supabase.from('procurement').select('project_id, status, contractors(name)').in('project_id', ids).eq('is_current', true),
          ])
        : [{ data: [] }, { data: [] }]

      const latestUpdateByProject = new Map()
      for (const update of updatesResult.data ?? []) {
        if (!latestUpdateByProject.has(update.project_id)) latestUpdateByProject.set(update.project_id, update)
      }
      const procurementByProject = new Map((procurementResult.data ?? []).map((p) => [p.project_id, p]))

      const enriched = rows.map((project) => {
        const latestUpdate = latestUpdateByProject.get(project.id)
        const procurement = procurementByProject.get(project.id)
        return {
          ...project,
          progress_percentage: latestUpdate?.progress_percentage ?? null,
          latest_monitoring_date: latestUpdate?.report_date ?? null,
          procurement_status: procurement?.status ?? null,
          contractor_name: procurement?.contractors?.name ?? null,
        }
      })

      exportProjectsToExcel(enriched.map(toExportRow))
      toast.success('Export ready', `${enriched.length} project(s) exported.`)
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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAT_TILES.map((tile) => (
            <div key={tile.key} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{tile.label}</p>
              <p
                className={`mt-1 flex items-center gap-1.5 text-2xl font-semibold ${
                  tile.tone === 'amber' && counts[tile.key] > 0 ? 'text-amber-600' : 'text-slate-800'
                }`}
              >
                {tile.tone === 'amber' && counts[tile.key] > 0 ? (
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                ) : null}
                {counts[tile.key]}
              </p>
            </div>
          ))}
        </div>
      )}

      {!loading && !loadError ? <ProjectStatusCharts counts={statusTally} /> : null}

      <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
        <h2 className="text-sm font-semibold text-slate-800">Quick Actions</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button icon={Plus} to="/mpdc/projects/new">
            Create Project
          </Button>
          <Button icon={FolderKanban} variant="secondary" to="/mpdc/projects">
            View Projects
          </Button>
          <Button icon={Download} variant="secondary" onClick={handleExportAll} loading={exporting}>
            Download Excel Report
          </Button>
        </div>
      </div>
    </div>
  )
}

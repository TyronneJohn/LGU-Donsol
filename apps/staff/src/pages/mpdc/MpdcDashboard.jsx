import { useEffect, useState } from 'react'
import { AlertTriangle, Download, FolderKanban, Plus, RotateCcw } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { exportProjectsToExcel, toExportRow } from '../../utils/exportProjects'

const STAT_TILES = [
  { key: 'total', label: 'Total Projects' },
  { key: 'submitted', label: 'Submitted to Engineering' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STAT_TILES.map((tile) => (
            <div key={tile.key} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{tile.label}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-800">{counts[tile.key]}</p>
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

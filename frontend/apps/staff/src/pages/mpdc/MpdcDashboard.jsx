import { useEffect, useState } from 'react'
import { AlertTriangle, FolderKanban, Plus, RotateCcw } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useAnnualBudget } from '../../hooks/useAnnualBudget'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import StatTile from '../../components/ui/StatTile'
import SavingsTile from '../../components/SavingsTile'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { formatCurrency } from '@shared/utils/format'

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

export default function MpdcDashboard() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})
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
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <div>
              <StatTile
                label={`Remaining Budget — ${budget.year}`}
                value={budget.loading ? '—' : budget.ceiling != null ? formatCurrency(budget.remaining) : 'Not set'}
                featured
              />
            </div>
            <SavingsTile projectLink={(id) => `/mpdc/monitoring/${id}`} />
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
      </div>
    </div>
  )
}

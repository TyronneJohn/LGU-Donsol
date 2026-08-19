import { useEffect, useState } from 'react'
import { AlertTriangle, FolderKanban, Landmark, RotateCcw, ScrollText, Users } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'

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

export default function AdminDashboard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})

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

      let attention = 0
      const { count: attentionCount, error: attentionError } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .not('dss_decision', 'in', '(ON_TRACK,COMPLETED)')

      if (attentionError) {
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

  return (
    <div>
      <PageHeader title="Dashboard" description="System-wide overview across all offices." />

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
      ) : counts.total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No dashboard data yet"
          description="Once projects, submissions, and procurement activity start flowing through the system, an overview will appear here."
        />
      ) : (
        <>
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
          <ProjectStatusCharts counts={statusTally} title="Projects by Status — All Offices" />

          <div className="mt-6 rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Quick Actions</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon={FolderKanban} to="/admin/projects">
                View Projects
              </Button>
              <Button icon={Users} variant="secondary" to="/admin/staff">
                Manage Staff Accounts
              </Button>
              <Button icon={Landmark} variant="secondary" to="/admin/offices">
                Manage Offices
              </Button>
              <Button icon={ScrollText} variant="secondary" to="/admin/audit-log">
                View Audit Log
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

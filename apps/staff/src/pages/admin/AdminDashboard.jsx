import { useEffect, useState } from 'react'
import { AlertTriangle, FolderKanban, Landmark, Pencil, RotateCcw, ScrollText, Users } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAnnualBudget } from '../../hooks/useAnnualBudget'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import StatTile from '../../components/ui/StatTile'
import SetAnnualBudgetModal from '../../components/ui/SetAnnualBudgetModal'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { formatCurrency } from '@shared/utils/format'

// Each tile links to /admin/projects pre-filtered to exactly the set it
// counts, so what you click through to always matches the number you saw.
const STAT_TILES = [
  { key: 'total', label: 'Total Projects', to: '/admin/projects' },
  { key: 'submitted', label: 'Submitted to Engineering', to: '/admin/projects?status=SUBMITTED_FOR_REVIEW' },
  { key: 'endorsed', label: 'Endorsed to BAC', to: '/admin/projects?status=APPROVED' },
  { key: 'procurement', label: 'In Procurement', to: '/admin/projects?status=FOR_PROCUREMENT' },
  { key: 'implementation', label: 'Under Implementation', to: '/admin/projects?status=FOR_IMPLEMENTATION' },
  { key: 'ongoing', label: 'Ongoing', to: '/admin/projects?status=ONGOING' },
  { key: 'completed', label: 'Completed', to: '/admin/projects?status=COMPLETED' },
  { key: 'attention', label: 'Requiring Attention (DSS)', to: '/admin/projects?dss=1', tone: 'amber' },
]

export default function AdminDashboard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const budget = useAnnualBudget()

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
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/60 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-slate-400">
                Remaining Budget — {budget.year}
              </p>
              <p className={`mt-1 text-3xl font-semibold ${budget.remaining < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {budget.loading ? '—' : budget.ceiling != null ? formatCurrency(budget.remaining) : 'Not set'}
              </p>
              {!budget.loading && budget.ceiling != null ? (
                <p className="mt-1 text-xs text-slate-500">
                  {formatCurrency(budget.ceiling)} appropriated · {formatCurrency(budget.committed)} committed to
                  endorsed and ongoing projects
                </p>
              ) : null}
            </div>
            <Button variant="secondary" icon={Pencil} onClick={() => setBudgetModalOpen(true)}>
              {budget.ceiling != null ? 'Edit Annual Budget' : 'Set Annual Budget'}
            </Button>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {STAT_TILES.map((tile) => (
              <StatTile
                key={tile.key}
                label={tile.label}
                value={counts[tile.key]}
                to={tile.to}
                warn={tile.tone === 'amber' && counts[tile.key] > 0}
              />
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

      <SetAnnualBudgetModal
        open={budgetModalOpen}
        year={budget.year}
        currentAmount={budget.ceiling}
        onSave={budget.save}
        onClose={() => setBudgetModalOpen(false)}
      />
    </div>
  )
}

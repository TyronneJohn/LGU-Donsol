import { useEffect, useState } from 'react'
import { Gavel } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAnnualBudget } from '../../hooks/useAnnualBudget'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import StatTile from '../../components/ui/StatTile'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { formatCurrency } from '@shared/utils/format'
import {
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROCUREMENT_ELIGIBLE_STATUSES,
} from '@shared/utils/projectStatus'

// Clicking a card filters the table below (same page — unlike the other
// office dashboards there's no separate list page to navigate to). Clicking
// the active card again clears the filter.
function StatCard({ label, value, active, onClick, featured }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`block w-full rounded-xl border text-left shadow-sm transition-colors ${featured ? 'col-span-2 p-5' : 'p-4'} ${
        active
          ? 'border-blue-300 bg-blue-50/60 shadow-blue-200/60'
          : 'border-slate-200/70 bg-white shadow-slate-200/60 hover:border-blue-300 hover:bg-blue-50/40'
      } ${onClick ? '' : 'cursor-default'}`}
    >
      <p className={`font-medium uppercase tracking-wide text-slate-400 ${featured ? 'text-sm' : 'text-xs'}`}>{label}</p>
      <p className={`mt-1 font-semibold text-slate-800 ${featured ? 'text-3xl' : 'text-2xl'}`}>{value}</p>
    </button>
  )
}

export default function BacDashboard() {
  const toast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [procurementFilter, setProcurementFilter] = useState(null)
  const [statusTally, setStatusTally] = useState({})
  const budget = useAnnualBudget()

  // Independent of `loadProjects` below (which only fetches the
  // procurement-eligible subset for the table) — this covers every project
  // status system-wide, for the chart.
  async function loadStatusTally() {
    const { data, error } = await supabase.from('projects').select('status')
    if (error) {
      toast.error('Could not load status overview', error.message)
      return
    }
    const tally = {}
    for (const row of data ?? []) tally[row.status] = (tally[row.status] ?? 0) + 1
    setStatusTally(tally)
  }

  async function loadProjects() {
    setLoading(true)

    const { data: projectRows, error: projectsError } = await supabase
      .from('projects')
      .select('id, project_code, title, status, estimated_cost, approved_budget, offices(name)')
      .in('status', PROCUREMENT_ELIGIBLE_STATUSES)
      .order('status', { ascending: true })
      .order('created_at', { ascending: true })

    if (projectsError) {
      toast.error('Could not load projects', projectsError.message)
      setLoading(false)
      return
    }

    const rows = projectRows ?? []
    if (rows.length === 0) {
      setProjects([])
      setLoading(false)
      return
    }

    const { data: procurementRows, error: procurementError } = await supabase
      .from('procurement')
      .select('project_id, status, mode_of_procurement, abc_amount, bid_opening_date, contractors(name)')
      .in(
        'project_id',
        rows.map((p) => p.id),
      )
      .eq('is_current', true)

    if (procurementError) {
      toast.error('Could not load procurement records', procurementError.message)
    }

    const procurementByProject = new Map((procurementRows ?? []).map((row) => [row.project_id, row]))

    setProjects(rows.map((project) => ({ ...project, procurement: procurementByProject.get(project.id) ?? null })))
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
    loadStatusTally()
  }, [])

  const notStarted = projects.filter((p) => !p.procurement).length
  const bidding = projects.filter((p) => ['BIDDING', 'BID_EVALUATION'].includes(p.procurement?.status)).length
  const awarded = projects.filter((p) => p.procurement?.status === 'AWARDED').length
  const totalAbc = projects.reduce((sum, p) => sum + Number(p.procurement?.abc_amount ?? p.approved_budget ?? 0), 0)

  const FILTERS = {
    not_started: (p) => !p.procurement,
    bidding: (p) => ['BIDDING', 'BID_EVALUATION'].includes(p.procurement?.status),
    awarded: (p) => p.procurement?.status === 'AWARDED',
  }
  const visibleProjects = procurementFilter ? projects.filter(FILTERS[procurementFilter]) : projects
  const toggleFilter = (key) => setProcurementFilter((current) => (current === key ? null : key))

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Procurement cycles in progress and projects ready to bid."
      />

      {loading ? (
        <LoadingState label="Loading procurement activity..." />
      ) : (
        <div className="space-y-6">
          <StatTile
            label={`Remaining Budget — ${budget.year}`}
            value={budget.loading ? '—' : budget.ceiling != null ? formatCurrency(budget.remaining) : 'Not set'}
            featured
          />
          <StatCard
            label="Total ABC / Budget"
            value={formatCurrency(totalAbc)}
            active={!procurementFilter}
            onClick={projects.length ? () => setProcurementFilter(null) : undefined}
            featured
          />
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Awaiting Procurement Start"
              value={notStarted}
              active={procurementFilter === 'not_started'}
              onClick={projects.length ? () => toggleFilter('not_started') : undefined}
            />
            <StatCard
              label="Bidding / Evaluation"
              value={bidding}
              active={procurementFilter === 'bidding'}
              onClick={projects.length ? () => toggleFilter('bidding') : undefined}
            />
            <StatCard
              label="Awarded, Pending Contract"
              value={awarded}
              active={procurementFilter === 'awarded'}
              onClick={projects.length ? () => toggleFilter('awarded') : undefined}
            />
          </div>

          <ProjectStatusCharts counts={statusTally} title="Projects by Status — All Offices" />

          {projects.length === 0 ? (
            <EmptyState
              icon={Gavel}
              title="No procurement activity yet"
              description="Projects approved for procurement will appear here once BAC opens a bidding cycle."
            />
          ) : (
            <>
              {procurementFilter ? (
                <p className="text-sm text-slate-500">
                  Showing {visibleProjects.length} of {projects.length} project{projects.length === 1 ? '' : 's'} —{' '}
                  <button
                    type="button"
                    onClick={() => setProcurementFilter(null)}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    Clear filter
                  </button>
                </p>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Project Code</th>
                      <th className="px-4 py-2.5 font-medium">Title</th>
                      <th className="px-4 py-2.5 font-medium">Office</th>
                      <th className="px-4 py-2.5 font-medium">Procurement Status</th>
                      <th className="px-4 py-2.5 font-medium">ABC</th>
                      <th className="px-4 py-2.5 font-medium">Contractor</th>
                      <th className="px-4 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleProjects.map((project) => (
                      <tr key={project.id}>
                        <td className="px-4 py-2.5 text-slate-800">{project.project_code ?? '—'}</td>
                        <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                        <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {project.procurement ? (
                            <Badge tone={PROCUREMENT_STATUS_TONES[project.procurement.status]}>
                              {PROCUREMENT_STATUS_LABELS[project.procurement.status] ?? project.procurement.status}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">Not started</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {formatCurrency(project.procurement?.abc_amount ?? project.approved_budget)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{project.procurement?.contractors?.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Button to={`/bac/procurement/${project.id}`} variant="secondary" size="sm">
                            {project.procurement ? 'Open' : 'Start Procurement'}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

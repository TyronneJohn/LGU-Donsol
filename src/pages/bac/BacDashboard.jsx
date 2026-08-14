import { useEffect, useState } from 'react'
import { Gavel } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatCurrency } from '../../utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROCUREMENT_ELIGIBLE_STATUSES,
} from '../../utils/projectStatus'

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-800">{value}</p>
    </div>
  )
}

export default function BacDashboard() {
  const toast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

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
  }, [])

  const notStarted = projects.filter((p) => !p.procurement).length
  const bidding = projects.filter((p) => ['BIDDING', 'BID_EVALUATION'].includes(p.procurement?.status)).length
  const awarded = projects.filter((p) => p.procurement?.status === 'AWARDED').length

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Procurement cycles in progress and projects ready to bid."
      />

      {loading ? (
        <LoadingState label="Loading procurement activity..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No procurement activity yet"
          description="Projects approved for procurement will appear here once BAC opens a bidding cycle."
        />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Awaiting Procurement Start" value={notStarted} />
            <StatCard label="Bidding / Evaluation" value={bidding} />
            <StatCard label="Awarded, Pending Contract" value={awarded} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Project Code</th>
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Office</th>
                  <th className="px-4 py-2.5 font-medium">Project Status</th>
                  <th className="px-4 py-2.5 font-medium">Procurement Status</th>
                  <th className="px-4 py-2.5 font-medium">ABC</th>
                  <th className="px-4 py-2.5 font-medium">Contractor</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="px-4 py-2.5 text-slate-800">{project.project_code ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                    <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                      </Badge>
                    </td>
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
        </div>
      )}
    </div>
  )
}

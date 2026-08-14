import { useEffect, useMemo, useState } from 'react'
import { Gavel, Search } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatCurrency, formatDate } from '../../utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROCUREMENT_ELIGIBLE_STATUSES,
} from '../../utils/projectStatus'

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All' },
  { value: 'NOT_STARTED', label: 'Not Started' },
  { value: 'BIDDING', label: 'Bidding' },
  { value: 'BID_EVALUATION', label: 'Bid Evaluation' },
  { value: 'AWARDED', label: 'Awarded' },
  { value: 'CONTRACT_SIGNED', label: 'Contract Signed' },
  { value: 'COMPLETED', label: 'Completed' },
]

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

export default function BacProcurement() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  async function loadRows() {
    setLoading(true)

    // Current + past procurement cycles, each carrying its project. Projects
    // that are procurement-eligible but haven't had a cycle opened yet won't
    // show up here, so they're fetched separately and merged in as
    // "not started" rows.
    const [procurementResult, eligibleProjectsResult] = await Promise.all([
      supabase
        .from('procurement')
        .select(
          `id, project_id, status, is_current, mode_of_procurement, abc_amount, contract_amount, created_at,
           contractors(name),
           projects(id, project_code, title, status, offices(name))`,
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('projects')
        .select('id, project_code, title, status, approved_budget, offices(name)')
        .in('status', PROCUREMENT_ELIGIBLE_STATUSES),
    ])

    if (procurementResult.error) {
      toast.error('Could not load procurement records', procurementResult.error.message)
    }
    if (eligibleProjectsResult.error) {
      toast.error('Could not load projects', eligibleProjectsResult.error.message)
    }

    const procurementRows = procurementResult.data ?? []
    const projectsWithProcurement = new Set(procurementRows.map((r) => r.project_id))

    const notStartedRows = (eligibleProjectsResult.data ?? [])
      .filter((p) => !projectsWithProcurement.has(p.id))
      .map((p) => ({
        id: `not-started-${p.id}`,
        project_id: p.id,
        status: null,
        is_current: true,
        abc_amount: p.approved_budget,
        contractors: null,
        projects: p,
      }))

    setRows([...notStartedRows, ...procurementRows])
    setLoading(false)
  }

  useEffect(() => {
    loadRows()
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      const effectiveStatus = row.status ?? 'NOT_STARTED'
      if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) return false
      if (!term) return true
      return (
        row.projects?.title?.toLowerCase().includes(term) ||
        row.projects?.project_code?.toLowerCase().includes(term) ||
        row.projects?.offices?.name?.toLowerCase().includes(term)
      )
    })
  }, [rows, search, statusFilter])

  return (
    <div>
      <PageHeader
        title="Procurement"
        description="Manage bidding, award, and contract status for approved projects."
        breadcrumbs={[{ label: 'Dashboard', to: '/bac' }, { label: 'Procurement' }]}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, code, or office"
            className={`${inputClass} pl-9`}
          />
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${inputClass} max-w-[200px]`}>
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <LoadingState label="Loading procurement records..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title="No matching procurement records"
          description="Try a different search or filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
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
                <th className="px-4 py-2.5 font-medium">Opened</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => (
                <tr key={row.id} className={row.is_current ? '' : 'opacity-60'}>
                  <td className="px-4 py-2.5 text-slate-800">{row.projects?.project_code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-800">
                    {row.projects?.title}
                    {!row.is_current ? <span className="ml-2 text-xs text-slate-400">(past cycle)</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{row.projects?.offices?.name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={PROJECT_STATUS_TONES[row.projects?.status]}>
                      {PROJECT_STATUS_LABELS[row.projects?.status] ?? row.projects?.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {row.status ? (
                      <Badge tone={PROCUREMENT_STATUS_TONES[row.status]}>
                        {PROCUREMENT_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">Not started</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{formatCurrency(row.abc_amount)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.contractors?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.created_at ? formatDate(row.created_at) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button to={`/bac/procurement/${row.project_id}`} variant="secondary" size="sm">
                      {row.status ? 'Open' : 'Start Procurement'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

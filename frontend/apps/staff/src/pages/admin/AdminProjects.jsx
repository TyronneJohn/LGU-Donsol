import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, FolderKanban, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'

const selectClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// Read-only cross-office view. Admin already has SELECT access to every
// project via the projects_select_staff RLS policy — this page just
// surfaces it instead of leaving MPDC/Engineering/BAC data siloed on
// their own dashboards. No writes happen here.
export default function AdminProjects() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(true)
  const [officeFilter, setOfficeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')
  const dssFilter = searchParams.get('dss') === '1'

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, name').order('name', { ascending: true })
    if (!error) setOffices(data ?? [])
  }

  async function loadProjects() {
    setLoading(true)
    let query = supabase
      .from('projects')
      .select(
        `id, project_code, title, status, estimated_cost, approved_budget, created_at,
         offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .order('created_at', { ascending: false })

    if (officeFilter) query = query.eq('office_id', officeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)
    // Mirrors the dashboard's "Requiring Attention" tile query — projects
    // whose DSS decision isn't ON_TRACK/COMPLETED.
    if (dssFilter) query = query.not('dss_decision', 'in', '(ON_TRACK,COMPLETED)')

    const { data, error } = await query

    if (error) {
      toast.error('Could not load projects', error.message)
    } else {
      setProjects(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadOffices()
  }, [])

  useEffect(() => {
    loadProjects()
  }, [officeFilter, statusFilter, dssFilter])

  function updateStatusFilter(value) {
    setStatusFilter(value)
    const next = new URLSearchParams(searchParams)
    if (value) next.set('status', value)
    else next.delete('status')
    setSearchParams(next)
  }

  function clearDssFilter() {
    const next = new URLSearchParams(searchParams)
    next.delete('dss')
    setSearchParams(next)
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        description="Cross-office view of every project — Engineering, MPDC, and BAC — for oversight."
        breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Projects' }]}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={officeFilter}
          onChange={(event) => setOfficeFilter(event.target.value)}
          className={selectClass}
        >
          <option value="">All offices</option>
          {offices.map((office) => (
            <option key={office.id} value={office.id}>
              {office.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) => updateStatusFilter(event.target.value)}
          className={selectClass}
        >
          <option value="">All statuses</option>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        {dssFilter ? (
          <button
            type="button"
            onClick={clearDssFilter}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 hover:bg-amber-100"
          >
            Requiring DSS Attention
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects found"
          description="No project matches these filters yet."
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {projects.length} project{projects.length === 1 ? '' : 's'} — Total Budget:{' '}
            <span className="font-medium text-slate-700">
              {formatCurrency(projects.reduce((sum, p) => sum + Number(p.approved_budget ?? p.estimated_cost ?? 0), 0))}
            </span>
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Created By</th>
                <th className="px-4 py-2.5 font-medium">Budget</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => (
                <tr key={project.id}>
                  <td className="px-4 py-2.5 text-slate-800">{project.project_code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                  <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{project.creator?.full_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                      {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{formatDate(project.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button to={`/admin/projects/${project.id}`} variant="secondary" size="sm" icon={ArrowRight}>
                      View
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
  )
}

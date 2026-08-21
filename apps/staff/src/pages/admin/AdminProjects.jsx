import { useEffect, useState } from 'react'
import { ArrowRight, FolderKanban } from 'lucide-react'
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
  const [projects, setProjects] = useState([])
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(true)
  const [officeFilter, setOfficeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, name').order('name', { ascending: true })
    if (!error) setOffices(data ?? [])
  }

  async function loadProjects() {
    setLoading(true)
    let query = supabase
      .from('projects')
      .select(
        `id, project_code, title, status, estimated_cost, created_at,
         offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .order('created_at', { ascending: false })

    if (officeFilter) query = query.eq('office_id', officeFilter)
    if (statusFilter) query = query.eq('status', statusFilter)

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
  }, [officeFilter, statusFilter])

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
          onChange={(event) => setStatusFilter(event.target.value)}
          className={selectClass}
        >
          <option value="">All statuses</option>
          {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Created By</th>
                <th className="px-4 py-2.5 font-medium">Est. Cost</th>
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
                  <td className="px-4 py-2.5 text-slate-600">{formatCurrency(project.estimated_cost)}</td>
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
      )}
    </div>
  )
}

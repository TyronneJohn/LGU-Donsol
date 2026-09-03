import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, FolderKanban } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES, MONITORING_VISIBLE_STATUSES } from '@shared/utils/projectStatus'

const selectClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// Cross-office, every status — the landing page for the Dashboard's
// Total/Submitted/Total Budget tiles, none of which map to a single status
// the way Ongoing/Completed do onto Monitoring. Read-only: MPDC already has
// SELECT access to every project via projects_select_staff, this just
// surfaces it (mirrors AdminProjects.jsx).
export default function AllProjects() {
  const toast = useToast()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(true)
  const [officeFilter, setOfficeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? '')

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, name').order('name', { ascending: true })
    if (!error) setOffices(data ?? [])
  }

  async function loadProjects() {
    setLoading(true)
    let query = supabase
      .from('projects')
      .select(
        `id, project_code, title, status, estimated_cost, approved_budget, created_at, created_by,
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

  function updateStatusFilter(value) {
    setStatusFilter(value)
    const next = new URLSearchParams(searchParams)
    if (value) next.set('status', value)
    else next.delete('status')
    setSearchParams(next)
  }

  // A project only has a detail page reachable from here once it's your own
  // (ProjectForm, edit) or in the monitored set (MpdcProjectMonitoringDetail,
  // read/report) — MPDC has no read-only viewer for someone else's
  // draft/submitted/rejected project yet, so those rows show status only.
  function viewLinkFor(project) {
    if (MONITORING_VISIBLE_STATUSES.includes(project.status)) return `/mpdc/monitoring/${project.id}`
    if (project.created_by === user.id) return `/mpdc/projects/${project.id}`
    return null
  }

  return (
    <div>
      <PageHeader
        title="All Projects"
        description="Cross-office view of every project, at every stage, for a full-picture status overview."
        breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'All Projects' }]}
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
                {projects.map((project) => {
                  const viewLink = viewLinkFor(project)
                  return (
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
                        {viewLink ? (
                          <Button to={viewLink} variant="secondary" size="sm" icon={ArrowRight}>
                            View
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

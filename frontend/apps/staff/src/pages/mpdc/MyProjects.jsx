import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderKanban, Plus, Search } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Pagination from '../../components/ui/Pagination'
import { usePagination } from '../../hooks/usePagination'
import SearchInput from '../../components/ui/SearchInput'
import { matchesProjectSearch } from '../../utils/projectSearch'
import StatusTabs from '../../components/ui/StatusTabs'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'

// Mirrors ProjectForm: only these statuses open in an editable form.
const EDITABLE_STATUSES = ['DRAFT', 'RETURNED_FOR_REVISION']

export default function MyProjects() {
  const toast = useToast()
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') ?? ''

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_code, title, status, estimated_cost, approved_budget, created_at, offices(name)')
      .eq('created_by', user.id)
      .order('updated_at', { ascending: false })

    if (error) {
      toast.error('Could not load your projects', error.message)
    } else {
      setProjects(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  const searchedProjects = useMemo(
    () => projects.filter((project) => matchesProjectSearch(project, search)),
    [projects, search],
  )
  const filteredProjects = statusFilter
    ? searchedProjects.filter((project) => project.status === statusFilter)
    : searchedProjects

  function updateStatusFilter(value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('status', value)
    else next.delete('status')
    setSearchParams(next, { replace: true })
  }

  const pagination = usePagination(filteredProjects, [search, statusFilter])

  return (
    <div>
      <PageHeader
        title="My Projects"
        description="Projects you've created and planned."
        breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'My Projects' }]}
        actions={
          <Button icon={Plus} to="/mpdc/projects/new">
            New Project
          </Button>
        }
      />

      <SearchInput value={search} onChange={setSearch} placeholder="Search by project title, code, or office" />
      {!loading && projects.length > 0 ? (
        <StatusTabs projects={searchedProjects} value={statusFilter} onChange={updateStatusFilter} />
      ) : null}

      {loading ? (
        <LoadingState label="Loading your projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Projects you create will appear here, along with their review status."
          action={
            <Button icon={Plus} to="/mpdc/projects/new">
              New Project
            </Button>
          }
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching projects"
          description="Try a different status tab or search term."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Implementing Office</th>
                <th className="px-4 py-2.5 font-medium">Total Cost</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagination.pageItems.map((project) => (
                <tr key={project.id}>
                  <td className="px-4 py-2.5 text-slate-800">{project.project_code ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                  <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
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
                    <div className="flex justify-end gap-2">
                      <Button to={`/mpdc/projects/${project.id}`} variant="secondary" size="sm">
                        View
                      </Button>
                      {EDITABLE_STATUSES.includes(project.status) ? (
                        <Button to={`/mpdc/projects/${project.id}`} variant="secondary" size="sm">
                          Edit
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled
                          title="Only Draft or Returned for Revision projects can be edited"
                        >
                          Edit
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading ? <Pagination {...pagination} /> : null}
    </div>
  )
}

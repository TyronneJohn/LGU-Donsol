import { useEffect, useState } from 'react'
import { Globe, GlobeLock } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'

// MPDC's publish window is enforced server-side (RLS): visibility/
// published_at/published_by can only be changed on a project while its
// status is APPROVED (see projects_update_scoped in
// 20260811100000_initial_schema.sql). Projects that already moved past
// APPROVED but were published earlier still show here, read-only, so MPDC
// can see what's currently live on the public site.
export default function PublishedProjects() {
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState(null)

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('id, project_code, title, status, visibility, published_at, estimated_cost, approved_budget, offices(name)')
      .or('status.eq.APPROVED,visibility.eq.PUBLIC')
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Could not load projects', error.message)
    } else {
      setProjects(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  async function handleToggle(project) {
    const publishing = project.visibility !== 'PUBLIC'

    const confirmed = await confirm({
      title: publishing ? 'Publish this project?' : 'Unpublish this project?',
      description: publishing
        ? 'This project will become visible to the public on the citizen-facing site.'
        : 'This project will be removed from the public site immediately.',
      confirmLabel: publishing ? 'Publish' : 'Unpublish',
      tone: publishing ? 'default' : 'danger',
    })
    if (!confirmed) return

    setTogglingId(project.id)
    const { error } = await supabase
      .from('projects')
      .update({
        visibility: publishing ? 'PUBLIC' : 'PRIVATE',
        published_at: publishing ? new Date().toISOString() : null,
        published_by: publishing ? user.id : null,
      })
      .eq('id', project.id)

    if (error) {
      toast.error('Could not update visibility', error.message)
    } else {
      toast.success(publishing ? 'Project published' : 'Project unpublished')
      await loadProjects()
    }
    setTogglingId(null)
  }

  return (
    <div>
      <PageHeader
        title="Published Projects"
        description="Manage what's visible on the public site."
        breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'Published Projects' }]}
      />

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No projects available to publish"
          description="Projects appear here once they've been endorsed to BAC (status: Endorsed to BAC)."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Est. Cost</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Visibility</th>
                <th className="px-4 py-2.5 font-medium">Published</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => {
                const isPublic = project.visibility === 'PUBLIC'
                const canToggle = project.status === 'APPROVED'
                return (
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
                    <td className="px-4 py-2.5">
                      <Badge tone={isPublic ? 'green' : 'neutral'}>{isPublic ? 'Public' : 'Private'}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{formatDate(project.published_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {canToggle ? (
                        <Button
                          variant={isPublic ? 'secondary' : 'primary'}
                          size="sm"
                          icon={isPublic ? GlobeLock : Globe}
                          loading={togglingId === project.id}
                          onClick={() => handleToggle(project)}
                        >
                          {isPublic ? 'Unpublish' : 'Publish'}
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400">Publish window closed</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

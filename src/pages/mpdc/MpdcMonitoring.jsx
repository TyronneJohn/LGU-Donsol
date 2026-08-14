import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate } from '../../utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES, MONITORING_VISIBLE_STATUSES } from '../../utils/projectStatus'
import { getMonitoringFlags, getFlagTone } from '../../utils/decisionSupport'

// Read-only, cross-office view: unlike Engineering's SiteMonitoring list
// (scoped to the viewer's own office_id), MPDC monitors every project it has
// already approved regardless of implementing office, so this deliberately
// has no office filter. projects_select_staff (public.app_is_staff())
// already grants MPDC read access to every project;
// MONITORING_VISIBLE_STATUSES narrows it to the post-approval set that's
// actually meaningful to monitor here (pre-approval projects stay in
// Project Review instead).
export default function MpdcMonitoring() {
  const toast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadProjects() {
    setLoading(true)

    const { data: projectRows, error: projectsError } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, status, end_date_planned,
         offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .in('status', MONITORING_VISIBLE_STATUSES)
      .order('status', { ascending: true })
      .order('end_date_planned', { ascending: true })

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

    const { data: updateRows, error: updatesError } = await supabase
      .from('project_updates')
      .select('project_id, progress_percentage, report_date')
      .in(
        'project_id',
        rows.map((p) => p.id),
      )
      .order('report_date', { ascending: false })

    if (updatesError) {
      toast.error('Could not load monitoring updates', updatesError.message)
    }

    const updatesByProject = new Map()
    for (const update of updateRows ?? []) {
      if (!updatesByProject.has(update.project_id)) {
        updatesByProject.set(update.project_id, [])
      }
      updatesByProject.get(update.project_id).push(update)
    }

    setProjects(
      rows.map((project) => {
        const updates = updatesByProject.get(project.id) ?? []
        return {
          ...project,
          latestUpdate: updates[0] ?? null,
          flags: getMonitoringFlags(project, updates),
        }
      }),
    )
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  return (
    <div>
      <PageHeader
        title="Monitoring"
        description="Track implementation progress on approved projects, reported by Engineering."
        breadcrumbs={[{ label: 'Dashboard', to: '/mpdc' }, { label: 'Monitoring' }]}
      />

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nothing to monitor yet"
          description="Projects will appear here once they're approved and Engineering begins reporting progress."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Progress</th>
                <th className="px-4 py-2.5 font-medium">Last Update</th>
                <th className="px-4 py-2.5 font-medium">Flags</th>
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
                  <td className="px-4 py-2.5 text-slate-600">
                    {project.latestUpdate?.progress_percentage != null
                      ? `${project.latestUpdate.progress_percentage}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {project.latestUpdate ? formatDate(project.latestUpdate.report_date) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    {project.flags.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {project.flags.map((flag) => (
                          <Badge key={flag.type} tone={getFlagTone(flag.severity)}>
                            {flag.type.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button to={`/mpdc/monitoring/${project.id}`} variant="secondary" size="sm">
                      Open
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

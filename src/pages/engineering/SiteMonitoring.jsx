import { useEffect, useState } from 'react'
import { HardHat } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate } from '../../utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  MONITORING_VISIBLE_STATUSES,
} from '../../utils/projectStatus'
import { getMonitoringFlags, getFlagTone } from '../../utils/decisionSupport'

export default function SiteMonitoring() {
  const toast = useToast()
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadProjects() {
    setLoading(true)

    // Monitoring eligibility is scoped by implementing office, not by who
    // created the project — any Engineering staffer can pick up any project
    // assigned to the Engineering office, matching how BAC's procurement
    // queue already works.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('office_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profile?.office_id) {
      toast.error('Could not load your office assignment', profileError?.message)
      setProjects([])
      setLoading(false)
      return
    }

    const { data: projectRows, error: projectsError } = await supabase
      .from('projects')
      .select('id, project_code, title, status, end_date_planned')
      .eq('office_id', profile.office_id)
      .in('status', MONITORING_VISIBLE_STATUSES)
      .order('created_at', { ascending: false })

    if (projectsError) {
      toast.error('Could not load your projects', projectsError.message)
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

    const latestByProject = new Map()
    for (const update of updateRows ?? []) {
      if (!latestByProject.has(update.project_id)) {
        latestByProject.set(update.project_id, [])
      }
      latestByProject.get(update.project_id).push(update)
    }

    setProjects(
      rows.map((project) => {
        const updates = latestByProject.get(project.id) ?? []
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
        title="Site Monitoring"
        description="Report progress, upload site photos, and log issues on approved projects."
        breadcrumbs={[{ label: 'Dashboard', to: '/engineering' }, { label: 'Site Monitoring' }]}
      />

      {loading ? (
        <LoadingState label="Loading your projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No projects to monitor yet"
          description="Once MPDC approves a project assigned to your office, it will appear here for progress reporting."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
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
                    <Button to={`/engineering/monitoring/${project.id}`} variant="secondary" size="sm">
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

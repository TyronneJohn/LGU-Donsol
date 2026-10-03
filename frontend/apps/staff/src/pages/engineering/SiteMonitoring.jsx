import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { HardHat, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatDate } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  SITE_MONITORING_VISIBLE_STATUSES,
} from '@shared/utils/projectStatus'
import { DSS_DECISION_LABELS, getDssSeverityTone } from '@shared/utils/decisionSupport'
import { ROLES } from '../../utils/roles'
import {
  UPDATE_REQUEST_PREFIX,
  UPDATE_REQUEST_STATE_LABELS,
  UPDATE_REQUEST_STATE_TONES,
  getUpdateRequestStatus,
} from '../../utils/updateRequests'

export default function SiteMonitoring() {
  const toast = useToast()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const statusFilter = searchParams.get('status') ?? ''

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

    let query = supabase
      .from('projects')
      .select('id, project_code, title, status, end_date_planned, dss_decision, dss_severity')
      .eq('office_id', profile.office_id)
      .order('created_at', { ascending: false })

    // A dashboard tile links here with a specific status (already known to
    // be one of SITE_MONITORING_VISIBLE_STATUSES); with no filter, show the
    // full monitored set as before.
    query = statusFilter ? query.eq('status', statusFilter) : query.in('status', SITE_MONITORING_VISIBLE_STATUSES)

    const { data: projectRows, error: projectsError } = await query

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

    const projectIds = rows.map((p) => p.id)
    const [{ data: updateRows, error: updatesError }, { data: requestRows, error: requestsError }] =
      await Promise.all([
        supabase
          .from('project_updates')
          .select('project_id, progress_percentage, report_date, created_at')
          .in('project_id', projectIds)
          .order('report_date', { ascending: false }),
        // MPDC's "Request Update" messages, newest first — see
        // ProjectMonitoringDetail's loadUpdateRequest.
        supabase
          .from('messages')
          .select('project_id, created_at')
          .in('project_id', projectIds)
          .eq('sender_role', ROLES.MPDC)
          .eq('recipient_role', ROLES.ENGINEERING)
          .like('body', `${UPDATE_REQUEST_PREFIX}%`)
          .order('created_at', { ascending: false }),
      ])

    if (updatesError) {
      toast.error('Could not load monitoring updates', updatesError.message)
    }
    if (requestsError) {
      toast.error('Could not load update requests', requestsError.message)
    }

    const latestRequestByProject = new Map()
    for (const request of requestRows ?? []) {
      if (!latestRequestByProject.has(request.project_id)) {
        latestRequestByProject.set(request.project_id, request.created_at)
      }
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
        const lastUpdateAt = updates.reduce(
          (latest, entry) => (!latest || entry.created_at > latest ? entry.created_at : latest),
          null,
        )
        return {
          ...project,
          latestUpdate: updates[0] ?? null,
          updateRequest: getUpdateRequestStatus(latestRequestByProject.get(project.id), lastUpdateAt),
        }
      }),
    )
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [statusFilter])

  return (
    <div>
      <PageHeader
        title="Site Monitoring"
        description="Report progress, upload site photos, and log issues on approved projects."
        actions={
          statusFilter ? (
            <button
              type="button"
              onClick={() => setSearchParams(new URLSearchParams())}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              {PROJECT_STATUS_LABELS[statusFilter] ?? statusFilter}
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : undefined
        }
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
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Progress</th>
                <th className="px-4 py-2.5 font-medium">Last Update</th>
                <th className="px-4 py-2.5 font-medium">MPDC Request</th>
                <th className="px-4 py-2.5 font-medium">DSS Decision</th>
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
                    {project.updateRequest ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <Badge tone={UPDATE_REQUEST_STATE_TONES[project.updateRequest.state]}>
                          {UPDATE_REQUEST_STATE_LABELS[project.updateRequest.state]}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {project.updateRequest.daysPending > 0
                            ? `${project.updateRequest.daysPending} ${project.updateRequest.daysPending === 1 ? 'day' : 'days'} pending`
                            : 'Requested today'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {project.dss_decision ? (
                      <Badge tone={getDssSeverityTone(project.dss_severity)}>
                        {DSS_DECISION_LABELS[project.dss_decision] ?? project.dss_decision}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
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

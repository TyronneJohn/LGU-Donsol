import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { FileWarning, MapPin } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import DssPanel from '../../components/ui/DssPanel'
import LocationModal from '../../components/LocationModal'
import ProjectDocumentsList from '../../components/ProjectDocumentsList'
import ProgramOfWorksSection from '../../components/ProgramOfWorksSection'
import BeforeAfterSection from '../../components/BeforeAfterSection'
import { formatCurrency, formatDate } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  MONITORING_VISIBLE_STATUSES,
  MONITORING_EDITABLE_STATUSES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
} from '@shared/utils/projectStatus'
import { evaluateProjectDss } from '@shared/utils/decisionSupport'
import { isWithinDonsol } from '@shared/utils/geo'
import { ROLES, ROLE_LABELS } from '../../utils/roles'
import { UPDATE_REQUEST_PREFIX } from '../../utils/updateRequests'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}

// Read-only counterpart to engineering/ProjectMonitoringDetail.jsx: same data
// (project_updates + project_images, same signed-URL pattern), no ownership
// check (any staff member may view via projects_select_staff /
// public.app_is_staff() — MPDC isn't the project's created_by), and no
// form/upload/edit controls at all — MPDC only ever reads here.
export default function MpdcProjectMonitoringDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState(null)
  const [procurement, setProcurement] = useState(null)
  const [updates, setUpdates] = useState([])
  const [images, setImages] = useState([])
  const [locationOpen, setLocationOpen] = useState(false)
  const [requestingUpdate, setRequestingUpdate] = useState(false)

  async function loadProcurement() {
    const { data, error } = await supabase
      .from('procurement')
      .select(
        `status, mode_of_procurement, abc_amount, contract_number, contract_amount,
         contract_signed_date, expected_completion_date, contractors(name)`,
      )
      .eq('project_id', projectId)
      .eq('is_current', true)
      .maybeSingle()

    if (error) {
      toast.error('Could not load procurement status', error.message)
      return
    }
    setProcurement(data ?? null)
  }

  async function loadUpdates() {
    const { data, error } = await supabase
      .from('project_updates')
      .select(
        `id, progress_percentage, narrative_report, issues_encountered, weather_condition, report_date, created_at,
         ai_analysis_status, ai_analysis_result,
         report_documents:project_documents(id, document_category, file_name, storage_path),
         reporter:profiles!project_updates_reported_by_fkey(full_name)`,
      )
      .eq('project_id', projectId)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Could not load monitoring updates', error.message)
      return []
    }
    setUpdates(data ?? [])
    return data ?? []
  }

  async function loadImages() {
    const { data, error } = await supabase
      .from('project_images')
      .select(
        `id, project_update_id, storage_path, file_name, image_stage, ai_analysis_status, ai_analysis_result, created_at, latitude, longitude,
         uploader:profiles!project_images_uploaded_by_fkey(full_name)`,
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Could not load site photos', error.message)
      return
    }

    const rows = data ?? []
    const withUrls = await Promise.all(
      rows.map(async (image) => {
        const { data: signed } = await supabase.storage
          .from('project-images')
          .createSignedUrl(image.storage_path, 3600)
        return { ...image, signedUrl: signed?.signedUrl ?? null }
      }),
    )
    setImages(withUrls)
  }

  async function loadProject() {
    setLoading(true)

    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, barangay, location_text,
         latitude, longitude, estimated_cost, approved_budget, pow_amount, pow_date, funding_source,
         start_date_planned, end_date_planned, start_date_actual, end_date_actual, status,
         offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(data)
    await Promise.all([loadUpdates(), loadImages(), loadProcurement()])
    setLoading(false)
  }

  useEffect(() => {
    loadProject()
  }, [projectId])

  // Page-load fallback for the one case no database trigger can ever catch:
  // a project sitting still while the calendar alone crosses its planned end
  // date. Advisory only — the DSS panel below already renders instantly from
  // the client-computed evaluateProjectDss() regardless of this succeeding;
  // this just keeps the persisted audit/notification record caught up.
  useEffect(() => {
    if (!projectId) return

    async function evaluateDss() {
      const { error } = await supabase.rpc('evaluate_project_dss', { p_project_id: projectId })
      if (error) console.warn('DSS evaluation fallback failed:', error.message)
    }
    evaluateDss()
  }, [projectId])

  async function handleRequestUpdate() {
    if (!project) return
    setRequestingUpdate(true)

    const body = `${UPDATE_REQUEST_PREFIX}${project.title} (${project.project_code}).`

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        sender_id: user.id,
        sender_role: ROLES.MPDC,
        recipient_role: ROLES.ENGINEERING,
        project_id: project.id,
        body,
      })
      .select('id')
      .single()

    if (error || !inserted) {
      toast.error('Could not request update', error?.message)
      setRequestingUpdate(false)
      return
    }

    const { data: recipients, error: recipientsError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', ROLES.ENGINEERING)
      .eq('is_active', true)

    if (recipientsError) {
      toast.error('Sent, but could not notify the Engineering office', recipientsError.message)
    } else if (recipients?.length) {
      const { error: notifyError } = await supabase.from('notifications').insert(
        recipients.map((recipient) => ({
          recipient_id: recipient.id,
          sender_id: user.id,
          category: 'NEW_MESSAGE',
          title: `New message from ${ROLE_LABELS[ROLES.MPDC]}`,
          message: body,
          related_project_id: project.id,
          related_message_id: inserted.id,
        })),
      )
      if (notifyError) toast.error('Sent, but could not notify the Engineering office', notifyError.message)
    }

    setRequestingUpdate(false)
    toast.success('Update requested', 'Engineering has been notified.')
    navigate(`/mpdc/messaging?with=${ROLES.ENGINEERING}`)
  }

  if (loading) {
    return <LoadingState label="Loading project..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Project not found"
        action={
          <Button variant="secondary" size="sm" to="/mpdc/monitoring">
            Back to Monitoring
          </Button>
        }
      />
    )
  }

  if (!MONITORING_VISIBLE_STATUSES.includes(project.status)) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Not yet under monitoring"
        description={`This project is ${(PROJECT_STATUS_LABELS[project.status] ?? project.status).toLowerCase()}. Monitoring data appears once the implementing office starts reporting progress.`}
        action={
          <Button variant="secondary" size="sm" to="/mpdc/monitoring">
            Back to Monitoring
          </Button>
        }
      />
    )
  }

  const dssDecision = evaluateProjectDss(project, updates)

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code ? `Project Code: ${project.project_code}` : undefined}
        breadcrumbs={[
          { label: 'Dashboard', to: '/mpdc' },
          { label: 'Monitoring', to: '/mpdc/monitoring' },
          { label: project.project_code },
        ]}
        actions={
          <Badge tone={PROJECT_STATUS_TONES[project.status]}>
            {PROJECT_STATUS_LABELS[project.status] ?? project.status}
          </Badge>
        }
      />

      <div className="space-y-6">
        <DssPanel decision={dssDecision} />

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Project Information</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Implementing Office">{project.offices?.name}</Field>
            <Field label="Created By">{project.creator?.full_name}</Field>
            <Field label="Category">{project.project_category}</Field>
            <Field label="Barangay">{project.barangay}</Field>
            <Field label="Location">{project.location_text}</Field>
            <Field label="Coordinates">
              {isWithinDonsol(project.latitude, project.longitude) ? (
                <Button variant="secondary" size="sm" icon={MapPin} onClick={() => setLocationOpen(true)}>
                  See Location
                </Button>
              ) : (
                <span className="text-slate-400">No location on file for Donsol, Sorsogon.</span>
              )}
            </Field>
            <Field label="Approved Budget">{formatCurrency(project.approved_budget ?? project.estimated_cost)}</Field>
            <Field label="Funding Source">{project.funding_source}</Field>
            <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
            <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
            <Field label="Actual Start">{formatDate(project.start_date_actual)}</Field>
            <Field label="Actual End">{formatDate(project.end_date_actual)}</Field>
          </div>
        </section>

        {procurement ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Procurement (BAC)</h2>
            <p className="mt-0.5 text-xs text-slate-400">Read-only — recorded by the BAC office.</p>
            <div className="mt-4 flex items-center gap-2">
              <Badge tone={PROCUREMENT_STATUS_TONES[procurement.status]}>
                {PROCUREMENT_STATUS_LABELS[procurement.status] ?? procurement.status}
              </Badge>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Mode of Procurement">{procurement.mode_of_procurement}</Field>
              <Field label="ABC">{formatCurrency(procurement.abc_amount)}</Field>
              <Field label="Contractor">{procurement.contractors?.name}</Field>
              <Field label="Contract #">{procurement.contract_number}</Field>
              <Field label="Contract Amount">{formatCurrency(procurement.contract_amount)}</Field>
              <Field label="Contract Signed">{formatDate(procurement.contract_signed_date)}</Field>
            </div>
          </section>
        ) : null}

        <ProgramOfWorksSection project={project} />

        <BeforeAfterSection
          project={project}
          images={images}
          latestProgress={updates[0]?.progress_percentage ?? null}
          userId={user.id}
          onPhotosChanged={loadImages}
          onRequestUpdate={MONITORING_EDITABLE_STATUSES.includes(project.status) ? handleRequestUpdate : null}
          requestingUpdate={requestingUpdate}
        />

        <ProjectDocumentsList projectId={project.id} />
      </div>

      <LocationModal
        open={locationOpen}
        project={project}
        procurement={procurement}
        showDetails
        onClose={() => setLocationOpen(false)}
      />
    </div>
  )
}

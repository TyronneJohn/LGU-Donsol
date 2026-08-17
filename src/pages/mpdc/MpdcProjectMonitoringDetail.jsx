import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, FileWarning, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import DssPanel from '../../components/ui/DssPanel'
import LocationModal from '../../components/LocationModal'
import { formatCurrency, formatDate } from '../../utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  MONITORING_VISIBLE_STATUSES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
} from '../../utils/projectStatus'
import { evaluateProjectDss } from '../../utils/decisionSupport'
import { formatImageMetadata } from '../../utils/imageProcessing'
import { isWithinDonsol } from '../../utils/geo'

const IMAGE_STAGE_LABELS = {
  BEFORE: 'Before',
  DURING: 'During',
  AFTER: 'After',
  ISSUE: 'Issue',
  OTHER: 'Other',
}

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
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState(null)
  const [procurement, setProcurement] = useState(null)
  const [updates, setUpdates] = useState([])
  const [images, setImages] = useState([])
  const [locationOpen, setLocationOpen] = useState(false)

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
        `id, progress_percentage, narrative_report, issues_encountered, weather_condition, report_date,
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
        `id, project_update_id, storage_path, file_name, image_stage, ai_analysis_result, created_at,
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
         latitude, longitude, estimated_cost, approved_budget, funding_source,
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
  const imagesByUpdate = images.reduce((map, image) => {
    const key = image.project_update_id ?? 'unassigned'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(image)
    return map
  }, new Map())

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code}
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
            <Field label="Approved Budget">{formatCurrency(project.approved_budget || project.estimated_cost)}</Field>
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

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Monitoring History</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Reported by Engineering — read-only. Progress and photos are recorded by the implementing
            office and cannot be edited here.
          </p>

          {updates.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No monitoring updates reported yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {updates.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {entry.progress_percentage != null ? `${entry.progress_percentage}% complete` : 'Update'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(entry.report_date)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reporter?.full_name ?? '—'}</p>
                  {entry.weather_condition ? (
                    <p className="mt-1 text-xs text-slate-500">Weather: {entry.weather_condition}</p>
                  ) : null}
                  {entry.narrative_report ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.narrative_report}</p>
                  ) : null}
                  {entry.issues_encountered ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-red-700">
                      Issues: {entry.issues_encountered}
                    </p>
                  ) : null}

                  {(imagesByUpdate.get(entry.id) ?? []).length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                      {imagesByUpdate.get(entry.id).map((image) => (
                        <a
                          key={image.id}
                          href={image.signedUrl ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block overflow-hidden rounded-md border border-slate-200 bg-white"
                        >
                          {image.signedUrl ? (
                            <img
                              src={image.signedUrl}
                              alt={image.file_name ?? 'Site photo'}
                              className="h-28 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-28 w-full items-center justify-center bg-slate-100">
                              <Camera className="h-6 w-6 text-slate-300" aria-hidden="true" />
                            </div>
                          )}
                          <div className="p-2">
                            <Badge tone="neutral">{IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage}</Badge>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {formatImageMetadata(image.ai_analysis_result) ?? 'Processing pending'}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {(imagesByUpdate.get('unassigned') ?? []).length > 0 ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Other Site Photos</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {imagesByUpdate.get('unassigned').map((image) => (
                <a
                  key={image.id}
                  href={image.signedUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-md border border-slate-200 bg-white"
                >
                  {image.signedUrl ? (
                    <img src={image.signedUrl} alt={image.file_name ?? 'Site photo'} className="h-28 w-full object-cover" />
                  ) : null}
                  <div className="p-2">
                    <Badge tone="neutral">{IMAGE_STAGE_LABELS[image.image_stage] ?? image.image_stage}</Badge>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {formatImageMetadata(image.ai_analysis_result) ?? 'Processing pending'}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />
    </div>
  )
}

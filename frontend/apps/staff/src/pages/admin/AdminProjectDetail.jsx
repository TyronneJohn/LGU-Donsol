import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileWarning, MapPin, Pencil } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import DssPanel from '../../components/ui/DssPanel'
import LocationModal from '../../components/LocationModal'
import EditProjectModal, { DOC_CATEGORY_LABELS } from '../../components/EditProjectModal'
import SitePhotoGrid from '../../components/ui/SitePhotoGrid'
import { analyzeProjectImage } from '../../utils/imageAnalysis'
import { formatCurrency, formatDate, formatDateTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { evaluateProjectDss } from '@shared/utils/decisionSupport'
import { isWithinDonsol } from '@shared/utils/geo'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}

// Full read-only audit trail for a single project — every office's
// contribution (MPDC's creation/submission/decisions, BAC's procurement,
// Engineering's monitoring updates) in one place, plus the raw
// status history. It exists so an admin can see everything happening on a
// project without cross-referencing three separate office dashboards, e.g.
// during an incident/breach investigation. The only write is the admin's
// "Edit Project" correction of the project's details and documents
// (EditProjectModal).
export default function AdminProjectDetail() {
  const { projectId } = useParams()
  const toast = useToast()

  const [project, setProject] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState([])
  const [documents, setDocuments] = useState([])
  const [procurement, setProcurement] = useState([])
  const [updates, setUpdates] = useState([])
  const [images, setImages] = useState([])
  const [statusHistory, setStatusHistory] = useState([])
  const [retryingImageId, setRetryingImageId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)

  async function loadData() {
    setLoading(true)

    const [
      projectResult,
      submissionsResult,
      approvalsResult,
      documentsResult,
      procurementResult,
      updatesResult,
      imagesResult,
      historyResult,
    ] = await Promise.all([
      supabase
        .from('projects')
        .select(
          `id, project_code, title, description, project_category, sector, barangay, location_text,
           latitude, longitude, estimated_cost, approved_budget, funding_source,
           pow_amount, pow_date,
           start_date_planned, end_date_planned, start_date_actual, end_date_actual,
           status, visibility, created_at,
           offices(name),
           creator:profiles!projects_created_by_fkey(full_name)`,
        )
        .eq('id', projectId)
        .maybeSingle(),
      supabase
        .from('project_submissions')
        .select(
          `id, submission_number, notes, submitted_at,
           submitter:profiles!project_submissions_submitted_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('submission_number', { ascending: false }),
      supabase
        .from('project_approvals')
        .select(
          `id, decision, remarks, reviewed_at,
           reviewer:profiles!project_approvals_reviewed_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('reviewed_at', { ascending: false }),
      supabase
        .from('project_documents')
        .select(
          `id, document_category, title, file_name, storage_path, created_at,
           uploader:profiles!project_documents_uploaded_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase
        .from('procurement')
        .select(
          `id, status, mode_of_procurement, abc_amount, contract_number, contract_amount,
           contract_signed_date, is_current, created_at,
           contractors(name),
           creator:profiles!procurement_created_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_updates')
        .select(
          `id, progress_percentage, narrative_report, issues_encountered, report_date,
           reporter:profiles!project_updates_reported_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('report_date', { ascending: false }),
      supabase
        .from('project_images')
        .select(
          `id, project_update_id, storage_path, file_name, image_stage, ai_analysis_status, ai_analysis_result, created_at,
           uploader:profiles!project_images_uploaded_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_status_history')
        .select(
          `id, old_status, new_status, reason, changed_at,
           changer:profiles!project_status_history_changed_by_fkey(full_name)`,
        )
        .eq('project_id', projectId)
        .order('changed_at', { ascending: false }),
    ])

    if (projectResult.error || !projectResult.data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(projectResult.data)
    setSubmissions(submissionsResult.data ?? [])
    setApprovals(approvalsResult.data ?? [])
    setDocuments(documentsResult.data ?? [])
    setProcurement(procurementResult.data ?? [])
    setUpdates(updatesResult.data ?? [])
    setStatusHistory(historyResult.data ?? [])
    setLoading(false)

    const imageRows = imagesResult.data ?? []
    const imagesWithUrls = await Promise.all(
      imageRows.map(async (image) => {
        const { data: signed } = await supabase.storage
          .from('project-images')
          .createSignedUrl(image.storage_path, 3600)
        return { ...image, signedUrl: signed?.signedUrl ?? null }
      }),
    )
    setImages(imagesWithUrls)
  }

  useEffect(() => {
    loadData()
  }, [projectId])

  // Admins can re-run a failed AI analysis too (analyze-project-image accepts
  // the admin role for any image) — and an admin is usually the one who fixes
  // the cause, e.g. configuring the API key, so being able to retry from here
  // saves a round trip through Engineering. Reloads everything afterwards
  // since this page has no images-only loader.
  async function handleRetryAnalysis(imageId) {
    setRetryingImageId(imageId)
    const outcome = await analyzeProjectImage(imageId)
    await loadData()
    setRetryingImageId(null)

    if (outcome?.status === 'PROCESSED') {
      toast.success('AI analysis complete')
      return
    }
    toast.error('AI analysis failed again', outcome?.result?.error ?? 'The photo itself is unaffected.')
  }

  async function handleViewDocument(doc) {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(doc.storage_path, 300)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(getDocumentViewUrl(data.signedUrl, doc.file_name), '_blank', 'noopener,noreferrer')
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
          <Button variant="secondary" size="sm" to="/admin/projects">
            Back to Projects
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
        description={project.project_code}
        breadcrumbs={[
          { label: 'Dashboard', to: '/admin' },
          { label: 'Projects', to: '/admin/projects' },
          { label: project.project_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={PROJECT_STATUS_TONES[project.status]}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            <Button size="sm" icon={Pencil} onClick={() => setEditOpen(true)}>
              Edit Project
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <DssPanel decision={dssDecision} />

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Project Details</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Office">{project.offices?.name}</Field>
            <Field label="Created by">{project.creator?.full_name}</Field>
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
            <Field label="Estimated Cost">{formatCurrency(project.estimated_cost)}</Field>
            <Field label="Approved Budget (MPDC Allocation)">
              {formatCurrency(project.approved_budget)}
            </Field>
            <Field label="Funding Source">{project.funding_source}</Field>
            <Field label="Program of Works">{formatCurrency(project.pow_amount)}</Field>
            <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
            <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
            <Field label="Actual Start">{formatDate(project.start_date_actual)}</Field>
            <Field label="Actual End">{formatDate(project.end_date_actual)}</Field>
            <Field label="Visibility">{project.visibility}</Field>
            <Field label="Created">{formatDate(project.created_at)}</Field>
          </div>
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Description</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{project.description || '—'}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Submissions (MPDC)</h2>
          {submissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No submissions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {submissions.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">Submission #{entry.submission_number}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(entry.submitted_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.submitter?.full_name ?? '—'}</p>
                  {entry.notes ? <p className="mt-1 text-sm text-slate-700">{entry.notes}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Review Decisions (MPDC)</h2>
          {approvals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No review decisions yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {approvals.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={PROJECT_STATUS_TONES[entry.decision] ?? 'neutral'}>
                      {PROJECT_STATUS_LABELS[entry.decision] ?? entry.decision}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(entry.reviewed_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reviewer?.full_name ?? '—'}</p>
                  {entry.remarks ? <p className="mt-1 text-sm text-slate-700">{entry.remarks}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Procurement (BAC)</h2>
          {procurement.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No procurement record yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {procurement.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {entry.status} {entry.is_current ? '' : '(past cycle)'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDateTime(entry.created_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.creator?.full_name ?? '—'}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Field label="Contractor">{entry.contractors?.name}</Field>
                    <Field label="Mode">{entry.mode_of_procurement}</Field>
                    <Field label="ABC">{formatCurrency(entry.abc_amount)}</Field>
                    <Field label="Contract Amount">{formatCurrency(entry.contract_amount)}</Field>
                    <Field label="Contract #">{entry.contract_number}</Field>
                    <Field label="Contract Signed">{formatDate(entry.contract_signed_date)}</Field>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Monitoring Updates (Engineering)</h2>
          {updates.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No monitoring updates yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {updates.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {entry.progress_percentage != null ? `${entry.progress_percentage}% complete` : 'Update'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(entry.report_date)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reporter?.full_name ?? '—'}</p>
                  {entry.narrative_report ? (
                    <p className="mt-1 text-sm text-slate-700">{entry.narrative_report}</p>
                  ) : null}
                  {entry.issues_encountered ? (
                    <p className="mt-1 text-sm text-red-700">Issues: {entry.issues_encountered}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Site Photos / Evidence</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Oversight view — every photo Engineering has submitted for this project, with its automated
            image-processing status.
          </p>
          {images.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No site photos uploaded yet.</p>
          ) : (
            <div className="mt-4">
              <SitePhotoGrid
              images={images}
              onRetryAnalysis={handleRetryAnalysis}
              retryingImageId={retryingImageId}
            />
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Initial Project Documents</h2>
          {documents.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No documents uploaded yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      {DOC_CATEGORY_LABELS[doc.document_category] ?? doc.document_category} · uploaded by{' '}
                      {doc.uploader?.full_name ?? '—'} · {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleViewDocument(doc)}>
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Status History</h2>
          {statusHistory.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No status changes recorded.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {statusHistory.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700">
                    {entry.old_status ? `${PROJECT_STATUS_LABELS[entry.old_status] ?? entry.old_status} → ` : ''}
                    {PROJECT_STATUS_LABELS[entry.new_status] ?? entry.new_status}
                    {entry.changer?.full_name ? (
                      <span className="text-slate-500"> · {entry.changer.full_name}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateTime(entry.changed_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />
      <EditProjectModal
        open={editOpen}
        project={project}
        documents={documents}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          loadData()
        }}
      />
    </div>
  )
}

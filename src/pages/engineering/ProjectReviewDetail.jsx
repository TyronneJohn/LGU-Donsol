import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileWarning, RotateCcw, Save, Send, Upload, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '../../utils/projectStatus'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const textareaClass = inputClass

const DOC_CATEGORY_LABELS = {
  PROGRAM_OF_WORKS: 'Program of Works',
  PERMIT: 'Permit',
  DESIGN_PLAN: 'Design Plan',
  OTHER: 'Other',
}

// Keyed by public.approval_decision. Engineering may only record a negative
// review decision here (project_approvals RLS enforces this at the database
// level, not just this list) — sending the project forward to BAC is a
// separate action (see handleEndorse) that writes to project_endorsements,
// never a project_approvals row with decision = APPROVED.
const DECISION_CONFIG = {
  RETURNED_FOR_REVISION: {
    label: 'Return for Revision',
    variant: 'secondary',
    icon: RotateCcw,
    remarksRequired: true,
    remarksLabel: 'Reason for return (required)',
    confirmTitle: 'Return this project for revision?',
    confirmDescription: 'The submitter will be notified and must revise and resubmit.',
    confirmTone: 'default',
    successMessage: 'Project returned for revision.',
  },
  REJECTED: {
    label: 'Reject',
    variant: 'danger',
    icon: XCircle,
    remarksRequired: true,
    remarksLabel: 'Rejection reason (required)',
    confirmTitle: 'Reject this project?',
    confirmDescription: 'The submitter will be notified. This decision is recorded permanently.',
    confirmTone: 'danger',
    successMessage: 'Project rejected.',
  },
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}

export default function ProjectReviewDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()

  const [project, setProject] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [history, setHistory] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [actionType, setActionType] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [fieldsForm, setFieldsForm] = useState({ approved_budget: '', funding_source: '' })
  const [savingFields, setSavingFields] = useState(false)

  const [docForm, setDocForm] = useState({ category: 'OTHER', title: '', file: null })
  const [uploading, setUploading] = useState(false)

  const [endorsementNotes, setEndorsementNotes] = useState('')
  const [endorsing, setEndorsing] = useState(false)

  async function loadDocuments(id) {
    const { data, error } = await supabase
      .from('project_documents')
      .select('id, document_category, title, file_name, storage_path, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
    if (error) {
      toast.error('Could not load documents', error.message)
    } else {
      setDocuments(data ?? [])
    }
  }

  async function loadHistory(id) {
    const [approvalsResult, endorsementsResult] = await Promise.all([
      supabase
        .from('project_approvals')
        .select(
          `id, decision, remarks, reviewed_at,
           reviewer:profiles!project_approvals_reviewed_by_fkey(full_name)`,
        )
        .eq('project_id', id)
        .order('reviewed_at', { ascending: false }),
      supabase
        .from('project_endorsements')
        .select(
          `id, notes, endorsed_at,
           endorser:profiles!project_endorsements_endorsed_by_fkey(full_name)`,
        )
        .eq('project_id', id)
        .order('endorsed_at', { ascending: false }),
    ])

    if (approvalsResult.error) {
      toast.error('Could not load review history', approvalsResult.error.message)
    }
    if (endorsementsResult.error) {
      toast.error('Could not load endorsement history', endorsementsResult.error.message)
    }

    const decisions = (approvalsResult.data ?? []).map((entry) => ({
      id: `decision-${entry.id}`,
      label: PROJECT_STATUS_LABELS[entry.decision] ?? entry.decision,
      tone: PROJECT_STATUS_TONES[entry.decision] ?? 'neutral',
      actor: entry.reviewer?.full_name,
      at: entry.reviewed_at,
      notes: entry.remarks,
    }))
    const endorsements = (endorsementsResult.data ?? []).map((entry) => ({
      id: `endorsement-${entry.id}`,
      label: 'Endorsed to BAC',
      tone: 'green',
      actor: entry.endorser?.full_name,
      at: entry.endorsed_at,
      notes: entry.notes,
    }))

    setHistory([...decisions, ...endorsements].sort((a, b) => new Date(b.at) - new Date(a.at)))
  }

  async function loadData() {
    setLoading(true)

    const [projectResult, submissionResult] = await Promise.all([
      supabase
        .from('projects')
        .select(
          `id, project_code, title, description, project_category, barangay, location_text,
           estimated_cost, approved_budget, funding_source,
           start_date_planned, end_date_planned, status, created_by, office_id,
           offices(name),
           creator:profiles!projects_created_by_fkey(full_name, position_title, phone)`,
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
        .order('submission_number', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (projectResult.error || !projectResult.data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(projectResult.data)
    setFieldsForm({
      approved_budget: projectResult.data.approved_budget ?? '',
      funding_source: projectResult.data.funding_source ?? '',
    })

    if (submissionResult.error) {
      toast.error('Could not load submission details', submissionResult.error.message)
    } else {
      setSubmission(submissionResult.data)
    }

    await Promise.all([loadHistory(projectResult.data.id), loadDocuments(projectResult.data.id)])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [projectId])

  function startDecision(type) {
    setActionType(type)
    setRemarks('')
  }

  function cancelDecision() {
    setActionType(null)
    setRemarks('')
  }

  async function sendDecisionNotification(decision, remarksText) {
    const category = decision === 'REJECTED' ? 'PROJECT_REJECTED' : 'PROJECT_RETURNED'
    const title =
      decision === 'REJECTED'
        ? `Project rejected: ${project.title}`
        : `Project returned for revision: ${project.title}`

    const { error } = await supabase.from('notifications').insert({
      recipient_id: project.created_by,
      category,
      title,
      message: remarksText,
      related_project_id: project.id,
    })
    if (error) toast.error('Decision recorded, but could not notify the submitter', error.message)
  }

  async function submitDecision() {
    const config = DECISION_CONFIG[actionType]
    const trimmedRemarks = remarks.trim()

    if (config.remarksRequired && !trimmedRemarks) {
      toast.error('Remarks required', `Please provide ${config.remarksLabel.toLowerCase()}.`)
      return
    }
    if (!submission) {
      toast.error('Cannot record decision', 'No submission record was found for this project.')
      return
    }

    const confirmed = await confirm({
      title: config.confirmTitle,
      description: config.confirmDescription,
      tone: config.confirmTone,
      confirmLabel: config.label,
    })
    if (!confirmed) return

    setSubmitting(true)

    const { error } = await supabase.from('project_approvals').insert({
      project_id: project.id,
      submission_id: submission.id,
      reviewed_by: user.id,
      decision: actionType,
      remarks: trimmedRemarks || null,
    })

    if (error) {
      toast.error('Could not record decision', error.message)
      setSubmitting(false)
      return
    }

    await sendDecisionNotification(actionType, trimmedRemarks)

    setSubmitting(false)
    toast.success('Decision recorded', config.successMessage)
    navigate('/engineering/review')
  }

  async function handleSaveFields(event) {
    event.preventDefault()
    setSavingFields(true)

    const { error } = await supabase
      .from('projects')
      .update({
        approved_budget: fieldsForm.approved_budget === '' ? null : Number(fieldsForm.approved_budget),
        funding_source: fieldsForm.funding_source.trim() || null,
      })
      .eq('id', project.id)

    setSavingFields(false)
    if (error) {
      toast.error('Could not save changes', error.message)
      return
    }
    toast.success('Changes saved')
    loadData()
  }

  async function handleUploadDocument(event) {
    event.preventDefault()
    if (!docForm.file) {
      toast.error('Choose a file', 'Select a file to upload.')
      return
    }

    setUploading(true)
    const path = `${project.id}/${crypto.randomUUID()}-${docForm.file.name}`

    const { error: uploadError } = await supabase.storage.from('project-documents').upload(path, docForm.file)
    if (uploadError) {
      toast.error('Could not upload file', uploadError.message)
      setUploading(false)
      return
    }

    const { error: insertError } = await supabase.from('project_documents').insert({
      project_id: project.id,
      uploaded_by: user.id,
      document_category: docForm.category,
      title: docForm.title.trim() || docForm.file.name,
      storage_path: path,
      file_name: docForm.file.name,
    })

    setUploading(false)
    if (insertError) {
      toast.error('Could not record document', insertError.message)
      return
    }

    setDocForm({ category: 'OTHER', title: '', file: null })
    toast.success('Document uploaded')
    loadDocuments(project.id)
  }

  async function handleViewDocument(doc) {
    const { data, error } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(doc.storage_path, 60)

    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleEndorse() {
    const confirmed = await confirm({
      title: 'Endorse this project to BAC?',
      description: 'BAC will be notified and can begin procurement.',
      confirmLabel: 'Endorse to BAC',
    })
    if (!confirmed) return

    setEndorsing(true)

    // The insert alone is enough: apply_project_endorsement (DB trigger)
    // advances the project to APPROVED (displayed as "Endorsed to BAC"),
    // writes the audit log, and notifies BAC — this is deliberately a
    // project_endorsements row, never a project_approvals decision.
    const { error } = await supabase.from('project_endorsements').insert({
      project_id: project.id,
      endorsed_by: user.id,
      notes: endorsementNotes.trim() || null,
    })

    setEndorsing(false)
    if (error) {
      toast.error('Could not endorse project', error.message)
      return
    }

    toast.success('Project endorsed', 'BAC has been notified and can begin procurement.')
    navigate('/engineering/review')
  }

  if (loading) {
    return <LoadingState label="Loading project..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Project not found"
        description="It may have been removed, or the link is incorrect."
        action={
          <Button variant="secondary" size="sm" to="/engineering/review">
            Back to Projects for Review
          </Button>
        }
      />
    )
  }

  const canReview = project.status === 'SUBMITTED_FOR_REVIEW'

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code}
        breadcrumbs={[
          { label: 'Dashboard', to: '/engineering' },
          { label: 'Project Review', to: '/engineering/review' },
          { label: project.project_code },
        ]}
        actions={
          <Badge tone={PROJECT_STATUS_TONES[project.status]}>
            {PROJECT_STATUS_LABELS[project.status] ?? project.status}
          </Badge>
        }
      />

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Project Details</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Entered by MPDC — read-only. Any change to these details happens through the submitter's own
            resubmission, never edited here.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Office">{project.offices?.name}</Field>
            <Field label="Submitted by">{project.creator?.full_name}</Field>
            <Field label="Category">{project.project_category}</Field>
            <Field label="Barangay">{project.barangay}</Field>
            <Field label="Location">{project.location_text}</Field>
            <Field label="Estimated Cost">{formatCurrency(project.estimated_cost)}</Field>
            <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
            <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
          </div>

          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Description</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
              {project.description || '—'}
            </p>
          </div>
        </section>

        {submission ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Submission</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Submission #">{submission.submission_number}</Field>
              <Field label="Submitted by">{submission.submitter?.full_name}</Field>
              <Field label="Submitted at">{formatDateTime(submission.submitted_at)}</Field>
            </div>
            {submission.notes ? (
              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Submission Notes
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{submission.notes}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        <form onSubmit={handleSaveFields} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Engineering Details</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Only these two fields are Engineering-editable, and only while the project is under review.
          </p>

          <fieldset disabled={!canReview} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="approved_budget" className="mb-1 block text-sm font-medium text-slate-700">
                Approved Budget (PHP)
              </label>
              <input
                id="approved_budget"
                type="number"
                step="0.01"
                min="0"
                value={fieldsForm.approved_budget}
                onChange={(event) =>
                  setFieldsForm((current) => ({ ...current, approved_budget: event.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="funding_source" className="mb-1 block text-sm font-medium text-slate-700">
                Funding Source
              </label>
              <input
                id="funding_source"
                value={fieldsForm.funding_source}
                onChange={(event) =>
                  setFieldsForm((current) => ({ ...current, funding_source: event.target.value }))
                }
                className={inputClass}
              />
            </div>
          </fieldset>

          {canReview ? (
            <div className="mt-4">
              <Button type="submit" size="sm" icon={Save} loading={savingFields}>
                Save Changes
              </Button>
            </div>
          ) : null}
        </form>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Technical Documents</h2>

          {documents.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      {DOC_CATEGORY_LABELS[doc.document_category] ?? doc.document_category} ·{' '}
                      {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleViewDocument(doc)}>
                    View
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No documents uploaded yet.</p>
          )}

          {canReview ? (
            <form
              onSubmit={handleUploadDocument}
              className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"
            >
              <div>
                <label htmlFor="doc_category" className="mb-1 block text-sm font-medium text-slate-700">
                  Category
                </label>
                <select
                  id="doc_category"
                  value={docForm.category}
                  onChange={(event) => setDocForm((current) => ({ ...current, category: event.target.value }))}
                  className={inputClass}
                >
                  {Object.entries(DOC_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="doc_title" className="mb-1 block text-sm font-medium text-slate-700">
                  Title (optional)
                </label>
                <input
                  id="doc_title"
                  value={docForm.title}
                  onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="doc_file" className="mb-1 block text-sm font-medium text-slate-700">
                  File
                </label>
                <input
                  id="doc_file"
                  type="file"
                  onChange={(event) =>
                    setDocForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))
                  }
                  className="block w-full text-sm text-slate-600"
                />
              </div>

              <div className="sm:col-span-3">
                <Button type="submit" variant="secondary" size="sm" icon={Upload} loading={uploading}>
                  Upload
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        {history.length > 0 ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Review History</h2>
            <ul className="mt-4 space-y-3">
              {history.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={entry.tone}>{entry.label}</Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(entry.at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.actor ?? '—'}</p>
                  {entry.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{entry.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Send Back or Reject</h2>

          {!canReview ? (
            <p className="mt-2 text-sm text-slate-500">
              This project has already been reviewed and is no longer awaiting a decision.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-500">
                Return this project to the submitter for revision, or reject it outright.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(DECISION_CONFIG).map(([type, config]) => (
                  <Button
                    key={type}
                    variant={config.variant}
                    icon={config.icon}
                    onClick={() => startDecision(type)}
                    disabled={submitting}
                  >
                    {config.label}
                  </Button>
                ))}
              </div>

              {actionType ? (
                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                  <label htmlFor="remarks" className="mb-1 block text-sm font-medium text-slate-700">
                    {DECISION_CONFIG[actionType].remarksLabel}
                  </label>
                  <textarea
                    id="remarks"
                    rows={3}
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    className={textareaClass}
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={cancelDecision} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button
                      variant={DECISION_CONFIG[actionType].variant}
                      size="sm"
                      onClick={submitDecision}
                      loading={submitting}
                    >
                      Confirm {DECISION_CONFIG[actionType].label}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        {canReview ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Endorse to BAC</h2>
            <p className="mt-1 text-sm text-slate-500">
              When the project is technically ready, endorse it to BAC to begin procurement.
            </p>

            <div className="mt-4">
              <label htmlFor="endorsement_notes" className="mb-1 block text-sm font-medium text-slate-700">
                Notes for BAC (optional)
              </label>
              <textarea
                id="endorsement_notes"
                rows={3}
                value={endorsementNotes}
                onChange={(event) => setEndorsementNotes(event.target.value)}
                className={textareaClass}
              />
            </div>

            <div className="mt-3">
              <Button icon={Send} onClick={handleEndorse} loading={endorsing} disabled={submitting}>
                Endorse to BAC
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}

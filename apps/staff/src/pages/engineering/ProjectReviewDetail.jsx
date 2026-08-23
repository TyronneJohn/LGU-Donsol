import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileWarning, RotateCcw, Save, Upload, XCircle } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import CurrencyInput from '../../components/ui/CurrencyInput'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate, formatDateTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'

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
// level, not just this list) — endorsing the project forward to BAC is MPDC's
// action (project_endorsements, on the MPDC project detail page), never a
// project_approvals row with decision = APPROVED.
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
  const [editingBudgetFields, setEditingBudgetFields] = useState(false)

  const [docForm, setDocForm] = useState({ category: 'OTHER', title: '', files: [] })
  const [docInputKey, setDocInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)

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

    const approvedBudget = fieldsForm.approved_budget === '' ? null : Number(fieldsForm.approved_budget)

    const { error } = await supabase
      .from('projects')
      .update({
        approved_budget: approvedBudget,
        funding_source: fieldsForm.funding_source.trim() || null,
      })
      .eq('id', project.id)

    setSavingFields(false)
    if (error) {
      toast.error('Could not save changes', error.message)
      return
    }

    // Only notify MPDC once there's actually something for them to act
    // on — a positive approved_budget is the same "review technically
    // ready" signal MPDC's own endorse button already gates on
    // (ProjectForm.jsx's reviewReady), not just any save. Recipient is the
    // project's own creator specifically, not every active MPDC staff
    // member — endorsing is RLS-gated to created_by = auth.uid()
    // (projects_update_scoped), so anyone else literally can't act on
    // this, same reasoning sendDecisionNotification() below already uses.
    if (approvedBudget != null && approvedBudget > 0) {
      const { error: notifyError } = await supabase.from('notifications').insert({
        recipient_id: project.created_by,
        category: 'PROJECT_REVIEW_READY',
        title: `Technical review ready: ${project.title}`,
        message: `${project.project_code} has an approved budget on file and can now be endorsed to BAC.`,
        related_project_id: project.id,
      })
      if (notifyError) toast.error('Saved, but could not notify MPDC', notifyError.message)
    }

    toast.success('Changes saved')
    navigate('/engineering/review')
  }

  function handleCancelEditFields() {
    setFieldsForm({
      approved_budget: project.approved_budget ?? '',
      funding_source: project.funding_source ?? '',
    })
    setEditingBudgetFields(false)
  }

  async function handleUploadDocument(event) {
    event.preventDefault()
    if (docForm.files.length === 0) {
      toast.error('Choose a file', 'Select at least one file to upload.')
      return
    }

    setUploading(true)

    // The Title field only makes sense when uploading a single file — with
    // several selected at once, each document takes its own file name
    // instead (same fallback the single-file case already used when Title
    // was left blank).
    const useTitle = docForm.files.length === 1

    const results = await Promise.all(
      docForm.files.map(async (file) => {
        const path = `${project.id}/${crypto.randomUUID()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('project-documents')
          .upload(path, file, { contentType: file.type || undefined })
        if (uploadError) return { file, error: uploadError }

        const { error: insertError } = await supabase.from('project_documents').insert({
          project_id: project.id,
          uploaded_by: user.id,
          document_category: docForm.category,
          title: (useTitle ? docForm.title.trim() : '') || file.name,
          storage_path: path,
          file_name: file.name,
        })
        return { file, error: insertError }
      }),
    )

    setUploading(false)

    const failed = results.filter((result) => result.error)
    const succeededCount = results.length - failed.length

    if (failed.length > 0) {
      toast.error(
        succeededCount === 0 ? 'Could not upload documents' : `${succeededCount} uploaded, ${failed.length} failed`,
        failed.map((result) => `${result.file.name}: ${result.error.message}`).join('; '),
      )
    }
    if (succeededCount > 0) {
      toast.success(succeededCount === 1 ? 'Document uploaded' : `${succeededCount} documents uploaded`)
    }

    setDocForm({ category: 'OTHER', title: '', files: [] })
    setDocInputKey((current) => current + 1)
    loadDocuments(project.id)
  }

  async function handleViewDocument(doc) {
    const { data, error } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(doc.storage_path, 300)

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
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Engineering Details</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Only these two fields are Engineering-editable, and only while the project is under review.
              </p>
            </div>
            {canReview && project.approved_budget != null && !editingBudgetFields ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditingBudgetFields(true)}
              >
                Edit
              </Button>
            ) : null}
          </div>

          <fieldset
            disabled={!canReview || (project.approved_budget != null && !editingBudgetFields)}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <div>
              <label htmlFor="approved_budget" className="mb-1 block text-sm font-medium text-slate-700">
                Approved Budget (PHP)
              </label>
              <CurrencyInput
                id="approved_budget"
                value={fieldsForm.approved_budget}
                onChange={(value) => setFieldsForm((current) => ({ ...current, approved_budget: value }))}
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

          {canReview && (project.approved_budget == null || editingBudgetFields) ? (
            <div className="mt-4 flex gap-2">
              <Button type="submit" size="sm" icon={Save} loading={savingFields}>
                Save Changes
              </Button>
              {editingBudgetFields ? (
                <Button type="button" variant="secondary" size="sm" onClick={handleCancelEditFields}>
                  Cancel
                </Button>
              ) : null}
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

              {docForm.files.length <= 1 ? (
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
              ) : (
                <div className="flex items-end">
                  <p className="text-xs text-slate-500">
                    {docForm.files.length} files selected — each will use its own file name as the title.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="doc_file" className="mb-1 block text-sm font-medium text-slate-700">
                  File(s)
                </label>
                <input
                  key={docInputKey}
                  id="doc_file"
                  type="file"
                  multiple
                  onChange={(event) =>
                    setDocForm((current) => ({ ...current, files: Array.from(event.target.files ?? []) }))
                  }
                  className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
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
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileWarning, MapPin, RotateCcw, Save, Upload, XCircle } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import { useFormDraft, readDraft, clearDraft } from '../../hooks/useFormDraft'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import CurrencyInput from '../../components/ui/CurrencyInput'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import LocationModal from '../../components/LocationModal'
import { formatCurrency, formatDate, formatDateTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'
import { isWithinDonsol } from '@shared/utils/geo'

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
  const [locationOpen, setLocationOpen] = useState(false)

  const [actionType, setActionType] = useState(null)
  const [remarks, setRemarks] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [powForm, setPowForm] = useState({ pow_amount: '', pow_date: '' })
  const [powFiles, setPowFiles] = useState([])
  const [powFileKey, setPowFileKey] = useState(0)
  const [savingPow, setSavingPow] = useState(false)
  const [editingPow, setEditingPow] = useState(false)

  const [docForm, setDocForm] = useState({ title: '', files: [] })
  const [docInputKey, setDocInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)

  // Unsaved review input survives a refresh or anything that unmounts this
  // page. The POW fields are drafted against the project's saved values; the
  // decision remarks against an empty box, keyed per decision type so
  // switching between Return and Reject doesn't mix them up.
  //
  // File handles are deliberately left out of every draft (powFiles, docForm):
  // they come from a picker and cannot be serialised or re-attached, so a
  // restored draft would point at files the browser will no longer hand over.
  const powDraftKey = project ? `project-review-pow:${projectId}` : null
  useFormDraft(
    powDraftKey,
    powForm,
    { pow_amount: project?.pow_amount ?? '', pow_date: project?.pow_date ?? '' },
    Boolean(project),
  )

  const remarksDraftKey = actionType ? `project-review-remarks:${projectId}:${actionType}` : null
  useFormDraft(remarksDraftKey, remarks, '', Boolean(actionType))

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
           latitude, longitude, estimated_cost, approved_budget, funding_source,
           pow_amount, pow_date, pow_submitted_at,
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

    // Same reasoning as the MPDC form: a query that failed and a project
    // that isn't there both used to render "Project not found", which throws
    // away the error message in the one case where it's the only clue.
    if (projectResult.error) {
      toast.error('Could not load project', projectResult.error.message)
      setNotFound(true)
      setLoading(false)
      return
    }

    if (!projectResult.data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(projectResult.data)
    // A restored draft means an edit was in progress, so reopen the fields
    // for editing too — otherwise the recovered values would sit behind a
    // read-only panel with no sign they're there.
    const powDraft = readDraft(`project-review-pow:${projectId}`)
    setPowForm(
      powDraft ?? {
        pow_amount: projectResult.data.pow_amount ?? '',
        pow_date: projectResult.data.pow_date ?? '',
      },
    )
    if (powDraft) setEditingPow(true)

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
    setRemarks(readDraft(`project-review-remarks:${projectId}:${type}`) ?? '')
  }

  function cancelDecision() {
    clearDraft(remarksDraftKey)
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

    clearDraft(remarksDraftKey)
    setSubmitting(false)
    toast.success('Decision recorded', config.successMessage)
    navigate('/engineering/review')
  }

  // Shared by the POW submission and the general document uploader below —
  // same bucket, same table, same path scheme; only the category and how the
  // title is chosen differ.
  async function uploadFiles(files, { title, category }) {
    return Promise.all(
      files.map(async (file) => {
        const path = `${project.id}/${crypto.randomUUID()}-${file.name}`
        const { error: uploadError } = await supabase.storage
          .from('project-documents')
          .upload(path, file, { contentType: file.type || undefined })
        if (uploadError) return { file, error: uploadError }

        const { error: insertError } = await supabase.from('project_documents').insert({
          project_id: project.id,
          uploaded_by: user.id,
          document_category: category,
          title: title || file.name,
          storage_path: path,
          file_name: file.name,
        })
        return { file, error: insertError }
      }),
    )
  }

  async function handleSavePow(event) {
    event.preventDefault()

    const powAmount = powForm.pow_amount === '' ? null : Number(powForm.pow_amount)
    if (powAmount == null || powAmount <= 0) {
      toast.error('POW amount required', 'Enter the total cost in the Program of Works.')
      return
    }
    // The file is required on the first submission only — a later correction
    // to the amount shouldn't force re-uploading a POW that's already on file.
    if (powFiles.length === 0 && project.pow_amount == null) {
      toast.error('POW file required', 'Attach the Program of Works document.')
      return
    }

    setSavingPow(true)

    if (powFiles.length > 0) {
      const results = await uploadFiles(powFiles, {
        title: `Program of Works — ${project.project_code}`,
        category: 'PROGRAM_OF_WORKS',
      })
      const failed = results.filter((result) => result.error)
      if (failed.length > 0) {
        setSavingPow(false)
        toast.error(
          'Could not upload the Program of Works',
          failed.map((result) => `${result.file.name}: ${result.error.message}`).join('; '),
        )
        return
      }
    }

    const { error } = await supabase
      .from('projects')
      .update({
        pow_amount: powAmount,
        pow_date: powForm.pow_date || null,
        pow_submitted_at: new Date().toISOString(),
        pow_submitted_by: user.id,
      })
      .eq('id', project.id)

    setSavingPow(false)
    if (error) {
      toast.error('Could not save the Program of Works', error.message)
      return
    }

    // Recipient is the project's own creator specifically, not every active
    // MPDC staff member — endorsing is RLS-gated to created_by = auth.uid()
    // (projects_update_scoped), so anyone else literally can't act on this,
    // the same reasoning sendDecisionNotification() below already uses.
    const overBudget =
      project.approved_budget != null && powAmount > Number(project.approved_budget)
    const { error: notifyError } = await supabase.from('notifications').insert({
      recipient_id: project.created_by,
      category: 'PROJECT_REVIEW_READY',
      title: `Program of Works submitted: ${project.title}`,
      message: overBudget
        ? `${project.project_code} has a Program of Works of ${formatCurrency(powAmount)}, which exceeds the allocation of ${formatCurrency(project.approved_budget)}.`
        : `${project.project_code} has a Program of Works on file and can now be endorsed to BAC.`,
      related_project_id: project.id,
    })
    if (notifyError) toast.error('Saved, but could not notify MPDC', notifyError.message)

    clearDraft(powDraftKey)
    toast.success('Program of Works submitted')
    navigate('/engineering/review')
  }

  function handleCancelEditPow() {
    clearDraft(powDraftKey)
    setPowForm({
      pow_amount: project.pow_amount ?? '',
      pow_date: project.pow_date ?? '',
    })
    setPowFiles([])
    setPowFileKey((current) => current + 1)
    setEditingPow(false)
  }

  async function handleUploadDocument(event) {
    event.preventDefault()
    if (docForm.files.length === 0) {
      toast.error('Choose a file', 'Select at least one file to upload.')
      return
    }
    // The Title field only applies when uploading a single file — with
    // several selected at once, each document takes its own file name
    // instead, so there's nothing to require in that case.
    const useTitle = docForm.files.length === 1
    if (useTitle && !docForm.title.trim()) {
      toast.error('Title required', 'Enter a title for this document.')
      return
    }

    setUploading(true)

    const results = await uploadFiles(docForm.files, {
      title: useTitle ? docForm.title.trim() : '',
      category: 'OTHER',
    })

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

    setDocForm({ title: '', files: [] })
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

  // Warns against the value being typed, not the saved one, so the engineer
  // sees the overrun before submitting rather than after.
  const powOverBudget =
    powForm.pow_amount !== '' &&
    project.approved_budget != null &&
    Number(powForm.pow_amount) > Number(project.approved_budget)

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

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Funding</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Set by MPDC from the Annual Investment Program — read-only here. Cost the Program of Works
            against this allocation.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Approved Budget (Allocation)">{formatCurrency(project.approved_budget)}</Field>
            <Field label="Funding Source">{project.funding_source}</Field>
          </div>
        </section>

        <form onSubmit={handleSavePow} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Program of Works</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Engineering's deliverable for this review. The total here becomes the ABC when BAC starts
                procurement, and MPDC cannot endorse the project to BAC until it is on file.
              </p>
            </div>
            {canReview && project.pow_amount != null && !editingPow ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditingPow(true)}>
                Edit
              </Button>
            ) : null}
          </div>

          {project.pow_submitted_at ? (
            <p className="mt-3 text-xs text-slate-500">
              Submitted {formatDateTime(project.pow_submitted_at)}
            </p>
          ) : null}

          <fieldset
            disabled={!canReview || (project.pow_amount != null && !editingPow)}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <div>
              <label htmlFor="pow_amount" className="mb-1 block text-sm font-medium text-slate-700">
                POW Total Amount (PHP) *
              </label>
              <CurrencyInput
                id="pow_amount"
                value={powForm.pow_amount}
                onChange={(value) => setPowForm((current) => ({ ...current, pow_amount: value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="pow_date" className="mb-1 block text-sm font-medium text-slate-700">
                POW Date
              </label>
              <input
                id="pow_date"
                type="date"
                value={powForm.pow_date}
                onChange={(event) => setPowForm((current) => ({ ...current, pow_date: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pow_file" className="mb-1 block text-sm font-medium text-slate-700">
                POW Document {project.pow_amount == null ? '*' : '(optional — replaces nothing on file)'}
              </label>
              <input
                key={powFileKey}
                id="pow_file"
                type="file"
                multiple
                onChange={(event) => setPowFiles(Array.from(event.target.files ?? []))}
                className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
              />
            </div>
          </fieldset>

          {powOverBudget ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This POW exceeds MPDC's allocation of {formatCurrency(project.approved_budget)} by{' '}
              {formatCurrency(Number(powForm.pow_amount) - Number(project.approved_budget))}. MPDC will be
              told, and will need to adjust the allocation or have the project returned for revision.
            </p>
          ) : null}

          {canReview && (project.pow_amount == null || editingPow) ? (
            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                size="sm"
                icon={Save}
                loading={savingPow}
                disabled={!powForm.pow_amount || Number(powForm.pow_amount) <= 0}
              >
                Send to MPDC
              </Button>
              {editingPow ? (
                <Button type="button" variant="secondary" size="sm" onClick={handleCancelEditPow}>
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
              className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
            >
              {docForm.files.length <= 1 ? (
                <div>
                  <label htmlFor="doc_title" className="mb-1 block text-sm font-medium text-slate-700">
                    Title
                  </label>
                  <input
                    id="doc_title"
                    value={docForm.title}
                    onChange={(event) => setDocForm((current) => ({ ...current, title: event.target.value }))}
                    className={inputClass}
                    required
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

              <div className="sm:col-span-2">
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

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />
    </div>
  )
}

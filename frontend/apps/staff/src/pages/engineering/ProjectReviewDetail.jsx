import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileWarning, MapPin, RotateCcw, Save, Sparkles, Upload } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import { useFormDraft, readDraft, clearDraft } from '../../hooks/useFormDraft'
import { useFieldErrors } from '../../hooks/useFieldErrors'
import { useConfirmedBy } from '../../hooks/useConfirmedBy'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import FieldError from '../../components/ui/FieldError'
import { invalidClass, invalidFileClass } from '../../utils/fieldStyles'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import LocationModal from '../../components/LocationModal'
import ConfirmNameDialog from '../../components/ConfirmNameDialog'
import ProgramOfWorksForm, {
  emptyPowDetails,
  powDetailsFromExtraction,
  powDetailsFromSaved,
  powDetailsPayload,
  powDetailsProblems,
} from '../../components/ProgramOfWorksForm'
import PowBreakdown from '@shared/components/PowBreakdown'
import { computePowTotals, formatPeso } from '@shared/utils/programOfWorks'
import { formatCurrency, formatDate, formatDateTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'
import { DOCUMENT_ACCEPT, DOCUMENT_RULES_TEXT, pickDocuments } from '../../utils/documentUpload'
import { isWithinDonsol } from '@shared/utils/geo'

const inputClass =
  'w-full rounded-md border border-slate-400 dark:border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

const DOC_CATEGORY_LABELS = {
  PROGRAM_OF_WORKS: 'Program of Works',
  PROGRESS_REPORT: 'Progress Report',
  PERMIT: 'Permit',
  DESIGN_PLAN: 'Design Plan',
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

export default function ProjectReviewDetail() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()

  const [project, setProject] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [history, setHistory] = useState([])
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)

  // Engineering's review ends in a POW, not a decision: the project was
  // already approved by the SB and Mayor, so there is nothing to send back.
  // Approving, rejecting and returning the POW are all MPDC's
  // (20261019100000_pow_revision.sql).
  // POWs MPDC returned for revision, newest first.
  const [powRevisions, setPowRevisions] = useState([])

  const [powForm, setPowForm] = useState(() => ({ pow_date: '', details: emptyPowDetails() }))
  const [powFiles, setPowFiles] = useState([])
  const [savingPow, setSavingPow] = useState(false)
  const [extracting, setExtracting] = useState(false)
  // Saved detailed POW (project_pow_details); null for a POW submitted before
  // the detailed form existed.
  const [powDetails, setPowDetails] = useState(null)

  const [docForm, setDocForm] = useState({ files: [] })
  const [docInputKey, setDocInputKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  // Which action is waiting on the Confirmed By popup: 'pow' (Send to MPDC)
  // or 'upload'.
  const [namePrompt, setNamePrompt] = useState(null)

  const powErrors = useFieldErrors()
  const docErrors = useFieldErrors()
  const confirmedBy = useConfirmedBy()

  // Unsaved review input survives a refresh or anything that unmounts this
  // page. The POW fields are drafted against the project's saved values.
  //
  // File handles are deliberately left out of every draft (powFiles, docForm):
  // they come from a picker and cannot be serialised or re-attached, so a
  // restored draft would point at files the browser will no longer hand over.
  const powDraftKey = project ? `project-review-pow:${projectId}` : null
  useFormDraft(powDraftKey, powForm, null, Boolean(project) && project?.pow_amount == null)

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

  async function loadHistory(id, revisions) {
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
    const returns = revisions.map((entry) => ({
      id: `pow-return-${entry.id}`,
      label: `POW Returned for Revision (${formatPeso(entry.pow_amount)})`,
      tone: 'amber',
      actor: entry.returner?.full_name,
      at: entry.returned_at,
      notes: entry.return_remarks,
    }))

    setHistory(
      [...decisions, ...endorsements, ...returns].sort((a, b) => new Date(b.at) - new Date(a.at)),
    )
  }

  async function loadPowRevisions(id) {
    const { data, error } = await supabase
      .from('project_pow_revisions')
      .select(
        `id, revision_no, pow_amount, pow_date, details, return_remarks, returned_at,
         returner:profiles!project_pow_revisions_returned_by_fkey(full_name)`,
      )
      .eq('project_id', id)
      .order('revision_no', { ascending: false })
    if (error) toast.error('Could not load Program of Works revisions', error.message)
    setPowRevisions(data ?? [])
    return data ?? []
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
    const revisions = await loadPowRevisions(projectResult.data.id)
    // A submitted POW can't be edited, so a leftover draft only matters while
    // none is on file. Drafts from before the detailed form have no details.
    // Without a draft, a POW MPDC returned starts from the returned version.
    const powDraft =
      projectResult.data.pow_amount == null ? readDraft(`project-review-pow:${projectId}`) : null
    const returned = projectResult.data.pow_amount == null ? revisions[0] : null
    setPowForm({
      pow_date: powDraft?.pow_date ?? projectResult.data.pow_date ?? returned?.pow_date ?? '',
      details: powDraft?.details?.items
        ? powDraft.details
        : returned?.details
          ? powDetailsFromSaved(returned.details)
          : emptyPowDetails(),
    })

    if (projectResult.data.pow_amount != null) {
      const { data: detailsRow, error: detailsError } = await supabase
        .from('project_pow_details')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()
      if (detailsError) toast.error('Could not load the Program of Works breakdown', detailsError.message)
      setPowDetails(detailsRow ? { ...detailsRow, pow_date: projectResult.data.pow_date } : null)
    }

    if (submissionResult.error) {
      toast.error('Could not load submission details', submissionResult.error.message)
    } else {
      setSubmission(submissionResult.data)
    }

    await Promise.all([loadHistory(projectResult.data.id, revisions), loadDocuments(projectResult.data.id)])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [projectId])

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

  // Reads the selected POW file with AI (extract-program-of-works) and fills
  // the form. Engineering still checks every value before sending.
  async function handleExtractPow() {
    const file = powFiles.find((f) => /\.(pdf|jpe?g|png)$/i.test(f.name))
    if (!file) {
      toast.error('No readable file selected', 'Choose the POW as a PDF, JPG or PNG first, then click Read from File.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large to read', 'Files up to 10 MB can be read automatically. Enter the details by hand.')
      return
    }

    setExtracting(true)
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('The file could not be read.'))
        reader.readAsDataURL(file)
      })
      const mimeType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/jpeg')
      const { data, error } = await supabase.functions.invoke('extract-program-of-works', {
        body: { file_base64: base64, mime_type: mimeType, project_id: project.id },
      })
      if (error || !data?.extracted) {
        let message = data?.error ?? error?.message ?? 'The file could not be read.'
        try {
          message = (await error?.context?.json())?.error ?? message
        } catch {
          // keep the generic message
        }
        throw new Error(message)
      }

      const details = powDetailsFromExtraction(data.extracted)
      const date = /^\d{4}-\d{2}-\d{2}$/.test(data.extracted.date_prepared ?? '') ? data.extracted.date_prepared : null
      setPowForm((current) => ({ pow_date: date ?? current.pow_date, details }))
      powErrors.clearError('pow_date')

      const computed = computePowTotals(details).total
      const written = Number(data.extracted.total_cost) || 0
      if (written > 0 && Math.abs(written - computed) > 1) {
        toast.error(
          'Check the extracted figures',
          `The file states a total of ${formatPeso(written)}, but the extracted items add up to ${formatPeso(computed)}. Compare the items with the document.`,
        )
      } else {
        toast.success('Program of Works read from file', 'Check every value against the document before sending.')
      }
    } catch (error) {
      toast.error('Could not read the Program of Works', error.message)
    } finally {
      setExtracting(false)
    }
  }

  async function handleSavePow(event) {
    event.preventDefault()

    // A sent Program of Works can't be edited — only MPDC can return it for
    // revision (also enforced by the lock_program_of_works trigger).
    if (project.pow_amount != null) return
    // It must fit within the SB-approved allocation (also enforced by
    // submit_program_of_works); the button is disabled while it doesn't.
    if (powOverBudget) return

    if (
      !powErrors.validate({
        pow_date: !powForm.pow_date && 'Choose the date of the Program of Works.',
        pow_file: powFiles.length === 0 && 'Attach the Program of Works document.',
      })
    ) {
      return
    }
    const problems = powDetailsProblems(powForm.details)
    if (problems.length > 0) {
      toast.error('The Program of Works is incomplete', problems.join(' '))
      return
    }
    setNamePrompt('pow')
  }

  async function savePow(confirmedName) {
    confirmedBy.setName(confirmedName)
    setNamePrompt(null)
    setSavingPow(true)

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

    // Saves the breakdown and the POW amount/date in one transaction; the
    // database computes the total (ABC) itself.
    const { data: powAmount, error } = await supabase.rpc('submit_program_of_works', {
      p_project_id: project.id,
      p_pow_date: powForm.pow_date,
      p_details: powDetailsPayload(powForm.details),
    })

    setSavingPow(false)
    if (error) {
      toast.error('Could not save the Program of Works', error.message)
      return
    }

    // Recipient is the project's own creator specifically, not every active
    // MPDC staff member — endorsing is RLS-gated to created_by = auth.uid()
    // (projects_update_scoped), so anyone else literally can't act on this,
    // the same recipient return_program_of_works() answers to.
    const revised = powRevisions.length > 0
    const { error: notifyError } = await supabase.from('notifications').insert({
      recipient_id: project.created_by,
      sender_id: user.id,
      category: 'PROJECT_REVIEW_READY',
      title: `${revised ? 'Revised Program of Works' : 'Program of Works'} submitted: ${project.title}`,
      message: `${project.project_code} has a Program of Works of ${formatCurrency(powAmount)} on file and can now be endorsed to BAC.`,
      related_project_id: project.id,
    })
    if (notifyError) toast.error('Saved, but could not notify MPDC', notifyError.message)

    await confirmedBy.record(
      project.id,
      `Submitted the ${revised ? 'revised ' : ''}Program of Works (${formatPeso(powAmount)})`,
      confirmedName,
    )
    clearDraft(powDraftKey)
    toast.success('Program of Works submitted')
    navigate('/engineering/review')
  }

  async function handleUploadDocument(event) {
    event.preventDefault()
    // No separate title — each document is listed under its own file name.
    if (
      !docErrors.validate({
        doc_file: docForm.files.length === 0 && 'Select at least one file to upload.',
      })
    ) {
      return
    }
    setNamePrompt('upload')
  }

  async function uploadDocuments(confirmedName) {
    confirmedBy.setName(confirmedName)
    setNamePrompt(null)
    setUploading(true)

    const useTitle = docForm.files.length <= 1
    const results = await uploadFiles(docForm.files, { title: '', category: 'OTHER' })

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
      await confirmedBy.record(
        project.id,
        succeededCount === 1 ? 'Uploaded a technical document' : `Uploaded ${succeededCount} technical documents`,
        confirmedName,
      )
      toast.success(succeededCount === 1 ? 'Document uploaded' : `${succeededCount} documents uploaded`)
    }

    setDocForm({ files: [] })
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

  // Checked against the value being typed, not the saved one, so the
  // engineer sees the overrun while revising rather than on submit.
  const powTotal = computePowTotals(powForm.details).total
  const powOverBudget = project.approved_budget != null && powTotal > Number(project.approved_budget)
  const powEditable = canReview && project.pow_amount == null
  const returnedPow = project.pow_amount == null ? powRevisions[0] : null

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code ? `Project Code: ${project.project_code}` : undefined}
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
            Entered by MPDC from the project approved by the SB and the Mayor — read-only. Encoding errors are
            corrected by Admin.
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
                procurement, so it must fit within the allocation, and MPDC cannot endorse the project to
                BAC until it is on file. Once sent, only MPDC can return it to you for revision.
              </p>
            </div>
          </div>

          {canReview && returnedPow ? (
            <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium">MPDC returned the Program of Works for revision</p>
                <p className="text-xs">
                  {returnedPow.returner?.full_name ?? 'MPDC'} · {formatDateTime(returnedPow.returned_at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{returnedPow.return_remarks}</p>
                <p className="mt-1 text-xs">
                  The returned version ({formatPeso(returnedPow.pow_amount)}) is filled in below. Revise it, attach
                  the revised POW document and send it again.
                </p>
              </div>
            </div>
          ) : null}

          {project.pow_submitted_at ? (
            <p className="mt-3 text-xs text-slate-500">
              Submitted {formatDateTime(project.pow_submitted_at)}
            </p>
          ) : null}

          {project.pow_amount != null ? (
            <div className="mt-4">
              {powDetails ? (
                <PowBreakdown pow={powDetails} />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="POW Total Amount">{formatCurrency(project.pow_amount)}</Field>
                  <Field label="POW Date">{formatDate(project.pow_date)}</Field>
                  <p className="text-xs text-slate-500 sm:col-span-2">
                    Submitted before the detailed breakdown was required — see the POW file under Technical Documents.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <fieldset disabled={!powEditable} className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="pow_file" className="mb-1 block text-sm font-medium text-slate-700">
                    POW Document *
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="pow_file"
                      type="file"
                      multiple
                      accept={DOCUMENT_ACCEPT}
                      onChange={(event) => {
                        setPowFiles(pickDocuments(event, toast))
                        powErrors.clearError('pow_file')
                      }}
                      className={`block min-w-0 flex-1 text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50${invalidFileClass(powErrors.errors.pow_file)}`}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      loading={extracting}
                      disabled={powFiles.length === 0}
                      onClick={handleExtractPow}
                    >
                      Read from File
                    </Button>
                  </div>
                  <FieldError message={powErrors.errors.pow_file} />
                  <p className="mt-1 text-xs text-slate-400">
                    {DOCUMENT_RULES_TEXT} "Read from File" fills in the form below from a PDF, JPG or PNG — check every
                    value against the document.
                  </p>
                </div>
                <div>
                  <label htmlFor="pow_date" className="mb-1 block text-sm font-medium text-slate-700">
                    POW Date (date prepared) *
                  </label>
                  <input
                    id="pow_date"
                    type="date"
                    value={powForm.pow_date}
                    onChange={(event) => {
                      setPowForm((current) => ({ ...current, pow_date: event.target.value }))
                      powErrors.clearError('pow_date')
                    }}
                    className={inputClass + invalidClass(powErrors.errors.pow_date)}
                  />
                  <FieldError message={powErrors.errors.pow_date} />
                </div>
                <div>
                  <p className="mb-1 block text-sm font-medium text-slate-700">POW Total (ABC)</p>
                  <p className="rounded-md bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-800">
                    {formatPeso(powTotal)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">Computed from the breakdown below.</p>
                </div>
              </fieldset>

              <ProgramOfWorksForm
                value={powForm.details}
                onChange={(details) => setPowForm((current) => ({ ...current, details }))}
                disabled={!powEditable}
              />
            </div>
          )}

          {powEditable && powOverBudget ? (
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              This POW exceeds the allocation of {formatCurrency(project.approved_budget)} by{' '}
              {formatCurrency(powTotal - Number(project.approved_budget))}. The allocation was approved by the SB and
              the Mayor, so revise the POW (quantities or items) until it fits before sending it to MPDC.
            </p>
          ) : null}

          {canReview && project.pow_amount == null ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="submit"
                size="sm"
                icon={Save}
                loading={savingPow}
                disabled={powOverBudget}
              >
                Send to MPDC
              </Button>
            </div>
          ) : null}
        </form>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">
            Technical Documents <span className="font-normal text-slate-400">(Optional)</span>
          </h2>

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
              className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
            >
              <div>
                <label htmlFor="doc_file" className="mb-1 block text-sm font-medium text-slate-700">
                  File(s)
                </label>
                <input
                  key={docInputKey}
                  id="doc_file"
                  type="file"
                  multiple
                  accept={DOCUMENT_ACCEPT}
                  onChange={(event) => {
                    const files = pickDocuments(event, toast)
                    setDocForm((current) => ({ ...current, files }))
                    docErrors.clearError('doc_file')
                  }}
                  className={`block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50${invalidFileClass(docErrors.errors.doc_file)}`}
                />
                <FieldError message={docErrors.errors.doc_file} />
                <p className="mt-1 text-xs text-slate-400">{DOCUMENT_RULES_TEXT}</p>
              </div>

              <div>
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

      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />

      {namePrompt === 'pow' ? (
        <ConfirmNameDialog
          title="Send Program of Works to MPDC?"
          description={`POW Total (ABC): ${formatPeso(powTotal)}. Once sent, you can no longer edit the Program of Works unless MPDC returns it for revision. Your name is recorded as Confirmed By.`}
          label="Confirmed By (Your Full Name)"
          confirmLabel="Send to MPDC"
          confirmIcon={Save}
          initialName={confirmedBy.name}
          onConfirm={savePow}
          onCancel={() => setNamePrompt(null)}
        />
      ) : null}

      {namePrompt === 'upload' ? (
        <ConfirmNameDialog
          title={docForm.files.length === 1 ? 'Upload this document?' : `Upload ${docForm.files.length} documents?`}
          description="Your name is recorded as Confirmed By for this upload."
          label="Confirmed By (Your Full Name)"
          confirmLabel="Upload"
          confirmIcon={Upload}
          initialName={confirmedBy.name}
          onConfirm={uploadDocuments}
          onCancel={() => setNamePrompt(null)}
        />
      ) : null}
    </div>
  )
}

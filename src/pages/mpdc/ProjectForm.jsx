import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { FileWarning, Save, Send, Upload } from 'lucide-react'
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

const EMPTY_FORM = {
  title: '',
  description: '',
  project_category: '',
  barangay: '',
  location_text: '',
  latitude: '',
  longitude: '',
  estimated_cost: '',
  start_date_planned: '',
  end_date_planned: '',
  office_id: '',
}

// Matches the completeness check the DB enforces on submission
// (trg_submissions_guard_completeness) so the UI never lets an incomplete
// project get as far as the trigger rejecting it.
const REQUIRED_FIELD_LABELS = {
  title: 'Project Name',
  description: 'Description',
  project_category: 'Category',
  barangay: 'Barangay',
  location_text: 'Location',
  estimated_cost: 'Estimated Budget',
  start_date_planned: 'Proposed Start Date',
  end_date_planned: 'Target Completion Date',
  office_id: 'Implementing Office',
}

export default function ProjectForm() {
  const { projectId } = useParams()
  const isNew = !projectId
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState(null)
  const [offices, setOffices] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [documents, setDocuments] = useState([])
  const [docForm, setDocForm] = useState({ category: 'OTHER', title: '', file: null })
  const [uploading, setUploading] = useState(false)

  const [history, setHistory] = useState([])

  const [showSubmitPanel, setShowSubmitPanel] = useState(false)
  const [submissionNotes, setSubmissionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, code, name').order('name', { ascending: true })
    if (error) {
      toast.error('Could not load offices', error.message)
      return []
    }
    setOffices(data ?? [])
    return data ?? []
  }

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

  async function loadProject() {
    setLoading(true)
    const officesData = await loadOffices()

    if (isNew) {
      // Default the implementing office to Engineering — MPDC plans/creates
      // the project, but Engineering is who it gets assigned to for
      // implementation, so that's the sensible default rather than MPDC's
      // own office. Still a normal editable field if that ever needs to
      // differ.
      const engineeringOffice = officesData.find((o) => o.code === 'ENGG')
      setForm((current) => ({ ...current, office_id: engineeringOffice?.id ?? officesData[0]?.id ?? '' }))
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, barangay, location_text,
         latitude, longitude, estimated_cost, approved_budget, funding_source,
         start_date_planned, end_date_planned, status, created_by, office_id`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (error || !data || data.created_by !== user.id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(data)
    setForm({
      title: data.title ?? '',
      description: data.description ?? '',
      project_category: data.project_category ?? '',
      barangay: data.barangay ?? '',
      location_text: data.location_text ?? '',
      latitude: data.latitude ?? '',
      longitude: data.longitude ?? '',
      estimated_cost: data.estimated_cost ?? '',
      start_date_planned: data.start_date_planned ?? '',
      end_date_planned: data.end_date_planned ?? '',
      office_id: data.office_id ?? '',
    })

    await Promise.all([loadDocuments(data.id), loadHistory(data.id)])
    setLoading(false)
  }

  useEffect(() => {
    loadProject()
  }, [projectId])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function getMissingFields() {
    const missing = []
    if (!form.title.trim()) missing.push(REQUIRED_FIELD_LABELS.title)
    if (!form.description.trim()) missing.push(REQUIRED_FIELD_LABELS.description)
    if (!form.project_category.trim()) missing.push(REQUIRED_FIELD_LABELS.project_category)
    if (!form.barangay.trim()) missing.push(REQUIRED_FIELD_LABELS.barangay)
    if (!form.location_text.trim()) missing.push(REQUIRED_FIELD_LABELS.location_text)
    if (form.estimated_cost === '' || Number(form.estimated_cost) <= 0) {
      missing.push(REQUIRED_FIELD_LABELS.estimated_cost)
    }
    if (!form.start_date_planned) missing.push(REQUIRED_FIELD_LABELS.start_date_planned)
    if (!form.end_date_planned) missing.push(REQUIRED_FIELD_LABELS.end_date_planned)
    if (!form.office_id) missing.push(REQUIRED_FIELD_LABELS.office_id)
    return missing
  }

  function buildPayload() {
    return {
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_category: form.project_category.trim() || null,
      barangay: form.barangay.trim() || null,
      location_text: form.location_text.trim() || null,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
      start_date_planned: form.start_date_planned || null,
      end_date_planned: form.end_date_planned || null,
    }
  }

  async function handleSaveDraft(event) {
    event.preventDefault()
    if (!form.title.trim()) {
      toast.error('Project name required', 'Give the project a name before saving.')
      return
    }
    if (form.start_date_planned && form.end_date_planned && form.end_date_planned < form.start_date_planned) {
      toast.error('Invalid schedule', 'Target completion date cannot be before the proposed start date.')
      return
    }

    setSaving(true)
    const payload = buildPayload()

    if (isNew) {
      const { data, error } = await supabase
        .from('projects')
        .insert({ ...payload, office_id: form.office_id || null, created_by: user.id })
        .select('id')
        .single()

      setSaving(false)
      if (error) {
        toast.error('Could not create project', error.message)
        return
      }
      toast.success('Draft created', 'You can now upload documents and submit it for review when ready.')
      navigate(`/mpdc/projects/${data.id}`, { replace: true })
      return
    }

    // office_id is locked at creation time (guard_project_field_updates
    // blocks MPDC from changing it afterward), so it's deliberately left
    // out of this update payload.
    const { error } = await supabase.from('projects').update(payload).eq('id', project.id)
    setSaving(false)
    if (error) {
      toast.error('Could not save changes', error.message)
      return
    }
    toast.success('Draft saved')
    loadProject()
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

  async function handleSubmitForReview() {
    const missing = getMissingFields()
    if (missing.length > 0) {
      toast.error('Project is incomplete', `Missing: ${missing.join(', ')}.`)
      return
    }

    const confirmed = await confirm({
      title: 'Submit this project for review?',
      description: 'It will appear in the Project Review queue for a decision.',
      confirmLabel: 'Submit for Review',
    })
    if (!confirmed) return

    setSubmitting(true)

    const { data: lastSubmission, error: lastError } = await supabase
      .from('project_submissions')
      .select('submission_number')
      .eq('project_id', project.id)
      .order('submission_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (lastError) {
      toast.error('Could not submit project', lastError.message)
      setSubmitting(false)
      return
    }

    const nextNumber = (lastSubmission?.submission_number ?? 0) + 1

    // The insert alone is enough: apply_project_submission (DB trigger)
    // advances the project to SUBMITTED_FOR_REVIEW, that status change logs
    // the status history, and the insert itself logs the PROJECT_SUBMITTED
    // audit entry. Notifying the rest of MPDC is the only step left to do
    // from here.
    const { error } = await supabase.from('project_submissions').insert({
      project_id: project.id,
      submission_number: nextNumber,
      submitted_by: user.id,
      notes: submissionNotes.trim() || null,
    })

    if (error) {
      toast.error('Could not submit project', error.message)
      setSubmitting(false)
      return
    }

    const { data: engineeringStaff, error: engineeringError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'engineering')
      .eq('is_active', true)

    if (engineeringError) {
      toast.error('Submitted, but could not notify Engineering', engineeringError.message)
    } else if (engineeringStaff?.length) {
      const { error: notifyError } = await supabase.from('notifications').insert(
        engineeringStaff.map((staff) => ({
          recipient_id: staff.id,
          category: 'PROJECT_SUBMITTED',
          title: `New project submitted for review: ${project.title}`,
          message: submissionNotes.trim() || `${project.project_code} is ready for review.`,
          related_project_id: project.id,
        })),
      )
      if (notifyError) toast.error('Submitted, but could not notify Engineering', notifyError.message)
    }

    setSubmitting(false)
    toast.success('Project submitted', 'It has been added to the review queue.')
    navigate('/mpdc/projects')
  }

  if (loading) {
    return <LoadingState label="Loading project..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Project not found"
        description="It may have been removed, or you don't have access to it."
        action={
          <Button variant="secondary" size="sm" to="/mpdc/projects">
            Back to My Projects
          </Button>
        }
      />
    )
  }

  const editable = isNew || ['DRAFT', 'RETURNED_FOR_REVISION'].includes(project.status)

  return (
    <div>
      <PageHeader
        title={isNew ? 'New Project' : project.title}
        description={isNew ? 'Create a project and save it as a draft.' : project.project_code}
        breadcrumbs={[
          { label: 'Dashboard', to: '/mpdc' },
          { label: 'My Projects', to: '/mpdc/projects' },
          { label: isNew ? 'New Project' : project.project_code },
        ]}
        actions={
          !isNew ? (
            <Badge tone={PROJECT_STATUS_TONES[project.status]}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>
          ) : null
        }
      />

      <div className="space-y-6">
        {!isNew && history.length > 0 ? (
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

        <form onSubmit={handleSaveDraft} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Project Details</h2>

          <fieldset disabled={!editable} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="title" className="mb-1 block text-sm font-medium text-slate-700">
                Project Name *
              </label>
              <input
                id="title"
                required
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                className={inputClass}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="description" className="mb-1 block text-sm font-medium text-slate-700">
                Description *
              </label>
              <textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                className={textareaClass}
              />
            </div>

            <div>
              <label htmlFor="project_category" className="mb-1 block text-sm font-medium text-slate-700">
                Category *
              </label>
              <input
                id="project_category"
                placeholder="e.g. Road, Bridge, Drainage, School Building"
                value={form.project_category}
                onChange={(event) => updateField('project_category', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="barangay" className="mb-1 block text-sm font-medium text-slate-700">
                Barangay *
              </label>
              <input
                id="barangay"
                value={form.barangay}
                onChange={(event) => updateField('barangay', event.target.value)}
                className={inputClass}
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="location_text" className="mb-1 block text-sm font-medium text-slate-700">
                Location *
              </label>
              <input
                id="location_text"
                placeholder="Site address / landmark"
                value={form.location_text}
                onChange={(event) => updateField('location_text', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="latitude" className="mb-1 block text-sm font-medium text-slate-700">
                Latitude (optional)
              </label>
              <input
                id="latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={form.latitude}
                onChange={(event) => updateField('latitude', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="longitude" className="mb-1 block text-sm font-medium text-slate-700">
                Longitude (optional)
              </label>
              <input
                id="longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={form.longitude}
                onChange={(event) => updateField('longitude', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="estimated_cost" className="mb-1 block text-sm font-medium text-slate-700">
                Estimated Budget (PHP) *
              </label>
              <input
                id="estimated_cost"
                type="number"
                step="0.01"
                min="0"
                value={form.estimated_cost}
                onChange={(event) => updateField('estimated_cost', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="office_id" className="mb-1 block text-sm font-medium text-slate-700">
                Implementing Office *
              </label>
              <select
                id="office_id"
                value={form.office_id}
                onChange={(event) => updateField('office_id', event.target.value)}
                className={inputClass}
                disabled={!isNew}
              >
                <option value="">Select an office</option>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
              {!isNew ? (
                <p className="mt-1 text-xs text-slate-400">Set once at creation and can't be changed.</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="start_date_planned" className="mb-1 block text-sm font-medium text-slate-700">
                Proposed Start Date *
              </label>
              <input
                id="start_date_planned"
                type="date"
                value={form.start_date_planned}
                onChange={(event) => updateField('start_date_planned', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="end_date_planned" className="mb-1 block text-sm font-medium text-slate-700">
                Target Completion Date *
              </label>
              <input
                id="end_date_planned"
                type="date"
                value={form.end_date_planned}
                onChange={(event) => updateField('end_date_planned', event.target.value)}
                className={inputClass}
              />
            </div>
          </fieldset>

          {editable ? (
            <div className="mt-5">
              <Button type="submit" icon={Save} loading={saving}>
                {isNew ? 'Save as Draft' : 'Save Changes'}
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              This project is {(PROJECT_STATUS_LABELS[project.status] ?? project.status).toLowerCase()} and
              can no longer be edited.
            </p>
          )}
        </form>

        {!isNew && (project.approved_budget != null || project.funding_source) ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Engineering Details</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Entered by Engineering during review — read-only here.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Approved Budget</p>
                <p className="mt-0.5 text-sm text-slate-800">
                  {project.approved_budget != null ? formatCurrency(project.approved_budget) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Funding Source</p>
                <p className="mt-0.5 text-sm text-slate-800">{project.funding_source || '—'}</p>
              </div>
            </div>
          </section>
        ) : null}

        {!isNew ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Initial Project Documents</h2>

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

            {editable ? (
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
                    onChange={(event) =>
                      setDocForm((current) => ({ ...current, category: event.target.value }))
                    }
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
        ) : null}

        {!isNew && editable ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Submit for Review</h2>
            <p className="mt-1 text-sm text-slate-500">
              Once submitted, this project is locked for editing until a decision is recorded.
            </p>

            {!showSubmitPanel ? (
              <div className="mt-4">
                <Button icon={Send} onClick={() => setShowSubmitPanel(true)}>
                  Submit for Review
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <label htmlFor="submission_notes" className="mb-1 block text-sm font-medium text-slate-700">
                  Notes for the reviewer (optional)
                </label>
                <textarea
                  id="submission_notes"
                  rows={3}
                  value={submissionNotes}
                  onChange={(event) => setSubmissionNotes(event.target.value)}
                  className={textareaClass}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowSubmitPanel(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" icon={Send} onClick={handleSubmitForReview} loading={submitting}>
                    Confirm Submit
                  </Button>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

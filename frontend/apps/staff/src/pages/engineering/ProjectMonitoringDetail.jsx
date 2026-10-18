import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FileWarning, MapPin, ScanSearch, Send } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import { useFormDraft, readDraft } from '../../hooks/useFormDraft'
import { useFieldErrors } from '../../hooks/useFieldErrors'
import { useConfirmedBy } from '../../hooks/useConfirmedBy'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import FieldError from '../../components/ui/FieldError'
import { invalidClass } from '../../utils/fieldStyles'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import DssPanel from '../../components/ui/DssPanel'
import LocationModal from '../../components/LocationModal'
import ProgramOfWorksSection from '../../components/ProgramOfWorksSection'
import BeforeAfterSection from '../../components/BeforeAfterSection'
import ConfirmNameDialog from '../../components/ConfirmNameDialog'
import { formatDate, formatDateTime } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  SITE_MONITORING_VISIBLE_STATUSES,
  MONITORING_EDITABLE_STATUSES,
} from '@shared/utils/projectStatus'
import { evaluateProjectDss } from '@shared/utils/decisionSupport'
import { isWithinDonsol } from '@shared/utils/geo'
import { ROLES } from '../../utils/roles'
import {
  UPDATE_REQUEST_PREFIX,
  UPDATE_REQUEST_STATE_LABELS,
  UPDATE_REQUEST_STATE_TONES,
  getUpdateRequestStatus,
} from '../../utils/updateRequests'

const inputClass =
  'w-full rounded-md border border-slate-400 dark:border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const textareaClass = inputClass

// Today's date in the device's local time zone as YYYY-MM-DD. toISOString()
// would give the UTC date, which in the Philippines is still yesterday until
// 8 AM. The database rejects future report dates against Manila time.
function localToday() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// No progress field: the update's progress is the AI Progress of its
// Before & After comparison (20261028100000_ai_progress.sql).
const EMPTY_FORM = {
  narrative_report: '',
  issues_encountered: '',
  report_date: localToday(),
}

function StepHeading({ number, title, description, done = false }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : number}
      </span>
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </div>
  )
}

export default function ProjectMonitoringDetail() {
  const { projectId } = useParams()
  const toast = useToast()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState(null)
  const [updates, setUpdates] = useState([])
  const [images, setImages] = useState([])
  const [latestRequestAt, setLatestRequestAt] = useState(null)
  const [locationOpen, setLocationOpen] = useState(false)

  const draftKey = `monitoring-update:${projectId}`
  const [form, setForm] = useState(() => readDraft(draftKey) ?? EMPTY_FORM)
  // Progress Report attached to the update. File handles stay out of the
  // draft.
  const [reportFiles, setReportFiles] = useState([])
  const [reportInputKey, setReportInputKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  // "Responsible person" dialog, opened by Submit Monitoring Update.
  const [submitPromptOpen, setSubmitPromptOpen] = useState(false)
  // Before & After comparisons, reported by BeforeAfterSection. The newest
  // draft one is what the update is submitted with.
  const [comparisons, setComparisons] = useState([])
  const { errors, validate, clearError } = useFieldErrors()
  const confirmedBy = useConfirmedBy()

  // A site report typed out on a phone in the field is exactly the input
  // worth not losing to a backgrounded tab. Text fields only. Submitting
  // resets `form` to EMPTY_FORM, which matches the clean value here and so
  // clears the stored draft on its own.
  useFormDraft(draftKey, form, EMPTY_FORM)

  async function loadUpdates() {
    const { data, error } = await supabase
      .from('project_updates')
      .select(
        `id, progress_percentage, narrative_report, issues_encountered, report_date, created_at,
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

  // MPDC's "Request Update" button (MpdcProjectMonitoringDetail.jsx) sends a
  // message to Engineering for this project. The New Monitoring Update form
  // only opens while the latest such request is still unanswered.
  async function loadUpdateRequest() {
    const { data, error } = await supabase
      .from('messages')
      .select('created_at')
      .eq('project_id', projectId)
      .eq('sender_role', ROLES.MPDC)
      .eq('recipient_role', ROLES.ENGINEERING)
      .like('body', `${UPDATE_REQUEST_PREFIX}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      toast.error('Could not load update requests', error.message)
      return
    }
    setLatestRequestAt(data?.created_at ?? null)
  }

  async function loadImages() {
    const { data, error } = await supabase
      .from('project_images')
      .select(
        `id, project_update_id, storage_path, file_name, image_stage, ai_analysis_status, ai_analysis_result, created_at, latitude, longitude,
         released_at,
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

    // Eligibility is scoped by implementing office, not by who created the
    // project — see SiteMonitoring.jsx for the same rule applied to the list.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('office_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError || !profile?.office_id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, status, barangay, location_text, latitude, longitude,
         start_date_planned, end_date_planned, start_date_actual, end_date_actual, office_id,
         pow_amount, pow_date`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (error || !data || data.office_id !== profile.office_id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(data)
    await Promise.all([loadUpdates(), loadImages(), loadUpdateRequest()])
    setLoading(false)
    return data
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

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    clearError(field)
  }

  // Draft comparison of a draft After photo — the site visit this update is
  // submitted with (trg_require_draft_comparison checks the same).
  const draftComparison =
    comparisons.find(
      (comparison) =>
        comparison.released_at === null &&
        images.some((image) => image.id === comparison.after_image_id && image.released_at === null),
    ) ?? null
  // Not editable: the database takes the update's progress from this
  // comparison (never below the latest update's).
  const aiProgress = draftComparison?.ai_progress != null ? Number(draftComparison.ai_progress) : null

  // Submit Monitoring Update: checks the form, then asks who is responsible
  // before anything is sent.
  function handleSubmitUpdate(event) {
    event.preventDefault()

    if (
      !validate({
        report_date: !form.report_date
          ? 'Choose the date this update covers.'
          : form.report_date > localToday() && 'The report date cannot be in the future.',
      })
    ) {
      return
    }
    if (reportFiles.length === 0) {
      toast.error('Progress Report required', 'Attach the Progress Report for this update.')
      return
    }
    if (!images.some((image) => image.image_stage === 'BEFORE')) {
      toast.error('Before photo required', 'Upload a BEFORE photo in step 1 first.')
      return
    }
    if (!draftComparison) {
      toast.error(
        'Before & After comparison required',
        'Take an After photo and press Generate in step 1 first.',
      )
      return
    }
    if (aiProgress == null) {
      toast.error('AI Progress required', 'The latest comparison has no AI Progress. Press Generate again in step 1.')
      return
    }
    setSubmitPromptOpen(true)
  }

  async function submitUpdate(responsiblePerson) {
    confirmedBy.setName(responsiblePerson)
    setSubmitPromptOpen(false)
    setSubmitting(true)
    const previousStatus = project.status

    // Every update must carry its Progress Report, so the files go up to
    // storage before the update row exists — a failed upload stops the
    // submission instead of leaving an update without its report. Same
    // bucket, table and path scheme as the POW upload in
    // ProjectReviewDetail.jsx; pdocs_insert_engineering_progress_report
    // allows it while monitoring is open.
    const uploadedReports = []
    for (const file of reportFiles) {
      const path = `${project.id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(path, file, { contentType: file.type || undefined })
      if (uploadError) {
        toast.error('Could not upload the Progress Report', `${file.name}: ${uploadError.message}`)
        setSubmitting(false)
        return
      }
      uploadedReports.push({ file, path })
    }

    const { data: newUpdate, error: updateError } = await supabase
      .from('project_updates')
      .insert({
        project_id: project.id,
        reported_by: user.id,
        // Overwritten by trg_require_draft_comparison with the same value.
        progress_percentage: aiProgress,
        narrative_report: form.narrative_report.trim() || null,
        issues_encountered: form.issues_encountered.trim() || null,
        report_date: form.report_date,
      })
      .select('id, progress_percentage')
      .single()

    if (updateError) {
      toast.error('Could not save monitoring update', updateError.message)
      setSubmitting(false)
      return
    }

    // The update's photos are the draft After photos and comparison from the
    // Before & After section: inserting the update links and releases them to
    // MPDC (trg_release_draft_photos), so nothing is uploaded here.

    const failedReports = []
    for (const { file, path } of uploadedReports) {
      const { error: insertError } = await supabase.from('project_documents').insert({
        project_id: project.id,
        project_update_id: newUpdate.id,
        uploaded_by: user.id,
        document_category: 'PROGRESS_REPORT',
        title: `Progress Report — ${project.project_code}`,
        storage_path: path,
        file_name: file.name,
      })
      if (insertError) failedReports.push(`${file.name}: ${insertError.message}`)
    }

    await confirmedBy.record(
      project.id,
      `Submitted a monitoring update (${Number(newUpdate.progress_percentage)}% AI Progress)`,
      responsiblePerson,
    )
    setForm(EMPTY_FORM)
    setReportFiles([])
    setReportInputKey((current) => current + 1)
    setSubmitting(false)

    if (failedReports.length > 0) {
      toast.error('Update saved, but the Progress Report failed to upload', failedReports.join('; '))
    }

    const refreshed = await loadProject()
    if (refreshed && refreshed.status !== previousStatus) {
      toast.success(
        'Monitoring update recorded',
        `Project status advanced to ${PROJECT_STATUS_LABELS[refreshed.status] ?? refreshed.status}.`,
      )
    } else if (failedReports.length === 0) {
      // The form only opens for an open MPDC request, so every submission
      // answers one — the notify_update_request_answered trigger notifies MPDC.
      toast.success('Monitoring update recorded', 'MPDC has been notified.')
    }
  }

  if (loading) {
    return <LoadingState label="Loading project..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Project not found"
        description="It may have been removed, or it isn't ready for site monitoring yet."
        action={
          <Button variant="secondary" size="sm" to="/engineering/monitoring">
            Back to Site Monitoring
          </Button>
        }
      />
    )
  }

  if (!SITE_MONITORING_VISIBLE_STATUSES.includes(project.status)) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Not ready for site monitoring"
        description={`This project is ${(PROJECT_STATUS_LABELS[project.status] ?? project.status).toLowerCase()}. Monitoring opens once it's approved by MPDC.`}
        action={
          <Button variant="secondary" size="sm" to="/engineering/monitoring">
            Back to Site Monitoring
          </Button>
        }
      />
    )
  }

  const editable = MONITORING_EDITABLE_STATUSES.includes(project.status)
  const lastUpdateAt = updates.reduce(
    (latest, entry) => (!latest || entry.created_at > latest ? entry.created_at : latest),
    null,
  )
  const updateRequest = getUpdateRequestStatus(latestRequestAt, lastUpdateAt)
  const updateRequested = Boolean(updateRequest)
  const hasBeforePhoto = images.some((image) => image.image_stage === 'BEFORE')
  const requestOverdue = updateRequest && updateRequest.state !== 'PENDING'
  const dssDecision = evaluateProjectDss(project, updates)

  const beforeAfter = (
    <BeforeAfterSection
      project={project}
      images={images}
      latestProgress={updates[0]?.progress_percentage ?? null}
      userId={user.id}
      confirmedBy={confirmedBy}
      updateRequested={editable && updateRequested}
      onPhotosChanged={loadImages}
      onComparisonsChange={setComparisons}
      embedded={editable && updateRequested}
    />
  )

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code ? `Project Code: ${project.project_code}` : undefined}
        breadcrumbs={[
          { label: 'Dashboard', to: '/engineering' },
          { label: 'Site Monitoring', to: '/engineering/monitoring' },
          { label: project.project_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={PROJECT_STATUS_TONES[project.status]}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            {isWithinDonsol(project.latitude, project.longitude) ? (
              <Button variant="secondary" size="sm" icon={MapPin} onClick={() => setLocationOpen(true)}>
                See Location
              </Button>
            ) : (
              <span className="text-xs text-slate-400">Location unavailable</span>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        <DssPanel decision={dssDecision} />

        <ProgramOfWorksSection project={project} />

        {/* Without an open request, Before & After stands on its own: the
            Before baseline can be uploaded ahead of any request, a COMPLETED
            project's finished photos are taken and released here, and past
            comparisons stay viewable. */}
        {editable && updateRequested ? null : beforeAfter}

        {editable && updateRequested ? (
          <section
            className={`rounded-xl border p-5 shadow-sm shadow-slate-200/60 ${
              updateRequest.state === 'MISSED'
                ? 'border-red-200 bg-red-50'
                : updateRequest.state === 'DELAYED'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-slate-200/70 bg-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {requestOverdue ? (
                  <AlertTriangle
                    className={`mt-0.5 h-5 w-5 shrink-0 ${updateRequest.state === 'MISSED' ? 'text-red-600' : 'text-amber-600'}`}
                    aria-hidden="true"
                  />
                ) : null}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-800">New Monitoring Update</h2>
                    {requestOverdue ? (
                      <Badge tone={UPDATE_REQUEST_STATE_TONES[updateRequest.state]}>
                        {UPDATE_REQUEST_STATE_LABELS[updateRequest.state]}
                      </Badge>
                    ) : null}
                  </div>
                  <p className={`mt-0.5 text-xs ${requestOverdue ? 'text-slate-700' : 'text-slate-500'}`}>
                    MPDC requested a progress update on {formatDate(latestRequestAt)}
                    {updateRequest.daysPending > 0
                      ? ` — still unanswered after ${updateRequest.daysPending} ${updateRequest.daysPending === 1 ? 'day' : 'days'}.`
                      : '.'}
                    {requestOverdue ? ' Please submit a monitoring update as soon as possible.' : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* One site visit, one card: the photos and comparison first,
                then the update they are submitted with. */}
            <div className="mt-4 border-t border-slate-200/70 pt-4">
              <StepHeading
                number={1}
                title="Site photos — Before & After"
                description="Take an After photo of the site, then press Generate to compare it with the Before photo."
                done={Boolean(draftComparison)}
              />
              {beforeAfter}
            </div>

            <form onSubmit={handleSubmitUpdate} className="mt-5 border-t border-slate-200/70 pt-4">
              <StepHeading
                number={2}
                title="Update details"
                description="Progress, report and Program of Works, sent to MPDC together with the comparison above."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="progress" className="mb-1 block text-sm font-medium text-slate-700">
                    Progress (%) — AI Progress
                  </label>
                  <input
                    id="progress"
                    type="text"
                    readOnly
                    disabled
                    value={aiProgress != null ? `${aiProgress.toFixed(1)}%` : ''}
                    placeholder="Generate in step 1"
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    {aiProgress != null
                      ? 'From the AI Progress in step 1. Press Generate again to change it.'
                      : 'Filled in automatically once Generate in step 1 gives an AI Progress.'}
                  </p>
                </div>

                <div>
                  <label htmlFor="report_date" className="mb-1 block text-sm font-medium text-slate-700">
                    Report Date *
                  </label>
                  <input
                    id="report_date"
                    type="date"
                    max={localToday()}
                    value={form.report_date}
                    onChange={(event) => updateField('report_date', event.target.value)}
                    className={inputClass + invalidClass(errors.report_date)}
                  />
                  <FieldError message={errors.report_date} />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="narrative_report" className="mb-1 block text-sm font-medium text-slate-700">
                    Narrative Report
                  </label>
                  <textarea
                    id="narrative_report"
                    rows={3}
                    value={form.narrative_report}
                    onChange={(event) => updateField('narrative_report', event.target.value)}
                    className={textareaClass}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="issues_encountered" className="mb-1 block text-sm font-medium text-slate-700">
                    Issues Encountered
                  </label>
                  <textarea
                    id="issues_encountered"
                    rows={2}
                    value={form.issues_encountered}
                    onChange={(event) => updateField('issues_encountered', event.target.value)}
                    className={textareaClass}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <label htmlFor="progress_report_file" className="block text-sm font-medium text-slate-700">
                    Progress Report *
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Attach the Progress Report for this update — the work done per Program of Works item.
                  </p>
                  <input
                    key={reportInputKey}
                    id="progress_report_file"
                    type="file"
                    multiple
                    onChange={(event) => setReportFiles(Array.from(event.target.files ?? []))}
                    className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </div>

                {/* The site photos of this update: the draft After photo and
                    comparison from Before & After, sent along on submit. */}
                <div
                  className={`rounded-md border p-4 ${
                    draftComparison ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <ScanSearch className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    Before &amp; After comparison *
                  </p>
                  {draftComparison ? (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-emerald-800">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        Attached: {Number(draftComparison.accuracy).toFixed(1)}% match accuracy
                        {aiProgress != null ? `, ${aiProgress.toFixed(1)}% AI Progress` : ''}, generated{' '}
                        {formatDateTime(draftComparison.created_at)}. MPDC sees it once this update is submitted.
                      </span>
                    </p>
                  ) : (
                    <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {hasBeforePhoto
                        ? 'Take an After photo and press Generate in step 1 above.'
                        : 'Upload a Before photo in step 1 above first.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  type="submit"
                  icon={Send}
                  loading={submitting}
                  disabled={
                    aiProgress == null ||
                    !form.report_date ||
                    reportFiles.length === 0 ||
                    !hasBeforePhoto ||
                    !draftComparison
                  }
                >
                  Submit Monitoring Update
                </Button>
              </div>
            </form>
          </section>
        ) : editable ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <p className="text-sm text-slate-500">
              No pending update request from MPDC. The update form opens once MPDC requests a progress update.
            </p>
          </section>
        ) : (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <p className="text-sm text-slate-500">
              This project is completed and no longer accepts new monitoring updates.
            </p>
          </section>
        )}
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />

      {submitPromptOpen ? (
        <ConfirmNameDialog
          title="Responsible person"
          description="Who is responsible for this monitoring update? The name is recorded with the update sent to MPDC."
          confirmLabel="Submit to MPDC"
          confirmIcon={Send}
          initialName={confirmedBy.name}
          onConfirm={submitUpdate}
          onCancel={() => setSubmitPromptOpen(false)}
        />
      ) : null}
    </div>
  )
}

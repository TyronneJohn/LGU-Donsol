import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronDown, FileWarning, Save, Send } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import CurrencyInput from '../../components/ui/CurrencyInput'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDateTime } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { DONSOL_BARANGAYS } from '@shared/utils/barangays'
import { DONSOL_BARANGAY_CENTROIDS } from '@shared/utils/barangayCentroids'
import ProjectMap from '@shared/components/ProjectMap'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const textareaClass = inputClass

const SECTOR_LABELS = {
  SOCIAL_DEVELOPMENT: 'Social Development',
  ECONOMIC_DEVELOPMENT: 'Economic Development',
  ENVIRONMENTAL_MANAGEMENT: 'Environmental Management',
}

const EMPTY_FORM = {
  title: '',
  description: '',
  project_category: '',
  sector: '',
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
  project_category: 'Programs/Project/Activities',
  sector: 'Category',
  barangay: 'Barangay',
  location_text: 'Location',
  estimated_cost: 'Estimated Budget',
  start_date_planned: 'Proposed Start Date',
  end_date_planned: 'Target Completion Date',
  office_id: 'Implementing Office',
}

// Per-browser convenience only — recovers unsaved form input across an
// accidental refresh/tab-close before "Save" has actually reached the
// database. Never the source of truth: cleared the moment a real save
// succeeds, and a fresh browser/device simply won't have it.
const DRAFT_STORAGE_PREFIX = 'lgu-donsol:mpdc-project-draft:'

function readDraft(key) {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeDraft(key, value) {
  try {
    localStorage.setItem(DRAFT_STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // Private browsing, storage disabled, or quota exceeded — losing the
    // convenience draft is fine; it just behaves like before this existed.
  }
}

function clearDraft(key) {
  try {
    localStorage.removeItem(DRAFT_STORAGE_PREFIX + key)
  } catch {
    // ignore
  }
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

  const [history, setHistory] = useState([])

  const [showSubmitPanel, setShowSubmitPanel] = useState(false)
  const [submissionNotes, setSubmissionNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [endorsementNotes, setEndorsementNotes] = useState('')
  const [endorsing, setEndorsing] = useState(false)

  const barangayPopover = useDismissablePopover()
  const barangayTriggerRef = useRef(null)

  async function loadOffices() {
    const { data, error } = await supabase.from('offices').select('id, code, name').order('name', { ascending: true })
    if (error) {
      toast.error('Could not load offices', error.message)
      return []
    }
    setOffices(data ?? [])
    return data ?? []
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
      // Implementing office is always Engineering — MPDC plans/creates the
      // project, but Engineering is who actually builds/monitors it, and
      // no other office ever implements one in this system. Not an
      // editable field (see the read-only display in the form below); this
      // is the only place office_id is ever set.
      const engineeringOffice = officesData.find((o) => o.code === 'ENGG')
      const draft = readDraft('new')
      if (draft) {
        setForm(draft)
      } else {
        setForm((current) => ({ ...current, office_id: engineeringOffice?.id ?? officesData[0]?.id ?? '' }))
      }
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, sector, barangay, location_text,
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
    // Projects created before barangay-based auto-pin existed may have a
    // barangay but no coordinates yet (latitude/longitude used to have no
    // way of ever being set) — backfill from the centroid table so
    // reopening one for edit shows the same auto-pin a new project gets,
    // without requiring the barangay to be re-selected.
    const centroid = data.barangay ? DONSOL_BARANGAY_CENTROIDS[data.barangay] : null
    const loadedForm = {
      title: data.title ?? '',
      description: data.description ?? '',
      project_category: data.project_category ?? '',
      sector: data.sector ?? '',
      barangay: data.barangay ?? '',
      location_text: data.location_text ?? '',
      latitude: data.latitude ?? centroid?.lat ?? '',
      longitude: data.longitude ?? centroid?.lng ?? '',
      estimated_cost: data.estimated_cost ?? '',
      start_date_planned: data.start_date_planned ?? '',
      end_date_planned: data.end_date_planned ?? '',
      office_id: data.office_id ?? '',
    }
    const draft = readDraft(data.id)
    if (draft) {
      setForm(draft)
    } else {
      setForm(loadedForm)
    }

    await loadHistory(data.id)
    setLoading(false)
  }

  useEffect(() => {
    loadProject()
  }, [projectId])

  // Mirrors `form` into localStorage so an accidental refresh/close doesn't
  // lose unsaved typing — see readDraft/writeDraft above. Gated on `loading`
  // so the brief empty/loading state before loadProject() finishes restoring
  // never overwrites a real draft with blank values.
  useEffect(() => {
    if (loading) return
    writeDraft(isNew ? 'new' : projectId, form)
  }, [form, loading, isNew, projectId])

  // Clears the draft when the user actually navigates away from this page
  // in-app without saving (e.g. clicking "My Projects") — a real unmount,
  // which React only runs for client-side route changes, never for a
  // browser refresh/close (the JS runtime is torn down first, so this
  // cleanup simply doesn't get a chance to run then). That's what keeps
  // "survives a refresh" and "doesn't survive deliberately leaving the
  // page" both true at once. draftKeyRef always holds the latest key (form
  // state changes across renders, but this cleanup itself only ever runs
  // once, on the actual unmount, so it needs the up-to-date key rather than
  // whatever it closed over at mount).
  const draftKeyRef = useRef(isNew ? 'new' : projectId)
  useEffect(() => {
    draftKeyRef.current = isNew ? 'new' : projectId
  })
  // The clear itself is deferred one tick and cancellable, purely to survive
  // React StrictMode's dev-only mount→cleanup→remount replay of this same
  // effect (refs/state persist across that replay, it's only the effect
  // call that's doubled) — without this, every normal mount in dev would
  // wipe the draft it had just restored, a tick before the "real" cleanup
  // this is meant for ever gets a chance to matter.
  const pendingClearRef = useRef(null)
  useEffect(() => {
    if (pendingClearRef.current) {
      clearTimeout(pendingClearRef.current)
      pendingClearRef.current = null
    }
    return () => {
      const key = draftKeyRef.current
      pendingClearRef.current = setTimeout(() => clearDraft(key), 0)
    }
  }, [])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  // The only way latitude/longitude ever get set — always derived from the
  // chosen barangay's centroid (see barangayCentroids.js), never typed or
  // dragged by hand. Barangay-level precision only: every project in the
  // same barangay resolves to the same point, since no purok-level
  // coordinate data exists to place it any more precisely than that.
  function selectBarangay(barangay) {
    const centroid = DONSOL_BARANGAY_CENTROIDS[barangay]
    setForm((current) => ({
      ...current,
      barangay,
      latitude: centroid?.lat ?? '',
      longitude: centroid?.lng ?? '',
    }))
  }

  function getMissingFields() {
    const missing = []
    if (!form.title.trim()) missing.push(REQUIRED_FIELD_LABELS.title)
    if (!form.description.trim()) missing.push(REQUIRED_FIELD_LABELS.description)
    if (!form.project_category.trim()) missing.push(REQUIRED_FIELD_LABELS.project_category)
    if (!form.sector) missing.push(REQUIRED_FIELD_LABELS.sector)
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
      sector: form.sector || null,
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
      if (error || !data?.id) {
        toast.error('Could not create project', error?.message ?? 'Unexpected error creating the project.')
        return
      }
      clearDraft('new')
      toast.success('Draft created', 'You can now submit it for review when ready.')
      navigate('/mpdc/projects')
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
    clearDraft(project.id)
    toast.success('Changes saved')
    navigate('/mpdc/projects')
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

  // Guards the render gap right after Save Draft on a new project: navigate()
  // updates the :projectId param (so isNew flips to false) a render before
  // the projectId effect has re-run loadProject() to reset loading/project
  // for it, leaving `project` still null for that one commit. Without this,
  // `project.status` below throws and — with no error boundary in the app —
  // takes down the whole page until a manual refresh.
  if (!isNew && !project) {
    return <LoadingState label="Loading project..." />
  }

  const editable = isNew || ['DRAFT', 'RETURNED_FOR_REVISION'].includes(project.status)

  // Engineering's technical review is represented by the approved_budget it
  // enters on this same project row (ProjectReviewDetail.jsx — "Only these
  // two fields are Engineering-editable, and only while the project is
  // under review"). A set, positive approved_budget is the existing signal
  // that Engineering actually reviewed the project, not just that MPDC
  // submitted it — mirrored by the DB-side check in endorsements_insert_mpdc
  // (20260820100000_endorsement_requires_engineering_review.sql), which is
  // the real enforcement; this only keeps the button from being offered
  // before that check would pass.
  const reviewReady = !isNew && project.approved_budget != null && Number(project.approved_budget) > 0

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
                Programs/Project/Activities *
              </label>
              <input
                id="project_category"
                placeholder="e.g. Solar Streetlights, Site Development (Access Road)"
                value={form.project_category}
                onChange={(event) => updateField('project_category', event.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="sector" className="mb-1 block text-sm font-medium text-slate-700">
                Category *
              </label>
              <select
                id="sector"
                value={form.sector}
                onChange={(event) => updateField('sector', event.target.value)}
                className={inputClass}
              >
                <option value="">Select a category</option>
                {Object.entries(SECTOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1 block text-sm font-medium text-slate-700">Region</p>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                Bicol Region (Region V)
              </p>
            </div>

            <div>
              <p className="mb-1 block text-sm font-medium text-slate-700">Municipality</p>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                Donsol, Sorsogon
              </p>
            </div>

            <div>
              <label htmlFor="barangay" className="mb-1 block text-sm font-medium text-slate-700">
                Barangay *
              </label>
              <div className="relative" ref={barangayPopover.containerRef}>
                <button
                  id="barangay"
                  ref={barangayTriggerRef}
                  type="button"
                  onClick={() => barangayPopover.setOpen((current) => !current)}
                  className={`${inputClass} flex items-center justify-between text-left`}
                >
                  <span className={form.barangay ? 'text-black' : 'text-slate-400'}>
                    {form.barangay || 'Select a barangay'}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                </button>

                {barangayPopover.open ? (
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
                    {DONSOL_BARANGAYS.map((barangay) => (
                      <button
                        key={barangay}
                        type="button"
                        onClick={() => {
                          selectBarangay(barangay)
                          barangayPopover.close()
                          barangayTriggerRef.current?.blur()
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50 ${
                          form.barangay === barangay ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700'
                        }`}
                      >
                        {barangay}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="location_text" className="mb-1 block text-sm font-medium text-slate-700">
                Location *
              </label>
              <input
                id="location_text"
                placeholder="Purok / sitio / landmark"
                value={form.location_text}
                onChange={(event) => updateField('location_text', event.target.value)}
                className={inputClass}
              />
            </div>

            {form.latitude !== '' && form.longitude !== '' ? (
              <div className="sm:col-span-2">
                <p className="mb-1 block text-sm font-medium text-slate-700">Location Preview</p>
                <p className="mb-2 text-xs text-slate-400">
                  Pinned automatically at Barangay {form.barangay}'s location — not editable directly. Use the
                  Location field above for the specific purok/sitio/landmark.
                </p>
                <ProjectMap
                  projects={[
                    {
                      id: 'preview',
                      title: form.title || 'This project',
                      status: 'DRAFT',
                      latitude: form.latitude,
                      longitude: form.longitude,
                    },
                  ]}
                  height="220px"
                />
              </div>
            ) : null}

            <div>
              <label htmlFor="estimated_cost" className="mb-1 block text-sm font-medium text-slate-700">
                Estimated Budget (PHP) *
              </label>
              <CurrencyInput
                id="estimated_cost"
                value={form.estimated_cost}
                onChange={(value) => updateField('estimated_cost', value)}
                className={inputClass}
              />
            </div>

            <div>
              <p className="mb-1 block text-sm font-medium text-slate-700">Implementing Office</p>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                {offices.find((office) => office.id === form.office_id)?.name ?? 'Engineering Office'}
              </p>
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
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" to="/mpdc/projects">
                Cancel
              </Button>
              <Button type="submit" icon={Save} loading={saving}>
                {isNew ? 'Save' : 'Save Changes'}
              </Button>
              {!isNew && !showSubmitPanel ? (
                <Button type="button" icon={Send} onClick={() => setShowSubmitPanel(true)}>
                  Submit for Review
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              This project is {(PROJECT_STATUS_LABELS[project.status] ?? project.status).toLowerCase()} and
              can no longer be edited.
            </p>
          )}
        </form>

        <SubmitForReviewModal
          open={!isNew && editable && showSubmitPanel}
          notes={submissionNotes}
          onNotesChange={setSubmissionNotes}
          onCancel={() => setShowSubmitPanel(false)}
          onConfirm={handleSubmitForReview}
          submitting={submitting}
        />

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

        {!isNew && project.status === 'SUBMITTED_FOR_REVIEW' ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Endorse to BAC</h2>

            {reviewReady ? (
              <>
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
                  <Button icon={Send} onClick={handleEndorse} loading={endorsing}>
                    Endorse to BAC
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-500">
                Waiting on Engineering's technical review (an approved budget has not been entered yet). This
                project can be endorsed to BAC once that review is complete.
              </p>
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function SubmitForReviewModal({ open, notes, onNotesChange, onCancel, onConfirm, submitting }) {
  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    // z-1100: same reasoning as ConfirmDialog.jsx — stays above Leaflet's
    // internal max (z-index:1000) so this never renders behind this page's
    // own inline Location Preview map.
    <div className="fixed inset-0 z-1100 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onCancel}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-review-title"
        className="animate-pop-in relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <h2 id="submit-review-title" className="text-base font-semibold text-slate-800">
          Submit for Review
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Once submitted, this project is locked for editing until a decision is recorded.
        </p>

        <div className="mt-4">
          <label htmlFor="submission_notes" className="mb-1 block text-sm font-medium text-slate-700">
            Notes for the reviewer (optional)
          </label>
          <textarea
            id="submission_notes"
            rows={3}
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            className={textareaClass}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" icon={Send} onClick={onConfirm} loading={submitting}>
            Confirm Submit
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

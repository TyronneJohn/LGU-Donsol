import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { Camera, CameraOff, Clock, FileWarning, MapPin, Send, X } from 'lucide-react'
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
import SitePhotoGrid from '../../components/ui/SitePhotoGrid'
import { formatDate } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  SITE_MONITORING_VISIBLE_STATUSES,
  MONITORING_EDITABLE_STATUSES,
} from '@shared/utils/projectStatus'
import { evaluateProjectDss } from '@shared/utils/decisionSupport'
import { IMAGE_STAGE_LABELS, processImageFile } from '../../utils/imageProcessing'
import { analyzeProjectImage } from '../../utils/imageAnalysis'
import { isWithinDonsol } from '@shared/utils/geo'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const textareaClass = inputClass

const EMPTY_FORM = {
  progress_percentage: '',
  narrative_report: '',
  issues_encountered: '',
  report_date: new Date().toISOString().slice(0, 10),
}

// Live in-page camera, for taking a fresh site photo on the spot rather than
// only ever picking an existing file from the gallery (which says nothing
// about when/where the photo was actually taken). Stays open across
// multiple captures — a site visit usually produces more than one photo —
// closed explicitly via Done or Escape. The plain <input type="file"
// capture="environment"> next to it is kept too, since this getUserMedia
// path needs a secure context (HTTPS/localhost) and camera permission, and
// simply won't be available on every device/browser.
function CameraCapture({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState(null)
  const [shotCount, setShotCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not access the camera.')
      }
    }
    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `site-photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        onCapture(file)
        setShotCount((count) => count + 1)
      },
      'image/jpeg',
      0.9,
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-medium text-white">Take Site Photo{shotCount > 0 ? ` (${shotCount} taken)` : ''}</p>
          <button
            type="button"
            aria-label="Close camera"
            onClick={onClose}
            className="rounded-md p-1 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <CameraOff className="h-8 w-8 text-slate-500" aria-hidden="true" />
            <p className="text-sm text-slate-300">{error}</p>
            <p className="text-xs text-slate-500">
              Use the regular file picker below instead, or check your browser's camera permission.
            </p>
          </div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full bg-black object-cover" />
        )}

        <div className="flex items-center justify-center gap-3 px-4 py-4">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
          <Button type="button" icon={Camera} onClick={capture} disabled={!!error}>
            Capture
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Monitoring History used to render inline on the page, pushing everything
// below the update form down further with every new entry. Moved into an
// on-demand modal (same createPortal/backdrop pattern as LocationModal) so
// the page stays short right after submitting an update, with history just
// a click away instead of always taking up space.
function MonitoringHistoryModal({ open, onClose, updates, imagesByUpdate }) {
  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const unassignedImages = imagesByUpdate.get('unassigned') ?? []

  return createPortal(
    <div className="fixed inset-0 z-1000 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
        className="animate-pop-in relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 id="history-modal-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <Clock className="h-4 w-4 text-blue-600" aria-hidden="true" />
            Monitoring History
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          {updates.length === 0 ? (
            <p className="text-sm text-slate-500">No monitoring updates yet.</p>
          ) : (
            <ul className="space-y-4">
              {updates.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {entry.progress_percentage != null ? `${entry.progress_percentage}% complete` : 'Update'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(entry.report_date)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reporter?.full_name ?? '—'}</p>
                  {entry.narrative_report ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.narrative_report}</p>
                  ) : null}
                  {entry.issues_encountered ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-red-700">
                      Issues: {entry.issues_encountered}
                    </p>
                  ) : null}

                  {(imagesByUpdate.get(entry.id) ?? []).length > 0 ? (
                    <div className="mt-3">
                      <SitePhotoGrid images={imagesByUpdate.get(entry.id)} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {unassignedImages.length > 0 ? (
            <div className="mt-6 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-800">Other Site Photos</h3>
              <div className="mt-3">
                <SitePhotoGrid images={unassignedImages} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
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
  const [locationOpen, setLocationOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const [form, setForm] = useState(EMPTY_FORM)
  const [photoQueue, setPhotoQueue] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  async function loadUpdates() {
    const { data, error } = await supabase
      .from('project_updates')
      .select(
        `id, progress_percentage, narrative_report, issues_encountered, report_date,
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
        `id, project_update_id, storage_path, file_name, image_stage, ai_analysis_status, ai_analysis_result, created_at,
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
         start_date_planned, end_date_planned, start_date_actual, end_date_actual, office_id`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (error || !data || data.office_id !== profile.office_id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(data)
    await Promise.all([loadUpdates(), loadImages()])
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
  }

  function addPhotos(fileList) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setPhotoQueue((current) => [
      ...current,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, stage: 'DURING' })),
    ])
  }

  function updatePhotoStage(id, stage) {
    setPhotoQueue((current) => current.map((photo) => (photo.id === id ? { ...photo, stage } : photo)))
  }

  function removePhoto(id) {
    setPhotoQueue((current) => current.filter((photo) => photo.id !== id))
  }

  async function handleSubmitUpdate(event) {
    event.preventDefault()

    if (form.progress_percentage === '' || Number(form.progress_percentage) < 0 || Number(form.progress_percentage) > 100) {
      toast.error('Progress required', 'Enter a progress percentage between 0 and 100.')
      return
    }
    if (!form.report_date) {
      toast.error('Report date required', 'Choose the date this update covers.')
      return
    }

    setSubmitting(true)
    const previousStatus = project.status

    const { data: newUpdate, error: updateError } = await supabase
      .from('project_updates')
      .insert({
        project_id: project.id,
        reported_by: user.id,
        progress_percentage: Number(form.progress_percentage),
        narrative_report: form.narrative_report.trim() || null,
        issues_encountered: form.issues_encountered.trim() || null,
        report_date: form.report_date,
      })
      .select('id')
      .single()

    if (updateError) {
      toast.error('Could not save monitoring update', updateError.message)
      setSubmitting(false)
      return
    }

    const failedPhotos = []
    for (const photo of photoQueue) {
      try {
        // Fast client-side gate only (format/size/corruption, entirely in
        // the browser — see src/utils/imageProcessing.js). A rejection here
        // means the file never gets uploaded or sent to Gemini at all. This
        // is not the authoritative check: analyze-project-image
        // independently re-validates the actual downloaded bytes
        // server-side, since a browser-reported MIME type can't be trusted.
        const { status: gateStatus, result: gateResult } = await processImageFile(photo.file)
        if (gateStatus === 'FAILED') {
          throw new Error(gateResult?.error ?? 'Image could not be validated.')
        }

        const path = `${project.id}/${newUpdate.id}/${crypto.randomUUID()}-${photo.file.name}`

        const { error: uploadError } = await supabase.storage.from('project-images').upload(path, photo.file)
        if (uploadError) throw uploadError

        const { data: insertedImage, error: insertError } = await supabase
          .from('project_images')
          .insert({
            project_id: project.id,
            project_update_id: newUpdate.id,
            uploaded_by: user.id,
            storage_path: path,
            file_name: photo.file.name,
            image_stage: photo.stage,
            captured_at: new Date().toISOString(),
            ai_analysis_status: 'PENDING',
            ai_analysis_result: null,
          })
          .select('id')
          .single()
        if (insertError) throw insertError

        // Fire-and-forget: the AI read is advisory-only (see
        // analyze-project-image) and must never block or fail the
        // monitoring update itself — the photo is already saved either way.
        analyzeProjectImage(insertedImage.id).catch(() => {})
      } catch (photoError) {
        failedPhotos.push(`${photo.file.name}: ${photoError.message}`)
      }
    }

    setForm(EMPTY_FORM)
    setPhotoQueue([])
    setSubmitting(false)

    if (failedPhotos.length > 0) {
      toast.error('Update saved, but some photos failed to upload', failedPhotos.join('; '))
    }

    const refreshed = await loadProject()
    if (refreshed && refreshed.status !== previousStatus) {
      toast.success(
        'Monitoring update recorded',
        `Project status advanced to ${PROJECT_STATUS_LABELS[refreshed.status] ?? refreshed.status}.`,
      )
    } else if (failedPhotos.length === 0) {
      toast.success('Monitoring update recorded')
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

        {editable ? (
          <form onSubmit={handleSubmitUpdate} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">New Monitoring Update</h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="progress" className="mb-1 block text-sm font-medium text-slate-700">
                  Progress (%) *
                </label>
                <input
                  id="progress"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.progress_percentage}
                  onChange={(event) => updateField('progress_percentage', event.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="report_date" className="mb-1 block text-sm font-medium text-slate-700">
                  Report Date *
                </label>
                <input
                  id="report_date"
                  type="date"
                  value={form.report_date}
                  onChange={(event) => updateField('report_date', event.target.value)}
                  className={inputClass}
                />
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

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="photos" className="mb-1 block text-sm font-medium text-slate-700">
                  Site Photos
                </label>
                <Button type="button" variant="secondary" size="sm" icon={Camera} onClick={() => setCameraOpen(true)}>
                  Take Photo
                </Button>
              </div>
              <input
                id="photos"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => addPhotos(event.target.files)}
                className="block w-full text-sm text-slate-600"
              />

              {photoQueue.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {photoQueue.map((photo) => (
                    <li
                      key={photo.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                    >
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        <Camera className="h-4 w-4 text-slate-400" aria-hidden="true" />
                        {photo.file.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          value={photo.stage}
                          onChange={(event) => updatePhotoStage(photo.id, event.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                        >
                          {Object.entries(IMAGE_STAGE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removePhoto(photo.id)}
                          className="text-slate-400 hover:text-red-600"
                          aria-label={`Remove ${photo.file.name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-5">
              <Button
                type="submit"
                icon={Send}
                loading={submitting}
                disabled={
                  form.progress_percentage === '' ||
                  Number(form.progress_percentage) < 0 ||
                  Number(form.progress_percentage) > 100 ||
                  !form.report_date
                }
              >
                Submit Update
              </Button>
            </div>
          </form>
        ) : (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <p className="text-sm text-slate-500">
              This project is completed and no longer accepts new monitoring updates.
            </p>
          </section>
        )}

        <section className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Monitoring History</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {updates.length === 0
                ? 'No monitoring updates yet.'
                : `${updates.length} update${updates.length === 1 ? '' : 's'} recorded.`}
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" icon={Clock} onClick={() => setHistoryOpen(true)}>
            View History
          </Button>
        </section>
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />

      <MonitoringHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        updates={updates}
        imagesByUpdate={imagesByUpdate}
      />

      {cameraOpen ? (
        <CameraCapture
          onCapture={(file) => addPhotos([file])}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { AlertTriangle, Camera, CameraOff, Clock, FileWarning, ImagePlus, Images, MapPin, Plus, Send, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useAuth } from '../../hooks/useAuth'
import { useFormDraft, readDraft } from '../../hooks/useFormDraft'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import DssPanel from '../../components/ui/DssPanel'
import LocationModal from '../../components/LocationModal'
import ProgramOfWorksSection, { UpdatePowButton } from '../../components/ProgramOfWorksSection'
import SitePhotoGrid from '../../components/ui/SitePhotoGrid'
import { formatDate } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  SITE_MONITORING_VISIBLE_STATUSES,
  MONITORING_EDITABLE_STATUSES,
} from '@shared/utils/projectStatus'
import { evaluateProjectDss } from '@shared/utils/decisionSupport'
import { processImageFile } from '../../utils/imageProcessing'
import { analyzeProjectUpdate } from '../../utils/imageAnalysis'
import { UpdateAnalysisFlag, UpdateComparisonModal } from '../../components/UpdateComparison'
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

const EMPTY_FORM = {
  progress_percentage: '',
  narrative_report: '',
  issues_encountered: '',
  report_date: localToday(),
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
  // Device location while the camera is open, attached to each capture.
  // A canvas-made JPEG carries no EXIF, so this is the only GPS these photos get.
  const positionRef = useRef(null)
  const [locationState, setLocationState] = useState('locating') // locating | ready | unavailable
  const [accuracy, setAccuracy] = useState(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationState('unavailable')
      return undefined
    }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        positionRef.current = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
        setAccuracy(position.coords.accuracy)
        setLocationState('ready')
      },
      () => {
        if (!positionRef.current) setLocationState('unavailable')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

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
        onCapture(file, positionRef.current)
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

        <p className="flex items-center justify-center gap-1.5 px-4 pt-3 text-xs text-slate-400">
          <MapPin
            className={`h-3.5 w-3.5 ${locationState === 'ready' ? 'text-emerald-400' : locationState === 'unavailable' ? 'text-amber-400' : ''}`}
            aria-hidden="true"
          />
          {locationState === 'ready'
            ? `Location tracked (±${Math.round(accuracy)} m)`
            : locationState === 'unavailable'
              ? 'Location unavailable — turn on location and allow access to tag photos'
              : 'Getting location...'}
        </p>

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
function MonitoringHistoryModal({ open, onClose, updates, imagesByUpdate, onCompare }) {
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
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {entry.progress_percentage != null ? `${entry.progress_percentage}% complete` : 'Update'}
                      {entry.id === updates[0]?.id ? <Badge tone="blue">New</Badge> : null}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(entry.report_date)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reporter?.full_name ?? '—'}</p>
                  <UpdateAnalysisFlag update={entry} />
                  <UpdatePowButton documents={entry.pow_documents} />
                  {(imagesByUpdate.get(entry.id) ?? []).length > 0 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      icon={Images}
                      className="mt-2"
                      onClick={() => onCompare(entry.id)}
                    >
                      Compare with previous photos
                    </Button>
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
  const [latestRequestAt, setLatestRequestAt] = useState(null)
  const [locationOpen, setLocationOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [compareUpdateId, setCompareUpdateId] = useState(null)

  const draftKey = `monitoring-update:${projectId}`
  const [form, setForm] = useState(() => readDraft(draftKey) ?? EMPTY_FORM)
  const [photoQueue, setPhotoQueue] = useState([])
  // Optional revised Program of Works attached to the update. Like photos,
  // file handles stay out of the draft.
  const [powFiles, setPowFiles] = useState([])
  const [powInputKey, setPowInputKey] = useState(0)
  // Bumped after a POW upload so ProgramOfWorksSection reloads its list.
  const [powVersion, setPowVersion] = useState(0)
  // The update form opens as a modal from the "Submit Monitoring Update" button.
  const [formOpen, setFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  // A site report typed out on a phone in the field is exactly the input
  // worth not losing to a backgrounded tab. Text fields only: photoQueue
  // holds File handles from the camera/picker, which can't be serialised or
  // re-attached, so the queued photos still have to be re-added after a
  // reload. Submitting resets `form` to EMPTY_FORM, which matches the clean
  // value here and so clears the stored draft on its own.
  useFormDraft(draftKey, form, EMPTY_FORM)

  async function loadUpdates() {
    const { data, error } = await supabase
      .from('project_updates')
      .select(
        `id, progress_percentage, narrative_report, issues_encountered, report_date, created_at,
         ai_analysis_status, ai_analysis_result,
         pow_documents:project_documents(id, document_category, file_name, storage_path),
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

  // Escape closes the update modal, but not mid-submit or while the camera
  // overlay (which sits above it) is open.
  useEffect(() => {
    if (!formOpen || submitting || cameraOpen) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') setFormOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [formOpen, submitting, cameraOpen])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  // `gps` is the device location from the in-app camera; picked photos fall
  // back to their own EXIF GPS at submit time.
  function addPhotos(fileList, gps = null) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0) return
    setPhotoQueue((current) => [
      ...current,
      ...files.map((file) => ({ id: crypto.randomUUID(), file, gps })),
    ])
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
    if (form.report_date > localToday()) {
      toast.error('Invalid report date', 'The report date cannot be in the future.')
      return
    }
    if (powFiles.length === 0) {
      toast.error('Program of Works required', 'Attach the Program of Works this update is measured against.')
      return
    }

    setSubmitting(true)
    const previousStatus = project.status

    // Every update must carry its Program of Works, so the files go up to
    // storage before the update row exists — a failed upload stops the
    // submission instead of leaving an update without its POW. Same bucket,
    // table and path scheme as the POW upload in ProjectReviewDetail.jsx;
    // pdocs_insert_engineering_monitoring_pow allows it while monitoring is
    // open.
    const uploadedPow = []
    for (const file of powFiles) {
      const path = `${project.id}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('project-documents')
        .upload(path, file, { contentType: file.type || undefined })
      if (uploadError) {
        toast.error('Could not upload the Program of Works', `${file.name}: ${uploadError.message}`)
        setSubmitting(false)
        return
      }
      uploadedPow.push({ file, path })
    }

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

    // Stage is derived instead of picked per photo: the first update's photos
    // are BEFORE, a 100% update's are AFTER, everything in between DURING.
    // The public page groups photos by these stages.
    const photoStage =
      updates.length === 0 ? 'BEFORE' : Number(form.progress_percentage) === 100 ? 'AFTER' : 'DURING'

    const failedPhotos = []
    let uploadedCount = 0
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
        const gps = photo.gps ?? gateResult?.gps ?? null

        const { error: uploadError } = await supabase.storage.from('project-images').upload(path, photo.file)
        if (uploadError) throw uploadError

        const { error: insertError } = await supabase
          .from('project_images')
          .insert({
            project_id: project.id,
            project_update_id: newUpdate.id,
            uploaded_by: user.id,
            storage_path: path,
            file_name: photo.file.name,
            image_stage: photoStage,
            captured_at: new Date().toISOString(),
            latitude: gps ? Number(gps.latitude.toFixed(6)) : null,
            longitude: gps ? Number(gps.longitude.toFixed(6)) : null,
            // Photos are analyzed together per update (analyze-project-update),
            // not one by one.
            ai_analysis_status: 'NOT_APPLICABLE',
            ai_analysis_result: null,
          })
        if (insertError) throw insertError
        uploadedCount += 1
      } catch (photoError) {
        failedPhotos.push(`${photo.file.name}: ${photoError.message}`)
      }
    }

    const failedPow = []
    for (const { file, path } of uploadedPow) {
      const { error: insertError } = await supabase.from('project_documents').insert({
        project_id: project.id,
        project_update_id: newUpdate.id,
        uploaded_by: user.id,
        document_category: 'PROGRAM_OF_WORKS',
        title: `Program of Works — ${project.project_code}`,
        storage_path: path,
        file_name: file.name,
      })
      if (insertError) failedPow.push(`${file.name}: ${insertError.message}`)
    }
    if (uploadedPow.length > failedPow.length) setPowVersion((current) => current + 1)

    setForm(EMPTY_FORM)
    setFormOpen(false)
    setPhotoQueue([])
    setPowFiles([])
    setPowInputKey((current) => current + 1)
    setSubmitting(false)

    if (failedPhotos.length > 0) {
      toast.error('Update saved, but some photos failed to upload', failedPhotos.join('; '))
    }
    if (failedPow.length > 0) {
      toast.error('Update saved, but the Program of Works failed to upload', failedPow.join('; '))
    }

    // Fire-and-forget: compares the new photos with every earlier update's.
    // Advisory only — it must never block or fail the monitoring update,
    // which is already saved. The history list picks up the result.
    if (uploadedCount > 0) {
      analyzeProjectUpdate(newUpdate.id).then(() => loadUpdates())
    }

    const refreshed = await loadProject()
    if (refreshed && refreshed.status !== previousStatus) {
      toast.success(
        'Monitoring update recorded',
        `Project status advanced to ${PROJECT_STATUS_LABELS[refreshed.status] ?? refreshed.status}.`,
      )
    } else if (failedPhotos.length === 0 && failedPow.length === 0) {
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
  const requestOverdue = updateRequest && updateRequest.state !== 'PENDING'
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

        <ProgramOfWorksSection key={powVersion} project={project} />

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
              <Button type="button" size="sm" icon={Plus} onClick={() => setFormOpen(true)}>
                Submit Monitoring Update
              </Button>
            </div>
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

        <section className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Monitoring History</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {updates.length === 0
                ? 'No monitoring updates yet.'
                : `${updates.length} update${updates.length === 1 ? '' : 's'} recorded.`}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {updates[0] && (imagesByUpdate.get(updates[0].id) ?? []).length > 0 ? (
              <Button type="button" variant="secondary" size="sm" icon={Images} onClick={() => setCompareUpdateId(updates[0].id)}>
                Compare latest photos
              </Button>
            ) : null}
            <Button type="button" variant="secondary" size="sm" icon={Clock} onClick={() => setHistoryOpen(true)}>
              View History
            </Button>
          </div>
        </section>
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />

      <MonitoringHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        updates={updates}
        imagesByUpdate={imagesByUpdate}
        onCompare={setCompareUpdateId}
      />

      {compareUpdateId && updates.some((entry) => entry.id === compareUpdateId) ? (
        <UpdateComparisonModal
          key={compareUpdateId}
          update={updates.find((entry) => entry.id === compareUpdateId)}
          updates={updates}
          images={images}
          isNew={compareUpdateId === updates[0]?.id}
          onClose={() => setCompareUpdateId(null)}
          onAnalyzed={loadUpdates}
        />
      ) : null}

      {formOpen && editable && updateRequested
        ? createPortal(
            <div className="fixed inset-0 z-1000 flex items-center justify-center px-4">
              <button
                type="button"
                aria-label="Dismiss dialog"
                onClick={() => !submitting && setFormOpen(false)}
                className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
              />
              <form
                role="dialog"
                aria-modal="true"
                aria-labelledby="update-modal-title"
                onSubmit={handleSubmitUpdate}
                className="animate-pop-in relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
              >
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                  <h2 id="update-modal-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
                    <Send className="h-4 w-4 text-blue-600" aria-hidden="true" />
                    New Monitoring Update
                  </h2>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setFormOpen(false)}
                    disabled={submitting}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>

                <div className="overflow-y-auto px-5 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
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
                        max={localToday()}
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
                    <div>
                      <span className="block text-sm font-medium text-slate-700">Site Photos</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {/* No `capture` attribute, so phones open the photo gallery;
                            Take Photo covers the camera. */}
                        <label
                          htmlFor="photos"
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <ImagePlus className="h-4 w-4" aria-hidden="true" />
                          Choose Photos
                        </label>
                        <input
                          id="photos"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            addPhotos(event.target.files)
                            // Lets the same photo be picked again after removing it.
                            event.target.value = ''
                          }}
                          className="sr-only"
                        />
                        <Button type="button" variant="secondary" size="sm" icon={Camera} onClick={() => setCameraOpen(true)}>
                          Take Photo
                        </Button>
                      </div>
                    </div>

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
                              {photo.gps ? (
                                <MapPin className="h-3.5 w-3.5 text-emerald-600" aria-label="Location tagged" />
                              ) : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => removePhoto(photo.id)}
                              className="text-slate-400 hover:text-red-600"
                              aria-label={`Remove ${photo.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
                    <label htmlFor="pow_file" className="block text-sm font-medium text-slate-700">
                      Program of Works *
                    </label>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Attach the Program of Works this update's progress is based on. Earlier versions stay on file.
                    </p>
                    <input
                      key={powInputKey}
                      id="pow_file"
                      type="file"
                      multiple
                      onChange={(event) => setPowFiles(Array.from(event.target.files ?? []))}
                      className="mt-2 block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-4">
                  <Button type="button" variant="secondary" onClick={() => setFormOpen(false)} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    icon={Send}
                    loading={submitting}
                    disabled={
                      form.progress_percentage === '' ||
                      Number(form.progress_percentage) < 0 ||
                      Number(form.progress_percentage) > 100 ||
                      !form.report_date ||
                      powFiles.length === 0
                    }
                  >
                    Submit Update
                  </Button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}

      {cameraOpen ? (
        <CameraCapture
          onCapture={(file, gps) => addPhotos([file], gps)}
          onClose={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  )
}

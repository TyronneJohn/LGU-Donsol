import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, FileWarning, Loader2, MapPin, Send, TriangleAlert, X } from 'lucide-react'
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
  weather_condition: '',
  report_date: new Date().toISOString().slice(0, 10),
  latitude: '',
  longitude: '',
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

  const [form, setForm] = useState(EMPTY_FORM)
  const [photoQueue, setPhotoQueue] = useState([])
  // Per-photo upload progress, keyed by photoQueue item id: 'uploading' |
  // 'success' | 'error'. Populated only while handleSubmitUpdate is running
  // and cleared once it finishes, so the queue shows plain "ready to submit"
  // rows the rest of the time.
  const [uploadStatus, setUploadStatus] = useState({})
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function loadUpdates() {
    const { data, error } = await supabase
      .from('project_updates')
      .select(
        `id, progress_percentage, narrative_report, issues_encountered, weather_condition, report_date,
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
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        stage: 'DURING',
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }

  function updatePhotoStage(id, stage) {
    setPhotoQueue((current) => current.map((photo) => (photo.id === id ? { ...photo, stage } : photo)))
  }

  function removePhoto(id) {
    setPhotoQueue((current) => {
      const removed = current.find((photo) => photo.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter((photo) => photo.id !== id)
    })
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Location unavailable', 'Your browser does not support geolocation.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateField('latitude', position.coords.latitude.toFixed(6))
        updateField('longitude', position.coords.longitude.toFixed(6))
        setLocating(false)
      },
      (error) => {
        toast.error('Could not get location', error.message)
        setLocating(false)
      },
    )
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
        weather_condition: form.weather_condition.trim() || null,
        report_date: form.report_date,
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
      })
      .select('id')
      .single()

    if (updateError) {
      toast.error('Could not save monitoring update', updateError.message)
      setSubmitting(false)
      return
    }

    // A photo upload/insert failure must never lose the monitoring update
    // itself — it's already saved above. Each photo is tracked independently
    // (own try/catch, own uploadStatus entry) and run concurrently rather
    // than one-at-a-time — with several photos queued, sequential upload +
    // insert + analyze per photo made total wait time scale with photo
    // count; running them in parallel doesn't change what happens to any
    // single photo, just lets them happen at the same time.
    const photoResults = await Promise.all(
      photoQueue.map(async (photo) => {
        setUploadStatus((current) => ({ ...current, [photo.id]: 'uploading' }))
        try {
          // Fast client-side gate only (format/size/corruption, entirely in
          // the browser — see src/utils/imageProcessing.js). A rejection
          // here means the file never gets uploaded or sent to Gemini at
          // all. This is not the authoritative check: analyze-project-image
          // independently re-validates the actual downloaded bytes
          // server-side, since a browser-reported MIME type can't be
          // trusted.
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
              latitude: form.latitude === '' ? null : Number(form.latitude),
              longitude: form.longitude === '' ? null : Number(form.longitude),
              ai_analysis_status: 'PENDING',
              ai_analysis_result: null,
            })
            .select('id')
            .single()
          if (insertError) throw insertError

          // The photo itself is safely saved from here on — everything
          // below is best-effort AI analysis. Its outcome (including any
          // failure) is only ever recorded on the image row itself
          // (ai_analysis_status/ai_analysis_result via the Edge Function);
          // it can never turn this photo, or the monitoring update, into a
          // failure.
          setUploadStatus((current) => ({ ...current, [photo.id]: 'analyzing' }))
          await analyzeProjectImage(insertedImage.id)

          setUploadStatus((current) => ({ ...current, [photo.id]: 'success' }))
          return null
        } catch (photoError) {
          setUploadStatus((current) => ({ ...current, [photo.id]: 'error' }))
          return `${photo.file.name}: ${photoError.message}`
        }
      }),
    )
    const failedPhotos = photoResults.filter(Boolean)

    for (const photo of photoQueue) URL.revokeObjectURL(photo.previewUrl)
    setForm(EMPTY_FORM)
    setPhotoQueue([])
    setUploadStatus({})
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

              <div>
                <label htmlFor="weather_condition" className="mb-1 block text-sm font-medium text-slate-700">
                  Weather Condition
                </label>
                <input
                  id="weather_condition"
                  value={form.weather_condition}
                  onChange={(event) => updateField('weather_condition', event.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Site Coordinates</label>
                <div className="flex gap-2">
                  <input
                    aria-label="Latitude"
                    placeholder="Latitude"
                    value={form.latitude}
                    onChange={(event) => updateField('latitude', event.target.value)}
                    className={inputClass}
                  />
                  <input
                    aria-label="Longitude"
                    placeholder="Longitude"
                    value={form.longitude}
                    onChange={(event) => updateField('longitude', event.target.value)}
                    className={inputClass}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="md"
                    icon={MapPin}
                    loading={locating}
                    onClick={useMyLocation}
                  >
                    Use
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="photos" className="mb-1 block text-sm font-medium text-slate-700">
                Site Photos
              </label>
              <input
                id="photos"
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => addPhotos(event.target.files)}
                className="block w-full text-sm text-slate-600"
              />

              {photoQueue.length > 0 ? (
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {photoQueue.map((photo) => {
                    const status = uploadStatus[photo.id]
                    return (
                      <li
                        key={photo.id}
                        className="overflow-hidden rounded-md border border-slate-200 bg-white"
                      >
                        <div className="relative">
                          <img
                            src={photo.previewUrl}
                            alt={photo.file.name}
                            className="h-28 w-full object-cover"
                          />
                          {status === 'uploading' || status === 'analyzing' ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Loader2 className="h-6 w-6 animate-spin text-white" aria-hidden="true" />
                            </div>
                          ) : status === 'success' ? (
                            <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-600 p-1 text-white">
                              <Check className="h-3 w-3" aria-hidden="true" />
                            </span>
                          ) : status === 'error' ? (
                            <span className="absolute right-1.5 top-1.5 rounded-full bg-red-600 p-1 text-white">
                              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                            </span>
                          ) : !submitting ? (
                            <button
                              type="button"
                              onClick={() => removePhoto(photo.id)}
                              className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                              aria-label={`Remove ${photo.file.name}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          ) : null}
                        </div>
                        <div className="space-y-1 p-2">
                          <p className="truncate text-[11px] text-slate-500" title={photo.file.name}>
                            {photo.file.name}
                          </p>
                          <select
                            value={photo.stage}
                            disabled={submitting}
                            onChange={(event) => updatePhotoStage(photo.id, event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-1.5 py-1 text-xs disabled:bg-slate-100"
                          >
                            {Object.entries(IMAGE_STAGE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          {status === 'error' ? (
                            <p className="text-[11px] text-red-600">Upload failed</p>
                          ) : status === 'uploading' ? (
                            <p className="text-[11px] text-slate-500">Uploading...</p>
                          ) : status === 'analyzing' ? (
                            <p className="text-[11px] text-slate-500">Processing image...</p>
                          ) : status === 'success' ? (
                            <p className="text-[11px] text-emerald-600">Uploaded</p>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>

            <div className="mt-5">
              <Button type="submit" icon={Send} loading={submitting}>
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

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Monitoring History</h2>
          {updates.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No monitoring updates yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {updates.map((entry) => (
                <li key={entry.id} className="rounded-md border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {entry.progress_percentage != null ? `${entry.progress_percentage}% complete` : 'Update'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(entry.report_date)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">by {entry.reporter?.full_name ?? '—'}</p>
                  {entry.weather_condition ? (
                    <p className="mt-1 text-xs text-slate-500">Weather: {entry.weather_condition}</p>
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
        </section>

        {(imagesByUpdate.get('unassigned') ?? []).length > 0 ? (
          <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Other Site Photos</h2>
            <div className="mt-4">
              <SitePhotoGrid images={imagesByUpdate.get('unassigned')} />
            </div>
          </section>
        ) : null}
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />
    </div>
  )
}

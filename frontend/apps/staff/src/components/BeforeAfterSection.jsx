import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Clock, ImagePlus, MapPin, MessageSquare, RefreshCw, ScanSearch, Send, Sparkles } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import Badge from '@shared/components/ui/Badge'
import { formatDateTime } from '@shared/utils/format'
import Button from './ui/Button'
import CameraCapture from './CameraCapture'
import ConfirmNameDialog from './ConfirmNameDialog'
import { useToast } from '../hooks/useToast'
import { processImageFile } from '../utils/imageProcessing'
import {
  CHANCE_INLIERS,
  TARGET_INLIERS,
  accuracyBand,
  computeMatchAccuracy,
  preloadOpenCv,
} from '../utils/beforeAfterMatching'

// Before & After image processing (panel revision after the 2026-10-04
// defense):
//   - BEFORE: a photo of the site before work starts. Required before the
//     first monitoring update (trg_require_before_photo).
//   - AFTER: while MPDC's update request is open (or once the project is
//     finished), Engineering captures the site with the camera — "Taken by"
//     is asked first. Each capture is saved right away as a DRAFT.
//   - Generate (Engineering only): compares a BEFORE and an AFTER photo by
//     image processing (beforeAfterMatching.js — ORB + RANSAC) and shows the
//     match accuracy; compare-before-after saves it with Gemini's written
//     explanation, also as a draft.
//   - Drafts are visible to Engineering and admins only. Submitting the
//     monitoring update releases them to MPDC (and the public); on a
//     COMPLETED project, "Submit AFTER photos to MPDC" does
//     (20261018100000_draft_site_photos.sql).
// Shared by Engineering (`confirmedBy` given: takes photos, generates) and
// MPDC (view only — it never receives drafts). `embedded` drops the card and
// heading so Engineering can show it as the photo step inside the New
// Monitoring Update card (ProjectMonitoringDetail.jsx).

const BEFORE_UPLOAD_STATUSES = ['FOR_IMPLEMENTATION', 'ONGOING']

const SAME_SITE = {
  LIKELY_SAME: { label: 'Likely the same site', flag: false },
  POSSIBLY_DIFFERENT: { label: 'Possibly a different site', flag: true },
  CANNOT_DETERMINE: { label: 'Same site cannot be determined', flag: false },
}

const COMPLETION = {
  APPEARS_COMPLETE: { label: 'Work appears complete', flag: false },
  APPEARS_INCOMPLETE: { label: 'Work appears incomplete', flag: true },
  CANNOT_DETERMINE: { label: 'Completion cannot be determined', flag: false },
}

// The matched-landmarks picture is hidden for now: Generate shows the
// accuracy and the written explanation only. Set to true to bring it back.
const SHOW_LANDMARK_PICTURE = false

const ACCURACY_COLORS = {
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
}

function newestFirst(a, b) {
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}

// Only Engineering's queries select released_at; MPDC rows leave it
// undefined and are never drafts (RLS hides drafts from MPDC).
function isDraft(row) {
  return row?.released_at === null
}

function PhotoPicker({ title, photos, selectedId, onSelect, emptyText, children }) {
  const selected = photos.find((photo) => photo.id === selectedId) ?? null
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          {title}
          {photos.length > 0 ? <span className="font-normal text-slate-400"> ({photos.length})</span> : null}
        </h3>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>

      {selected ? (
        <>
          <a
            href={selected.signedUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200"
            title="Open full photo"
          >
            {selected.signedUrl ? (
              <img src={selected.signedUrl} alt={`${title} photo`} className="aspect-4/3 w-full object-cover" />
            ) : (
              <div className="aspect-4/3" />
            )}
          </a>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
            {isDraft(selected) ? <Badge tone="amber">Draft</Badge> : null}
            {formatDateTime(selected.created_at)}
            {selected.uploader?.full_name ? ` · ${selected.uploader.full_name}` : ''}
            {selected.latitude != null ? <MapPin className="h-3 w-3 text-emerald-600" aria-label="Location tagged" /> : null}
          </p>
          {photos.length > 1 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onSelect(photo.id)}
                  className={`w-16 shrink-0 overflow-hidden rounded-md bg-slate-100 ${
                    photo.id === selectedId ? 'ring-2 ring-blue-500' : 'ring-1 ring-slate-200 opacity-70 hover:opacity-100'
                  }`}
                  aria-label="Use this photo"
                >
                  {photo.signedUrl ? (
                    <img src={photo.signedUrl} alt="" className="aspect-4/3 w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="aspect-4/3" />
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-3 flex aspect-4/3 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      )}
    </section>
  )
}

function Verdict({ verdict, reason }) {
  return (
    <div className="flex gap-2">
      {verdict.flag ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
      )}
      <div>
        <p className={`text-sm font-medium ${verdict.flag ? 'text-red-700' : 'text-slate-800'}`}>{verdict.label}</p>
        <p className="text-sm text-slate-600">{reason}</p>
      </div>
    </div>
  )
}

function ComparisonResult({ comparison, images, visualization }) {
  const accuracy = Number(comparison.accuracy)
  const band = accuracyBand(accuracy)
  const m = comparison.metrics ?? {}
  const ai = comparison.ai_analysis_status === 'PROCESSED' ? comparison.ai_analysis_result : null
  const before = images.find((image) => image.id === comparison.before_image_id)
  const after = images.find((image) => image.id === comparison.after_image_id)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-slate-200 p-4">
        <div className="text-center">
          <p className={`text-4xl font-bold tabular-nums ${ACCURACY_COLORS[band.tone]}`}>{accuracy.toFixed(1)}%</p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Match accuracy</p>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Badge tone={band.tone}>{band.label}</Badge>
          <p className="text-sm text-slate-600">{band.note}</p>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${band.tone === 'green' ? 'bg-emerald-500' : band.tone === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, Math.max(0, accuracy))}%` }}
            />
          </div>
        </div>
        {before?.signedUrl && after?.signedUrl ? (
          <div className="flex gap-1.5">
            {[
              [before, 'Before'],
              [after, 'After'],
            ].map(([image, label]) => (
              <figure key={label} className="w-20">
                <img src={image.signedUrl} alt={`${label} photo compared`} className="aspect-4/3 w-full rounded object-cover ring-1 ring-slate-200" />
                <figcaption className="mt-0.5 text-center text-[10px] text-slate-500">{label}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </div>

      {SHOW_LANDMARK_PICTURE && visualization ? (
        <figure>
          <img src={visualization} alt="Matched landmarks between the before and after photos" className="w-full rounded-lg ring-1 ring-slate-200" />
          <figcaption className="mt-1 text-[11px] text-slate-500">
            Green lines join the same physical points found in both photos (RANSAC inliers) — the landmarks the
            accuracy is based on. Left: Before · Right: After.
          </figcaption>
        </figure>
      ) : null}

      <section className="space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">How the accuracy was computed</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Keypoints (Before)', m.keypoints_before],
            ['Keypoints (After)', m.keypoints_after],
            ['Good matches', m.good_matches],
            ['Verified landmarks', m.inliers],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-2.5">
              <p className="text-lg font-semibold tabular-nums text-slate-800">{value ?? '—'}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          ORB feature detection finds distinctive points in each photo; brute-force Hamming matching with Lowe's ratio
          test keeps the clear matches; RANSAC keeps only the matches that fit one consistent change of camera position
          (verified landmarks). Accuracy = coverage × (0.5 + 0.5 × verified ÷ good matches), where coverage counts
          verified landmarks above {CHANCE_INLIERS} (chance level) up to {TARGET_INLIERS}. The same two photos always
          give the same accuracy.
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Sparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
          AI explanation
        </h4>
        {ai ? (
          <>
            <p className="text-sm text-slate-700">{ai.summary}</p>
            {SAME_SITE[ai.same_site] ? <Verdict verdict={SAME_SITE[ai.same_site]} reason={ai.same_site_reason} /> : null}
            {COMPLETION[ai.completion] ? <Verdict verdict={COMPLETION[ai.completion]} reason={ai.completion_reason} /> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Landmarks in both photos</p>
                {ai.matching_landmarks?.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {ai.matching_landmarks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">None identified.</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Visible changes</p>
                {ai.visible_changes?.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                    {ai.visible_changes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">None noted.</p>
                )}
              </div>
            </div>
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{ai.limitations}</p>
          </>
        ) : (
          <p className="text-sm text-slate-500">
            {comparison.ai_analysis_result?.error
              ? `The written explanation could not be generated: ${comparison.ai_analysis_result.error} The accuracy above is unaffected.`
              : 'No written explanation for this comparison.'}
          </p>
        )}
      </section>

      <p className="text-[11px] italic text-slate-400">
        Generated {formatDateTime(comparison.created_at)}. Decision-support only — not an official engineering
        inspection.
      </p>
    </div>
  )
}

export default function BeforeAfterSection({
  project,
  images,
  latestProgress,
  userId,
  confirmedBy = null,
  updateRequested = false,
  onPhotosChanged,
  onComparisonsChange,
  // MPDC only: asks Engineering for a monitoring update (shown when given).
  onRequestUpdate = null,
  requestingUpdate = false,
  embedded = false,
}) {
  const toast = useToast()
  const canTakePhotos = Boolean(confirmedBy)

  const beforePhotos = images.filter((image) => image.image_stage === 'BEFORE').sort(newestFirst)
  // Inside the New Monitoring Update, After starts empty: only this visit's
  // new (draft) photos show, not the ones already submitted with earlier
  // updates — those stay in the standalone section.
  const afterPhotos = images
    .filter((image) => image.image_stage === 'AFTER' && (!embedded || isDraft(image)))
    .sort(newestFirst)

  const [selectedBeforeId, setSelectedBeforeId] = useState(null)
  const [selectedAfterId, setSelectedAfterId] = useState(null)
  const [comparisons, setComparisons] = useState([])
  const [shownComparisonId, setShownComparisonId] = useState(null)
  const [visualization, setVisualization] = useState(null)
  const [generating, setGenerating] = useState(null) // null | 'processing' | 'explaining'
  // { stage, takenBy } while the camera is open.
  const [camera, setCamera] = useState(null)
  const [uploading, setUploading] = useState(0)
  // { title, description, confirmLabel, confirmIcon, run(name) } while the
  // name dialog is open.
  const [namePrompt, setNamePrompt] = useState(null)
  const [releasing, setReleasing] = useState(false)
  const beforeInputRef = useRef(null)
  const afterInputRef = useRef(null)
  const uploadNameRef = useRef('')

  const beforeId = beforePhotos.some((p) => p.id === selectedBeforeId) ? selectedBeforeId : beforePhotos[0]?.id ?? null
  const afterId = afterPhotos.some((p) => p.id === selectedAfterId) ? selectedAfterId : afterPhotos[0]?.id ?? null

  // Once there's a pair to compare, load OpenCV in the background worker so
  // Generate doesn't wait on the ~10 MB download. Projects without both
  // photos never download it.
  const canCompare = Boolean(beforeId && afterId)
  useEffect(() => {
    if (canCompare) preloadOpenCv()
  }, [canCompare])

  const finished = project.status === 'COMPLETED' || Number(latestProgress) === 100
  // One BEFORE photo is the baseline: Upload disappears once it's on file.
  const canAddBefore = canTakePhotos && beforePhotos.length === 0 && BEFORE_UPLOAD_STATUSES.includes(project.status)
  // Needs the BEFORE baseline first; then unlocked by a finished project, or
  // while MPDC's update request is open.
  const hasBefore = beforePhotos.length > 0
  const afterUnlocked = finished || updateRequested
  const canCaptureAfter = canTakePhotos && hasBefore && afterUnlocked
  const afterLockedReason = !hasBefore
    ? 'Upload a Before photo first.'
    : 'Available once MPDC requests an update or the project reaches 100%.'
  // For a requested update, Generate must use a new (draft) After photo — the
  // database only accepts the update with a comparison of one.
  const selectedAfter = afterPhotos.find((p) => p.id === afterId) ?? null
  const needsNewAfter = updateRequested && !isDraft(selectedAfter)
  const draftPhotoCount = images.filter((image) => isDraft(image)).length
  // A monitoring update carries one After photo: once its draft is taken,
  // Take Photo becomes Retake, and the new photo replaces the draft
  // (20261023100000_retake_draft_after_photo.sql). A COMPLETED project's
  // finished-project photos are not limited.
  const oneAfterOnly = canTakePhotos && updateRequested
  const draftAfters = afterPhotos.filter((photo) => isDraft(photo))
  const isRetake = oneAfterOnly && draftAfters.length > 0
  const canReleaseCompleted = canTakePhotos && project.status === 'COMPLETED' && draftPhotoCount > 0

  async function loadComparisons() {
    const { data, error } = await supabase
      .from('project_before_after_comparisons')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(20)
    if (error) {
      toast.error('Could not load Before & After comparisons', error.message)
      return
    }
    setComparisons(data ?? [])
  }

  useEffect(() => {
    loadComparisons()
  }, [project.id])

  useEffect(() => {
    onComparisonsChange?.(comparisons)
  }, [comparisons, onComparisonsChange])

  // Saves one BEFORE/AFTER photo right away — no form, it shows up as soon as
  // the upload finishes.
  async function savePhoto(file, gps, stage, takenBy) {
    // Drafts this photo replaces (retake), fixed now — the new one is saved
    // first so a failed capture never leaves the update without its photo.
    const replaced = stage === 'AFTER' && oneAfterOnly ? draftAfters : []
    setUploading((count) => count + 1)
    try {
      const { status: gateStatus, result: gateResult } = await processImageFile(file)
      if (gateStatus === 'FAILED') throw new Error(gateResult?.error ?? 'Image could not be validated.')

      const location = gps ?? gateResult?.gps ?? null
      const path = `${project.id}/${stage.toLowerCase()}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('project-images').upload(path, file)
      if (uploadError) throw uploadError

      const { data: inserted, error: insertError } = await supabase
        .from('project_images')
        .insert({
          project_id: project.id,
          project_update_id: null,
          uploaded_by: userId,
          storage_path: path,
          file_name: file.name,
          image_stage: stage,
          captured_at: new Date().toISOString(),
          latitude: location ? Number(location.latitude.toFixed(6)) : null,
          longitude: location ? Number(location.longitude.toFixed(6)) : null,
          ai_analysis_status: 'NOT_APPLICABLE',
          ai_analysis_result: null,
        })
        .select('id')
        .single()
      if (insertError) throw insertError

      if (stage === 'BEFORE') setSelectedBeforeId(inserted.id)
      else setSelectedAfterId(inserted.id)

      // Retake: remove the replaced draft — file first (its row is what
      // proves it is a draft), then the row, whose comparisons go with it.
      let replaceFailed = null
      if (replaced.length > 0) {
        const { error: removeError } = await supabase.storage
          .from('project-images')
          .remove(replaced.map((photo) => photo.storage_path))
        const { error: deleteError } = removeError
          ? { error: removeError }
          : await supabase.from('project_images').delete().in('id', replaced.map((photo) => photo.id))
        if (deleteError) replaceFailed = deleteError.message
        setShownComparisonId(null)
        setVisualization(null)
        await loadComparisons()
      }

      await confirmedBy.record(
        project.id,
        stage === 'BEFORE'
          ? 'Uploaded a BEFORE photo of the site'
          : replaced.length > 0
            ? 'Retook the AFTER photo of the site'
            : 'Took an AFTER photo of the site',
        takenBy,
      )
      await onPhotosChanged()
      if (replaceFailed) {
        toast.error('New After photo saved, but the previous one could not be removed', replaceFailed)
      } else {
        toast.success(
          stage === 'BEFORE' ? 'Before photo saved' : replaced.length > 0 ? 'After photo replaced' : 'After photo saved',
          stage === 'BEFORE'
            ? 'It now appears in Before & After.'
            : replaced.length > 0
              ? 'The previous photo and its comparison were removed. Press Generate again.'
              : 'Saved as a draft. MPDC sees it once you submit the monitoring update.',
        )
      }
    } catch (error) {
      toast.error(`Could not save the ${stage === 'BEFORE' ? 'before' : 'after'} photo`, error.message)
    } finally {
      setUploading((count) => count - 1)
    }
  }

  // Every photo starts with who took it; the camera / file picker opens
  // only after the name is confirmed.
  function openCamera(stage) {
    setNamePrompt({
      title: 'Taken by',
      description:
        stage === 'AFTER' && isRetake
          ? 'Who is retaking the After photo? The new photo replaces the current one, and its comparison is removed.'
          : 'Who is taking this photo at the site? The name is recorded with the photo.',
      confirmLabel: 'Open Camera',
      confirmIcon: Camera,
      run: (name) => setCamera({ stage, takenBy: name }),
    })
  }

  function chooseFile(stage) {
    setNamePrompt({
      title: 'Taken by',
      description: `Who took this ${stage === 'BEFORE' ? 'Before' : 'After'} photo of the site? The name is recorded with the photo.`,
      confirmLabel: 'Choose Photo',
      confirmIcon: ImagePlus,
      run: (name) => {
        uploadNameRef.current = name
        // Still inside the Confirm click, so the browser lets this open the picker.
        ;(stage === 'BEFORE' ? beforeInputRef : afterInputRef).current?.click()
      },
    })
  }

  function pickFiles(fileList, stage) {
    const files = Array.from(fileList ?? [])
    if (files.length === 0 || !uploadNameRef.current) return
    for (const file of files) savePhoto(file, null, stage, uploadNameRef.current)
  }

  function confirmName(name) {
    const { run } = namePrompt
    confirmedBy.setName(name)
    setNamePrompt(null)
    run(name)
  }

  // Reuses the name already given on the page; asks only if there is none.
  function requestGenerate() {
    if (confirmedBy.name.trim().length >= 2) {
      handleGenerate(confirmedBy.name.trim())
      return
    }
    setNamePrompt({
      title: 'Generated by',
      description: 'Who is generating this comparison? The name is recorded with it.',
      confirmLabel: 'Generate',
      confirmIcon: ScanSearch,
      run: handleGenerate,
    })
  }

  function requestReleaseCompleted() {
    setNamePrompt({
      title: 'Responsible person',
      description: 'Who is submitting these AFTER photos and comparisons to MPDC?',
      confirmLabel: 'Submit to MPDC',
      confirmIcon: Send,
      run: releaseCompleted,
    })
  }

  async function releaseCompleted(name) {
    setReleasing(true)
    const { data: count, error } = await supabase.rpc('release_completed_project_photos', {
      p_project_id: project.id,
    })
    if (error) {
      toast.error('Could not submit the photos', error.message)
      setReleasing(false)
      return
    }
    await confirmedBy.record(
      project.id,
      `Submitted ${count} AFTER ${count === 1 ? 'photo' : 'photos'} to MPDC`,
      name,
    )
    await Promise.all([onPhotosChanged(), loadComparisons()])
    setReleasing(false)
    toast.success('Submitted to MPDC', 'MPDC can now see the AFTER photos and comparisons.')
  }

  async function handleGenerate(generatedBy) {
    const before = beforePhotos.find((p) => p.id === beforeId)
    const after = afterPhotos.find((p) => p.id === afterId)
    if (!before?.signedUrl || !after?.signedUrl) return

    setGenerating('processing')
    setVisualization(null)
    try {
      const { metrics, visualization: picture } = await computeMatchAccuracy(before.signedUrl, after.signedUrl)
      setVisualization(picture)

      setGenerating('explaining')
      const { data, error } = await supabase.functions.invoke('compare-before-after', {
        body: { project_id: project.id, before_image_id: before.id, after_image_id: after.id, metrics },
      })
      if (error || !data?.comparison) {
        let message = data?.error ?? error?.message ?? 'The comparison could not be saved.'
        try {
          message = (await error?.context?.json())?.error ?? message
        } catch {
          // keep the generic message
        }
        throw new Error(message)
      }

      setComparisons((current) => [data.comparison, ...current])
      setShownComparisonId(data.comparison.id)
      await confirmedBy.record(
        project.id,
        `Generated a Before & After comparison (${Number(data.comparison.accuracy).toFixed(1)}% match accuracy)`,
        generatedBy,
      )
      toast.success('Comparison generated', `Match accuracy: ${Number(data.comparison.accuracy).toFixed(1)}%`)
    } catch (error) {
      setVisualization(null)
      toast.error('Could not generate the comparison', error.message)
    } finally {
      setGenerating(null)
    }
  }

  // Redraws the matched landmarks of a saved comparison (same photos, same
  // deterministic result), without saving anything.
  async function showLandmarks(comparison) {
    const before = images.find((image) => image.id === comparison.before_image_id)
    const after = images.find((image) => image.id === comparison.after_image_id)
    if (!before?.signedUrl || !after?.signedUrl) return
    setGenerating('processing')
    try {
      const { visualization: picture } = await computeMatchAccuracy(before.signedUrl, after.signedUrl)
      setVisualization(picture)
    } catch (error) {
      toast.error('Could not draw the matched landmarks', error.message)
    } finally {
      setGenerating(null)
    }
  }

  const shown = comparisons.find((c) => c.id === shownComparisonId) ?? comparisons[0] ?? null
  const shownIsLive = shown && shown.id === shownComparisonId
  const canGenerate = canTakePhotos && Boolean(beforeId && afterId) && !needsNewAfter && !generating

  const header = (
    <div>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <ScanSearch className="h-4 w-4 text-blue-600" aria-hidden="true" />
        Before &amp; After
      </h2>
      <p className="mt-0.5 text-xs text-slate-500">
        The site before work started, the finished project, and how closely they match.
      </p>
    </div>
  )

  const requestUpdateButton = onRequestUpdate ? (
    <Button
      type="button"
      size="sm"
      icon={MessageSquare}
      loading={requestingUpdate}
      onClick={onRequestUpdate}
    >
      Request Update
    </Button>
  ) : null

  // MPDC (view only): a short notice instead of empty boxes until Engineering
  // releases photos or a comparison with a monitoring update.
  if (!canTakePhotos && beforePhotos.length === 0 && afterPhotos.length === 0 && comparisons.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {header}
          {requestUpdateButton}
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-linear-to-r from-amber-50 to-orange-50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-amber-900">No update from Engineering yet.</p>
            <p className="mt-0.5 text-xs text-amber-700">
              Before &amp; After photos appear here once Engineering submits the monitoring update.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const Wrapper = embedded ? 'div' : 'section'

  return (
    <Wrapper className={embedded ? '' : 'rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/60'}>
      <div className={`flex flex-wrap items-start gap-3 ${embedded ? 'justify-end' : 'justify-between'}`}>
        {embedded ? null : header}
        {uploading > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving photo...
          </span>
        ) : null}
        {requestUpdateButton}
      </div>

      {canTakePhotos && beforePhotos.length === 0 ? (
        <p className={`${embedded ? '' : 'mt-4 '}flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Upload a BEFORE photo of the site first. Monitoring updates can't be submitted until the site's condition
          before the project is on file.
        </p>
      ) : null}

      <div className={`${embedded && beforePhotos.length > 0 ? '' : 'mt-4 '}grid gap-4 md:grid-cols-2`}>
        <PhotoPicker
          title="Before"
          photos={beforePhotos}
          selectedId={beforeId}
          onSelect={setSelectedBeforeId}
          emptyText="No before photo yet. It must be uploaded before the project starts."
        >
          {canAddBefore ? (
            <>
              <Button type="button" variant="secondary" size="sm" icon={ImagePlus} onClick={() => chooseFile('BEFORE')}>
                Upload
              </Button>
              <input
                ref={beforeInputRef}
                id="before_photo"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  pickFiles(event.target.files, 'BEFORE')
                  event.target.value = ''
                }}
              />
            </>
          ) : null}
        </PhotoPicker>

        <PhotoPicker
          title="After"
          photos={afterPhotos}
          selectedId={afterId}
          onSelect={setSelectedAfterId}
          emptyText={
            hasBefore && afterUnlocked
              ? embedded
                ? 'No after photo yet. Capture the project site with the camera.'
                : 'No after photo yet. Capture the project site with the camera or upload a photo.'
              : afterLockedReason
          }
        >
          {canTakePhotos ? (
            <>
              {/* Inside the New Monitoring Update the After photo must come
                  from the in-app camera — taken at the site, at the visit. */}
              {embedded ? null : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={ImagePlus}
                    disabled={!canCaptureAfter}
                    title={canCaptureAfter ? undefined : afterLockedReason}
                    onClick={() => chooseFile('AFTER')}
                  >
                    Upload
                  </Button>
                  <input
                    ref={afterInputRef}
                    id="after_photo"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      pickFiles(event.target.files, 'AFTER')
                      event.target.value = ''
                    }}
                  />
                </>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={Camera}
                disabled={!canCaptureAfter}
                title={canCaptureAfter ? undefined : afterLockedReason}
                onClick={() => openCamera('AFTER')}
              >
                {isRetake ? 'Retake' : 'Take Photo'}
              </Button>
            </>
          ) : null}
        </PhotoPicker>
      </div>

      {canTakePhotos ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-500">
            {!beforeId || !afterId
              ? 'Generate becomes available once there is both a Before and an After photo.'
              : needsNewAfter
                ? 'Take a new After photo first — Generate compares it with the Before photo for this update.'
                : 'Compares the selected Before and After photos and computes the match accuracy.'}
          </p>
          <Button type="button" icon={ScanSearch} loading={Boolean(generating)} disabled={!canGenerate} onClick={requestGenerate}>
            {generating === 'processing'
              ? 'Matching landmarks...'
              : generating === 'explaining'
                ? 'Saving & explaining...'
                : 'Generate'}
          </Button>
        </div>
      ) : comparisons.length === 0 ? (
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
          Engineering&apos;s Before &amp; After comparison appears here once it submits the monitoring update.
        </p>
      ) : null}

      {canReleaseCompleted ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-800">
            {draftPhotoCount} draft {draftPhotoCount === 1 ? 'photo is' : 'photos are'} not yet visible to MPDC.
          </p>
          <Button type="button" size="sm" icon={Send} loading={releasing} onClick={requestReleaseCompleted}>
            Submit AFTER photos to MPDC
          </Button>
        </div>
      ) : null}

      {shown ? (
        <div className="mt-5">
          {isDraft(shown) ? (
            <p className="mb-3 flex items-center gap-2 text-xs text-amber-700">
              <Badge tone="amber">Draft</Badge>
              Not yet visible to MPDC — it is sent with the monitoring update.
            </p>
          ) : null}
          {SHOW_LANDMARK_PICTURE && !shownIsLive && !visualization ? (
            <div className="mb-3 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={ScanSearch}
                disabled={Boolean(generating)}
                onClick={() => showLandmarks(shown)}
              >
                Show matched landmarks
              </Button>
            </div>
          ) : null}
          <ComparisonResult comparison={shown} images={images} visualization={visualization} />

          {comparisons.length > 1 ? (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Earlier comparisons</h4>
              <ul className="mt-2 flex flex-wrap gap-2">
                {comparisons.map((comparison) => (
                  <li key={comparison.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setShownComparisonId(comparison.id)
                        setVisualization(null)
                      }}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                        comparison.id === shown.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-semibold tabular-nums">{Number(comparison.accuracy).toFixed(1)}%</span>
                      <span className="text-slate-500"> · {formatDateTime(comparison.created_at)}</span>
                      {isDraft(comparison) ? <span className="text-amber-700"> · Draft</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {camera ? (
        <CameraCapture
          title={camera.stage === 'BEFORE' ? 'Before Photo' : finished ? 'Capture Finished Project' : 'After Photo'}
          hint={
            camera.stage === 'AFTER'
              ? 'Stand where the Before photo was taken and frame the same view — the closer the angle, the higher the match accuracy.'
              : 'Take a wide shot that includes fixed landmarks (trees, buildings, poles, road edges).'
          }
          onCapture={(file, gps) => savePhoto(file, gps, camera.stage, camera.takenBy)}
          onClose={() => setCamera(null)}
          singleShot
        />
      ) : null}

      {namePrompt ? (
        <ConfirmNameDialog
          title={namePrompt.title}
          description={namePrompt.description}
          confirmLabel={namePrompt.confirmLabel}
          confirmIcon={namePrompt.confirmIcon}
          initialName={confirmedBy?.name ?? ''}
          onConfirm={confirmName}
          onCancel={() => setNamePrompt(null)}
        />
      ) : null}
    </Wrapper>
  )
}

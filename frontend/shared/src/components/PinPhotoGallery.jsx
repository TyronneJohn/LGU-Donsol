import { useMemo, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react'
import { formatDate } from '../utils/format'

// Before/After tabs always show (site photos are taken only as Before and
// After now, so there is no During tab). ISSUE/OTHER photos are staff-only
// (get_public_project_transparency() filters them out), so their tabs only
// appear when there are some — i.e. never on the public site.
const STAGES = [
  { key: 'BEFORE', label: 'Before' },
  { key: 'AFTER', label: 'After' },
  { key: 'ISSUE', label: 'Issue', optional: true },
  { key: 'OTHER', label: 'Other', optional: true },
]

function newestFirst(a, b) {
  return new Date(b.captured_at ?? 0) - new Date(a.captured_at ?? 0)
}

/**
 * Site photos shown inside a clicked map pin's details panel (ProjectMap
 * `renderCardMedia`): a large preview, Before/After tabs with counts,
 * and a thumbnail strip. Opens on the stage of the newest photo.
 *
 * @param {object[]} photos - rows with `id`, `signedUrl`, `image_stage`, `captured_at`.
 * @param {boolean} loading
 * @param {(list: object[], index: number) => void} onOpen - full-screen view
 *   of `list` (the current stage's photos), starting at `index`.
 */
export default function PinPhotoGallery({ photos, loading, onOpen }) {
  const byStage = useMemo(
    () =>
      Object.fromEntries(
        STAGES.map(({ key }) => [key, photos.filter((p) => p.image_stage === key).sort(newestFirst)]),
      ),
    [photos],
  )
  const newestStage = useMemo(() => {
    const stage = [...photos].sort(newestFirst)[0]?.image_stage
    return STAGES.some((s) => s.key === stage) ? stage : 'BEFORE'
  }, [photos])

  const [stage, setStage] = useState(null)
  const [index, setIndex] = useState(0)

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="aspect-4/3 animate-pulse rounded-lg bg-slate-100" />
        <p className="text-xs text-slate-400">Loading project photos...</p>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className="flex aspect-4/3 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
        <Camera className="h-6 w-6 text-slate-300" aria-hidden="true" />
        <p className="text-xs text-slate-500">No project photos posted yet.</p>
      </div>
    )
  }

  const activeStage = stage && byStage[stage].length > 0 ? stage : newestStage
  const list = byStage[activeStage]
  const current = Math.min(index, list.length - 1)
  const photo = list[current]
  const stageLabel = STAGES.find((s) => s.key === activeStage).label
  const step = (delta) => setIndex((current + delta + list.length) % list.length)

  return (
    <div className="space-y-2">
      <div className="group relative aspect-4/3 overflow-hidden rounded-lg bg-slate-900">
        <button
          type="button"
          onClick={() => onOpen(list, current)}
          aria-label="View photo full screen"
          className="block h-full w-full"
        >
          <img
            src={photo.signedUrl}
            alt={`${stageLabel} photo, ${formatDate(photo.captured_at)}`}
            className="h-full w-full object-cover"
          />
        </button>
        <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/50 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {list.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => step(-1)}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1 text-slate-700 shadow hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => step(1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1 text-slate-700 shadow hover:bg-white"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        ) : null}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-2 bg-linear-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-6 text-[11px] text-white">
          <span>
            {stageLabel} · {formatDate(photo.captured_at)}
          </span>
          <span className="tabular-nums">
            {current + 1} / {list.length}
          </span>
        </div>
      </div>

      <div role="tablist" aria-label="Photo stage" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {STAGES.filter((s) => !s.optional || byStage[s.key].length > 0).map(({ key, label }) => {
          const count = byStage[key].length
          const active = key === activeStage
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={count === 0}
              onClick={() => {
                setStage(key)
                setIndex(0)
              }}
              className={`flex-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              {label} <span className="tabular-nums text-slate-400">({count})</span>
            </button>
          )
        })}
      </div>

      {list.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {list.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === current ? 'true' : undefined}
              onClick={() => setIndex(i)}
              className={`h-12 w-16 shrink-0 overflow-hidden rounded-md ring-2 transition ${
                i === current ? 'ring-blue-500' : 'ring-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <img src={item.signedUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

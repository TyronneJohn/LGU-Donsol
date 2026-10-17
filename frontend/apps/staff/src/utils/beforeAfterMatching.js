// Page-side entry point for the Before vs After matching. The OpenCV work
// runs in a background Web Worker (beforeAfterMatching.worker.js) so the page
// never freezes; this file only talks to it. The method and the accuracy
// formula are documented in beforeAfterAccuracy.js.
export {
  ACCURACY_BANDS,
  CHANCE_INLIERS,
  TARGET_INLIERS,
  accuracyBand,
  accuracyFromMetrics,
} from './beforeAfterAccuracy'

let worker = null
let nextId = 0
const pending = new Map()

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./beforeAfterMatching.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data ?? {}
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    if (ok) request.resolve(result)
    else request.reject(new Error(error ?? 'Image processing failed.'))
  }
  // A worker that crashed (e.g. failed to load OpenCV) is discarded so the
  // next request starts a fresh one.
  worker.onerror = (event) => {
    event.preventDefault?.()
    for (const request of pending.values()) request.reject(new Error('The image-processing engine could not start.'))
    pending.clear()
    worker.terminate()
    worker = null
  }
  return worker
}

function send(message) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, ...message })
  })
}

// Starts downloading and compiling OpenCV in the background so it's ready
// before Generate is pressed. Safe to call repeatedly; failures are ignored
// here and surface on the real request instead.
let warmedUp = false
export function preloadOpenCv() {
  if (warmedUp) return
  warmedUp = true
  send({ type: 'warmup' }).catch(() => {
    warmedUp = false
  })
}

// Compares two photo URLs. Resolves to { accuracy, metrics, visualization }.
export function computeMatchAccuracy(beforeUrl, afterUrl) {
  return send({ type: 'match', beforeUrl, afterUrl })
}

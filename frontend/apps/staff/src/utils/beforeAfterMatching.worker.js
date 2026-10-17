// Background thread for the Before vs After matching (see beforeAfterAccuracy.js
// for the method). Loading the ~10 MB OpenCV.js library and running ORB +
// RANSAC take seconds; on the page's own thread that froze the tab ("Page
// isn't responding"). Here the page stays responsive while it works.
//
// Messages in:  { id, type: 'warmup' } | { id, type: 'match', beforeUrl, afterUrl }
// Messages out: { id, ok: true, result? } | { id, ok: false, error }
import './workerEnvShim'
import cvModule from '@techstark/opencv-js'
import {
  MAX_DIMENSION,
  ORB_FEATURES,
  RANSAC_REPROJECTION_PX,
  RATIO_TEST,
  accuracyFromMetrics,
} from './beforeAfterAccuracy'

let cvPromise = null

// Resolved as { cv }: the module object is thenable, and resolving a promise
// with it directly would make it wait on itself forever.
function loadOpenCv() {
  cvPromise ??= (async () => {
    if (cvModule instanceof Promise) return { cv: await cvModule }
    if (cvModule.Mat && cvModule.ORB) return { cv: cvModule }
    await new Promise((resolve) => {
      cvModule.onRuntimeInitialized = resolve
    })
    return { cv: cvModule }
  })()
  return cvPromise
}

async function loadScaled(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('A photo could not be downloaded.')
  const bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

function detect(cv, canvas, orb) {
  const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  const rgba = cv.matFromImageData(imageData)
  const gray = new cv.Mat()
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY)
  cv.equalizeHist(gray, gray)
  const keypoints = new cv.KeyPointVector()
  const descriptors = new cv.Mat()
  const noMask = new cv.Mat()
  orb.detectAndCompute(gray, noMask, keypoints, descriptors)
  rgba.delete()
  gray.delete()
  noMask.delete()
  return { keypoints, descriptors }
}

// A homography that mirrors the image or blows it up/shrinks it absurdly is a
// degenerate fit, not a real change of camera position.
function isPlausibleHomography(H) {
  const d = H.data64F
  const det = d[0] * d[4] - d[1] * d[3]
  return Number.isFinite(det) && det > 0.05 && det < 20
}

// Side-by-side picture of both photos with a line for every inlier — the
// landmarks the accuracy is based on. Returned as a data URL.
async function drawMatches(beforeCanvas, afterCanvas, pairs) {
  const gap = 12
  const canvas = new OffscreenCanvas(beforeCanvas.width + gap + afterCanvas.width, Math.max(beforeCanvas.height, afterCanvas.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(beforeCanvas, 0, 0)
  ctx.drawImage(afterCanvas, beforeCanvas.width + gap, 0)

  const offset = beforeCanvas.width + gap
  ctx.lineWidth = 1.5
  for (const [a, b] of pairs) {
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x + offset, b.y)
    ctx.stroke()
    ctx.fillStyle = '#10b981'
    for (const [x, y] of [
      [a.x, a.y],
      [b.x + offset, b.y],
    ]) {
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  return new FileReaderSync().readAsDataURL(blob)
}

async function match(beforeUrl, afterUrl) {
  const [{ cv }, beforeCanvas, afterCanvas] = await Promise.all([loadOpenCv(), loadScaled(beforeUrl), loadScaled(afterUrl)])

  const orb = new cv.ORB(ORB_FEATURES)
  const before = detect(cv, beforeCanvas, orb)
  const after = detect(cv, afterCanvas, orb)
  const toDelete = [orb, before.keypoints, before.descriptors, after.keypoints, after.descriptors]

  try {
    const metrics = {
      keypoints_before: before.keypoints.size(),
      keypoints_after: after.keypoints.size(),
      good_matches: 0,
      inliers: 0,
      homography_found: false,
    }

    const good = []
    if (before.descriptors.rows >= 2 && after.descriptors.rows >= 2) {
      const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false)
      const knn = new cv.DMatchVectorVector()
      toDelete.push(matcher, knn)
      matcher.knnMatch(before.descriptors, after.descriptors, knn, 2)
      for (let i = 0; i < knn.size(); i++) {
        const pair = knn.get(i)
        if (pair.size() >= 2) {
          const best = pair.get(0)
          if (best.distance < RATIO_TEST * pair.get(1).distance) good.push(best)
        }
        pair.delete()
      }
    }
    metrics.good_matches = good.length

    const inlierPairs = []
    if (good.length >= 4) {
      const src = []
      const dst = []
      for (const m of good) {
        const a = before.keypoints.get(m.queryIdx).pt
        const b = after.keypoints.get(m.trainIdx).pt
        src.push(a.x, a.y)
        dst.push(b.x, b.y)
      }
      const srcMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, src)
      const dstMat = cv.matFromArray(good.length, 1, cv.CV_32FC2, dst)
      const mask = new cv.Mat()
      const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, RANSAC_REPROJECTION_PX, mask)
      toDelete.push(srcMat, dstMat, mask, H)

      if (!H.empty() && isPlausibleHomography(H)) {
        metrics.homography_found = true
        for (let i = 0; i < good.length; i++) {
          if (mask.data[i]) {
            inlierPairs.push([
              { x: src[i * 2], y: src[i * 2 + 1] },
              { x: dst[i * 2], y: dst[i * 2 + 1] },
            ])
          }
        }
        metrics.inliers = inlierPairs.length
      }
    }

    return {
      accuracy: accuracyFromMetrics(metrics),
      metrics,
      visualization: await drawMatches(beforeCanvas, afterCanvas, inlierPairs),
    }
  } finally {
    for (const item of toDelete) item.delete()
  }
}

self.onmessage = async (event) => {
  const { id, type, beforeUrl, afterUrl } = event.data ?? {}
  try {
    if (type === 'warmup') {
      await loadOpenCv()
      self.postMessage({ id, ok: true })
    } else if (type === 'match') {
      self.postMessage({ id, ok: true, result: await match(beforeUrl, afterUrl) })
    } else {
      self.postMessage({ id, ok: false, error: 'Unknown request.' })
    }
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message ?? 'Image processing failed.' })
  }
}

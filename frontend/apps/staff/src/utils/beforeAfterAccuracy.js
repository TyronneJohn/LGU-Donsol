// Before vs After match accuracy by classical image processing (no AI).
// Shared by the page and the background worker (beforeAfterMatching.worker.js),
// which does the actual OpenCV work.
//
// Pipeline, run in a Web Worker with OpenCV.js:
//   1. Load both photos (EXIF orientation applied), scale the longer side to
//      MAX_DIMENSION px, convert to grayscale and equalize the histogram so a
//      sunny AFTER photo and an overcast BEFORE photo are comparable.
//   2. ORB (Oriented FAST + Rotated BRIEF) finds up to ORB_FEATURES distinctive
//      corner points ("keypoints") in each photo and describes each one with
//      a 256-bit binary descriptor.
//   3. Brute-force Hamming matching, 2 nearest neighbours per keypoint, kept
//      only when the best match is clearly better than the second best
//      (Lowe's ratio test, RATIO_TEST) — "good matches".
//   4. RANSAC fits one homography (the perspective change between the two
//      camera positions) through the good matches. Matches consistent with it
//      are "inliers": landmarks that really are the same physical points
//      seen from both camera positions. Random look-alike matches are not.
//   5. Accuracy:
//        coverage    = clamp((inliers - CHANCE_INLIERS) / (TARGET_INLIERS - CHANCE_INLIERS), 0, 1)
//        inlierRatio = inliers / goodMatches
//        accuracy    = 100 × coverage × (0.5 + 0.5 × inlierRatio)
//      A homography fits any 4 points exactly, so up to CHANCE_INLIERS
//      inliers can appear between unrelated photos and are not counted.
//
// Deterministic: OpenCV's RANSAC uses a fixed random seed, so the same two
// photos always give the same accuracy. The formula is mirrored in
// supabase/functions/compare-before-after, which recomputes it from the
// metrics before saving.

export const MAX_DIMENSION = 800
export const ORB_FEATURES = 1000
export const RATIO_TEST = 0.75
export const RANSAC_REPROJECTION_PX = 5
export const CHANCE_INLIERS = 8
export const TARGET_INLIERS = 50

export const ACCURACY_BANDS = [
  { min: 70, label: 'High match', tone: 'green', note: 'Many landmarks of the BEFORE photo are found again in the AFTER photo — very likely the same site.' },
  { min: 40, label: 'Moderate match', tone: 'amber', note: 'Some landmarks match. Likely the same site, but the angle, framing or the amount of new construction limits the match.' },
  { min: 0, label: 'Low match', tone: 'red', note: 'Few landmarks match. The photos may be from different spots or angles — retake the AFTER photo from where the BEFORE photo was taken.' },
]

export function accuracyBand(accuracy) {
  return ACCURACY_BANDS.find((band) => accuracy >= band.min) ?? ACCURACY_BANDS[ACCURACY_BANDS.length - 1]
}

export function accuracyFromMetrics({ good_matches: good, inliers }) {
  if (!good || !inliers) return 0
  const coverage = Math.min(1, Math.max(0, (inliers - CHANCE_INLIERS) / (TARGET_INLIERS - CHANCE_INLIERS)))
  const inlierRatio = inliers / good
  return Math.round(100 * coverage * (0.5 + 0.5 * inlierRatio) * 100) / 100
}

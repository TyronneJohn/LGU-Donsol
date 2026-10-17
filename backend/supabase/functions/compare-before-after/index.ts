// Before vs After comparison for a finished project ("Generate" in the
// Before & After section, BeforeAfterSection.jsx).
//
// The match ACCURACY is computed by image processing in the browser — OpenCV
// ORB keypoints matched with Lowe's ratio test and verified with a RANSAC
// homography (src/utils/beforeAfterMatching.js). It is deterministic: the
// same two photos always give the same accuracy. This function:
//   1. verifies the caller and that both photos belong to the project
//      (one BEFORE, one AFTER),
//   2. re-checks the submitted metrics and recomputes the accuracy from them,
//      so a client can't post an accuracy its own numbers don't support,
//   3. asks Gemini for a short WRITTEN explanation of the two photos
//      (advisory — it never changes the accuracy),
//   4. saves the row to project_before_after_comparisons (service role).
// A Gemini failure still saves the accuracy, with ai_analysis_status FAILED.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GEMINI_TIMEOUT_MS = 60000
const GEMINI_RETRY_DELAYS_MS = [2000, 5000]
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

// Must match beforeAfterMatching.js.
const CHANCE_INLIERS = 8
const TARGET_INLIERS = 50

const SAME_SITE_VALUES = ['LIKELY_SAME', 'POSSIBLY_DIFFERENT', 'CANNOT_DETERMINE']
const COMPLETION_VALUES = ['APPEARS_COMPLETE', 'APPEARS_INCOMPLETE', 'CANNOT_DETERMINE']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

// Same formula as beforeAfterMatching.js#accuracyFromMetrics.
function accuracyFromMetrics(m: { good_matches: number; inliers: number }) {
  if (m.good_matches === 0 || m.inliers === 0) return 0
  const coverage = Math.min(1, Math.max(0, (m.inliers - CHANCE_INLIERS) / (TARGET_INLIERS - CHANCE_INLIERS)))
  const inlierRatio = m.inliers / m.good_matches
  return Math.round(100 * coverage * (0.5 + 0.5 * inlierRatio) * 100) / 100
}

function validateMetrics(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null
  const m = candidate as Record<string, unknown>
  if (!isCount(m.keypoints_before) || !isCount(m.keypoints_after) || !isCount(m.good_matches) || !isCount(m.inliers)) {
    return null
  }
  // At most one good match per BEFORE keypoint; inliers are a subset of them.
  if (m.good_matches > m.keypoints_before || m.inliers > m.good_matches) return null
  return {
    keypoints_before: m.keypoints_before,
    keypoints_after: m.keypoints_after,
    good_matches: m.good_matches,
    inliers: m.inliers,
    homography_found: m.homography_found === true,
  }
}

function validateAi(candidate: unknown) {
  if (!candidate || typeof candidate !== 'object') return null
  const o = candidate as Record<string, unknown>
  if (
    typeof o.summary !== 'string' ||
    typeof o.same_site !== 'string' ||
    !SAME_SITE_VALUES.includes(o.same_site) ||
    typeof o.same_site_reason !== 'string' ||
    !isStringArray(o.matching_landmarks) ||
    !isStringArray(o.visible_changes) ||
    typeof o.completion !== 'string' ||
    !COMPLETION_VALUES.includes(o.completion) ||
    typeof o.completion_reason !== 'string' ||
    typeof o.limitations !== 'string'
  ) {
    return null
  }
  return {
    summary: o.summary,
    same_site: o.same_site,
    same_site_reason: o.same_site_reason,
    matching_landmarks: o.matching_landmarks,
    visible_changes: o.visible_changes,
    completion: o.completion,
    completion_reason: o.completion_reason,
    limitations: o.limitations,
  }
}

function stripJsonWrapper(text: string): string {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return unfenced
  return unfenced.slice(start, end + 1)
}

function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function buildPrompt(project: Record<string, unknown> | null, accuracy: number) {
  const contextLines = [
    project?.title ? `Project title: ${project.title}` : null,
    project?.project_category ? `Category: ${project.project_category}` : null,
    project?.barangay ? `Barangay: ${project.barangay}` : null,
    project?.location_text ? `Location: ${project.location_text}` : null,
  ].filter(Boolean)

  return `You are an assistive image-observation tool inside a local government unit's project monitoring system (Donsol, Sorsogon, Philippines). You are given exactly two photos of ONE project: a BEFORE photo taken before construction started, and an AFTER photo captured by field engineering staff when the project was reported finished.

An image-processing step (ORB feature matching with RANSAC geometric verification) has already measured how well the two photos match: ${accuracy}% match accuracy. Do NOT produce your own percentage. Your job is only to explain, in words, what is visible.

Rules:
- Describe only what is visibly evident. Do not invent measurements, dates, costs or locations.
- The site will look different because construction happened — that alone does not make it a different site. Judge "same site" from fixed surroundings: terrain, trees, neighbouring buildings, road alignment, poles, landmarks.
- Do not claim the photos are authentic or prove anything about the contractor. Use hedged language ("appears to").
- This is advisory, not an official engineering inspection.

Project context (administrative metadata, not verified by the photos):
${contextLines.length > 0 ? contextLines.join('\n') : 'None provided.'}

Respond with JSON matching the schema:
- summary: two sentences on what changed from BEFORE to AFTER.
- same_site: LIKELY_SAME, POSSIBLY_DIFFERENT or CANNOT_DETERMINE.
- same_site_reason: one sentence naming the fixed features behind that judgment.
- matching_landmarks: short list of fixed features visible in BOTH photos (empty if none).
- visible_changes: short list of physical changes between the photos (empty if none — never invent).
- completion: APPEARS_COMPLETE, APPEARS_INCOMPLETE or CANNOT_DETERMINE, based only on the AFTER photo.
- completion_reason: one sentence.
- limitations: one sentence on what cannot be concluded from two photos.`
}

async function explainWithGemini(apiKey: string, prompt: string, before: { mime: string; data: string }, after: { mime: string; data: string }) {
  const requestBody = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { text: 'BEFORE photo:' },
          { inline_data: { mime_type: before.mime, data: before.data } },
          { text: 'AFTER photo:' },
          { inline_data: { mime_type: after.mime, data: after.data } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'LOW' },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          same_site: { type: 'STRING', enum: SAME_SITE_VALUES },
          same_site_reason: { type: 'STRING' },
          matching_landmarks: { type: 'ARRAY', items: { type: 'STRING' } },
          visible_changes: { type: 'ARRAY', items: { type: 'STRING' } },
          completion: { type: 'STRING', enum: COMPLETION_VALUES },
          completion_reason: { type: 'STRING' },
          limitations: { type: 'STRING' },
        },
        required: [
          'summary',
          'same_site',
          'same_site_reason',
          'matching_landmarks',
          'visible_changes',
          'completion',
          'completion_reason',
          'limitations',
        ],
      },
    },
  })

  let response: Response | null = null
  for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAYS_MS[attempt - 1]))
    const isLastAttempt = attempt === GEMINI_RETRY_DELAYS_MS.length
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
    try {
      response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: requestBody,
      })
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') throw new Error('AI explanation timed out.')
      if (isLastAttempt) throw new Error('Could not reach the Gemini API (network error).')
      continue
    } finally {
      clearTimeout(timeout)
    }
    const isTransient = response.status === 429 || response.status >= 500
    if (!isTransient || isLastAttempt) break
    await response.body?.cancel()
  }
  response = response!

  if (!response.ok) {
    if (response.status === 429) throw new Error('Gemini API rate limit or quota exceeded. Try again later.')
    if (response.status === 401 || response.status === 403) throw new Error('Gemini API key is invalid or unauthorized.')
    throw new Error(`Gemini API request failed (HTTP ${response.status}).`)
  }

  const data = await response.json().catch(() => null)
  const candidate = data?.candidates?.[0]
  if (!data || data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') {
    throw new Error('Gemini could not analyze these photos.')
  }
  const rawText = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .filter((part: Record<string, unknown>) => part?.thought !== true && typeof part?.text === 'string')
    .map((part: Record<string, unknown>) => part.text as string)
    .join('')
  if (rawText.trim().length === 0) throw new Error('Gemini returned an empty explanation.')

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonWrapper(rawText))
  } catch {
    throw new Error('Gemini returned malformed JSON.')
  }
  const validated = validateAi(parsed)
  if (!validated) throw new Error('Gemini returned an incomplete explanation.')
  return validated
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData?.user) {
      return jsonResponse({ error: 'Not authenticated.' }, 401)
    }

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role, is_active, office_id')
      .eq('id', callerData.user.id)
      .single()
    // Engineering generates the comparison as part of its monitoring update
    // (MPDC only views it once the update is submitted — see
    // 20261018100000_draft_site_photos.sql).
    if (!callerProfile?.is_active || !['engineering', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: 'Only Engineering or an administrator can generate a comparison.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const { project_id, before_image_id, after_image_id } = body ?? {}
    if (typeof project_id !== 'string' || typeof before_image_id !== 'string' || typeof after_image_id !== 'string') {
      return jsonResponse({ error: 'project_id, before_image_id and after_image_id are required.' }, 400)
    }
    const metrics = validateMetrics(body.metrics)
    if (!metrics) {
      return jsonResponse({ error: 'The image-processing metrics are missing or inconsistent.' }, 400)
    }
    const accuracy = accuracyFromMetrics(metrics)

    const { data: project } = await admin
      .from('projects')
      .select('id, title, project_category, barangay, location_text, office_id')
      .eq('id', project_id)
      .single()
    if (!project) return jsonResponse({ error: 'Project not found.' }, 404)
    if (callerProfile.role === 'engineering' && callerProfile.office_id !== project.office_id) {
      return jsonResponse({ error: 'You do not have access to this project.' }, 403)
    }

    const { data: images } = await admin
      .from('project_images')
      .select('id, project_id, image_stage, storage_path')
      .in('id', [before_image_id, after_image_id])
    const beforeImage = images?.find((i) => i.id === before_image_id)
    const afterImage = images?.find((i) => i.id === after_image_id)
    if (
      !beforeImage ||
      !afterImage ||
      beforeImage.project_id !== project_id ||
      afterImage.project_id !== project_id ||
      beforeImage.image_stage !== 'BEFORE' ||
      afterImage.image_stage !== 'AFTER'
    ) {
      return jsonResponse({ error: 'Choose one BEFORE and one AFTER photo of this project.' }, 400)
    }

    let aiStatus = 'PROCESSED'
    let aiResult: Record<string, unknown>
    try {
      const apiKey = Deno.env.get('GEMINI_API_KEY')
      if (!apiKey) throw new Error('AI explanation is not configured on the server (missing API key).')

      const load = async (path: string) => {
        const { data: blob, error } = await admin.storage.from('project-images').download(path)
        if (error || !blob) throw new Error('A photo could not be read from storage.')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('A photo is empty or too large.')
        const mime = detectImageMimeType(bytes)
        if (!mime) throw new Error('A photo is not a supported image format.')
        return { mime, data: toBase64(bytes) }
      }
      const [before, after] = await Promise.all([load(beforeImage.storage_path), load(afterImage.storage_path)])
      aiResult = {
        ...(await explainWithGemini(apiKey, buildPrompt(project, accuracy), before, after)),
        model: GEMINI_MODEL,
        analyzed_at: new Date().toISOString(),
      }
    } catch (aiError) {
      aiStatus = 'FAILED'
      aiResult = {
        error: aiError instanceof Error ? aiError.message : 'AI explanation failed.',
        failed_at: new Date().toISOString(),
      }
    }

    const { data: saved, error: saveError } = await admin
      .from('project_before_after_comparisons')
      .insert({
        project_id,
        before_image_id,
        after_image_id,
        accuracy,
        method: 'ORB_RANSAC',
        metrics,
        ai_analysis_status: aiStatus,
        ai_analysis_result: aiResult,
        generated_by: callerData.user.id,
      })
      .select('*')
      .single()
    if (saveError) {
      return jsonResponse({ error: `The comparison could not be saved: ${saveError.message}` }, 500)
    }

    return jsonResponse({ comparison: saved })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})

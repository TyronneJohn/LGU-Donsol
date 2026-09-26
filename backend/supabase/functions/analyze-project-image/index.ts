// AI-assisted image observation for one site-monitoring photo. Called by
// Engineering right after a photo is uploaded (src/utils/imageAnalysis.js ->
// supabase.functions.invoke('analyze-project-image', { body: { image_id } })).
//
// Flow: verify the caller, load the project_images row (service role — RLS
// intentionally forbids uploaders from writing ai_analysis_* themselves, see
// guard_project_image_updates() in 20260811120000_rls_policy_hardening.sql;
// service_role bypasses that trigger via app_is_admin_or_system()), download
// the actual file bytes from Storage, validate them independently of
// whatever the browser claimed, send them to Gemini with a strict
// anti-hallucination prompt, validate Gemini's structured response field by
// field, and write the outcome back to ai_analysis_status /
// ai_analysis_result. Never throws past its own boundary — every path ends
// in a 2xx JSON response with status PROCESSED or FAILED, because a failed
// AI analysis must never be surfaced as a failure of the monitoring update
// that carries it (the photo/update are already saved by the time this
// runs).
//
// Gemini API key is read server-side only, via Deno.env.get('GEMINI_API_KEY')
// (a Supabase Edge Function secret) — never sent to, or readable from, the
// browser bundle.
import { createClient } from 'jsr:@supabase/supabase-js@2'

// Multimodal input + JSON-schema-constrained structured output, available on
// the Gemini free tier. Swap this constant if a newer model should be used.
// gemini-2.5-flash is in its retirement window (Google-announced shutdown,
// already returning HTTP 404 for some callers ahead of the formal date) —
// gemini-3.5-flash is the current GA migration target with the same
// contents/generationConfig.responseSchema request shape.
const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GEMINI_TIMEOUT_MS = 30000
const GEMINI_RETRY_DELAYS_MS = [2000, 5000]

// Independent server-side ceiling — must not simply trust the browser, which
// already enforces the same limit in src/utils/imageProcessing.js.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

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

type AiResult = {
  observed_activity: string
  visible_materials: string[]
  site_condition: string
  potential_issues: string[]
  image_quality: string
  confidence: number
  observation: string
}

// Strict field-by-field validation of Gemini's parsed response. Returns null
// for anything malformed — callers must treat null as "do not save as
// PROCESSED".
function validateAiResult(candidate: unknown): AiResult | null {
  if (!candidate || typeof candidate !== 'object') return null
  const o = candidate as Record<string, unknown>

  const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

  if (typeof o.observed_activity !== 'string') return null
  if (!isStringArray(o.visible_materials)) return null
  if (typeof o.site_condition !== 'string') return null
  if (!isStringArray(o.potential_issues)) return null
  if (typeof o.image_quality !== 'string') return null
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence)) return null
  if (typeof o.observation !== 'string') return null

  return {
    observed_activity: o.observed_activity,
    visible_materials: o.visible_materials,
    site_condition: o.site_condition,
    potential_issues: o.potential_issues,
    image_quality: o.image_quality,
    confidence: Math.min(100, Math.max(0, o.confidence)),
    observation: o.observation,
  }
}

// responseMimeType: 'application/json' is supposed to make this unnecessary,
// but a model that wraps its object in a markdown fence, or puts a stray line
// either side of it, would otherwise fail the parse outright over formatting
// rather than content.
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

// Sniffs the actual downloaded bytes — the browser-supplied MIME type is
// never trusted for this decision. Returns null for anything unrecognized.
function detectImageMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
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

// Chunked to avoid blowing the call stack on String.fromCharCode(...bytes)
// for anything near the 8 MB ceiling.
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function buildPrompt(context: { title: string | null; category: string | null; barangay: string | null; location: string | null }) {
  const contextLines = [
    context.title ? `Project title: ${context.title}` : null,
    context.category ? `Category: ${context.category}` : null,
    context.barangay ? `Barangay: ${context.barangay}` : null,
    context.location ? `Location: ${context.location}` : null,
  ].filter(Boolean)
  const contextText = contextLines.length > 0 ? contextLines.join('\n') : 'No project context was provided.'

  return `You are an assistive image-observation tool inside a local government unit's construction/project monitoring system (Donsol, Sorsogon, Philippines). You are looking at ONE photo submitted by field engineering staff as part of a routine site-monitoring update.

Your output is an AI-ASSISTED OBSERVATION for human review only. It is NOT an official engineering inspection, NOT a certified assessment, and NOT a verification of project completion, status, or authenticity.

Rules you must follow:
- Only describe what is visibly evident in the image itself.
- Do not invent facts that are not visible in the image.
- Do not state an exact construction completion percentage — a single photo cannot establish this.
- Do not state an exact project status (e.g. "on schedule", "delayed", "60% complete") from the image alone.
- Do not invent measurements, dimensions, or quantities.
- Do not invent or guess dates.
- Do not invent or guess costs or monetary figures.
- Do not invent or guess GPS coordinates or precise locations.
- Do not assume the photo is authentic, unaltered, or actually taken at this project's site merely because it is attached to this project's monitoring record.
- The project context below is administrative metadata that you cannot verify from pixels. Do not claim the image proves or confirms the project's title, category, barangay, or location.
- If the image does not provide enough evidence for a field, say so plainly (e.g. "Not enough visual evidence to determine this.") rather than guessing.
- Clearly distinguish what is directly visible from anything you are inferring.
- Use cautious, hedged language ("appears to", "is visible", "cannot be determined from this image alone").

Project context (administrative metadata only, not verified by this image):
${contextText}

Respond with a JSON object matching the required schema and nothing else. Field guidance:
- observed_activity: one or two sentences on what activity/state is visibly evident.
- visible_materials: short list of materials/equipment visibly present (empty array if none identifiable).
- site_condition: one short sentence on the general visible condition of the site.
- potential_issues: short list of visibly evident concerns only (e.g. exposed rebar, standing water, no visible safety gear). Empty array if none are visibly evident — never invent issues to fill this list.
- image_quality: one short phrase on the photo's own quality/clarity for review purposes (lighting, focus, framing).
- confidence: your confidence, 0-100, in the observations above, based solely on image clarity and visible evidence.
- observation: a short overall note that explicitly names the limits of what can be concluded from this single image.`
}

async function markFailed(
  admin: ReturnType<typeof createClient>,
  imageId: string,
  message: string,
) {
  const result = { error: message, failed_at: new Date().toISOString() }
  await admin.from('project_images').update({ ai_analysis_status: 'FAILED', ai_analysis_result: result }).eq('id', imageId)
  return jsonResponse({ status: 'FAILED', result })
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
      .select('role, is_active')
      .eq('id', callerData.user.id)
      .single()

    if (!callerProfile?.is_active || !['engineering', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: 'Only Engineering or an administrator can request image analysis.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const imageId = body?.image_id
    if (!imageId || typeof imageId !== 'string') {
      return jsonResponse({ error: 'image_id is required.' }, 400)
    }

    const { data: image, error: imageError } = await admin
      .from('project_images')
      .select(
        `id, storage_path, uploaded_by, ai_analysis_status, ai_analysis_result,
         project:projects(title, project_category, barangay, location_text, created_by)`,
      )
      .eq('id', imageId)
      .single()

    if (imageError || !image) {
      return jsonResponse({ error: 'Image not found.' }, 404)
    }

    const project = Array.isArray(image.project) ? image.project[0] : image.project
    const isOwner = image.uploaded_by === callerData.user.id || project?.created_by === callerData.user.id
    if (callerProfile.role !== 'admin' && !isOwner) {
      return jsonResponse({ error: 'You do not have access to this image.' }, 403)
    }

    // Idempotency — never re-spend a Gemini call on an already-processed image.
    if (image.ai_analysis_status === 'PROCESSED') {
      return jsonResponse({ status: 'PROCESSED', result: image.ai_analysis_result })
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return await markFailed(admin, imageId, 'AI analysis is not configured on the server (missing API key).')
    }

    const { data: fileBlob, error: downloadError } = await admin.storage
      .from('project-images')
      .download(image.storage_path)
    if (downloadError || !fileBlob) {
      return await markFailed(admin, imageId, 'Could not read the uploaded photo from storage.')
    }

    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    if (bytes.length === 0) {
      return await markFailed(admin, imageId, 'The uploaded file is empty.')
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return await markFailed(admin, imageId, `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MB size limit.`)
    }
    const mimeType = detectImageMimeType(bytes)
    if (!mimeType) {
      return await markFailed(admin, imageId, 'Unsupported or unrecognized image format. Only JPEG, PNG, and WebP are supported.')
    }

    const prompt = buildPrompt({
      title: project?.title ?? null,
      category: project?.project_category ?? null,
      barangay: project?.barangay ?? null,
      location: project?.location_text ?? null,
    })

    const requestBody = JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: toBase64(bytes) } }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        // The analysis itself is short, but this ceiling is shared with
        // whatever reasoning the model does before emitting it — at 1024
        // a thinking model can spend the budget and get cut off partway
        // through the JSON, which arrives here as a parse failure.
        maxOutputTokens: 4096,
        // 3.5 Flash reasons at MEDIUM by default, which is most of the wait
        // for a short, descriptive answer like this one. LOW keeps some
        // reasoning for reading the photo while cutting the latency.
        thinkingConfig: { thinkingLevel: 'LOW' },
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            observed_activity: { type: 'STRING' },
            visible_materials: { type: 'ARRAY', items: { type: 'STRING' } },
            site_condition: { type: 'STRING' },
            potential_issues: { type: 'ARRAY', items: { type: 'STRING' } },
            image_quality: { type: 'STRING' },
            confidence: { type: 'NUMBER' },
            observation: { type: 'STRING' },
          },
          required: [
            'observed_activity',
            'visible_materials',
            'site_condition',
            'potential_issues',
            'image_quality',
            'confidence',
            'observation',
          ],
        },
      },
    })

    // Gemini returns 5xx ("model is overloaded") and occasional 429s in
    // short bursts that clear within seconds. Retrying those — and plain
    // network drops — a couple of times with backoff turns most of them
    // into a success instead of a FAILED photo that needs a manual retry.
    // Timeouts are not retried: another 30 s attempt would risk the Edge
    // Function's own wall-clock limit.
    let geminiResponse: Response | null = null
    for (let attempt = 0; attempt <= GEMINI_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_DELAYS_MS[attempt - 1]))
      const isLastAttempt = attempt === GEMINI_RETRY_DELAYS_MS.length

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
      try {
        geminiResponse = await fetch(GEMINI_API_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: requestBody,
        })
      } catch (fetchError) {
        const isAbort = fetchError instanceof Error && fetchError.name === 'AbortError'
        if (isAbort) return await markFailed(admin, imageId, 'AI analysis timed out.')
        if (isLastAttempt) return await markFailed(admin, imageId, 'Could not reach the Gemini API (network error).')
        continue
      } finally {
        clearTimeout(timeout)
      }

      const isTransient = geminiResponse.status === 429 || geminiResponse.status >= 500
      if (!isTransient || isLastAttempt) break
      await geminiResponse.body?.cancel()
    }
    geminiResponse = geminiResponse!

    if (!geminiResponse.ok) {
      if (geminiResponse.status === 429) {
        return await markFailed(admin, imageId, 'Gemini API rate limit or quota exceeded. Try again later.')
      }
      if (geminiResponse.status === 401 || geminiResponse.status === 403) {
        return await markFailed(admin, imageId, 'Gemini API key is invalid or unauthorized.')
      }
      if (geminiResponse.status >= 500) {
        return await markFailed(admin, imageId, `Gemini API is temporarily unavailable (HTTP ${geminiResponse.status}).`)
      }
      return await markFailed(admin, imageId, `Gemini API request failed (HTTP ${geminiResponse.status}).`)
    }

    const geminiData = await geminiResponse.json().catch(() => null)
    if (!geminiData) {
      return await markFailed(admin, imageId, 'Gemini API returned an unreadable response.')
    }

    if (geminiData.promptFeedback?.blockReason) {
      return await markFailed(admin, imageId, 'The image was blocked by Gemini safety filters and could not be analyzed.')
    }

    const candidate = geminiData.candidates?.[0]
    if (candidate?.finishReason === 'SAFETY') {
      return await markFailed(admin, imageId, 'The image was blocked by Gemini safety filters and could not be analyzed.')
    }

    // The answer is not reliably parts[0]: these models reason before they
    // answer, and a reasoning/thought part can be emitted ahead of the JSON.
    // Reading only the first part then hands JSON.parse a chunk of prose.
    // Join every non-thought text part instead.
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    const rawText = parts
      .filter((part: Record<string, unknown>) => part?.thought !== true && typeof part?.text === 'string')
      .map((part: Record<string, unknown>) => part.text as string)
      .join('')

    if (rawText.trim().length === 0) {
      return await markFailed(admin, imageId, 'Gemini returned an empty analysis.')
    }

    // A response cut off at the token ceiling is truncated mid-object, which
    // is a parse failure with a completely different fix (raise the ceiling)
    // than actually malformed output — worth saying so rather than lumping
    // the two together.
    if (candidate?.finishReason === 'MAX_TOKENS') {
      return await markFailed(admin, imageId, 'Gemini ran out of output tokens before it finished the analysis.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stripJsonWrapper(rawText))
    } catch {
      // Carry an excerpt of what actually came back. Without it, the next
      // occurrence of this is exactly as undiagnosable as the first one was.
      const excerpt = rawText.trim().slice(0, 200).replace(/\s+/g, ' ')
      return await markFailed(admin, imageId, `Gemini returned malformed JSON. Response began: ${excerpt}`)
    }

    const validated = validateAiResult(parsed)
    if (!validated) {
      return await markFailed(admin, imageId, 'Gemini returned an incomplete or malformed analysis.')
    }

    const result = { ...validated, model: GEMINI_MODEL, analyzed_at: new Date().toISOString() }
    const { error: updateError } = await admin
      .from('project_images')
      .update({ ai_analysis_status: 'PROCESSED', ai_analysis_result: result })
      .eq('id', imageId)

    if (updateError) {
      return jsonResponse({ error: 'Analysis succeeded but could not be saved.' }, 500)
    }

    return jsonResponse({ status: 'PROCESSED', result })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})

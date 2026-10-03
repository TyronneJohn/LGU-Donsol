// One AI-assisted analysis for a whole monitoring update. Replaces the
// per-photo analysis (analyze-project-image) for new updates: every photo of
// the update is sent to Gemini together with a selection of photos from ALL
// earlier updates of the same project, and one combined result comes back —
// what the new photos show, plus how they compare with the earlier ones.
//
// Called automatically by Engineering right after an update is submitted,
// and on demand by the "Compare with previous photos" button
// (src/utils/imageAnalysis.js -> analyzeProjectUpdate). The result is saved
// on project_updates.ai_analysis_* so the button never pays for a second
// Gemini call once an update has been analyzed.
//
// Same ground rules as analyze-project-image: verify the caller, read the
// actual file bytes from Storage, strict anti-hallucination prompt, validate
// Gemini's structured response field by field, never throw past this
// boundary. GEMINI_API_KEY is a server-side secret only.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GEMINI_TIMEOUT_MS = 60000
const GEMINI_RETRY_DELAYS_MS = [2000, 5000]

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
// Gemini caps an inline request at ~20 MB, and base64 adds a third on top of
// the raw bytes. Photos past this budget are skipped (newest-first priority).
const MAX_TOTAL_BYTES = 14 * 1024 * 1024
const MAX_CURRENT_PHOTOS = 4
const MAX_PREVIOUS_PHOTOS = 8
// A PENDING analysis younger than this is assumed to still be running.
const PENDING_STALE_MS = 3 * 60 * 1000

const SAME_SITE_VALUES = ['LIKELY_SAME', 'POSSIBLY_DIFFERENT', 'CANNOT_DETERMINE']
const PROGRESS_CONSISTENCY_VALUES = ['CONSISTENT', 'INCONSISTENT', 'CANNOT_DETERMINE']

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

type UpdateRow = {
  id: string
  report_date: string | null
  progress_percentage: number | string | null
  created_at: string
}

type ImageRow = {
  id: string
  project_update_id: string
  storage_path: string
  created_at: string
}

type LoadedPhoto = {
  id: string
  updateId: string
  label: string
  mimeType: string
  base64: string
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

function validateResult(candidate: unknown, expectComparison: boolean) {
  if (!candidate || typeof candidate !== 'object') return null
  const o = candidate as Record<string, unknown>

  if (typeof o.summary !== 'string') return null
  if (!isStringArray(o.visible_materials)) return null
  if (typeof o.site_condition !== 'string') return null
  if (!isStringArray(o.potential_issues)) return null
  if (typeof o.image_quality !== 'string') return null
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence)) return null
  if (typeof o.observation !== 'string') return null

  let comparison = null
  if (expectComparison) {
    const c = o.comparison as Record<string, unknown> | undefined
    if (
      !c ||
      typeof c.same_site !== 'string' ||
      !SAME_SITE_VALUES.includes(c.same_site) ||
      typeof c.same_site_reason !== 'string' ||
      !isStringArray(c.changes_since_previous) ||
      typeof c.progress_consistency !== 'string' ||
      !PROGRESS_CONSISTENCY_VALUES.includes(c.progress_consistency) ||
      typeof c.progress_reason !== 'string' ||
      typeof c.timeline_summary !== 'string'
    ) {
      return null
    }
    comparison = {
      same_site: c.same_site,
      same_site_reason: c.same_site_reason,
      changes_since_previous: c.changes_since_previous,
      progress_consistency: c.progress_consistency,
      progress_reason: c.progress_reason,
      timeline_summary: c.timeline_summary,
    }
  }

  return {
    summary: o.summary,
    visible_materials: o.visible_materials,
    site_condition: o.site_condition,
    potential_issues: o.potential_issues,
    image_quality: o.image_quality,
    confidence: Math.min(100, Math.max(0, o.confidence)),
    observation: o.observation,
    comparison,
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

function describeUpdate(update: UpdateRow) {
  const progress = update.progress_percentage != null ? `${Number(update.progress_percentage)}%` : 'progress not recorded'
  return `${update.report_date ?? 'date not recorded'}, reported ${progress}`
}

// Earlier updates, oldest first. Ordered like the app lists them: by report
// date, then by when they were filed.
function compareUpdates(a: UpdateRow, b: UpdateRow) {
  const byDate = (a.report_date ?? '').localeCompare(b.report_date ?? '')
  return byDate !== 0 ? byDate : a.created_at.localeCompare(b.created_at)
}

// Which earlier photos to send, within MAX_PREVIOUS_PHOTOS: up to 3 from the
// most recent earlier update, up to 2 from the very first (the baseline),
// then one from each update in between, newest first. Returned in priority
// order, which is also the order the byte budget is spent in.
function pickPreviousPhotos(previousUpdates: UpdateRow[], imagesByUpdate: Map<string, ImageRow[]>) {
  const withPhotos = previousUpdates.filter((u) => (imagesByUpdate.get(u.id) ?? []).length > 0)
  if (withPhotos.length === 0) return []

  const picked: ImageRow[] = []
  const take = (update: UpdateRow, count: number) => {
    for (const image of (imagesByUpdate.get(update.id) ?? []).slice(0, count)) {
      if (picked.length < MAX_PREVIOUS_PHOTOS && !picked.includes(image)) picked.push(image)
    }
  }

  const latest = withPhotos[withPhotos.length - 1]
  const first = withPhotos[0]
  take(latest, 3)
  if (first !== latest) take(first, 2)
  for (const update of withPhotos.slice(1, -1).reverse()) take(update, 1)
  return picked
}

function buildPrompt(params: {
  title: string | null
  category: string | null
  barangay: string | null
  location: string | null
  current: UpdateRow
  currentCount: number
  previousUpdates: UpdateRow[]
}) {
  const contextLines = [
    params.title ? `Project title: ${params.title}` : null,
    params.category ? `Category: ${params.category}` : null,
    params.barangay ? `Barangay: ${params.barangay}` : null,
    params.location ? `Location: ${params.location}` : null,
  ].filter(Boolean)
  const contextText = contextLines.length > 0 ? contextLines.join('\n') : 'No project context was provided.'
  const hasPrevious = params.previousUpdates.length > 0

  const timeline = hasPrevious
    ? params.previousUpdates.map((u) => `- EARLIER update: ${describeUpdate(u)}`).join('\n') +
      `\n- NEW update: ${describeUpdate(params.current)}`
    : `- NEW update: ${describeUpdate(params.current)} (no earlier photos exist)`

  const comparisonText = hasPrevious
    ? `
- comparison.same_site: LIKELY_SAME if distinctive fixed features (road alignment, structures, trees, terrain, landmarks) visibly match between the NEW and EARLIER photos; POSSIBLY_DIFFERENT if visible features clearly conflict; CANNOT_DETERMINE if angles, framing or quality do not allow a judgment. Different camera angles of the same site are normal — do not call a site different merely because the angle changed.
- comparison.same_site_reason: one sentence naming the specific visible features behind that judgment.
- comparison.changes_since_previous: short list of physical changes visibly evident between the most recent EARLIER photos and the NEW photos. Empty array if no change is visible — never invent changes.
- comparison.progress_consistency: whether the visible change is plausibly in line with the change in reported progress across the timeline above. CONSISTENT, INCONSISTENT (e.g. a large reported increase but no visible new work), or CANNOT_DETERMINE. Photos cannot measure a percentage — judge only plausibility, never state a percentage of your own.
- comparison.progress_reason: one sentence explaining that judgment.
- comparison.timeline_summary: two or three hedged sentences describing how the site visibly changed across ALL the photos, oldest to newest.`
    : ''

  return `You are an assistive image-observation tool inside a local government unit's construction/project monitoring system (Donsol, Sorsogon, Philippines). You are looking at site photos submitted by field engineering staff as part of routine monitoring updates for ONE project.

Your output is an AI-ASSISTED OBSERVATION for human review only. It is NOT an official engineering inspection, NOT a certified assessment, and NOT a verification of project completion, status, or authenticity.

Rules you must follow:
- Only describe what is visibly evident in the images themselves.
- Do not invent facts, measurements, quantities, dates, costs, GPS coordinates or precise locations.
- Do not state an exact construction completion percentage or project status (e.g. "on schedule", "delayed") from the images.
- Do not assume the photos are authentic, unaltered, or actually taken at this project's site merely because they are attached to this project's records.
- The project context below is administrative metadata that you cannot verify from pixels. Do not claim the images prove it.
- If the images do not provide enough evidence for a field, say so plainly rather than guessing.
- Use cautious, hedged language ("appears to", "is visible", "cannot be determined from these images alone").

Project context (administrative metadata only, not verified by these images):
${contextText}

Monitoring timeline (reported by staff, not verified):
${timeline}

Each photo below is preceded by a label saying whether it is an EARLIER photo or a NEW photo, and which update it belongs to. The NEW update has ${params.currentCount} photo(s).

Respond with a JSON object matching the required schema and nothing else. Field guidance:
- summary: one or two sentences on what activity/state is visibly evident in the NEW photos, taken together.
- visible_materials: short list of materials/equipment visibly present in the NEW photos (empty array if none identifiable).
- site_condition: one short sentence on the general visible condition of the site in the NEW photos.
- potential_issues: short list of visibly evident concerns in the NEW photos only. Empty array if none — never invent issues.
- image_quality: one short phrase on the NEW photos' quality/clarity for review purposes.
- confidence: your confidence, 0-100, in the observations above, based solely on image clarity and visible evidence.
- observation: a short overall note naming the limits of what can be concluded from these photos.${comparisonText}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey)

  let updateId: string | null = null
  async function fail(message: string) {
    const result = { error: message, failed_at: new Date().toISOString() }
    if (updateId) {
      await admin.from('project_updates').update({ ai_analysis_status: 'FAILED', ai_analysis_result: result }).eq('id', updateId)
    }
    return jsonResponse({ status: 'FAILED', result })
  }

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

    if (!callerProfile?.is_active || !['engineering', 'mpdc', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: 'Only Engineering, MPDC, or an administrator can request this analysis.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    if (!body?.update_id || typeof body.update_id !== 'string') {
      return jsonResponse({ error: 'update_id is required.' }, 400)
    }

    const { data: update, error: updateError } = await admin
      .from('project_updates')
      .select(
        `id, project_id, report_date, progress_percentage, created_at, ai_analysis_status, ai_analysis_result,
         project:projects(title, project_category, barangay, location_text, office_id)`,
      )
      .eq('id', body.update_id)
      .single()

    if (updateError || !update) {
      return jsonResponse({ error: 'Monitoring update not found.' }, 404)
    }

    const project = Array.isArray(update.project) ? update.project[0] : update.project
    // Engineering sees only its own office's projects (same rule as the
    // Site Monitoring pages); MPDC and admin oversee every project.
    if (callerProfile.role === 'engineering' && callerProfile.office_id !== project?.office_id) {
      return jsonResponse({ error: 'You do not have access to this project.' }, 403)
    }

    // Saved result: never re-spend a Gemini call.
    if (update.ai_analysis_status === 'PROCESSED') {
      return jsonResponse({ status: 'PROCESSED', result: update.ai_analysis_result })
    }
    const startedAt = Date.parse(update.ai_analysis_result?.started_at ?? '')
    if (update.ai_analysis_status === 'PENDING' && Date.now() - startedAt < PENDING_STALE_MS) {
      return jsonResponse({ status: 'PENDING', result: update.ai_analysis_result })
    }

    const [{ data: allUpdates }, { data: allImages }] = await Promise.all([
      admin
        .from('project_updates')
        .select('id, report_date, progress_percentage, created_at')
        .eq('project_id', update.project_id),
      admin
        .from('project_images')
        .select('id, project_update_id, storage_path, created_at')
        .eq('project_id', update.project_id)
        .not('project_update_id', 'is', null)
        .neq('image_stage', 'ISSUE')
        .order('created_at', { ascending: true }),
    ])

    const imagesByUpdate = new Map<string, ImageRow[]>()
    for (const image of (allImages ?? []) as ImageRow[]) {
      if (!imagesByUpdate.has(image.project_update_id)) imagesByUpdate.set(image.project_update_id, [])
      imagesByUpdate.get(image.project_update_id)!.push(image)
    }

    const currentImages = (imagesByUpdate.get(update.id) ?? []).slice(0, MAX_CURRENT_PHOTOS)
    if (currentImages.length === 0) {
      return jsonResponse({ status: 'FAILED', result: { error: 'This update has no photos to analyze.' } })
    }

    const current = update as UpdateRow
    const previousUpdates = ((allUpdates ?? []) as UpdateRow[])
      .filter((u) => u.id !== update.id && compareUpdates(u, current) < 0)
      .sort(compareUpdates)
    const updatesById = new Map(previousUpdates.map((u) => [u.id, u]))

    updateId = update.id
    await admin
      .from('project_updates')
      .update({ ai_analysis_status: 'PENDING', ai_analysis_result: { started_at: new Date().toISOString() } })
      .eq('id', updateId)

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      return await fail('AI analysis is not configured on the server (missing API key).')
    }

    // Download in priority order (new photos first), spending the byte
    // budget; anything unreadable or over budget is skipped, not fatal.
    let budget = MAX_TOTAL_BYTES
    async function load(image: ImageRow, label: string): Promise<LoadedPhoto | null> {
      const { data: blob, error } = await admin.storage.from('project-images').download(image.storage_path)
      if (error || !blob) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.length > budget) return null
      const mimeType = detectImageMimeType(bytes)
      if (!mimeType) return null
      budget -= bytes.length
      return { id: image.id, updateId: image.project_update_id, label, mimeType, base64: toBase64(bytes) }
    }

    const currentPhotos: LoadedPhoto[] = []
    for (const [index, image] of currentImages.entries()) {
      const photo = await load(image, `NEW photo ${index + 1} (update of ${describeUpdate(current)})`)
      if (photo) currentPhotos.push(photo)
    }
    if (currentPhotos.length === 0) {
      return await fail('The photos of this update could not be read from storage.')
    }

    const previousPhotos: LoadedPhoto[] = []
    for (const image of pickPreviousPhotos(previousUpdates, imagesByUpdate)) {
      const source = updatesById.get(image.project_update_id)!
      const photo = await load(image, `EARLIER photo (update of ${describeUpdate(source)})`)
      if (photo) previousPhotos.push(photo)
    }
    // Shown to the model oldest first, so the photos read as a timeline.
    const updateOrder = new Map(previousUpdates.map((u, index) => [u.id, index]))
    previousPhotos.sort((a, b) => updateOrder.get(a.updateId)! - updateOrder.get(b.updateId)!)

    const usedPreviousUpdates = previousUpdates.filter((u) => previousPhotos.some((p) => p.updateId === u.id))
    const hasPrevious = previousPhotos.length > 0

    const prompt = buildPrompt({
      title: project?.title ?? null,
      category: project?.project_category ?? null,
      barangay: project?.barangay ?? null,
      location: project?.location_text ?? null,
      current,
      currentCount: currentPhotos.length,
      previousUpdates: usedPreviousUpdates,
    })

    const parts: unknown[] = [{ text: prompt }]
    for (const photo of [...previousPhotos, ...currentPhotos]) {
      parts.push({ text: photo.label })
      parts.push({ inline_data: { mime_type: photo.mimeType, data: photo.base64 } })
    }

    const properties: Record<string, unknown> = {
      summary: { type: 'STRING' },
      visible_materials: { type: 'ARRAY', items: { type: 'STRING' } },
      site_condition: { type: 'STRING' },
      potential_issues: { type: 'ARRAY', items: { type: 'STRING' } },
      image_quality: { type: 'STRING' },
      confidence: { type: 'NUMBER' },
      observation: { type: 'STRING' },
    }
    const required = [
      'summary',
      'visible_materials',
      'site_condition',
      'potential_issues',
      'image_quality',
      'confidence',
      'observation',
    ]
    if (hasPrevious) {
      properties.comparison = {
        type: 'OBJECT',
        properties: {
          same_site: { type: 'STRING', enum: SAME_SITE_VALUES },
          same_site_reason: { type: 'STRING' },
          changes_since_previous: { type: 'ARRAY', items: { type: 'STRING' } },
          progress_consistency: { type: 'STRING', enum: PROGRESS_CONSISTENCY_VALUES },
          progress_reason: { type: 'STRING' },
          timeline_summary: { type: 'STRING' },
        },
        required: [
          'same_site',
          'same_site_reason',
          'changes_since_previous',
          'progress_consistency',
          'progress_reason',
          'timeline_summary',
        ],
      }
      required.push('comparison')
    }

    const requestBody = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'LOW' },
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties, required },
      },
    })

    // Same retry policy as analyze-project-image: transient 429/5xx and
    // network drops are retried with backoff; timeouts are not.
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
        if (isAbort) return await fail('AI analysis timed out.')
        if (isLastAttempt) return await fail('Could not reach the Gemini API (network error).')
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
      if (geminiResponse.status === 429) return await fail('Gemini API rate limit or quota exceeded. Try again later.')
      if (geminiResponse.status === 401 || geminiResponse.status === 403) {
        return await fail('Gemini API key is invalid or unauthorized.')
      }
      if (geminiResponse.status === 400) {
        return await fail('Gemini rejected the request (the photos may be too large together).')
      }
      if (geminiResponse.status >= 500) {
        return await fail(`Gemini API is temporarily unavailable (HTTP ${geminiResponse.status}).`)
      }
      return await fail(`Gemini API request failed (HTTP ${geminiResponse.status}).`)
    }

    const geminiData = await geminiResponse.json().catch(() => null)
    if (!geminiData) return await fail('Gemini API returned an unreadable response.')
    if (geminiData.promptFeedback?.blockReason) {
      return await fail('The photos were blocked by Gemini safety filters and could not be analyzed.')
    }

    const candidate = geminiData.candidates?.[0]
    if (candidate?.finishReason === 'SAFETY') {
      return await fail('The photos were blocked by Gemini safety filters and could not be analyzed.')
    }

    const responseParts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
    const rawText = responseParts
      .filter((part: Record<string, unknown>) => part?.thought !== true && typeof part?.text === 'string')
      .map((part: Record<string, unknown>) => part.text as string)
      .join('')

    if (rawText.trim().length === 0) return await fail('Gemini returned an empty analysis.')
    if (candidate?.finishReason === 'MAX_TOKENS') {
      return await fail('Gemini ran out of output tokens before it finished the analysis.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stripJsonWrapper(rawText))
    } catch {
      const excerpt = rawText.trim().slice(0, 200).replace(/\s+/g, ' ')
      return await fail(`Gemini returned malformed JSON. Response began: ${excerpt}`)
    }

    const validated = validateResult(parsed, hasPrevious)
    if (!validated) return await fail('Gemini returned an incomplete or malformed analysis.')

    const result = {
      ...validated,
      comparison_status: hasPrevious ? 'COMPARED' : 'NO_PREVIOUS_PHOTOS',
      current_image_ids: currentPhotos.map((p) => p.id),
      previous_image_ids: previousPhotos.map((p) => p.id),
      model: GEMINI_MODEL,
      analyzed_at: new Date().toISOString(),
    }

    const { error: saveError } = await admin
      .from('project_updates')
      .update({ ai_analysis_status: 'PROCESSED', ai_analysis_result: result })
      .eq('id', updateId)
    if (saveError) {
      return jsonResponse({ error: 'Analysis succeeded but could not be saved.' }, 500)
    }

    return jsonResponse({ status: 'PROCESSED', result })
  } catch (error) {
    return await fail(error instanceof Error ? error.message : 'Unexpected error.')
  }
})

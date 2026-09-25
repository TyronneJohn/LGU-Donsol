// Optional, advisory-only AI read of a site monitoring photo — NEVER a
// substitute for the Engineer's own reported progress_percentage. A single
// photo carries no information about a project's full scope of work or
// Bill of Quantities, so this never asks the model to invent an absolute
// completion percentage on its own.
//
// Instead, when the project already has an earlier update with a photo,
// this compares the NEW photo against that PREVIOUS one (same project) —
// the previous photo's already-confirmed progress_percentage is the
// reference point, and the model's job is only to sanity-check whether the
// new photo's visible change looks roughly consistent with the reported
// jump from that figure to the new one, not to produce its own number. No
// prior photo (first-ever update) falls back to a plain single-photo
// qualitative read. This is what the panel specifically asked for:
// comparing projects/photos against each other rather than judging one
// photo in isolation.
//
// Called fire-and-forget by the client right after a photo upload succeeds
// (see ProjectMonitoringDetail.jsx); failure here never blocks or
// invalidates the monitoring update itself.
//
// Requires the ANTHROPIC_API_KEY secret to be set on this Supabase project
// (`supabase secrets set ANTHROPIC_API_KEY=...`) — without it, this function
// returns a 500 and the photo simply has no AI observation, which the UI
// already treats as a normal, unremarkable state (see ai_reviewed_at being
// null).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'

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

const OUTPUT_SHAPE_INSTRUCTIONS = `Respond with ONLY valid JSON, no other text, in exactly this shape:
{"stage_observation": string, "anomaly_detected": boolean, "anomaly_notes": string | null}`

const SINGLE_PHOTO_PROMPT = `You are assisting a Philippine local government engineering office reviewing a construction site monitoring photo. This is the first recorded photo for this project, so there is nothing yet to compare it against.

${OUTPUT_SHAPE_INSTRUCTIONS}

- stage_observation: one short, plain sentence describing the construction stage or activity visibly shown (e.g. "Foundation excavation in progress", "Roofing installation visible"). If the photo doesn't show construction work at all, say so plainly.
- anomaly_detected: true only if something in the photo looks like it warrants a second look — a visible defect, a safety hazard, work that looks incomplete or substandard for its apparent stage, or the photo not actually matching a construction site. Otherwise false.
- anomaly_notes: one short sentence explaining the anomaly if anomaly_detected is true, otherwise null.

IMPORTANT: Do not estimate or state a percentage of physical completion. You have no access to this project's approved scope of work, quantities, or budget breakdown, so any percentage you gave would be an unsupported guess, not a measurement — the Engineer's own reported figure is the only authoritative one. Stay strictly within the JSON shape above.`

function comparativePrompt(previousPercentage: number, newPercentage: number): string {
  return `You are assisting a Philippine local government engineering office reviewing site monitoring photos. You are shown two photos of the SAME project: the PREVIOUS photo (already confirmed by the Engineer at ${previousPercentage}% physical progress) and the NEW photo just submitted (the Engineer now reports ${newPercentage}% progress).

Your job is only to sanity-check whether the VISIBLE CHANGE between the two photos looks roughly consistent with that reported jump (${previousPercentage}% -> ${newPercentage}%) — you are NOT estimating your own percentage from scratch. You have no access to the project's full scope of work or quantities, so an independent percentage from you would be an unsupported guess; comparing relative visible change against an already-confirmed anchor is the only thing you're being asked to judge.

${OUTPUT_SHAPE_INSTRUCTIONS}

- stage_observation: one short, plain sentence describing what visibly changed (or didn't) between the two photos (e.g. "Walls that were bare framing in the previous photo now appear fully enclosed", "Little visible change from the previous photo").
- anomaly_detected: true if the visible change looks clearly inconsistent with the reported jump — e.g. the photos look nearly identical despite a large reported jump, or the new photo looks like it represents far less (or implausibly more) progress than the reported percentages would suggest, or either photo shows a visible defect/safety hazard/substandard work. Otherwise false.
- anomaly_notes: one short sentence explaining the inconsistency or issue if anomaly_detected is true, otherwise null.

IMPORTANT: Never state your own percentage of completion in stage_observation or anomaly_notes — only describe the visible change and whether it seems consistent with the reported figures. Stay strictly within the JSON shape above.`
}

async function downloadAsBase64(
  adminClient: ReturnType<typeof createClient>,
  storagePath: string,
): Promise<{ base64: string; mimeType: string } | null> {
  const { data: fileData, error } = await adminClient.storage.from('project-images').download(storagePath)
  if (error || !fileData) return null

  const mimeType = fileData.type || 'image/jpeg'
  const bytes = new Uint8Array(await fileData.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { base64: btoa(binary), mimeType }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY is not configured for this project.' }, 500)
    }

    // Verify the caller is an authenticated, active staff member before
    // spending an API call on their behalf — mirrors create-staff-account's
    // pattern of a caller-scoped client for auth, then a service-role client
    // for the actual work (needed here to read the private image bucket and
    // to write the AI-only columns past guard_project_image_updates).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData?.user) {
      return jsonResponse({ error: 'Not authenticated.' }, 401)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerData.user.id)
      .single()

    if (profileError || !callerProfile?.role || !callerProfile.is_active) {
      return jsonResponse({ error: 'Only active staff may request photo analysis.' }, 403)
    }

    const body = await req.json()
    const { image_id } = body ?? {}
    if (!image_id) {
      return jsonResponse({ error: 'image_id is required.' }, 400)
    }

    const { data: image, error: imageError } = await adminClient
      .from('project_images')
      .select('id, storage_path, project_id, project_update_id')
      .eq('id', image_id)
      .single()

    if (imageError || !image) {
      return jsonResponse({ error: 'Image not found.' }, 404)
    }

    const currentPhoto = await downloadAsBase64(adminClient, image.storage_path)
    if (!currentPhoto) {
      return jsonResponse({ error: 'Could not read the image file.' }, 500)
    }

    // Look for a comparison reference: the current update's own reported
    // progress, and the most recent EARLIER update on the same project that
    // has a photo. Both must exist for a comparative prompt — otherwise
    // this falls back to the single-photo read.
    let referencePhoto: { base64: string; mimeType: string } | null = null
    let previousPercentage: number | null = null
    let newPercentage: number | null = null

    if (image.project_update_id) {
      const { data: currentUpdate } = await adminClient
        .from('project_updates')
        .select('id, progress_percentage, created_at')
        .eq('id', image.project_update_id)
        .maybeSingle()

      if (currentUpdate?.progress_percentage != null) {
        newPercentage = currentUpdate.progress_percentage

        const { data: priorUpdate } = await adminClient
          .from('project_updates')
          .select('id, progress_percentage')
          .eq('project_id', image.project_id)
          .lt('created_at', currentUpdate.created_at)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (priorUpdate?.progress_percentage != null) {
          const { data: priorImage } = await adminClient
            .from('project_images')
            .select('storage_path')
            .eq('project_update_id', priorUpdate.id)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (priorImage?.storage_path) {
            referencePhoto = await downloadAsBase64(adminClient, priorImage.storage_path)
            if (referencePhoto) previousPercentage = priorUpdate.progress_percentage
          }
        }
      }
    }

    const hasComparison = referencePhoto && previousPercentage != null && newPercentage != null

    const content = hasComparison
      ? [
          { type: 'text', text: 'PREVIOUS photo (earlier, already-confirmed progress):' },
          { type: 'image', source: { type: 'base64', media_type: referencePhoto!.mimeType, data: referencePhoto!.base64 } },
          { type: 'text', text: 'NEW photo (just submitted):' },
          { type: 'image', source: { type: 'base64', media_type: currentPhoto.mimeType, data: currentPhoto.base64 } },
          { type: 'text', text: comparativePrompt(previousPercentage!, newPercentage!) },
        ]
      : [
          { type: 'image', source: { type: 'base64', media_type: currentPhoto.mimeType, data: currentPhoto.base64 } },
          { type: 'text', text: SINGLE_PHOTO_PROMPT },
        ]

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text()
      return jsonResponse({ error: `Anthropic API error: ${errText}` }, 502)
    }

    const anthropicBody = await anthropicResponse.json()
    const rawText = anthropicBody?.content?.[0]?.text ?? ''

    let parsed: { stage_observation?: string; anomaly_detected?: boolean; anomaly_notes?: string | null }
    try {
      // Models occasionally wrap JSON in a code fence despite instructions —
      // strip that before parsing rather than failing the whole analysis.
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      return jsonResponse({ error: 'Could not parse the AI response.', raw: rawText }, 502)
    }

    const { error: updateError } = await adminClient
      .from('project_images')
      .update({
        ai_stage_observation: parsed.stage_observation ?? null,
        ai_anomaly_detected: Boolean(parsed.anomaly_detected),
        ai_anomaly_notes: parsed.anomaly_notes ?? null,
        ai_reviewed_at: new Date().toISOString(),
      })
      .eq('id', image_id)

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500)
    }

    return jsonResponse({ ok: true, compared: hasComparison, ...parsed })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})

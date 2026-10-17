// Reads a Program of Works file (PDF or photo/scan) with Gemini and returns
// its contents as structured data, so Engineering doesn't have to retype the
// Bill of Quantities, materials, manpower and equipment by hand.
//
// Nothing is saved here: the result only pre-fills the POW form on
// ProjectReviewDetail.jsx, where Engineering checks and corrects every value
// before submitting. submit_program_of_works() then recomputes all totals, so
// an extraction mistake in an amount can't end up stored as the ABC.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GEMINI_MODEL = 'gemini-3.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
const GEMINI_TIMEOUT_MS = 90000
const GEMINI_RETRY_DELAYS_MS = [2000, 5000]
const MAX_FILE_BYTES = 10 * 1024 * 1024
const SUPPORTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

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

const PROMPT = `You are reading a Philippine local government "Program of Works" (POW) document for a construction project.
Extract its contents exactly as written. Do not invent, estimate or correct any value. If a field is not in the document, use an empty string, 0 or an empty array.

Fields:
- project_name, location, scope_description (length/width/area/thickness lines combined into one line), mode_of_implementation, duration_days (number), date_prepared (YYYY-MM-DD).
- items: every Bill of Quantities / Scope of Work line: item_no, description, quantity (number), unit, unit_cost (number). Do NOT include total or subtotal rows.
- overhead_pct, profit_pct, vat_pct: the percentages in the Summary of Cost (e.g. 8, 8, 5). 0 if not stated.
- total_cost: the Total Estimated Project Cost / ABC as written (number), used only to check the extraction.
- schedule_periods: the column labels of the Work Schedule table (e.g. "WK 1-2"), left to right. Empty if there is no schedule.
- schedule: one entry per schedule row: item_no and values (one number per period, 0 for a dash/blank).
- materials: name, quantity (number), unit, remarks.
- manpower: role and count, one entry per role (e.g. "4 Skilled Workers" -> role "Skilled Worker", count 4).
- equipment: name and count, one entry per type.
- notes: the document's notes section as plain text.

Numbers must be plain numbers without commas or currency symbols.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    project_name: { type: 'STRING' },
    location: { type: 'STRING' },
    scope_description: { type: 'STRING' },
    mode_of_implementation: { type: 'STRING' },
    duration_days: { type: 'NUMBER' },
    date_prepared: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_no: { type: 'STRING' },
          description: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          unit_cost: { type: 'NUMBER' },
        },
        required: ['item_no', 'description', 'quantity', 'unit', 'unit_cost'],
      },
    },
    overhead_pct: { type: 'NUMBER' },
    profit_pct: { type: 'NUMBER' },
    vat_pct: { type: 'NUMBER' },
    total_cost: { type: 'NUMBER' },
    schedule_periods: { type: 'ARRAY', items: { type: 'STRING' } },
    schedule: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item_no: { type: 'STRING' },
          values: { type: 'ARRAY', items: { type: 'NUMBER' } },
        },
        required: ['item_no', 'values'],
      },
    },
    materials: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          remarks: { type: 'STRING' },
        },
        required: ['name', 'quantity', 'unit'],
      },
    },
    manpower: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { role: { type: 'STRING' }, count: { type: 'NUMBER' } },
        required: ['role', 'count'],
      },
    },
    equipment: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, count: { type: 'NUMBER' } },
        required: ['name', 'count'],
      },
    },
    notes: { type: 'STRING' },
  },
  required: ['items', 'overhead_pct', 'profit_pct', 'vat_pct', 'materials', 'manpower', 'equipment'],
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
    const { data: profile } = await admin
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerData.user.id)
      .single()
    if (!profile?.is_active || !['engineering', 'admin'].includes(profile.role)) {
      return jsonResponse({ error: 'Only Engineering can extract a Program of Works.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const mimeType = typeof body?.mime_type === 'string' ? body.mime_type : ''
    const fileBase64 = typeof body?.file_base64 === 'string' ? body.file_base64 : ''
    if (!SUPPORTED_TYPES.includes(mimeType)) {
      return jsonResponse({ error: 'Only PDF, JPG, PNG or WebP files can be read automatically. Enter the details by hand instead.' }, 400)
    }
    if (!fileBase64 || fileBase64.length * 0.75 > MAX_FILE_BYTES) {
      return jsonResponse({ error: 'The file is empty or larger than 10 MB.' }, 400)
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) return jsonResponse({ error: 'AI extraction is not configured on the server (missing API key).' }, 500)

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: fileBase64 } }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingLevel: 'LOW' },
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
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
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return jsonResponse({ error: 'Reading the file timed out. Try again.' }, 504)
        }
        if (isLastAttempt) return jsonResponse({ error: 'Could not reach the Gemini API (network error).' }, 502)
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
      const message =
        response.status === 429
          ? 'Gemini API rate limit or quota exceeded. Try again later.'
          : response.status === 401 || response.status === 403
            ? 'Gemini API key is invalid or unauthorized.'
            : `Gemini API request failed (HTTP ${response.status}).`
      return jsonResponse({ error: message }, 502)
    }

    const data = await response.json().catch(() => null)
    const candidate = data?.candidates?.[0]
    const rawText = (Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
      .filter((part: Record<string, unknown>) => part?.thought !== true && typeof part?.text === 'string')
      .map((part: Record<string, unknown>) => part.text as string)
      .join('')
    if (!rawText.trim()) return jsonResponse({ error: 'The file could not be read. Enter the details by hand.' }, 422)
    if (candidate?.finishReason === 'MAX_TOKENS') {
      return jsonResponse({ error: 'The document is too long to read in one go. Enter the remaining details by hand.' }, 422)
    }

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(stripJsonWrapper(rawText))
    } catch {
      return jsonResponse({ error: 'The AI returned an unreadable result. Try again.' }, 502)
    }
    if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
      return jsonResponse({ error: 'No Bill of Quantities was found in this file.' }, 422)
    }

    return jsonResponse({ extracted, model: GEMINI_MODEL })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})

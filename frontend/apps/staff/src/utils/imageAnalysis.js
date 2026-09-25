// Client-side entry point for the real Gemini-backed AI image analysis. This
// only invokes the analyze-project-image Supabase Edge Function — it never
// talks to Gemini directly and never sees GEMINI_API_KEY, which is read
// server-side only (Deno.env.get('GEMINI_API_KEY') in the Edge Function).
//
// Never throws: a failure to even reach the Edge Function (e.g. network
// drop) is reported back as an ordinary { status: 'FAILED', result } outcome,
// same shape as a Gemini-side failure the function itself handles. Callers
// (the Engineering upload flow) can treat every outcome uniformly and must
// never let this fail the photo/monitoring-update save that already
// happened before this is called.
import { supabase } from '@shared/lib/supabaseClient'

export async function analyzeProjectImage(imageId) {
  try {
    const { data, error } = await supabase.functions.invoke('analyze-project-image', {
      body: { image_id: imageId },
    })
    if (error) {
      return { status: 'FAILED', result: { error: error.message ?? 'AI analysis request failed.' } }
    }
    return data
  } catch (err) {
    return { status: 'FAILED', result: { error: err?.message ?? 'AI analysis request failed.' } }
  }
}

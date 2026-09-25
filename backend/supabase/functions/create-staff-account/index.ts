// Creates a login (auth user + profile) for one of the three offices
// (Engineering, MPDC, BAC). Admin-only. Runs with the service role key,
// which is why this can never move into the client bundle.
//
// The UI only collects email, password, and office — role isn't a separate
// input. It's derived here from the chosen office's code, since each of the
// three seeded offices maps 1:1 to a login role. An office added later that
// isn't one of those three simply can't have a login created for it here.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const OFFICE_CODE_TO_ROLE: Record<string, string> = {
  ENGG: 'engineering',
  MPDC: 'mpdc',
  BAC: 'bac',
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Verify the caller is an authenticated admin before doing anything else.
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

    if (profileError || callerProfile?.role !== 'admin' || !callerProfile.is_active) {
      return jsonResponse({ error: 'Only administrators can create staff accounts.' }, 403)
    }

    const body = await req.json()
    const { email, password, office_id } = body ?? {}

    if (!email || !password || !office_id) {
      return jsonResponse({ error: 'Email, password, and office are required.' }, 400)
    }
    if (password.length < 6) {
      return jsonResponse({ error: 'Password must be at least 6 characters.' }, 400)
    }

    const { data: office, error: officeError } = await adminClient
      .from('offices')
      .select('code')
      .eq('id', office_id)
      .single()

    if (officeError || !office) {
      return jsonResponse({ error: 'Office not found.' }, 400)
    }

    const role = OFFICE_CODE_TO_ROLE[office.code]
    if (!role) {
      return jsonResponse({ error: 'This office cannot have a staff login created for it.' }, 400)
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError || !created?.user) {
      return jsonResponse({ error: createError?.message ?? 'Could not create the account.' }, 400)
    }

    // The on_auth_user_created trigger already inserted a role-less profile
    // row for this user — fill in role/office now.
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ role, office_id })
      .eq('id', created.user.id)

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 400)
    }

    return jsonResponse({ email })
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})

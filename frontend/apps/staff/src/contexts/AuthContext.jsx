import { createContext, useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'

export const AuthContext = createContext(undefined)

// How often the last-seen heartbeat below stamps profile_last_seen while
// signed in — the most a closed-without-signing-out tab's "Active N
// minutes ago" can be off by.
const LAST_SEEN_INTERVAL_MS = 60_000

// Roles are read from the `profiles` table (id, role, office_id, full_name).
// `profiles.id` references `auth.users.id` directly (1:1), and a new row is
// auto-created with a null role by a database trigger on signup — an admin
// assigns the role afterwards. Until a role is assigned, `role` stays null
// and the user is treated as unauthorized for role-gated routes.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    // onAuthStateChange fires immediately with the current session on
    // subscribe, and again on every sign-in/out/token-refresh. Relying on
    // it as the single source of truth (instead of also calling
    // getSession() separately) avoids two concurrent role queries racing
    // and an out-of-order response overwriting a newer, correct one.
    let requestId = 0
    // Who the last event said was signed in — see the loading note below.
    let currentUserId = null

    async function loadRole(currentSession, thisRequestId) {
      if (!currentSession?.user) {
        if (isMounted && thisRequestId === requestId) {
          setRole(null)
          setProfile(null)
        }
        return
      }

      // office_id/full_name ride along on the same query (messaging needs
      // to know "my office" and display a sender's name) — no extra round
      // trip, and this stays independent of any dashboard data loading.
      const { data, error } = await supabase
        .from('profiles')
        .select('role, office_id, full_name')
        .eq('id', currentSession.user.id)
        .maybeSingle()

      if (!isMounted || thisRequestId !== requestId) return
      setRole(error ? null : (data?.role ?? null))
      setProfile(error ? null : (data ?? null))
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        requestId += 1
        const thisRequestId = requestId
        // Switching accounts (sign out then sign in as someone else, or a
        // session change synced in from another tab) fires this a second
        // time after the initial mount. Without resetting loading back to
        // true there, `user` updates to the new session immediately while
        // `role` still holds the *previous* user's role until the DB query
        // below resolves — a brief window where consumers (Login's
        // post-sign-in redirect, ProtectedRoute) would act on a stale role
        // and could bounce a legitimate login to /unauthorized.
        //
        // Only when the *identity* can differ, though. This also fires on
        // every token refresh, which supabase-js runs on a timer and again
        // whenever a backgrounded tab becomes visible — same user, same
        // role, nothing to re-check. Flipping loading for those made
        // ProtectedRoute replace the entire routed page with the
        // "Checking your session..." screen for the length of a round trip,
        // unmounting whatever the user was in the middle of: a half-typed
        // New Project form lost its state, and its unsaved-work draft was
        // then discarded by that very unmount (ProjectForm.jsx clears the
        // draft when the form unmounts). Coming back to a tab after a few
        // minutes wiped the typing.
        const isSameUser = Boolean(newSession?.user?.id) && newSession.user.id === currentUserId
        currentUserId = newSession?.user?.id ?? null
        if (!isSameUser) setLoading(true)
        setSession(newSession)
        loadRole(newSession, thisRequestId).finally(() => {
          if (isMounted && thisRequestId === requestId) setLoading(false)
        })
      },
    )

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // Last-seen heartbeat for Messaging's "Active N minutes ago": stamps
  // profile_last_seen (server time, via touch_last_seen()) on sign-in and
  // every LAST_SEEN_INTERVAL_MS while signed in. Keyed on the user id so a
  // token refresh doesn't restart it. "Online now" itself is realtime
  // presence in PresenceContext.jsx, not this.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) return undefined

    async function beat() {
      await supabase.rpc('touch_last_seen')
    }

    beat()
    const interval = setInterval(beat, LAST_SEEN_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [userId])

  async function signOut() {
    // Final stamp so last-seen is the exact sign-out time — it has to run
    // before auth.signOut(), while there's still a session to run it under.
    // PresenceContext.jsx leaves the realtime channel once the session here
    // becomes null.
    if (session?.user?.id) await supabase.rpc('touch_last_seen')
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    role,
    profile,
    loading,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

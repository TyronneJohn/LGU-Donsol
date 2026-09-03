import { createContext, useEffect, useRef, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'

export const AuthContext = createContext(undefined)

// How often the presence heartbeat below stamps profile_sessions.last_seen_at
// while signed in. Staff Accounts (apps/staff/src/pages/admin/
// StaffAccounts.jsx) treats a session as online only while its last_seen_at
// is more recent than a few multiples of this — see HEARTBEAT_INTERVAL_MS
// there.
const HEARTBEAT_INTERVAL_MS = 60_000

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

  // One random key per browser tab, for the lifetime of the tab — not per
  // user. It identifies *this session* in profile_sessions, so signing out
  // here only ever deletes this tab's presence row, regardless of who's
  // signed in elsewhere. crypto.randomUUID() needs no network round trip,
  // unlike deriving an id from the auth session itself.
  const sessionKeyRef = useRef(null)
  if (!sessionKeyRef.current) sessionKeyRef.current = crypto.randomUUID()

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

  // Presence heartbeat: upserts this tab's profile_sessions row immediately
  // on sign-in and every HEARTBEAT_INTERVAL_MS thereafter, for as long as
  // this session stays open. Keyed on the user id (not the whole session
  // object) so it doesn't restart on every token refresh — only on an
  // actual account switch. Signing in as someone else in the same tab just
  // starts a new (profile_id, session_key) row; the old profile's row for
  // this session_key is removed by signOut() below before that happens.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId) return undefined
    const sessionKey = sessionKeyRef.current

    async function beat() {
      await supabase
        .from('profile_sessions')
        .upsert(
          { profile_id: userId, session_key: sessionKey, last_seen_at: new Date().toISOString() },
          { onConflict: 'profile_id,session_key' },
        )
    }

    beat()
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [userId])

  async function signOut() {
    // Delete only this tab's presence row, before the session actually ends
    // (once auth.signOut() resolves there's no authenticated session left
    // to run this under, and RLS would reject it). Any other device/browser
    // signed into the same account keeps its own row untouched, so the
    // account still shows Active there — only this session flips off.
    if (session?.user?.id) {
      await supabase
        .from('profile_sessions')
        .delete()
        .eq('profile_id', session.user.id)
        .eq('session_key', sessionKeyRef.current)
    }
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

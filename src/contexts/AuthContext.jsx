import { createContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export const AuthContext = createContext(undefined)

// Roles are read from the `profiles` table (id, role, office_id, full_name).
// `profiles.id` references `auth.users.id` directly (1:1), and a new row is
// auto-created with a null role by a database trigger on signup — an admin
// assigns the role afterwards. Until a role is assigned, `role` stays null
// and the user is treated as unauthorized for role-gated routes.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    // onAuthStateChange fires immediately with the current session on
    // subscribe, and again on every sign-in/out/token-refresh. Relying on
    // it as the single source of truth (instead of also calling
    // getSession() separately) avoids two concurrent role queries racing
    // and an out-of-order response overwriting a newer, correct one.
    let requestId = 0

    async function loadRole(currentSession, thisRequestId) {
      if (!currentSession?.user) {
        if (isMounted && thisRequestId === requestId) setRole(null)
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentSession.user.id)
        .maybeSingle()

      if (!isMounted || thisRequestId !== requestId) return
      setRole(error ? null : (data?.role ?? null))
    }

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        requestId += 1
        const thisRequestId = requestId
        // Switching accounts (sign out then sign in as someone else, or a
        // session change synced in from another tab) fires this a second
        // time after the initial mount. Without resetting loading back to
        // true here, `user` updates to the new session immediately while
        // `role` still holds the *previous* user's role until the DB query
        // below resolves — a brief window where consumers (Login's
        // post-sign-in redirect, ProtectedRoute) would act on a stale role
        // and could bounce a legitimate login to /unauthorized.
        setLoading(true)
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

  async function signOut() {
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user ?? null,
    role,
    loading,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

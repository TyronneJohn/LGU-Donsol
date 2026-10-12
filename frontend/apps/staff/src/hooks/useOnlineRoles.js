import { useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'

// How often to re-check who's online. Presence itself is a 60s heartbeat
// (AuthContext.jsx), so polling faster than this wouldn't be any fresher.
const REFRESH_INTERVAL_MS = 30_000

// Set of office roles that currently have at least one signed-in, recently
// active session — via the online_roles() database function
// (20261011100000_online_roles_presence.sql). Failures are silent: a
// missing green dot is a harmless fallback.
export function useOnlineRoles() {
  const [onlineRoles, setOnlineRoles] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase.rpc('online_roles')
      if (!cancelled && !error) setOnlineRoles(new Set(data ?? []))
    }

    load()
    const interval = setInterval(load, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return onlineRoles
}

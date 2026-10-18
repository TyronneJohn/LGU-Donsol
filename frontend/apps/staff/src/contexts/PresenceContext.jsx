import { createContext, useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

export const PresenceContext = createContext(undefined)

// Private channel — only active staff may join or track on it, enforced by
// the realtime.messages policies in
// 20261025100000_staff_realtime_presence.sql.
const PRESENCE_TOPIC = 'staff-presence'

const EMPTY_PRESENCE = { onlineIds: new Set(), onlineRoles: new Set(), lastSeenByRole: new Map() }

// Realtime "who's online" for the whole authenticated shell, via Supabase
// Realtime Presence. Every signed-in tab joins one shared channel keyed by
// its user id, so a person with several tabs/devices open is still a single
// entry. Joins and leaves are pushed to every member within a second or
// two: signing out removes the channel immediately, and closing the tab or
// losing the connection drops the socket, which the Realtime server
// detects and broadcasts as a leave on its own — no polling, no
// last-seen timeout window.
//
// lastSeenByRole (role -> Date) backs Messaging's "Active N minutes ago":
// loaded once from office_last_seen() (20261025110000_office_last_seen.sql),
// then bumped to "now" locally whenever an office goes from online to
// offline, so the label switches over the moment presence says they left.
//
// Provided once at the app root (same reason as NotificationsProvider: two
// channels with the same topic in one client conflict), and read by Staff
// Accounts (per person) and Messaging (per office role).
export function PresenceProvider({ children }) {
  const { user, role } = useAuth()
  const [presence, setPresence] = useState(EMPTY_PRESENCE)

  const userId = user?.id ?? null
  useEffect(() => {
    // No role yet means not authorized as staff — the channel policy would
    // reject the join anyway.
    if (!userId || !role) {
      setPresence(EMPTY_PRESENCE)
      return undefined
    }

    let cancelled = false
    let previousRoles = new Set()

    // Failures are silent throughout: a missing green dot or "Offline"
    // instead of a last-seen time is a harmless fallback. Re-run on every
    // presence sync (a handful of rows), so one failed load — e.g. the tab
    // was open before the migration landed — doesn't leave "Offline" stuck
    // until a full reload. Merging keeps the newer of the loaded and local
    // times, since the last heartbeat can trail an actual leave by ~60s.
    async function loadLastSeen() {
      const { data, error } = await supabase.rpc('office_last_seen')
      if (cancelled || error) return
      setPresence((current) => {
        const lastSeenByRole = new Map(current.lastSeenByRole)
        for (const row of data ?? []) {
          const loaded = new Date(row.last_seen_at)
          const existing = lastSeenByRole.get(row.role)
          if (!existing || loaded > existing) lastSeenByRole.set(row.role, loaded)
        }
        return { ...current, lastSeenByRole }
      })
    }

    loadLastSeen()

    const channel = supabase.channel(PRESENCE_TOPIC, {
      config: { private: true, presence: { key: userId } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const onlineIds = new Set(Object.keys(state))
        const onlineRoles = new Set(
          Object.values(state)
            .map((metas) => metas[0]?.role)
            .filter(Boolean),
        )
        const leftRoles = [...previousRoles].filter((value) => !onlineRoles.has(value))
        previousRoles = onlineRoles

        setPresence((current) => {
          if (leftRoles.length === 0) return { ...current, onlineIds, onlineRoles }
          const lastSeenByRole = new Map(current.lastSeenByRole)
          const now = new Date()
          for (const value of leftRoles) lastSeenByRole.set(value, now)
          return { onlineIds, onlineRoles, lastSeenByRole }
        })
        loadLastSeen()
      })
      // Fires again after every automatic reconnect, so re-tracking here
      // puts this tab back online after a network blip.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ role })
      })

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      setPresence(EMPTY_PRESENCE)
    }
  }, [userId, role])

  return <PresenceContext.Provider value={presence}>{children}</PresenceContext.Provider>
}

import { useContext } from 'react'
import { PresenceContext } from '../contexts/PresenceContext'

// Realtime presence for the whole staff app (contexts/PresenceContext.jsx):
// `onlineIds` is the set of profile ids with at least one open session,
// `onlineRoles` the set of office roles with someone online, and
// `lastSeenByRole` when each office last had someone online (role -> Date).
export function usePresence() {
  const context = useContext(PresenceContext)
  if (context === undefined) {
    throw new Error('usePresence must be used within a PresenceProvider')
  }
  return context
}

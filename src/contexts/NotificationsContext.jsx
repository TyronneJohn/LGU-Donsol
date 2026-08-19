import { createContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'

export const NotificationsContext = createContext(undefined)

// Bell dropdown and the topbar message button only ever need a recent slice
// — unread count is derived from this same slice rather than a separate
// count query, which is an accurate approximation at this system's scale (a
// handful of staff per office) and keeps this to one query plus one
// realtime channel.
const NOTIFICATIONS_LIMIT = 50

// Single shared notifications feed for the whole authenticated shell: one
// realtime subscription per logged-in user, independent of dashboard data
// loading (a dashboard query failing must never take the bell down with
// it). Provided once at the app root so every consumer (NotificationBell,
// MessageButton) reads the same state instead of each opening its own
// channel — two channels with the same topic name causes Supabase's client
// to throw when the second one calls `.on()` after the first already
// `subscribe()`d.
export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  async function load(userId) {
    if (!userId) {
      setNotifications([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('notifications')
      .select(
        `id, category, title, message, related_project_id, related_message_id, sender_id, is_read, read_at, created_at,
         sender:profiles!notifications_sender_id_fkey(full_name, role)`,
      )
      .order('created_at', { ascending: false })
      .limit(NOTIFICATIONS_LIMIT)

    if (!error) setNotifications(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load(user?.id)
  }, [user?.id])

  useEffect(() => {
    if (!user) return undefined

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
        () => load(user.id),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
        () => load(user.id),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  async function markOneRead(id) {
    const now = new Date().toISOString()
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, is_read: true, read_at: now } : notification,
      ),
    )
    await supabase.from('notifications').update({ is_read: true, read_at: now }).eq('id', id)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((notification) => !notification.is_read).map((notification) => notification.id)
    if (unreadIds.length === 0) return

    const now = new Date().toISOString()
    setNotifications((current) =>
      current.map((notification) =>
        notification.is_read ? notification : { ...notification, is_read: true, read_at: now },
      ),
    )
    await supabase.from('notifications').update({ is_read: true, read_at: now }).in('id', unreadIds)
  }

  const unreadCount = notifications.filter((notification) => !notification.is_read).length

  const value = { notifications, unreadCount, loading, markOneRead, markAllRead }

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

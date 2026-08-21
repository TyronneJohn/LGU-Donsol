import { Bell, CheckCheck, Inbox, MessageSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import { useNotifications } from '../../hooks/useNotifications'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME_PATH, ROLE_LABELS } from '../../utils/roles'
import { formatRelativeTime } from '@shared/utils/format'
import EmptyState from '@shared/components/ui/EmptyState'

// Where clicking a non-message notification should land, per role — the one
// project page each role can always open regardless of the project's current
// stage (plain `.eq('id', projectId)` lookups, no status gating).
const PROJECT_NOTIFICATION_PATH = {
  admin: (projectId) => `/admin/projects/${projectId}`,
  mpdc: (projectId) => `/mpdc/monitoring/${projectId}`,
  engineering: (projectId) => `/engineering/monitoring/${projectId}`,
  bac: (projectId) => `/bac/procurement/${projectId}`,
}

export default function NotificationBell() {
  const { open, setOpen, close, containerRef } = useDismissablePopover()
  const { role } = useAuth()
  const navigate = useNavigate()
  const { notifications, unreadCount, markOneRead, markAllRead } = useNotifications()

  async function handleSelect(notification) {
    if (!notification.is_read) await markOneRead(notification.id)
    close()

    if (notification.category === 'NEW_MESSAGE' && notification.sender?.role && role) {
      navigate(`${ROLE_HOME_PATH[role]}/messaging?with=${notification.sender.role}`)
      return
    }

    if (notification.related_project_id && PROJECT_NOTIFICATION_PATH[role]) {
      navigate(PROJECT_NOTIFICATION_PATH[role](notification.related_project_id))
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Notifications"
        className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="animate-pop-in absolute right-0 z-30 mt-2 w-80 origin-top-right rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10 sm:w-96"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all as read
              </button>
            ) : null}
          </div>

          {notifications.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="You're all caught up"
              description="Messages, submissions, and monitoring alerts will show up here."
              bordered={false}
            />
          ) : (
            <ul className="max-h-96 space-y-0.5 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleSelect(notification)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 ${
                      notification.is_read ? '' : 'bg-blue-50/60'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        notification.is_read ? 'bg-transparent' : 'bg-blue-600'
                      }`}
                    />
                    {notification.category === 'NEW_MESSAGE' ? (
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${
                          notification.is_read ? 'font-normal text-slate-600' : 'font-semibold text-slate-800'
                        }`}
                      >
                        {notification.title}
                      </span>
                      {notification.message ? (
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{notification.message}</span>
                      ) : null}
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                        <span className="font-medium text-slate-500">
                          {notification.sender?.role
                            ? ROLE_LABELS[notification.sender.role]
                            : notification.category === 'NEW_MESSAGE'
                              ? null
                              : 'System'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelativeTime(notification.created_at)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}

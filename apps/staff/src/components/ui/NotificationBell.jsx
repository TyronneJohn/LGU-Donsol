import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, CheckCheck, Inbox, MessageSquare, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import { useNotifications } from '../../hooks/useNotifications'
import { useAuth } from '../../hooks/useAuth'
import { ROLE_HOME_PATH, ROLE_LABELS } from '../../utils/roles'
import { formatRelativeTime, formatDateTime } from '@shared/utils/format'
import EmptyState from '@shared/components/ui/EmptyState'
import Button from './Button'

// Categories that fire while a project is still pre-approval (draft,
// submitted, returned, rejected, or awaiting endorsement) — none of those
// statuses are in MONITORING_VISIBLE_STATUSES / SITE_MONITORING_VISIBLE_
// STATUSES (projectStatus.js), so routing these to a monitoring page would
// 404/"not yet monitoring" even though the notification itself is valid.
const PRE_APPROVAL_CATEGORIES = new Set([
  'PROJECT_SUBMITTED',
  'PROJECT_RETURNED',
  'PROJECT_REJECTED',
  'PROJECT_REVIEW_READY',
])

// Where clicking a non-message notification should land, per role and
// category — the monitoring pages only cover a project once it's actually
// APPROVED+ (MPDC) / FOR_IMPLEMENTATION+ (Engineering), so a pre-approval
// notification instead goes to the page each role actually manages that
// stage from. Admin's project detail has no status gating at all (plain
// `.eq('id', projectId)` lookup), so it's the same for every category.
function getProjectNotificationPath(role, category, projectId) {
  if (role === 'admin') return `/admin/projects/${projectId}`
  if (role === 'bac') return `/bac/procurement/${projectId}`
  if (role === 'mpdc') {
    return PRE_APPROVAL_CATEGORIES.has(category) ? `/mpdc/projects/${projectId}` : `/mpdc/monitoring/${projectId}`
  }
  if (role === 'engineering') {
    return PRE_APPROVAL_CATEGORIES.has(category)
      ? `/engineering/review/${projectId}`
      : `/engineering/monitoring/${projectId}`
  }
  return null
}

// Where "Open" in the detail dialog below should lead, mirroring
// handleSelect's old direct-navigate logic — kept as a standalone function
// so both the dialog's button and (if ever needed) other callers can reach
// it without going through component state.
function resolveNotificationPath(role, notification) {
  if (notification.category === 'NEW_MESSAGE' && notification.sender?.role && role) {
    return `${ROLE_HOME_PATH[role]}/messaging?with=${notification.sender.role}`
  }
  return notification.related_project_id
    ? getProjectNotificationPath(role, notification.category, notification.related_project_id)
    : null
}

export default function NotificationBell() {
  const { open, setOpen, close, containerRef } = useDismissablePopover()
  const { role } = useAuth()
  const navigate = useNavigate()
  const { notifications, unreadCount, markOneRead, markAllRead } = useNotifications()
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    if (!detail) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') setDetail(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [detail])

  // Clicking a notification no longer jumps straight to its project/
  // conversation — it opens a small dialog showing the full title/message
  // first (the dropdown list below truncates both to one line each), so the
  // reader actually sees what came in before choosing to proceed anywhere.
  async function handleSelect(notification) {
    if (!notification.is_read) await markOneRead(notification.id)
    close()
    setDetail(notification)
  }

  function handleProceed() {
    const path = resolveNotificationPath(role, detail)
    setDetail(null)
    if (path) navigate(path)
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

      {detail
        ? createPortal(
            <div className="fixed inset-0 z-1100 flex items-center justify-center px-4">
              <button
                type="button"
                aria-label="Dismiss dialog"
                onClick={() => setDetail(null)}
                className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="notification-detail-title"
                className="animate-pop-in relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 id="notification-detail-title" className="text-base font-semibold text-slate-800">
                    {detail.title}
                  </h2>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setDetail(null)}
                    className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <span className="font-medium text-slate-500">
                    {detail.sender?.role
                      ? ROLE_LABELS[detail.sender.role]
                      : detail.category === 'NEW_MESSAGE'
                        ? null
                        : 'System'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDateTime(detail.created_at)}</span>
                </p>

                {detail.message ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{detail.message}</p>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setDetail(null)}>
                    Close
                  </Button>
                  {resolveNotificationPath(role, detail) ? (
                    <Button size="sm" onClick={handleProceed}>
                      Open
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

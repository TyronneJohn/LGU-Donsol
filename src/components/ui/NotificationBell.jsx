import { Bell, Inbox } from 'lucide-react'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import EmptyState from './EmptyState'

// No live notification feed is wired up yet — this renders the real empty
// state rather than a placeholder count or fabricated messages.
export default function NotificationBell() {
  const { open, setOpen, containerRef } = useDismissablePopover()
  const unreadCount = 0

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
            className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500"
            aria-hidden="true"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="animate-pop-in absolute right-0 z-30 mt-2 w-80 origin-top-right rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10"
        >
          <p className="px-1 pb-1 text-sm font-semibold text-slate-800">Notifications</p>
          <EmptyState
            icon={Inbox}
            title="You're all caught up"
            description="Submissions, reviews, and monitoring alerts will show up here."
            bordered={false}
          />
        </div>
      ) : null}
    </div>
  )
}

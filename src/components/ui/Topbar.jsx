import { Menu } from 'lucide-react'
import MessageButton from './MessageButton'
import NotificationBell from './NotificationBell'
import UserMenu from './UserMenu'

export default function Topbar({ title, onMenuClick }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200/70 border-t-2 border-t-gold-500 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/50 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 lg:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <h2 className="font-display truncate text-base font-semibold text-slate-800 sm:text-lg">{title}</h2>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <MessageButton />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  )
}

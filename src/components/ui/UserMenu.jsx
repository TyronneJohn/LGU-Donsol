import { ChevronDown, LogOut, User } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'
import { ROLE_LABELS } from '../../utils/roles'
import Badge from './Badge'

export default function UserMenu() {
  const { user, role, signOut } = useAuth()
  const { open, setOpen, close, containerRef } = useDismissablePopover()

  const label = user?.email ?? 'Account'
  const initial = label.charAt(0).toUpperCase()

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md py-1.5 pl-1.5 pr-2 text-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate font-medium text-slate-700 sm:inline">
          {label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="border-b border-slate-100 px-2 pb-2">
            <p className="truncate text-sm font-medium text-slate-800">{label}</p>
            <Badge tone="blue" className="mt-1">
              {ROLE_LABELS[role] ?? 'Unassigned role'}
            </Badge>
          </div>

          <button
            type="button"
            role="menuitem"
            disabled
            title="Coming soon"
            className="mt-2 flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-400"
          >
            <User className="h-4 w-4" aria-hidden="true" />
            Profile settings
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close()
              signOut()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

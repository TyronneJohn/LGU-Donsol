import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import donsolSeal from '../../assets/Donsol.png'

// Nav shell shared by every authenticated role. Renders as a static column
// on large screens and an overlay drawer (backdrop + Escape + close button)
// on small ones, driven by `open`/`onClose` from the parent DashboardShell.
export default function Sidebar({ brandTitle, brandSubtitle, navItems, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden bg-linear-to-b from-blue-900 via-blue-950 to-blue-950 shadow-xl shadow-blue-950/30 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl"
        />

        <div className="relative flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-9 w-9 shrink-0 rounded-full ring-2 ring-gold-400/80"
            />
            <div className="leading-tight">
              <p className="font-display text-sm font-semibold text-white">{brandTitle}</p>
              <p className="text-xs text-blue-300">{brandSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1 text-blue-200 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Dashboard" className="relative flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-linear-to-r from-gold-500 to-gold-400 text-blue-950 shadow-md shadow-gold-500/20'
                    : 'text-blue-200 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              {item.icon ? (
                <item.icon className="h-4 w-4 shrink-0 opacity-90 group-hover:opacity-100" aria-hidden="true" />
              ) : null}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}

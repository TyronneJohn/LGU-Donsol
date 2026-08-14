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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white shadow-sm transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-blue-950 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-9 w-9 shrink-0 rounded-full ring-2 ring-gold-400/80"
            />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">{brandTitle}</p>
              <p className="text-xs text-blue-200">{brandSubtitle}</p>
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

        <nav aria-label="Dashboard" className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-gold-500 bg-blue-50 text-blue-700'
                    : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {item.icon ? <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}

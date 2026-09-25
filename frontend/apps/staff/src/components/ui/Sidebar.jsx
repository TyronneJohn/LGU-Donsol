import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import donsolSeal from '@shared/assets/Donsol.png'

// Nav shell shared by every authenticated role. Renders as a static column
// on large screens and an overlay drawer (backdrop + Escape + close button)
// on small ones, driven by `open`/`onClose` from the parent DashboardShell.
// `collapsed`/`onToggleCollapse` add a second, desktop-only mode (icon-only
// rail) on top of that — unrelated to the mobile open/close drawer, which
// always renders full-width regardless of the collapsed preference.
export default function Sidebar({
  brandTitle,
  brandSubtitle,
  navItems,
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}) {
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden bg-linear-to-b from-blue-900 via-blue-950 to-blue-950 shadow-xl shadow-blue-950/30 dark:border-r dark:border-white/10 dark:from-neutral-950 dark:via-black dark:to-black dark:shadow-none transition-all duration-200 ease-in-out lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'lg:w-24' : 'lg:w-64'}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/10 blur-3xl"
        />

        <div className="relative flex items-center justify-between gap-2 border-b border-white/10 px-3 py-4">
          <div className={`flex min-w-0 items-center gap-2.5 ${collapsed ? 'lg:flex-1 lg:justify-center' : ''}`}>
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className={`shrink-0 rounded-full ring-2 ring-gold-400/80 ${collapsed ? 'h-9 w-9 lg:h-8 lg:w-8' : 'h-9 w-9'}`}
            />
            <div className={`min-w-0 leading-tight ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="truncate font-display text-sm font-semibold text-white">{brandTitle}</p>
              <p className="truncate text-xs text-blue-300 dark:text-neutral-400">{brandSubtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Desktop-only collapse toggle — sits right next to the brand,
                same slot the mobile close button occupies below, so exactly
                one of the two shows depending on screen size. */}
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-md p-1 text-blue-200 hover:bg-white/10 hover:text-white dark:text-neutral-400 lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="rounded-md p-1 text-blue-200 hover:bg-white/10 hover:text-white dark:text-neutral-400 lg:hidden"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav aria-label="Dashboard" className="relative flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onClose}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  collapsed ? 'lg:justify-center' : ''
                } ${
                  isActive
                    ? 'bg-linear-to-r from-gold-500 to-gold-400 text-blue-950 shadow-md shadow-gold-500/20'
                    : 'text-blue-200 hover:bg-white/10 hover:text-white dark:text-neutral-400'
                }`
              }
            >
              {item.icon ? (
                <item.icon className="h-4 w-4 shrink-0 opacity-90 group-hover:opacity-100" aria-hidden="true" />
              ) : null}
              <span className={collapsed ? 'lg:hidden' : ''}>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  )
}

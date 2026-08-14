import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import donsolSeal from '../assets/Donsol.png'

// This layout is the public-facing site only. It intentionally has no
// staff login entry point — staff reach /login directly, which renders
// its own separate, non-public page (see src/pages/Login.jsx).

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/projects', label: 'Projects' },
]

export default function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 border-t-2 border-t-gold-500 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 text-slate-800">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-9 w-9 shrink-0 rounded-full ring-1 ring-slate-200"
            />
            <span className="text-sm font-semibold leading-tight sm:text-base">
              LGU Donsol
              <span className="block text-xs font-normal text-slate-500">
                Project Monitoring System
              </span>
            </span>
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `border-b-2 pb-0.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-gold-500 text-blue-700'
                      : 'border-transparent text-slate-600 hover:border-gold-300 hover:text-blue-700'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation menu"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:hidden"
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {menuOpen ? (
          <nav aria-label="Primary" className="border-t border-slate-200 px-4 py-2 sm:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-2 text-sm font-medium ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        ) : null}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-blue-950 py-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center">
          <img src={donsolSeal} alt="Bayan ng Donsol seal" className="h-8 w-8 opacity-90" />
          <p className="text-xs text-blue-200">
            &copy; {new Date().getFullYear()} Local Government Unit of Donsol.
            Public information is limited to approved and published projects.
          </p>
        </div>
      </footer>
    </div>
  )
}

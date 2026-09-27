import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import donsolSeal from '@shared/assets/Donsol.png'
import munisipyoPhoto from '@shared/assets/Munisipyo.jpg'

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
    <div className="relative isolate flex min-h-screen flex-col bg-blue-950">
      {/* Fixed so the photo stays put and fills the viewport behind every page,
          from under the header down to the footer, however long the page is. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0 scale-105 bg-cover bg-center"
          style={{ backgroundImage: `url(${munisipyoPhoto})` }}
        />
        <div className="absolute inset-0 bg-linear-to-br from-blue-950/92 via-blue-900/82 to-blue-800/70" />
        <div className="animate-blob absolute -right-24 -top-24 h-80 w-80 rounded-full bg-gold-400/20 blur-3xl" />
        <div
          className="animate-blob absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-blue-500/25 blur-3xl"
          style={{ animationDelay: '-8s' }}
        />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 border-t-2 border-t-gold-500 bg-blue-950/20 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5 text-white">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/30"
            />
            <span className="text-sm font-semibold leading-tight sm:text-base">
              LGU Donsol
              <span className="block text-xs font-normal text-blue-100/75">
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
                      ? 'border-gold-400 text-white'
                      : 'border-transparent text-blue-100/80 hover:border-gold-300 hover:text-white'
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
            className="rounded-md p-2 text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 sm:hidden"
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>

        {menuOpen ? (
          <nav aria-label="Primary" className="border-t border-white/10 px-4 py-2 sm:hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-2 text-sm font-medium ${
                    isActive ? 'bg-white/15 text-white' : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
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

      <footer className="border-t border-white/10 bg-blue-950/20 py-6 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center">
          <img src={donsolSeal} alt="Bayan ng Donsol seal" className="h-8 w-8 opacity-90" />
          <p className="text-xs text-blue-100/75">
            &copy; {new Date().getFullYear()} Local Government Unit of Donsol.
            Public information is limited to approved and published projects.
          </p>
        </div>
      </footer>
    </div>
  )
}

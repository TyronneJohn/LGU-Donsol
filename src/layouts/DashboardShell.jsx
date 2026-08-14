import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from '../components/ui/Sidebar'
import Topbar from '../components/ui/Topbar'

// Shared authenticated shell (sidebar + topbar + content) composed by every
// per-role layout (AdminLayout, MpdcLayout, EngineeringLayout, BacLayout)
// with its own title and nav items.
export default function DashboardShell({ title, navItems }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="brand-surface relative flex min-h-screen">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-32 right-0 h-96 w-96 rounded-full bg-blue-200/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -bottom-32 left-1/4 h-96 w-96 rounded-full bg-gold-200/30 blur-3xl"
      />

      <Sidebar
        brandTitle="LGU Donsol"
        brandSubtitle={title}
        navItems={navItems}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

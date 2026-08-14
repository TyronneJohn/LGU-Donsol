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
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        brandTitle="LGU Donsol"
        brandSubtitle={title}
        navItems={navItems}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

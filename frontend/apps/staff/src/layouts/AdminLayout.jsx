import { FolderKanban, Landmark, LayoutDashboard, ScrollText, UserCog } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/admin/staff', label: 'Staff Accounts', icon: UserCog },
  { to: '/admin/offices', label: 'Offices', icon: Landmark },
  { to: '/admin/audit-log', label: 'Audit Log', icon: ScrollText },
]

export default function AdminLayout() {
  return <DashboardShell title="Administrator" navItems={navItems} />
}


import { Activity, FolderKanban, Globe, LayoutDashboard } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/mpdc', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/mpdc/projects', label: 'My Projects', icon: FolderKanban },
  { to: '/mpdc/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/mpdc/published', label: 'Published Projects', icon: Globe },
]

export default function MpdcLayout() {
  return <DashboardShell title="Municipal Planning and Development Council" navItems={navItems} />
}

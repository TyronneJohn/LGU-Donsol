import { Activity, FolderKanban, Globe, LayoutDashboard, Map } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/mpdc', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/mpdc/projects', label: 'My Projects', icon: FolderKanban },
  { to: '/mpdc/geo-map', label: 'Geo Mapping', icon: Map },
  { to: '/mpdc/monitoring', label: 'Monitoring', icon: Activity },
  { to: '/mpdc/published', label: 'Published Projects', icon: Globe },
]

export default function MpdcLayout() {
  return <DashboardShell title="MPDC" navItems={navItems} />
}

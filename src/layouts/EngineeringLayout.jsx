import { ClipboardCheck, HardHat, LayoutDashboard } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/engineering', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/engineering/review', label: 'Project Review', icon: ClipboardCheck },
  { to: '/engineering/monitoring', label: 'Site Monitoring', icon: HardHat },
]

export default function EngineeringLayout() {
  return <DashboardShell title="Engineering Office" navItems={navItems} />
}

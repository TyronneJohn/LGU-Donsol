import { ClipboardList, Gavel, LayoutDashboard, Map, Users } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/bac', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/bac/procurement', label: 'Procurement', icon: Gavel },
  { to: '/bac/contractors', label: 'Contractors', icon: Users },
  { to: '/bac/accomplishments', label: 'Accomplishments', icon: ClipboardList },
  { to: '/bac/geo-map', label: 'Geo Mapping', icon: Map },
]

export default function BacLayout() {
  return <DashboardShell title="BAC" navItems={navItems} />
}

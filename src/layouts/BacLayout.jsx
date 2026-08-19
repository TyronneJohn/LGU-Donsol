import { ClipboardList, Gavel, LayoutDashboard, Users } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/bac', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/bac/procurement', label: 'Procurement', icon: Gavel },
  { to: '/bac/contractors', label: 'Contractors', icon: Users },
  { to: '/bac/accomplishments', label: 'Accomplishments', icon: ClipboardList },
]

export default function BacLayout() {
  return <DashboardShell title="Bids and Awards Committee" navItems={navItems} />
}

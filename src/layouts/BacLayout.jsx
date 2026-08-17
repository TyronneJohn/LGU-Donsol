import { ClipboardList, Gavel, LayoutDashboard, MessageSquare, Users } from 'lucide-react'
import DashboardShell from './DashboardShell'

const navItems = [
  { to: '/bac', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/bac/procurement', label: 'Procurement', icon: Gavel },
  { to: '/bac/contractors', label: 'Contractors', icon: Users },
  { to: '/bac/accomplishments', label: 'Accomplishments', icon: ClipboardList },
  { to: '/bac/messaging', label: 'Messaging', icon: MessageSquare },
]

export default function BacLayout() {
  return <DashboardShell title="Bids and Awards Committee" navItems={navItems} />
}

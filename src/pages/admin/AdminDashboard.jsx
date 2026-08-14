import { FolderKanban } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'

export default function AdminDashboard() {
  return (
    <div>
      <PageHeader title="Dashboard" description="System-wide overview across all offices." />
      <EmptyState
        icon={FolderKanban}
        title="No dashboard data yet"
        description="Once projects, submissions, and procurement activity start flowing through the system, an overview will appear here."
      />
    </div>
  )
}

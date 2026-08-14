import { HardHat } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '../../components/ui/EmptyState'

export default function EngineeringDashboard() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Projects assigned to your office for implementation and site monitoring."
      />
      <EmptyState
        icon={HardHat}
        title="No projects assigned yet"
        description="Projects MPDC assigns to your office for implementation will appear here."
      />
    </div>
  )
}

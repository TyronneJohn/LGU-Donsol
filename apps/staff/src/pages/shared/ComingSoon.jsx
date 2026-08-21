import PageHeader from '../../components/ui/PageHeader'
import EmptyState from '@shared/components/ui/EmptyState'

// Placeholder destination for nav items whose business functionality
// hasn't been built yet — keeps every link in the sidebar landing
// somewhere real (styled, breadcrumbed) instead of a 404.
export default function ComingSoon({ title, description, icon, breadcrumbs }) {
  return (
    <div>
      <PageHeader title={title} description={description} breadcrumbs={breadcrumbs} />
      <EmptyState
        icon={icon}
        title="This feature is under development"
        description="This section is part of the planned workflow and will be built out in a later phase."
      />
    </div>
  )
}

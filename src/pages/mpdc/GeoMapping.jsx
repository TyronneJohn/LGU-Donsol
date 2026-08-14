import { useAuth } from '../../hooks/useAuth'
import GeoMappingPage from '../shared/GeoMappingPage'

// MPDC sees every project (system-wide tracking/transparency — the same
// projects_select_staff access every staff role already has). "View
// Project" routes to the MPDC-owned edit view for projects this user
// created, or the read-only Monitoring detail view for everyone else's
// (ProjectForm.jsx only loads self-created projects).
export default function MpdcGeoMapping() {
  const { user } = useAuth()

  function getDetailHref(project) {
    return project.created_by === user.id ? `/mpdc/projects/${project.id}` : `/mpdc/monitoring/${project.id}`
  }

  return (
    <GeoMappingPage
      homePath="/mpdc"
      description="Every project's location, status, and progress — for planning, tracking, and transparency."
      getDetailHref={getDetailHref}
      showDss
      showExport
    />
  )
}

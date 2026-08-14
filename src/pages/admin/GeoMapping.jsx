import GeoMappingPage from '../shared/GeoMappingPage'

// Full, unrestricted view — every project, every status. "View Project"
// always routes to the Admin project detail page, which has no ownership
// restriction (safe for any project).
function getDetailHref(project) {
  return `/admin/projects/${project.id}`
}

export default function AdminGeoMapping() {
  return (
    <GeoMappingPage
      homePath="/admin"
      description="Every project's location, status, and DSS/monitoring information, across all offices."
      getDetailHref={getDetailHref}
      showDss
    />
  )
}

import GeoMappingPage from '../shared/GeoMappingPage'
import { MONITORING_VISIBLE_STATUSES } from '../../utils/projectStatus'

// Scoped by the project's implementing office (projects.office_id) matching
// the viewer's own office — the same eligibility rule already used by
// Site Monitoring (SiteMonitoring.jsx / ProjectMonitoringDetail.jsx),
// deliberately NOT created_by. "View Project" routes to whichever existing
// Engineering page actually has this project: Project Review while it's
// still awaiting a decision, Site Monitoring once it's reached a
// monitoring-visible status; otherwise no link is shown at all rather than
// pointing at a page that would just say "not found."
function filterRelevant(projects, { profile }) {
  if (!profile?.office_id) return []
  return projects.filter((p) => p.office_id === profile.office_id)
}

function getDetailHref(project) {
  if (project.status === 'SUBMITTED_FOR_REVIEW') return `/engineering/review/${project.id}`
  if (MONITORING_VISIBLE_STATUSES.includes(project.status)) return `/engineering/monitoring/${project.id}`
  return null
}

export default function EngineeringGeoMapping() {
  return (
    <GeoMappingPage
      homePath="/engineering"
      description="Locations of projects assigned to your office, with monitoring progress and DSS flags."
      filterRelevant={filterRelevant}
      getDetailHref={getDetailHref}
      showDss
    />
  )
}

import GeoMappingPage from '../shared/GeoMappingPage'
import { PROCUREMENT_RELEVANT_STATUSES } from '../../utils/projectStatus'

// Scoped to statuses BAC actually has (or could soon have) a procurement
// relationship with — endorsed onward. No DSS (not BAC's concern), no
// export, and "View Project" always routes to the existing read-only-until-
// action BAC Procurement detail page, which has no ownership restriction —
// safe to link for any project in this status range.
function filterRelevant(projects) {
  return projects.filter((p) => PROCUREMENT_RELEVANT_STATUSES.includes(p.status))
}

function getDetailHref(project) {
  return `/bac/procurement/${project.id}`
}

export default function BacGeoMapping() {
  return (
    <GeoMappingPage
      homePath="/bac"
      description="Locations of projects endorsed for or already in procurement."
      filterRelevant={filterRelevant}
      getDetailHref={getDetailHref}
    />
  )
}

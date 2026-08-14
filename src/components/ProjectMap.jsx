import { Component, useEffect, useMemo } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, MapPin } from 'lucide-react'
import Badge from './ui/Badge'
import Button from './ui/Button'
import { formatCurrency } from '../utils/format'
import { getFlagTone } from '../utils/decisionSupport'
import {
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
} from '../utils/projectStatus'

// Donsol, Sorsogon — sensible default center/zoom when there are no valid
// markers to fit bounds to yet.
const DEFAULT_CENTER = [12.9013, 123.9711]
const DEFAULT_ZOOM = 12

// Solid hex equivalents of the Badge component's tone palette, so marker
// colors stay visually consistent with every status badge elsewhere in the
// app rather than inventing a separate color language just for the map.
const TONE_COLORS = {
  neutral: '#64748b',
  blue: '#2563eb',
  green: '#059669',
  amber: '#d97706',
  red: '#dc2626',
}

// Leaflet's default marker icon references image paths that don't resolve
// under Vite's bundling — building a small inline SVG pin sidesteps that
// well-known issue entirely and lets markers be colored by project status.
function markerIcon(status) {
  const color = TONE_COLORS[PROJECT_STATUS_TONES[status]] ?? TONE_COLORS.neutral
  return L.divIcon({
    className: '',
    html: `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="5" fill="white"/>
    </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -32],
  })
}

// Fits the map to the current marker set whenever it changes. Kept as its
// own child component because useMap() only works inside a MapContainer.
function FitToMarkers({ points }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], DEFAULT_ZOOM)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32] })
  }, [map, points])

  return null
}

// Catches rendering failures from Leaflet itself (e.g. a tile/init error)
// instead of taking down the whole page. Must be a class component — React
// error boundaries have no hook equivalent.
class MapErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Never hide this silently — log the real error so it's visible in the
    // browser console instead of only showing the generic fallback below.
    console.error('ProjectMap failed to render:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
          <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700">Unable to load map</p>
          <p className="text-xs text-slate-500">The project list below is still available.</p>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Reusable project map — shared by MPDC, Engineering, BAC, and Admin's Geo
 * Mapping pages (see src/pages/shared/GeoMappingPage.jsx). Renders a marker
 * per project with valid coordinates; projects with missing/invalid
 * latitude/longitude are simply excluded (the caller is responsible for
 * surfacing that count/list — this component only draws what it's given).
 * Read-only everywhere: no drag/edit affordance on markers, regardless of
 * caller/role.
 *
 * @param {object[]} projects - rows already filtered to valid coordinates
 * @param {(project: object) => string | null | undefined} [getDetailHref] - route for "View Project"; omit or return a falsy value to hide the button for that project
 * @param {boolean} [showDss] - whether to render DSS flags in the popup (Engineering/MPDC/Admin only, never BAC)
 * @param {string} [height]
 */
export default function ProjectMap({ projects, getDetailHref, showDss = false, height = '520px' }) {
  const points = useMemo(() => projects.map((p) => [Number(p.latitude), Number(p.longitude)]), [projects])

  if (projects.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-center"
      >
        <MapPin className="h-6 w-6 text-slate-300" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-600">No project locations available</p>
        <p className="text-xs text-slate-400">Try a different filter, or check projects without coordinates below.</p>
      </div>
    )
  }

  return (
    <MapErrorBoundary>
      <div style={{ height }} className="overflow-hidden rounded-lg border border-slate-200">
        <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToMarkers points={points} />
          {projects.map((project) => {
            const detailHref = getDetailHref?.(project)
            return (
              <Marker
                key={project.id}
                position={[Number(project.latitude), Number(project.longitude)]}
                icon={markerIcon(project.status)}
              >
                <Popup minWidth={230}>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-slate-800">{project.title}</p>
                    <p className="text-xs text-slate-500">{project.project_code}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={PROJECT_STATUS_TONES[project.status]}>
                        {PROJECT_STATUS_LABELS[project.status] ?? project.status}
                      </Badge>
                      {project.procurement_status ? (
                        <Badge tone={PROCUREMENT_STATUS_TONES[project.procurement_status]}>
                          {PROCUREMENT_STATUS_LABELS[project.procurement_status] ?? project.procurement_status}
                        </Badge>
                      ) : null}
                      {project.progress_percentage != null ? (
                        <Badge tone="blue">{project.progress_percentage}% complete</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-600">{project.offices?.name || '—'}</p>
                    <p className="text-xs text-slate-600">
                      {project.barangay || '—'}
                      {project.location_text ? ` · ${project.location_text}` : ''}
                    </p>
                    <p className="text-xs text-slate-600">
                      {formatCurrency(project.approved_budget ?? project.estimated_cost)}
                    </p>
                    {showDss && project.flags?.length > 0 ? (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {project.flags.map((flag) => (
                          <Badge key={flag.type} tone={getFlagTone(flag.severity)}>
                            {flag.type.replace('_', ' ')}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {detailHref ? (
                      <div className="pt-1">
                        <Button to={detailHref} size="sm" variant="secondary">
                          View Project
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
    </MapErrorBoundary>
  )
}

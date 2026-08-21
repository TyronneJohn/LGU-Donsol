import { Component, useEffect, useMemo } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, MapPin } from 'lucide-react'
import Badge from './ui/Badge'
import { formatCurrency } from '../utils/format'
import { getFlagTone } from '../utils/decisionSupport'
import { DONSOL_BOUNDS } from '../utils/geo'
import {
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
} from '../utils/projectStatus'

// Donsol, Sorsogon poblacion — verified against Wikipedia/PhilAtlas/
// latitude.to (they converge on 12.9083°N, 123.5981°E). Only used as a
// fallback when there's no project to center on yet (never actually
// reached in practice — see the projects.length === 0 guard below, which
// returns before MapContainer ever mounts).
const DEFAULT_CENTER = [12.9083, 123.5981]

// "Marker clearly visible" zoom used as the map's actual initial zoom when
// centering on a specific project — close enough to read street-level
// context around the pin without depending on any post-mount correction.
const MARKER_ZOOM = 15

// Hard panning/zooming limit so this never becomes a general Philippines/
// world map — GeoMapping exists only to show where a project sits within
// Donsol. maxBoundsViscosity=1.0 makes the edge feel solid (no elastic
// drag past it) rather than merely springing back.
const MAX_BOUNDS = [
  [DONSOL_BOUNDS.south, DONSOL_BOUNDS.west],
  [DONSOL_BOUNDS.north, DONSOL_BOUNDS.east],
]
// Kept close to MARKER_ZOOM (rather than a province-wide zoomed-out level)
// so the on-screen viewport never has to grow past what DONSOL_BOUNDS can
// actually contain — a viewport bigger than the box it's clamped to is
// exactly what made setView()/maxBounds fight each other and silently
// fail to center on valid, in-bounds coordinates.
const MIN_ZOOM = 12

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

// Defensive correction, kept in addition to MapContainer's own
// project-derived initial center/zoom (below) — not the primary way this
// centers anymore. Also guards against a well-known Leaflet-in-a-modal
// issue: a map initialized inside a just-opened dialog can read a stale
// container size at mount, before the dialog's own layout has settled, so
// invalidateSize() is called first to make sure Leaflet's pixel math
// matches the container's real, final size before any pan happens.
function FitToMarkers({ points }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    map.invalidateSize()
    if (points.length === 1) {
      map.setView(points[0], MARKER_ZOOM)
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
 * Reusable project map — used by LocationModal.jsx to show a single
 * project's fixed location ("See Location" from a project detail page).
 * Renders a marker per project with valid coordinates; projects with
 * missing/invalid latitude/longitude are simply excluded (the caller is
 * responsible for gating access to this component on that — see
 * isWithinDonsol() in utils/geo.js). Read-only: no drag/edit affordance on
 * markers. Panning/zooming is hard-clamped to Donsol, Sorsogon (see
 * MAX_BOUNDS above) so this never turns into a general Philippines/world
 * map, regardless of how many projects are passed in.
 *
 * @param {object[]} projects - rows already filtered to valid coordinates
 * @param {string} [height]
 */
export default function ProjectMap({ projects, height = '520px' }) {
  const points = useMemo(() => projects.map((p) => [Number(p.latitude), Number(p.longitude)]), [projects])

  // MapContainer's center/zoom props are only read once, at mount — react-
  // leaflet does not update them on prop changes. Deriving the initial
  // view directly from the actual project (rather than always mounting at
  // a fixed Donsol-wide default and hoping FitToMarkers' post-mount
  // setView() corrects it before maxBounds clamps it) is what actually
  // guarantees "opens centered on this project's coordinates."
  const initialCenter = points[0] ?? DEFAULT_CENTER
  const initialZoom = points[0] ? MARKER_ZOOM : MIN_ZOOM
  // Forces a clean remount whenever the shown project changes, so a new
  // marker never inherits a previous MapContainer instance's pan/zoom
  // state (react-leaflet has no other way to "retarget" an existing map).
  const mapKey = projects[0]?.id ?? 'empty'

  if (projects.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 text-center"
      >
        <MapPin className="h-6 w-6 text-slate-300" aria-hidden="true" />
        <p className="text-sm font-medium text-slate-600">No project location available</p>
        <p className="text-xs text-slate-400">This project has no coordinates on file within Donsol, Sorsogon.</p>
      </div>
    )
  }

  return (
    <MapErrorBoundary>
      <div style={{ height }} className="overflow-hidden rounded-lg border border-slate-200">
        <MapContainer
          key={mapKey}
          center={initialCenter}
          zoom={initialZoom}
          minZoom={MIN_ZOOM}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitToMarkers points={points} />
          {projects.map((project) => (
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
                  {project.flags?.length > 0 ? (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {project.flags.map((flag) => (
                        <Badge key={flag.type} tone={getFlagTone(flag.severity)}>
                          {flag.type.replace('_', ' ')}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </MapErrorBoundary>
  )
}

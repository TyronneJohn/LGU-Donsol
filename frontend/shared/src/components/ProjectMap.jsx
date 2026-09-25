import { Component, useEffect, useMemo, useState } from 'react'
import { GeoJSON, LayersControl, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AlertTriangle, MapPin, X } from 'lucide-react'
import Badge from './ui/Badge'
import { formatCurrency } from '../utils/format'
import { getFlagTone } from '../utils/decisionSupport'
import { DONSOL_BOUNDS } from '../utils/geo'
import donsolBoundary from '../assets/geo/donsol-boundary.json'
import donsolBarangayBoundaries from '../assets/geo/donsol-barangay-boundaries.json'
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

// Deepest zoom the map offers, one level past Leaflet's z18 default. Only
// affects zooming IN, so it never interacts with the MIN_ZOOM / maxBounds
// balance described above.
const MAX_ZOOM = 19

// Esri's imagery over Donsol stops at z18 — verified against their tilemap
// availability endpoint at four points spread across the municipality
// (poblacion, north, south coast, east inland): all four report z15-z18
// present and z19+ absent. Past its coverage Esri does NOT return a 404;
// it serves a real placeholder tile stamped "Map data not yet available",
// which is what showed up on screen at full zoom. Declaring the true
// native limit makes Leaflet upscale the z18 tile to fill z19 instead of
// requesting one that doesn't exist — blurry at the last step, but
// continuous. OSM has genuine z19 tiles, so the street layer is left to
// fetch its own and stays sharp all the way in.
const ESRI_MAX_NATIVE_ZOOM = 18

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Esri World Imagery: real satellite/aerial imagery, free and keyless, so
// no API key or billing account has to be provisioned for the LGU. Chosen
// over the Google tile endpoints that turn up in tutorials — those work
// but violate Google's terms, which isn't acceptable in a government
// system. Imagery resolution in rural Sorsogon varies by area and capture
// date; if it ever proves too coarse for site verification, the paid path
// is the Google Maps JavaScript API, which would swap only the basemap
// and leave every marker/popup below intact.
const ESRI_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'

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

// Land border of Donsol: the outer edge of the union of the 51 PSA barangay
// polygons below (~153 km², in line with the official ~156 km² land area).
// Derived from the same data rather than a separate source (OSM's border
// was tried and ran up to ~1 km off PSA's along the north coast) so it
// always lines up exactly with the outermost barangay borders. Outline only
// with no fill so the imagery underneath stays readable, and
// non-interactive so it never swallows a
// click meant for a project marker. Amber reads against both the satellite
// and the street basemap.
const BOUNDARY_STYLE = {
  color: '#f59e0b',
  weight: 3,
  opacity: 0.9,
  fill: false,
  dashArray: '8 6',
}

// Borders of all 51 barangays from PSA's 2023 PSGC boundaries (via
// github.com/faeldon/philippines-json-maps), renamed to match
// DONSOL_BARANGAYS and simplified to ~5 m. Thin solid white so they read
// as subdivisions of — and never get confused with — the dashed amber
// municipal border. Non-interactive for the same reason as that border.
const BARANGAY_BORDER_STYLE = {
  color: '#ffffff',
  weight: 1.5,
  opacity: 0.8,
  fill: false,
}

// Always-on barangay name labels. The Esri/OSM tile labels decluster and
// drop place names depending on zoom, so every one of the 51 barangays is
// drawn here as its own label instead, placed at each barangay's
// precomputed pole of inaccessibility (`label`, [lat, lng]) — the point
// deepest inside its border, so a label never sits over a neighbor. White
// text with a dark halo stays legible on both basemaps. Built once at
// module load since the list never changes.
const BARANGAY_LABELS = donsolBarangayBoundaries.features.map(({ properties: { name, label } }) => ({
  name,
  position: label,
  icon: L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font:600 11px/1.2 system-ui,sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 3px #000,0 1px 2px #000;pointer-events:none">${name}</div>`,
  }),
}))

// Leaflet's default marker icon references image paths that don't resolve
// under Vite's bundling — building a small inline SVG pin sidesteps that
// well-known issue entirely and lets markers be colored by project status.
// The selected pin is drawn larger with a drop shadow so a click visibly
// registers even before the details card is read.
function markerIcon(status, selected = false) {
  const color = TONE_COLORS[PROJECT_STATUS_TONES[status]] ?? TONE_COLORS.neutral
  const [w, h] = selected ? [34, 44] : [26, 34]
  return L.divIcon({
    className: '',
    html: `<svg width="${w}" height="${h}" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg"${
      selected ? ' style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))"' : ''
    }>
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <circle cx="13" cy="13" r="5" fill="white"/>
    </svg>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
  })
}

// Clicking empty map dismisses the details card. Marker clicks never reach
// this: Leaflet markers default to bubblingMouseEvents: false.
function ClearSelectionOnMapClick({ onClear }) {
  useMapEvents({ click: onClear })
  return null
}

// Details for the clicked pin. Deliberately NOT a Leaflet <Popup>: a popup
// is anchored to the pin and autoPans the map to fit itself, but the
// maxBounds clamp snaps that pan back — and the popup's fixed pixel height
// spans more ground the further out you zoom (~1 km at z15, ~8 km at z12),
// so it ended up clipped or hidden above the map edge for most of northern
// Donsol. Pinned to a corner of the map box instead, it's fully visible at
// every zoom and pan position. Bottom sheet on phones, fixed-width card
// from `sm` up; scrolls internally if taller than the map.
function ProjectDetailsCard({ project, onClose }) {
  return (
    <section
      aria-label="Project details"
      className="animate-pop-in absolute inset-x-2 bottom-2 z-1000 max-h-[calc(100%-1rem)] overflow-y-auto rounded-lg bg-white p-3 shadow-lg ring-1 ring-slate-900/10 sm:right-auto sm:bottom-3 sm:left-3 sm:w-72"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{project.title}</p>
          <p className="text-xs text-slate-500">{project.project_code}</p>
        </div>
        <button
          type="button"
          aria-label="Close project details"
          onClick={onClose}
          className="-m-1 shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1.5 space-y-1.5">
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
        <p className="text-xs text-slate-600">{formatCurrency(project.approved_budget ?? project.estimated_cost)}</p>
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
    </section>
  )
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
 * @param {object[]} projects - rows already filtered to valid coordinates.
 *   Optional decorator fields the details card renders when present:
 *   `procurement_status`, `progress_percentage`, `flags`.
 * @param {string} [height]
 */
export default function ProjectMap({ projects, height = '520px' }) {
  const points = useMemo(() => projects.map((p) => [Number(p.latitude), Number(p.longitude)]), [projects])
  // Closed until a pin is clicked. Looked up by id so a stale selection from
  // a previously shown project simply resolves to nothing.
  const [selectedId, setSelectedId] = useState(null)
  const selectedProject = projects.find((p) => p.id === selectedId) ?? null

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
      {/* relative isolate z-0: `isolate` contains Leaflet's own internal
          z-indexes (up to 1000 for its controls) so they never escape this
          box; `relative z-0` makes the box itself an explicit, ordinary
          z-index:0 layer rather than an un-positioned one. The actual
          overlay-safety guarantee comes from the other side of this: every
          modal that can appear alongside an inline map on the same page
          (ConfirmDialog, ProjectForm's SubmitForReviewModal) uses z-1100,
          comfortably above Leaflet's max, so it always wins regardless of
          any stacking-context leak here. */}
      <div
        style={{ height }}
        className="relative isolate z-0 overflow-hidden rounded-lg border border-slate-200"
      >
        <MapContainer
          key={mapKey}
          center={initialCenter}
          zoom={initialZoom}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%' }}
        >
          {/* Satellite is the default checked layer: this map exists so staff
              can eyeball an actual project site, and OSM's drawn tiles show
              no ground detail whatsoever. The layer choice resets whenever
              `mapKey` remounts the map for a different project, which is
              fine — the default is the one wanted in nearly every case. */}
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Satellite">
              {/* No Esri place-name overlay on top: it duplicated (and
                  inconsistently hid) the BARANGAY_LABELS drawn below. */}
              <TileLayer
                attribution={ESRI_ATTRIBUTION}
                url={ESRI_IMAGERY_URL}
                maxZoom={MAX_ZOOM}
                maxNativeZoom={ESRI_MAX_NATIVE_ZOOM}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Street">
              <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_URL} maxZoom={MAX_ZOOM} />
            </LayersControl.BaseLayer>
          </LayersControl>
          {/* Barangay borders first so the municipal border draws on top. */}
          <GeoJSON data={donsolBarangayBoundaries} style={BARANGAY_BORDER_STYLE} interactive={false} />
          <GeoJSON data={donsolBoundary} style={BOUNDARY_STYLE} interactive={false} />
          {/* zIndexOffset keeps every label beneath the project pins. */}
          {BARANGAY_LABELS.map((b) => (
            <Marker
              key={b.name}
              position={b.position}
              icon={b.icon}
              interactive={false}
              keyboard={false}
              zIndexOffset={-1000}
            />
          ))}
          <FitToMarkers points={points} />
          <ClearSelectionOnMapClick onClear={() => setSelectedId(null)} />
          {projects.map((project) => {
            const selected = project.id === selectedId
            return (
              <Marker
                key={project.id}
                position={[Number(project.latitude), Number(project.longitude)]}
                icon={markerIcon(project.status, selected)}
                zIndexOffset={selected ? 1000 : 0}
                title={project.title}
                eventHandlers={{ click: () => setSelectedId(project.id) }}
              />
            )
          })}
        </MapContainer>
        {/* Sibling of MapContainer, not a child: keeps the card's own
            clicks/scrolls from ever reaching Leaflet as map pans or zooms. */}
        {selectedProject ? (
          <ProjectDetailsCard project={selectedProject} onClose={() => setSelectedId(null)} />
        ) : null}
      </div>
    </MapErrorBoundary>
  )
}

// Shared coordinate helpers for the "See Location" feature. GeoMapping is
// scoped exclusively to Donsol, Sorsogon (see ProjectMap.jsx's maxBounds) —
// isWithinDonsol() is the single source of truth every project detail page
// uses to decide whether a project's recorded latitude/longitude are safe
// to show a map for, so a stray/incorrect coordinate elsewhere in the
// Philippines is never presented as though it were a valid Donsol location.

// Roughly the municipal extent of Donsol, Sorsogon plus a safety margin —
// deliberately generous enough to (a) cover every barangay, not just the
// handful of verified points we've checked, and (b) stay comfortably
// larger than the on-screen map viewport at every zoom level ProjectMap
// uses, so Leaflet's maxBounds clamp never has to fight a setView/center
// call for a point that's genuinely inside Donsol (that fight is what
// caused valid coordinates to render off-center or effectively invisible).
// Centered on the verified poblacion coordinates (12.9083°N, 123.5981°E —
// Wikipedia/PhilAtlas/latitude.to all agree), bordered by Burias Pass to
// the north, Ticao Pass to the south, Pilar, Sorsogon to the east, and
// Pio Duran/Jovellar/Daraga, Albay to the west — still clearly
// municipality-scoped (~900 km² bounding box vs. the ~156 km² land area,
// the difference being irregular-coastline + panning slack, not scope
// creep into the rest of Sorsogon province, which is ~2,119 km²).
export const DONSOL_BOUNDS = {
  north: 13.03,
  south: 12.78,
  east: 123.75,
  west: 123.45,
}

export function isValidCoordinate(lat, lng) {
  if (lat === null || lat === undefined || lat === '' || lng === null || lng === undefined || lng === '') {
    return false
  }
  const latNum = Number(lat)
  const lngNum = Number(lng)
  return (
    Number.isFinite(latNum) &&
    Number.isFinite(lngNum) &&
    latNum >= -90 &&
    latNum <= 90 &&
    lngNum >= -180 &&
    lngNum <= 180
  )
}

export function isWithinDonsol(lat, lng) {
  if (!isValidCoordinate(lat, lng)) return false
  const latNum = Number(lat)
  const lngNum = Number(lng)
  return (
    latNum >= DONSOL_BOUNDS.south &&
    latNum <= DONSOL_BOUNDS.north &&
    lngNum >= DONSOL_BOUNDS.west &&
    lngNum <= DONSOL_BOUNDS.east
  )
}

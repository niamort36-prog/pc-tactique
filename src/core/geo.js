// Repère métrique local : origine = centre de la zone d'opération (AO).
// x = mètres vers l'Est, y = mètres vers le Nord.
// Approximation équirectangulaire, précise à <1 m sur quelques km.

const R = 6378137;

export class Frame {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    this.mPerDegLat = Math.PI * R / 180;
    this.mPerDegLon = Math.PI * R / 180 * Math.cos(lat0 * Math.PI / 180);
  }
  toLocal(lat, lon) {
    return { x: (lon - this.lon0) * this.mPerDegLon, y: (lat - this.lat0) * this.mPerDegLat };
  }
  toGeo(x, y) {
    return { lat: this.lat0 + y / this.mPerDegLat, lon: this.lon0 + x / this.mPerDegLon };
  }
  // bbox géographique d'un carré local de demi-côté `half` mètres
  bbox(half) {
    const sw = this.toGeo(-half, -half), ne = this.toGeo(half, half);
    return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
  }
}

// --- Conversions tuiles slippy (pour l'élévation) ---
export function lonToTileX(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
export function latToTileY(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
}
export function tileXToLon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
export function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

// Coordonnées MGRS-like simplifiées pour l'affichage (grille locale kilométrique)
export function gridRef(frame, x, y) {
  const e = Math.round((x + 100000) / 10), n = Math.round((y + 100000) / 10);
  return String(e).padStart(5, '0') + ' ' + String(n).padStart(5, '0');
}

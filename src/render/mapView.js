// Carte réelle (OpenStreetMap via Leaflet) + calques dérivés du terrain simulé.

import { CELL, T, TERRAIN } from '../world/terrain.js';

const TERRAIN_COLORS = {
  [T.FIELD]:  [140, 168, 104],
  [T.CROP]:   [178, 176, 106],
  [T.SCRUB]:  [116, 150, 92],
  [T.FOREST]: [58, 104, 60],
  [T.URBAN]:  [150, 146, 140],
  [T.ROAD]:   [232, 214, 160],
  [T.TRACK]:  [198, 178, 132],
  [T.WATER]:  [88, 130, 178],
  [T.MARSH]:  [104, 136, 128],
  [T.ROCK]:   [150, 142, 128],
};

export class MapView {
  constructor(el, frame, terrain) {
    this.frame = frame;
    this.terrain = terrain;
    const c = frame.toGeo(0, 0);

    this.map = L.map(el, {
      center: [c.lat, c.lon],
      zoom: 15,
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 140,
      attributionControl: true,
      preferCanvas: true,
    });

    this.baseLayers = {
      'Plan OSM': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap',
      }),
      'Topographique': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17, subdomains: 'abc', attribution: '© OpenTopoMap, © OpenStreetMap',
      }),
      'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Imagerie Esri',
      }),
      'Sombre': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap, © CARTO',
      }),
    };
    this.currentBase = 'Plan OSM';
    this.baseLayers[this.currentBase].addTo(this.map);

    const bb = frame.bbox(terrain.half);
    this.bounds = L.latLngBounds([bb.south, bb.west], [bb.north, bb.east]);
    this.map.fitBounds(this.bounds);
    this.map.setMaxBounds(this.bounds.pad(0.35));

    L.rectangle(this.bounds, { color: '#ffd45e', weight: 1.5, fill: false, dashArray: '6 5' }).addTo(this.map);

    this.overlays = {};
  }

  setBase(name) {
    if (!this.baseLayers[name] || name === this.currentBase) return;
    this.map.removeLayer(this.baseLayers[this.currentBase]);
    this.baseLayers[name].addTo(this.map);
    this.currentBase = name;
    if (this.overlays.terrain && this.map.hasLayer(this.overlays.terrain)) this.overlays.terrain.bringToFront();
  }

  // --- conversions ---
  toPoint(x, y) {
    const g = this.frame.toGeo(x, y);
    return this.map.latLngToContainerPoint([g.lat, g.lon]);
  }
  toLocal(containerPoint) {
    const ll = this.map.containerPointToLatLng(containerPoint);
    return this.frame.toLocal(ll.lat, ll.lng);
  }
  // mètres par pixel à l'écran
  get scale() {
    const a = this.toPoint(0, 0), b = this.toPoint(100, 0);
    return 100 / Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
  }

  // --- calques dérivés du terrain simulé ---

  buildTerrainOverlay() {
    const t = this.terrain, n = t.n;
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = cy * n + cx;
        // l'image est en repère écran : y inversé
        const o = ((n - 1 - cy) * n + cx) * 4;
        let col = TERRAIN_COLORS[t.type[i]] || [128, 128, 128];
        let a = 190;
        if (t.building[i] >= 0) { col = [64, 58, 54]; a = 235; }
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.overlays.terrain = L.imageOverlay(cv.toDataURL(), this.bounds, { opacity: 0.72, interactive: false });
    return this.overlays.terrain;
  }

  buildReliefOverlay() {
    const t = this.terrain, n = t.n;
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n);
    const range = Math.max(1, t.maxElev - t.minElev);
    // ombrage : soleil au nord-ouest
    const lx = -0.6, ly = 0.6, lz = 0.5;
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = cy * n + cx;
        const e = t.elev[i];
        const ex = (t.elev[t.cellIdx(Math.min(n - 1, cx + 1), cy)] - t.elev[t.cellIdx(Math.max(0, cx - 1), cy)]) / (2 * CELL);
        const ey = (t.elev[t.cellIdx(cx, Math.min(n - 1, cy + 1))] - t.elev[t.cellIdx(cx, Math.max(0, cy - 1))]) / (2 * CELL);
        const len = Math.hypot(ex, ey, 1);
        const nx = -ex / len, ny = -ey / len, nz = 1 / len;
        let sh = nx * lx + ny * ly + nz * lz;
        sh = Math.max(0, Math.min(1, 0.35 + sh * 0.9));
        const h = (e - t.minElev) / range;
        const o = ((n - 1 - cy) * n + cx) * 4;
        // teinte hypsométrique discrète, modulée par l'ombrage
        img.data[o] = Math.round((90 + h * 150) * sh);
        img.data[o + 1] = Math.round((110 + h * 110) * sh);
        img.data[o + 2] = Math.round((95 + h * 70) * sh);
        img.data[o + 3] = 165;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.overlays.relief = L.imageOverlay(cv.toDataURL(), this.bounds, { opacity: 0.6, interactive: false });
    return this.overlays.relief;
  }

  // Courbes de niveau vectorielles, tracées sur le canevas de jeu.
  contourSegments(interval = 10) {
    const t = this.terrain, n = t.n, segs = [];
    const at = (cx, cy) => t.elev[t.cellIdx(Math.min(n - 1, Math.max(0, cx)), Math.min(n - 1, Math.max(0, cy)))];
    const pos = (cx, cy) => ({ x: (cx + 0.5) * CELL - t.half, y: (cy + 0.5) * CELL - t.half });
    const lo = Math.floor(t.minElev / interval) * interval;
    const hi = Math.ceil(t.maxElev / interval) * interval;
    if (hi - lo > interval * 200) return segs;
    for (let level = lo; level <= hi; level += interval) {
      const st = 2;
      for (let cy = 0; cy < n - st; cy += st) {
        for (let cx = 0; cx < n - st; cx += st) {
          const v = [at(cx, cy), at(cx + st, cy), at(cx + st, cy + st), at(cx, cy + st)];
          const p = [pos(cx, cy), pos(cx + st, cy), pos(cx + st, cy + st), pos(cx, cy + st)];
          const pts = [];
          for (let e = 0; e < 4; e++) {
            const a = v[e], b = v[(e + 1) % 4];
            if ((a > level) === (b > level)) continue;
            const f = (level - a) / (b - a);
            const pa = p[e], pb = p[(e + 1) % 4];
            pts.push({ x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f });
          }
          if (pts.length >= 2) segs.push({ a: pts[0], b: pts[1], level });
        }
      }
    }
    return segs;
  }
}

export { TERRAIN_COLORS };

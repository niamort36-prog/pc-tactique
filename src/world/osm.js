// Chargement des données réelles OpenStreetMap (Overpass) et rasterisation dans la grille.

import { T, CELL, TERRAIN } from './terrain.js';

/**
 * Les miroirs Overpass, dans l'ordre où on les sollicite.
 *
 * Six plutôt que trois, parce qu'ils tombent ensemble. Overpass est un service
 * bénévole et sa charge est très inégale : aux heures pleines, un miroir
 * répond 504, et les deux autres rendent une page d'erreur émise par leur
 * proxy de tête — laquelle ne porte pas d'en-tête CORS. Le navigateur n'annonce
 * alors pas la surcharge mais un refus d'origine croisée, ce qui fait chercher
 * le défaut au mauvais endroit. C'est le même incident.
 */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const REPRISES = 2;          // tours de miroirs
const ATTENTE = 6000;        // avant d'y revenir, le temps que la charge retombe

function query(bb, timeout) {
  const b = bb.south + ',' + bb.west + ',' + bb.north + ',' + bb.east;
  return [
    '[out:json][timeout:' + (timeout || 90) + '];',
    '(',
    '  way["highway"](' + b + ');',
    '  way["building"](' + b + ');',
    '  way["landuse"](' + b + ');',
    '  way["natural"](' + b + ');',
    '  way["leisure"~"^(park|garden|pitch|golf_course)$"](' + b + ');',
    '  way["waterway"~"^(river|stream|canal)$"](' + b + ');',
    '  way["barrier"~"^(wall|fence|hedge)$"](' + b + ');',
    '  way["aeroway"](' + b + ');',
    '  node["aeroway"~"^(aerodrome|helipad)$"](' + b + ');',
    ');',
    'out geom;',
  ].join('\n');
}

export async function fetchOsm(bbox, onProgress = () => {}, timeout) {
  let lastErr;
  for (let tour = 0; tour < REPRISES; tour++) {
    if (tour) {
      onProgress('Tous les miroirs sont chargés — nouvelle tentative dans '
        + (ATTENTE / 1000) + ' s…');
      await new Promise(r => setTimeout(r, ATTENTE));
    }
    for (const url of ENDPOINTS) {
      const hote = new URL(url).hostname;
      try {
        onProgress('Interrogation Overpass (' + hote + ')…');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query(bbox, timeout)),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        onProgress('OSM : ' + json.elements.length + ' éléments reçus');
        return json.elements;
      } catch (e) {
        lastErr = e;
        // `fetch` ne distingue pas un miroir éteint d'un miroir qui refuse :
        // dans les deux cas il jette « Failed to fetch ». Dire « surchargé »
        // est l'explication juste neuf fois sur dix, et la seule sur laquelle
        // celui qui lit puisse agir — attendre, ou réduire la zone.
        const motif = /failed to fetch|networkerror|load failed/i.test(e.message)
          ? 'surchargé ou injoignable' : e.message;
        onProgress(hote + ' : ' + motif + ', miroir suivant…');
      }
    }
  }
  throw new Error('Overpass ne répond sur aucun miroir. Le service est bénévole et '
    + 'saturé par moments : réessayez dans une minute, ou prenez une zone plus petite.'
    + (lastErr ? ' (' + lastErr.message + ')' : ''));
}

// --- classification des tags ---

const LANDUSE_TYPE = {
  forest: T.FOREST, wood: T.FOREST,
  residential: T.URBAN, industrial: T.URBAN, commercial: T.URBAN, retail: T.URBAN,
  construction: T.URBAN, garages: T.URBAN, railway: T.URBAN, quarry: T.ROCK,
  farmland: T.CROP, farmyard: T.CROP, orchard: T.CROP, vineyard: T.CROP, allotments: T.CROP,
  meadow: T.FIELD, grass: T.FIELD, village_green: T.FIELD, cemetery: T.FIELD, recreation_ground: T.FIELD,
};
const NATURAL_TYPE = {
  wood: T.FOREST, tree_row: T.FOREST, scrub: T.SCRUB, heath: T.SCRUB, shrubbery: T.SCRUB,
  grassland: T.FIELD, water: T.WATER, wetland: T.MARSH, marsh: T.MARSH,
  bare_rock: T.ROCK, scree: T.ROCK, cliff: T.ROCK, sand: T.FIELD, beach: T.FIELD,
};
const LEISURE_TYPE = { park: T.FIELD, garden: T.FIELD, pitch: T.FIELD, golf_course: T.FIELD };

// largeur (m) et nature par type de voie
const HIGHWAY = {
  motorway: [14, T.ROAD], trunk: [12, T.ROAD], primary: [10, T.ROAD], secondary: [9, T.ROAD],
  tertiary: [7, T.ROAD], unclassified: [6, T.ROAD], residential: [6, T.ROAD], living_street: [6, T.ROAD],
  service: [4, T.ROAD], motorway_link: [8, T.ROAD], trunk_link: [8, T.ROAD], primary_link: [7, T.ROAD],
  secondary_link: [6, T.ROAD], tertiary_link: [5, T.ROAD],
  track: [4, T.TRACK], pedestrian: [4, T.TRACK],
  // sentiers : praticables mais ils ne suppriment pas le couvert qu'ils traversent
  path: [2, T.TRACK, true], footway: [2, T.TRACK, true], cycleway: [2, T.TRACK, true],
  bridleway: [2, T.TRACK, true], steps: [2, T.TRACK, true],
};

// Voies aeronautiques : surfaces dures, praticables et bien degagees.
const AEROWAY_WIDTH = { runway: 45, taxiway: 20, apron: 0, helipad: 0 };

// natures de sol qu'un simple sentier ne remplace pas
const KEEPS_COVER = { [T.FOREST]: 1, [T.SCRUB]: 1, [T.URBAN]: 1, [T.MARSH]: 1, [T.ROCK]: 1, [T.WATER]: 1 };

// Priorité de rasterisation : les valeurs hautes écrasent les basses.
const PRIORITY = {
  [T.FIELD]: 1, [T.CROP]: 2, [T.SCRUB]: 3, [T.MARSH]: 3, [T.ROCK]: 3,
  [T.FOREST]: 4, [T.URBAN]: 5, [T.WATER]: 6, [T.TRACK]: 7, [T.ROAD]: 8,
};

export function rasterize(elements, terrain, frame, onProgress = () => {}) {
  const toLocal = g => g.map(p => frame.toLocal(p.lat, p.lon));
  const areas = [], lines = [], buildings = [], barriers = [];
  const aero = { fields: [], runways: [], helipads: [] };

  for (const el of elements) {
    // les aerodromes et helistations sont souvent de simples noeuds
    if (el.type === 'node' && el.tags && el.tags.aeroway) {
      const p = frame.toLocal(el.lat, el.lon);
      if (el.tags.aeroway === 'aerodrome') aero.fields.push({ x: p.x, y: p.y, name: el.tags.name || 'A\u00e9rodrome' });
      else if (el.tags.aeroway === 'helipad') aero.helipads.push({ x: p.x, y: p.y });
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    const g = el.geometry;
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

    if (tags.aeroway) {
      const pts = toLocal(el.geometry);
      const g0 = el.geometry;
      const ring = g0.length > 3 && g0[0].lat === g0[g0.length - 1].lat && g0[0].lon === g0[g0.length - 1].lon;
      const centre = centroid(pts);
      if (tags.aeroway === 'runway') {
        const len = polylineLength(pts);
        aero.runways.push({ x: centre.x, y: centre.y, length: len, name: tags.ref || null });
        lines.push({ pts, width: parseWidth(tags, AEROWAY_WIDTH.runway), type: T.ROAD });
      } else if (tags.aeroway === 'taxiway') {
        lines.push({ pts, width: parseWidth(tags, AEROWAY_WIDTH.taxiway), type: T.ROAD });
      } else if (tags.aeroway === 'apron' && ring) {
        areas.push({ pts, type: T.ROAD });
      } else if (tags.aeroway === 'helipad') {
        aero.helipads.push({ x: centre.x, y: centre.y });
        if (ring) areas.push({ pts, type: T.ROAD });
      } else if (tags.aeroway === 'aerodrome') {
        aero.fields.push({ x: centre.x, y: centre.y, name: tags.name || 'A\u00e9rodrome' });
      }
      continue;
    }
    if (tags.building || tags['building:part']) {
      if (closed) buildings.push({ pts: toLocal(g), tags });
      continue;
    }
    if (tags.highway && HIGHWAY[tags.highway]) {
      const spec = HIGHWAY[tags.highway];
      lines.push({ pts: toLocal(g), width: parseWidth(tags, spec[0]), type: spec[1], minor: !!spec[2] });
      continue;
    }
    if (tags.waterway) {
      lines.push({ pts: toLocal(g), width: tags.waterway === 'river' ? 12 : 4, type: T.WATER });
      continue;
    }
    if (tags.barrier) { barriers.push({ pts: toLocal(g) }); continue; }

    let t = null;
    if (tags.landuse) t = LANDUSE_TYPE[tags.landuse];
    if (t == null && tags.natural) t = NATURAL_TYPE[tags.natural];
    if (t == null && tags.leisure) t = LEISURE_TYPE[tags.leisure];
    if (t != null && closed) areas.push({ pts: toLocal(g), type: t });
  }

  onProgress('Rasterisation : ' + areas.length + ' zones, ' + lines.length + ' voies, ' + buildings.length + ' bâtiments');

  // 1. surfaces, par priorité croissante
  areas.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  for (const a of areas) terrain.fillPolygon(a.pts, i => { terrain.type[i] = a.type; });

  // 2. haies et murs : dissimulation légère, avant les routes
  for (const bar of barriers) strokeLine(terrain, bar.pts, CELL, T.SCRUB, true);

  // 3. voies
  lines.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
  for (const l of lines) strokeLine(terrain, l.pts, l.width, l.type, false, l.minor);

  // 4. bâtiments (par-dessus tout, ils bloquent)
  let bid = 0;
  for (const b of buildings) {
    const cells = [];
    terrain.fillPolygon(b.pts, i => {
      // Une chaussée n'est jamais dans un bâtiment : préserver les voies garde le
      // réseau de rues connexe, sinon les emprises soudées scellent des quartiers entiers.
      if (terrain.building[i] < 0 && !TERRAIN[terrain.type[i]].road) {
        terrain.building[i] = bid;
        cells.push(i);
      }
    });
    if (!cells.length) continue;
    let cx = 0, cy = 0;
    for (const i of cells) { const c = terrain.cellCenter(i); cx += c.x; cy += c.y; }
    const levels = parseInt(b.tags['building:levels'] || b.tags.levels || '', 10);
    terrain.buildings.push({
      id: bid,
      x: cx / cells.length, y: cy / cells.length,
      cells,
      area: cells.length * CELL * CELL,
      floors: Number.isFinite(levels) ? Math.max(1, levels) : (cells.length > 40 ? 3 : 1),
      kind: b.tags.building || 'yes',
      name: b.tags.name || null,
      capacity: Math.max(4, Math.round(cells.length * 0.8)),
      occupants: [],
    });
    bid++;
  }

  buildAirfields(terrain, aero, onProgress);
  onProgress('Terrain prêt : ' + terrain.buildings.length + ' bâtiments rastérisés');
}

function parseWidth(tags, fallback) {
  const w = parseFloat(tags.width);
  if (Number.isFinite(w) && w > 0) return w;
  const lanes = parseInt(tags.lanes, 10);
  if (Number.isFinite(lanes) && lanes > 0) return Math.max(fallback, lanes * 3.2);
  return fallback;
}

// Trace une polyligne épaisse dans la grille.
// `minor` : voie légère, qui ne remplace pas un couvert végétal ou bâti.
function strokeLine(terrain, pts, width, type, onlyIfEmpty, minor) {
  // Une cellule est prise si son centre est à portée de l'axe. Sans ce plancher
  // un sentier de 2 m disparaîtrait ; sans ce plafond il occuperait deux cellules.
  const r = Math.max(CELL * 0.5, width / 2);
  const rc = Math.ceil(r / CELL) + 1;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const cx0 = terrain.ix(px), cy0 = terrain.iy(py);
      for (let dy = -rc; dy <= rc; dy++) {
        for (let dx = -rc; dx <= rc; dx++) {
          const i = terrain.cellIdx(cx0 + dx, cy0 + dy);
          if (i < 0) continue;
          const c = terrain.cellCenter(i);
          if (Math.hypot(c.x - px, c.y - py) > r) continue;
          if (onlyIfEmpty && terrain.type[i] !== T.FIELD) continue;
          if (minor && KEEPS_COVER[terrain.type[i]]) continue;
          if (PRIORITY[type] >= PRIORITY[terrain.type[i]]) terrain.type[i] = type;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- aeronautique

function polylineLength(pts) {
  let d = 0;
  for (let i = 0; i + 1 < pts.length; i++) d += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  return d;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

// Rattache chaque piste et chaque hélistation à l'aérodrome le plus proche ;
// une piste isolée devient un terrain à part entière.
function buildAirfields(terrain, aero, onProgress) {
  const fields = aero.fields.map(f => ({ x: f.x, y: f.y, name: f.name, runway: 0, helipads: 0 }));

  const attach = (item, radius, apply) => {
    let best = null, bestD = radius;
    for (const f of fields) {
      const d = Math.hypot(f.x - item.x, f.y - item.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best) apply(best);
    else fields.push(apply({ x: item.x, y: item.y, name: null, runway: 0, helipads: 0 }));
  };

  for (const r of aero.runways) {
    attach(r, 3500, f => {
      f.runway = Math.max(f.runway, Math.round(r.length));
      if (!f.name) f.name = r.name ? 'Piste ' + r.name : 'Terrain d\u2019aviation';
      return f;
    });
  }
  for (const h of aero.helipads) {
    attach(h, 1500, f => {
      f.helipads++;
      if (!f.name) f.name = 'H\u00e9listation';
      return f;
    });
  }

  // on ne garde que ce qui est réellement dans la zone
  terrain.airfields = fields
    .filter(f => terrain.inside(f.x, f.y))
    .sort((a, b) => b.runway - a.runway);

  if (terrain.airfields.length) {
    const best = terrain.airfields[0];
    onProgress('A\u00e9ronautique : ' + terrain.airfields.length + ' terrain(s), plus longue piste ' +
      (best.runway ? best.runway + ' m' : 'aucune') +
      (best.helipads ? ', ' + best.helipads + ' h\u00e9listation(s)' : ''));
  } else {
    onProgress('A\u00e9ronautique : aucun terrain d\u2019aviation dans la zone.');
  }
}

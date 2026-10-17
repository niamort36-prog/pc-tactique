// Grille de terrain. Une cellule = CELL mètres.
// Stocke : nature du sol, couvert (dissimulation), obstruction (LOS), coût de déplacement, altitude, bâtiment.

// Résolution de la grille, en mètres. Elle s'adapte à la taille de la zone :
// garder 10 m sur 20 km demanderait 4 millions de cellules et plus de 150 Mo.
// Une partie n'a qu'une seule zone d'opération, donc une valeur de module suffit ;
// les imports en profitent grâce aux liaisons vivantes des modules ES.
export let CELL = 10;

export function cellForHalf(half) {
  if (half <= 3000) return 10;      // jusqu'à 6 km de côté
  if (half <= 6000) return 15;      // jusqu'à 12 km
  return 20;                        // au-delà
}

export function setCell(v) { CELL = v; }

export const T = {
  FIELD: 0, CROP: 1, SCRUB: 2, FOREST: 3, URBAN: 4,
  ROAD: 5, TRACK: 6, WATER: 7, MARSH: 8, ROCK: 9,
};

// concealment : dissimulation (0 = à découvert, 1 = invisible)
// blocking    : obstruction de la ligne de vue par mètre traversé
// cost        : multiplicateur de temps de déplacement à pied
// effort      : multiplicateur de fatigue
// protection  : réduction des pertes sous le feu
export const TERRAIN = {
  [T.FIELD]:  { name: 'Champ',       concealment: 0.05, blocking: 0.000, cost: 1.00, effort: 1.00, protection: 0.05, road: false },
  [T.CROP]:   { name: 'Culture',     concealment: 0.30, blocking: 0.001, cost: 1.20, effort: 1.15, protection: 0.10, road: false },
  [T.SCRUB]:  { name: 'Broussaille', concealment: 0.45, blocking: 0.004, cost: 1.45, effort: 1.35, protection: 0.15, road: false },
  [T.FOREST]: { name: 'Forêt',       concealment: 0.75, blocking: 0.020, cost: 1.70, effort: 1.55, protection: 0.30, road: false },
  [T.URBAN]:  { name: 'Urbain',      concealment: 0.55, blocking: 0.012, cost: 1.25, effort: 1.10, protection: 0.35, road: false },
  [T.ROAD]:   { name: 'Route',       concealment: 0.00, blocking: 0.000, cost: 0.75, effort: 0.80, protection: 0.00, road: true  },
  [T.TRACK]:  { name: 'Piste',       concealment: 0.10, blocking: 0.000, cost: 0.88, effort: 0.90, protection: 0.02, road: true  },
  [T.WATER]:  { name: 'Eau',         concealment: 0.00, blocking: 0.000, cost: 9.00, effort: 4.00, protection: 0.00, road: false },
  [T.MARSH]:  { name: 'Marais',      concealment: 0.35, blocking: 0.002, cost: 2.40, effort: 2.20, protection: 0.05, road: false },
  [T.ROCK]:   { name: 'Rocaille',    concealment: 0.25, blocking: 0.006, cost: 1.60, effort: 1.50, protection: 0.40, road: false },
};

export class Terrain {
  constructor(halfSize) {
    setCell(cellForHalf(halfSize));             // résolution adaptée à l'étendue
    this.half = halfSize;                       // demi-côté de l'AO en mètres
    this.cell = CELL;
    this.n = Math.round(halfSize * 2 / CELL);   // cellules par côté
    const N = this.n * this.n;
    this.type = new Uint8Array(N).fill(T.FIELD);
    this.elev = new Float32Array(N);
    this.building = new Int32Array(N).fill(-1);
    this.buildings = [];                        // { id, cx, cy, cells[], area, floors, occupants[] }
    this.airfields = [];                        // { x, y, name, runway, helipads }
    this.minElev = 0; this.maxElev = 0;
  }

  // --- indexation ---
  ix(x) { return Math.floor((x + this.half) / CELL); }
  iy(y) { return Math.floor((y + this.half) / CELL); }
  idx(x, y) {
    const cx = this.ix(x), cy = this.iy(y);
    if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n) return -1;
    return cy * this.n + cx;
  }
  cellIdx(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n) return -1;
    return cy * this.n + cx;
  }
  cellCenter(i) {
    const cy = Math.floor(i / this.n), cx = i - cy * this.n;
    return { x: (cx + 0.5) * CELL - this.half, y: (cy + 0.5) * CELL - this.half };
  }
  inside(x, y) { return x > -this.half && x < this.half && y > -this.half && y < this.half; }

  typeAt(x, y) { const i = this.idx(x, y); return i < 0 ? T.FIELD : this.type[i]; }
  infoAt(x, y) { return TERRAIN[this.typeAt(x, y)]; }
  buildingAt(x, y) { const i = this.idx(x, y); return i < 0 ? -1 : this.building[i]; }
  isRoad(x, y) { return TERRAIN[this.typeAt(x, y)].road; }

  // altitude interpolée bilinéairement
  elevAt(x, y) {
    const fx = (x + this.half) / CELL - 0.5, fy = (y + this.half) / CELL - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const g = (cx, cy) => {
      const i = this.cellIdx(Math.min(this.n - 1, Math.max(0, cx)), Math.min(this.n - 1, Math.max(0, cy)));
      return i < 0 ? 0 : this.elev[i];
    };
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  // pente en % dans la direction (dx,dy) normalisée
  slopeAlong(x, y, dx, dy, step = CELL) {
    const e0 = this.elevAt(x, y), e1 = this.elevAt(x + dx * step, y + dy * step);
    return (e1 - e0) / step;
  }

  // dissimulation effective d'une position (terrain + bâtiment)
  concealmentAt(x, y) {
    const b = this.buildingAt(x, y);
    if (b >= 0) return 0.9;
    return TERRAIN[this.typeAt(x, y)].concealment;
  }
  protectionAt(x, y) {
    const b = this.buildingAt(x, y);
    if (b >= 0) return 0.65;
    return TERRAIN[this.typeAt(x, y)].protection;
  }

  computeElevRange() {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < this.elev.length; i++) { const e = this.elev[i]; if (e < mn) mn = e; if (e > mx) mx = e; }
    this.minElev = isFinite(mn) ? mn : 0; this.maxElev = isFinite(mx) ? mx : 0;
  }

  // Remplissage scanline d'un polygone (coords locales) -> callback(cellIndex, cx, cy)
  fillPolygon(pts, cb) {
    if (pts.length < 3) return;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    }
    let cy0 = Math.max(0, this.iy(minY)), cy1 = Math.min(this.n - 1, this.iy(maxY));
    for (let cy = cy0; cy <= cy1; cy++) {
      const sy = (cy + 0.5) * CELL - this.half;
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[j], b = pts[i];
        if ((a.y > sy) !== (b.y > sy)) xs.push(a.x + (sy - a.y) / (b.y - a.y) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // On ne retient que les cellules dont le CENTRE tombe dans le polygone.
        // Arrondir à la cellule contenant l'intersection ferait occuper 100 m²
        // au moindre abri de jardin, et souderait tous les pâtés de maisons.
        let cx0 = Math.ceil((xs[k] + this.half) / CELL - 0.5);
        let cx1 = Math.floor((xs[k + 1] + this.half) / CELL - 0.5);
        if (cx0 < 0) cx0 = 0;
        if (cx1 > this.n - 1) cx1 = this.n - 1;
        for (let cx = cx0; cx <= cx1; cx++) {
          const i = cy * this.n + cx;
          cb(i, cx, cy);
        }
      }
    }
  }
}

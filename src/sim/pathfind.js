// Recherche d'itinéraire A* sur la grille fine du terrain (10 m).
//
// Travailler directement à la résolution du terrain garantit qu'un itinéraire calculé
// est réellement praticable : aucun point du chemin ne peut tomber dans un bâtiment,
// et l'unité n'a donc jamais à « forcer » un passage qui n'existe pas.
// Les véhicules à roues paient très cher le tout-terrain : ils suivent les routes
// d'eux-mêmes. Les chenillés coupent à travers champs.

import { CELL, TERRAIN, T } from '../world/terrain.js';

// Coût de franchissement par nature de sol : [pied, roues, chenilles]
const COST = {
  [T.FIELD]:  [1.00,  3.00,  1.50],
  [T.CROP]:   [1.20,  3.60,  1.65],
  [T.SCRUB]:  [1.45,  6.50,  2.30],
  [T.FOREST]: [1.70, 12.00,  3.40],
  [T.URBAN]:  [1.25,  3.50,  2.60],
  [T.ROAD]:   [0.75,  0.60,  0.80],
  [T.TRACK]:  [0.88,  0.95,  0.90],
  [T.WATER]:  [9.00, Infinity, Infinity],
  [T.MARSH]:  [2.40, 16.00,  5.00],
  [T.ROCK]:   [1.60,  9.00,  3.00],
};

class Heap {
  constructor(cap) { this.node = new Int32Array(cap); this.f = new Float32Array(cap); this.size = 0; this.cap = cap; }
  clear() { this.size = 0; }
  push(node, f) {
    if (this.size >= this.cap) return;
    let i = this.size++;
    this.node[i] = node; this.f[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      const tn = this.node[p], tf = this.f[p];
      this.node[p] = this.node[i]; this.f[p] = this.f[i];
      this.node[i] = tn; this.f[i] = tf;
      i = p;
    }
  }
  pop() {
    const top = this.node[0];
    const last = --this.size;
    this.node[0] = this.node[last]; this.f[0] = this.f[last];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.size && this.f[l] < this.f[m]) m = l;
      if (r < this.size && this.f[r] < this.f[m]) m = r;
      if (m === i) break;
      const tn = this.node[m], tf = this.f[m];
      this.node[m] = this.node[i]; this.f[m] = this.f[i];
      this.node[i] = tn; this.f[i] = tf;
      i = m;
    }
    return top;
  }
}

export class NavGrid {
  constructor(terrain) {
    this.terrain = terrain;
    this.n = terrain.n;
    const N = this.n * this.n;

    this.costFoot = new Float32Array(N);
    this.costWheel = new Float32Array(N);
    this.costTrack = new Float32Array(N);
    this.solid = new Uint8Array(N);      // bâti : infranchissable pour tous
    this.wet = new Uint8Array(N);        // eau : infranchissable pour les véhicules

    // État de recherche réutilisé d'un appel à l'autre, marqué par un numéro de
    // génération : on évite ainsi de réallouer et d'effacer plusieurs mégaoctets
    // à chaque calcul d'itinéraire.
    this.g = new Float32Array(N);
    this.came = new Int32Array(N);
    this.stamp = new Int32Array(N);      // nœud découvert à cette génération
    this.closed = new Int32Array(N);     // nœud déjà développé à cette génération
    this.gen = 0;
    this.heap = new Heap(Math.min(N * 3 + 64, 900000));

    this.build();
  }

  build() {
    const t = this.terrain;
    for (let i = 0; i < this.costFoot.length; i++) {
      const type = t.type[i];
      const c = COST[type] || COST[T.FIELD];
      this.costFoot[i] = c[0];
      this.costWheel[i] = c[1];
      this.costTrack[i] = c[2];
      this.solid[i] = t.building[i] >= 0 ? 1 : 0;
      this.wet[i] = type === T.WATER ? 1 : 0;
    }
  }

  index(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n) return -1;
    return cy * this.n + cx;
  }
  cellOf(x, y) { return this.terrain.idx(x, y); }
  center(i) { return this.terrain.cellCenter(i); }

  // Cellule libre la plus proche, cherchée en anneaux croissants.
  nearestFreeCell(x, y, rings = 12) {
    const t = this.terrain;
    const cx0 = t.ix(x), cy0 = t.iy(y);
    for (let r = 0; r <= rings; r++) {
      let best = null, bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const j = this.index(cx0 + dx, cy0 + dy);
          if (j < 0 || this.solid[j]) continue;
          const p = t.cellCenter(j);
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestD) { bestD = d; best = p; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  passable(i, mode, allowBuilding) {
    if (this.solid[i]) return allowBuilding >= 0 && this.terrain.building[i] === allowBuilding;
    if (mode !== 'foot' && this.wet[i]) return false;
    return true;
  }

  stepCost(i, mode) {
    return mode === 'wheel' ? this.costWheel[i] : mode === 'track' ? this.costTrack[i] : this.costFoot[i];
  }

  // A*. `allowBuilding` = id du bâtiment que l'on a le droit de pénétrer (destination).
  find(sx, sy, tx, ty, opts = {}) {
    const mode = opts.mode || 'foot';
    const allowBuilding = opts.allowBuilding != null ? opts.allowBuilding : -1;
    const avoid = opts.avoid || null;
    const maxNodes = opts.maxNodes || 150000;
    const t = this.terrain, n = this.n;

    // Une destination inaccessible est ramenée sur la cellule libre la plus proche.
    let goal = this.cellOf(tx, ty);
    if (goal < 0) return null;
    if (!this.passable(goal, mode, allowBuilding)) {
      const free = this.nearestFreeCell(tx, ty, 14);
      if (!free) return null;
      tx = free.x; ty = free.y;
      goal = this.cellOf(tx, ty);
      if (goal < 0 || !this.passable(goal, mode, allowBuilding)) return null;
    }

    const start = this.cellOf(sx, sy);
    if (start < 0) return null;
    if (start === goal) return [{ x: sx, y: sy }, { x: tx, y: ty }];

    const gen = ++this.gen;
    const g = this.g, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();

    // Sur une grande zone, une heuristique plus agressive divise le nombre de
    // nœuds développés : le chemin est marginalement plus long, le calcul bien plus court.
    const hw = n > 700 ? 1.35 : n > 400 ? 1.20 : 1.06;

    const gx = goal % n, gy = (goal - gx) / n;
    const heur = i => {
      const x = i % n, y = (i - x) / n;
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy);
    };

    // zones à éviter, converties en cellules
    const zones = avoid ? avoid.map(z => ({ cx: t.ix(z.x), cy: t.iy(z.y), rc: Math.max(1, z.r / CELL), w: z.w || 6 })) : null;

    g[start] = 0; came[start] = -1; stamp[start] = gen;
    heap.push(start, heur(start));
    let expanded = 0, best = start, bestH = heur(start);

    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;            // doublon périmé dans la file
      closed[cur] = gen;
      if (cur === goal) return this.reconstruct(came, cur, sx, sy, tx, ty, mode, allowBuilding);
      if (++expanded > maxNodes) break;

      const hh = heur(cur);
      if (hh < bestH) { bestH = hh; best = cur; }

      const cx = cur % n, cy = (cur - cx) / n;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const ni = ny * n + nx;
          if (closed[ni] === gen) continue;
          if (!this.passable(ni, mode, allowBuilding)) continue;

          const diag = dx && dy;
          if (diag) {
            // on ne coupe pas l'angle d'un bâtiment en diagonale
            if (!this.passable(cy * n + nx, mode, allowBuilding)) continue;
            if (!this.passable(ny * n + cx, mode, allowBuilding)) continue;
          }

          let step = this.stepCost(ni, mode) * (diag ? 1.4142 : 1);
          if (!isFinite(step)) continue;

          // pente : monter coûte cher, descendre un peu
          const dz = t.elev[ni] - t.elev[cur];
          const slope = Math.abs(dz) / (diag ? CELL * 1.4142 : CELL);
          step *= 1 + slope * (dz > 0 ? 6 : 2);

          if (zones) {
            for (const z of zones) {
              const d = Math.hypot(nx - z.cx, ny - z.cy);
              if (d < z.rc) step += z.w * (1 - d / z.rc);
            }
          }

          const ng = g[cur] + step;
          if (stamp[ni] !== gen || ng < g[ni]) {
            stamp[ni] = gen; g[ni] = ng; came[ni] = cur;
            heap.push(ni, ng + heur(ni) * hw);
          }
        }
      }
    }

    // pas de chemin complet : on rejoint le point le plus proche atteint
    if (best !== start) {
      const c = this.center(best);
      return this.reconstruct(came, best, sx, sy, c.x, c.y, mode, allowBuilding);
    }
    return null;
  }

  reconstruct(came, end, sx, sy, tx, ty, mode, allowBuilding) {
    const cells = [];
    let cur = end, guard = 0;
    while (cur !== -1 && guard++ < 200000) { cells.push(cur); cur = came[cur]; }
    cells.reverse();

    // On part de la position réelle de l'unité : partir du centre de la cellule
    // la ferait reculer à chaque recalcul, et elle n'avancerait jamais.
    const pts = [{ x: sx, y: sy }];
    for (let k = 1; k < cells.length; k++) pts.push(this.center(cells[k]));
    pts.push({ x: tx, y: ty });
    return this.simplify(pts, mode, allowBuilding);
  }

  // Supprime les points intermédiaires quand la ligne directe reste praticable :
  // évite l'aspect « escalier » des chemins de grille.
  simplify(pts, mode, allowBuilding) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 40);     // fenêtre bornée : le lissage reste rapide
      for (; j > i + 1; j--) if (this.clearLine(pts[i], pts[j], mode, allowBuilding)) break;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  clearLine(a, b, mode, allowBuilding) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.ceil(d / (CELL * 0.45));
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const i = this.cellOf(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      if (i < 0 || !this.passable(i, mode, allowBuilding)) return false;
    }
    return true;
  }
}

export function pathLength(path) {
  let d = 0;
  for (let i = 0; i + 1 < path.length; i++) d += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
  return d;
}

// Ligne de vue : masque de relief + obstruction cumulée par la végétation et le bâti.
// Retourne une transmittance 0..1 (1 = vue parfaitement dégagée).

import { CELL, TERRAIN } from './terrain.js';

const EYE_INF = 1.7;      // hauteur des yeux d'un fantassin debout
const EYE_PRONE = 0.4;
const EYE_VEH = 2.6;

export function eyeHeight(unit) {
  // en vol, l'observateur domine tout le terrain
  if (unit.spec && unit.spec.kind === 'air') {
    return unit.landed ? 2.5 : Math.max(2.5, unit.agl != null ? unit.agl : (unit.spec.altitude || 200));
  }
  if (unit.kind === 'vehicle') return EYE_VEH;
  if (unit.posture === 'prone') return EYE_PRONE;
  const b = unit.inBuilding;
  if (b != null) return EYE_INF + 3;   // tireur à l'étage
  return EYE_INF;
}

// Échantillonne le segment A->B. Coût : ~ (distance / CELL) itérations.
export function lineOfSight(terrain, ax, ay, az, bx, by, bz, maxRange) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1) return 1;
  if (maxRange && d > maxRange) return 0;

  const steps = Math.min(400, Math.max(2, Math.ceil(d / CELL)));
  const eA = terrain.elevAt(ax, ay) + az;
  const eB = terrain.elevAt(bx, by) + bz;

  let transmit = 1;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const px = ax + dx * t, py = ay + dy * t;
    const i = terrain.idx(px, py);
    if (i < 0) return 0;

    // 1. masque de relief
    const ray = eA + (eB - eA) * t;
    const ground = terrain.elev[i];
    if (ground > ray) return 0;

    // 2. obstruction du bâti : opaque sauf tout près de l'observateur ou de la cible
    if (terrain.building[i] >= 0) {
      const nearEnd = Math.min(t, 1 - t) * d;
      if (nearEnd > CELL * 1.5) return 0;
    }

    // 3. végétation : atténuation exponentielle
    const blk = TERRAIN[terrain.type[i]].blocking;
    if (blk > 0) {
      // hauteur du couvert (~8 m en forêt) : seulement si le rayon passe dedans
      const canopy = ground + (terrain.type[i] === 3 ? 9 : terrain.type[i] === 4 ? 8 : 1.5);
      if (ray < canopy) transmit *= Math.exp(-blk * (d / steps));
      if (transmit < 0.02) return 0;
    }
  }
  return transmit;
}

// Vue depuis une unité vers un point.
export function unitSees(terrain, observer, tx, ty, targetHeight, maxRange) {
  return lineOfSight(terrain, observer.x, observer.y, eyeHeight(observer),
                     tx, ty, targetHeight, maxRange);
}

// Dénivelé positif entre deux points (pour la fatigue et le choix d'itinéraire).
export function climbBetween(terrain, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / CELL));
  let up = 0, prev = terrain.elevAt(ax, ay);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const e = terrain.elevAt(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (e > prev) up += e - prev;
    prev = e;
  }
  return up;
}

// Domine-t-on la position ? Sert au choix des points d'appui par l'IA.
export function dominance(terrain, x, y, radius) {
  const e = terrain.elevAt(x, y);
  let below = 0, total = 0;
  for (let a = 0; a < 8; a++) {
    const ang = a * Math.PI / 4;
    for (let r = radius * 0.3; r <= radius; r += radius * 0.35) {
      const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
      if (!terrain.inside(px, py)) continue;
      total++;
      if (terrain.elevAt(px, py) < e) below++;
    }
  }
  return total ? below / total : 0.5;
}

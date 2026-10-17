// IA d'exécution. Le joueur donne une mission, l'unité choisit son itinéraire,
// sa posture, ses points d'appui et son feu.

import { CELL, TERRAIN, T } from '../world/terrain.js';
import { dominance, lineOfSight, eyeHeight } from '../world/los.js';
import { selectTarget, resolveFire, updateMorale, applyDamage } from './combat.js';
import { LVL } from './sensors.js';
import { makeOrder, ORDERS } from './orders.js';
import { azimuth, clamp, dist, formatDist } from '../core/util.js';
import { POSTURE } from './catalog.js';
import { TYPE_FR } from './intel.js';
import { updateTactical } from './tactics.js';
import { flyStep, beginLanding, bingoFuel, cruiseAgl } from './flight.js';

// ---------------------------------------------------------------- déplacement

export function moveMode(unit) {
  if (unit.spec.kind === 'air') return 'air';
  if (unit.spec.kind === 'squad') return 'foot';
  return unit.spec.tracked ? 'track' : 'wheel';
}

export function setDestination(world, unit, x, y, opts = {}) {
  const key = Math.round(x) + ':' + Math.round(y) + ':' + (opts.allowBuilding || -1);
  if (unit.destKey === key && unit.path && world.time < unit.repathAt) return true;

  // Un aéronef vole droit au but : ni relief ni bâti ne le contraignent.
  if (unit.spec.kind === 'air') {
    unit.path = [{ x: unit.x, y: unit.y }, { x, y }];
    unit.pathIdx = 0;
    unit.destKey = key;
    unit.dest = { x, y };
    unit.repathAt = world.time + 6;
    return true;
  }

  // On contourne les menaces connues, sauf quand la mission est justement d'aller au contact.
  const closeWithEnemy = unit.order && (unit.order.type === 'ATTAQUER' || unit.order.type === 'RECHERCHE');
  const path = world.nav.find(unit.x, unit.y, x, y, {
    mode: moveMode(unit),
    allowBuilding: opts.allowBuilding != null ? opts.allowBuilding : -1,
    avoid: opts.avoid || (closeWithEnemy ? null : threatZones(world, unit)),
  });
  unit.path = path;
  unit.pathIdx = 0;
  unit.destKey = key;
  unit.dest = { x, y };
  unit.repathAt = world.time + 25 + world.rng() * 15;
  return !!path;
}

export function clearPath(unit) { unit.path = null; unit.pathIdx = 0; unit.destKey = null; unit.dest = null; }

// Zones à éviter : contacts ennemis connus par l'unité (et par le PC pour les alliés).
function threatZones(world, unit) {
  const out = [];
  const src = unit.side === 'BLUFOR' ? world.intel.contacts.values() : [];
  for (const c of src) {
    if (c.level < LVL.HEARD) continue;
    if (world.time - c.lastFresh > 180) continue;
    out.push({ x: c.x, y: c.y, r: 260, w: c.level >= LVL.SEEN ? 9 : 4 });
  }
  for (const [, c] of unit.contacts) {
    if (c.level < LVL.SEEN) continue;
    out.push({ x: c.x, y: c.y, r: 220, w: 8 });
  }
  return out.length ? out.slice(0, 40) : null;
}

// Avance le long du chemin. Retourne true quand la destination est atteinte.
export function advance(world, unit, dt) {
  const terrain = world.terrain;

  // Un aéronef obéit à sa mécanique de vol, pas au suivi de chemin au sol.
  if (unit.spec.kind === 'air') {
    const tgt = (unit.path && unit.path[unit.path.length - 1]) || unit.dest;
    if (!tgt) { holdAir(world, unit, dt); return true; }
    const done = flyStep(world, unit, tgt.x, tgt.y, dt, false);
    trailOf(world, unit);
    return done;
  }

  if (!unit.path || unit.pathIdx >= unit.path.length) {
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    return true;
  }
  if (unit.suppression > 0.85) {           // cloué au sol : on ne bouge plus
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    return false;
  }

  let budget = dt;
  let guard = 0;
  while (budget > 0 && unit.pathIdx < unit.path.length && guard++ < 8) {
    const tgt = unit.path[unit.pathIdx];
    const dx = tgt.x - unit.x, dy = tgt.y - unit.y;
    const d = Math.hypot(dx, dy);
    if (d < 2.5) { unit.pathIdx++; continue; }

    // Veille de progression : on ne s'acharne pas sur un point de passage inatteignable.
    if (unit.progIdx !== unit.pathIdx) {
      unit.progIdx = unit.pathIdx; unit.progD = d; unit.progT = world.time; unit.progRetried = false;
    } else if (d < unit.progD - 1.5) {
      unit.progD = d; unit.progT = world.time; unit.progRetried = false;
    } else if (world.time - unit.progT > 10) {
      unit.progIdx = -1;
      if (!unit.progRetried) {
        unit.progRetried = true;
        const dest = unit.dest;                  // clearPath efface dest, on le garde d'abord
        if (dest) {
          clearPath(unit);
          unit.repathAt = 0;
          setDestination(world, unit, dest.x, dest.y, { allowBuilding: unit.allowBuilding });
        }
      } else {
        unit.pathIdx++;                          // on abandonne ce point et on passe au suivant
      }
      unit.speed = 0;
      unit.updateFatigue(world, dt, false);
      return false;
    }

    const nx = dx / d, ny = dy / d;
    const v = unit.currentSpeed(terrain, nx, ny);
    const step = Math.min(d, v * budget);
    const px = unit.x + nx * step, py = unit.y + ny * step;

    let moved = canOccupy(world, unit, px, py) ? { x: px, y: py } : slide(world, unit, nx, ny, step);
    if (!moved) {
      // vraiment coincé : on recalcule, au plus une fois toutes les 3 s
      if (world.time > (unit.blockedUntil || 0)) {
        unit.blockedUntil = world.time + 3;
        const dest = unit.dest;                    // clearPath efface dest, on le garde d'abord
        if (dest) {
          clearPath(unit);
          unit.repathAt = 0;
          setDestination(world, unit, dest.x, dest.y, { allowBuilding: unit.allowBuilding });
        }
      } else if ((unit.stuck = (unit.stuck || 0) + 1) > 60) {
        unit.stuck = 0;
        unit.pathIdx++;                            // point de passage inatteignable : on l'abandonne
      }
      unit.speed = 0;
      unit.updateFatigue(world, dt, false);
      return false;
    }
    unit.stuck = 0;

    unit.x = moved.x; unit.y = moved.y;
    if (unit.spec.kind === 'air') unit.landed = false;
    unit.heading = azimuth({ x: 0, y: 0 }, { x: nx, y: ny });
    unit.speed = v;
    budget -= step / Math.max(0.05, v);
    if (step >= d - 1e-6 && moved.x === px && moved.y === py) unit.pathIdx++;
  }

  unit.updateFatigue(world, dt, true);
  if (unit.spec.fuel) {
    unit.fuel = clamp(unit.fuel - unit.speed * dt * unit.spec.fuelUse / unit.spec.fuel, 0, 1);
  }
  // sillage pour l'affichage
  if (!unit.trail.length || dist(unit.trail[unit.trail.length - 1], unit) > 25) {
    unit.trail.push({ x: unit.x, y: unit.y, t: world.time });
    if (unit.trail.length > 60) unit.trail.shift();
  }
  return unit.pathIdx >= unit.path.length;
}

// Trace de progression, pour l'affichage.
function trailOf(world, unit) {
  if (!unit.trail.length || dist(unit.trail[unit.trail.length - 1], unit) > 25) {
    unit.trail.push({ x: unit.x, y: unit.y, t: world.time });
    if (unit.trail.length > 60) unit.trail.shift();
  }
}

// Aéronef sans destination : stationnaire pour une voilure tournante,
// orbite sur place pour une voilure fixe, qui ne peut pas s'arrêter en l'air.
export function holdAir(world, unit, dt) {
  if (unit.landed) { unit.speed = 0; return; }
  if (unit.spec.rotary) {
    flyStep(world, unit, unit.x, unit.y, dt, true);
  } else {
    unit.holdAngle = (unit.holdAngle || 0) + dt * 0.09;
    const r = 900;
    if (!unit.holdCentre) unit.holdCentre = { x: unit.x, y: unit.y };
    flyStep(world, unit,
      unit.holdCentre.x + Math.cos(unit.holdAngle) * r,
      unit.holdCentre.y + Math.sin(unit.holdAngle) * r, dt, false);
  }
}

// Contournement : on longe l'obstacle plutôt que de s'arrêter net.
// La mémoire du côté choisi évite l'oscillation gauche/droite devant un pâté de maisons.
function slide(world, unit, nx, ny, step) {
  const ANG = [30, 55, 80, 105, 130];
  const keep = world.time < (unit.slideUntil || -1) ? (unit.slideSign || 1) : 0;
  const order = [];
  if (keep) {
    for (const a of ANG) order.push(keep * a);
    for (const a of ANG) order.push(-keep * a);
  } else {
    for (const a of ANG) { order.push(a); order.push(-a); }
  }
  for (const deg of order) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = nx * c - ny * s, dy = nx * s + ny * c;
    const px = unit.x + dx * step, py = unit.y + dy * step;
    if (canOccupy(world, unit, px, py)) {
      unit.slideSign = deg < 0 ? -1 : 1;
      unit.slideUntil = world.time + 5;
      return { x: px, y: py };
    }
  }
  return null;
}

function canOccupy(world, unit, x, y) {
  const t = world.terrain;
  if (!t.inside(x, y)) return false;
  if (unit.spec.kind === 'air') return true;      // rien n'arrête un aéronef en vol
  const b = t.buildingAt(x, y);
  if (b >= 0 && b !== unit.allowBuilding) return false;
  if (unit.spec.kind === 'vehicle' && t.typeAt(x, y) === T.WATER) return false;
  return true;
}

// ------------------------------------------------------------ bâtiments

export function enterBuilding(world, unit, id) {
  if (unit.inBuilding === id) return true;
  const b = world.terrain.buildings[id];
  if (!b) return false;
  if (b.occupants.length + unit.alive > b.capacity) return false;
  leaveBuilding(world, unit);
  b.occupants.push(unit.id);
  unit.inBuilding = id;
  unit.allowBuilding = id;
  return true;
}
export function leaveBuilding(world, unit) {
  if (unit.inBuilding == null) return;
  const b = world.terrain.buildings[unit.inBuilding];
  if (b) { const i = b.occupants.indexOf(unit.id); if (i >= 0) b.occupants.splice(i, 1); }
  unit.inBuilding = null;
  unit.allowBuilding = -1;
}

export function nearbyBuildings(world, x, y, radius) {
  const out = [];
  for (const b of world.terrain.buildings) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d <= radius) out.push({ b, d });
  }
  out.sort((p, q) => p.d - q.d);
  return out;
}

// ------------------------------------------------------------ choix de position

// Cherche un emplacement de combat : protection, dissimulation, vue et domination.
export function findFightingPosition(world, unit, cx, cy, radius, opts = {}) {
  const t = world.terrain;
  const rng = world.rng;
  const facing = opts.facing;               // direction de la menace {x,y}
  const useBuildings = opts.buildings !== false && unit.spec.kind === 'squad';

  let best = null, bestScore = -Infinity;
  const samples = 42;

  const candidates = [];
  if (useBuildings) {
    for (const { b, d } of nearbyBuildings(world, cx, cy, radius).slice(0, 6)) {
      if (b.occupants.length + unit.alive <= b.capacity) candidates.push({ x: b.x, y: b.y, building: b.id, d });
    }
  }
  for (let i = 0; i < samples; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    candidates.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, building: -1, d: r });
  }
  candidates.push({ x: cx, y: cy, building: -1, d: 0 });

  for (const c of candidates) {
    if (!t.inside(c.x, c.y)) continue;
    const bAt = t.buildingAt(c.x, c.y);
    if (bAt >= 0 && bAt !== c.building) continue;
    if (unit.spec.kind === 'vehicle') {
      if (bAt >= 0) continue;
      const ty = t.typeAt(c.x, c.y);
      if (ty === T.WATER) continue;
      if (!unit.spec.tracked && !TERRAIN[ty].road && TERRAIN[ty].cost > 1.4) continue;
    }
    let score = 0;
    score += t.protectionAt(c.x, c.y) * 3.2;
    score += t.concealmentAt(c.x, c.y) * 1.8;
    score += dominance(t, c.x, c.y, 320) * 2.4;
    if (c.building >= 0) score += 1.6;
    score -= (c.d / Math.max(1, radius)) * 1.4;

    if (facing) {
      // on veut voir venir : bonus si la vue est dégagée vers la menace
      const tr = lineOfSight(t, c.x, c.y, eyeHeight(unit), facing.x, facing.y, 1.6, 1500);
      score += tr * 2.6;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// ------------------------------------------------------------ feu

function indirectTargets(world, unit) {
  const out = [];
  for (const c of world.intel.contacts.values()) {
    if (c.level < LVL.SEEN) continue;
    if (world.time - c.lastFresh > 25) continue;
    out.push(c);
  }
  return out;
}

export function engage(world, unit, dt) {
  if (unit.side === 'CIV') return false;
  if (unit.isMounted) return false;
  if (!unit.spec.weapon || !unit.spec.weapon.rof) return false;

  if (unit.spec.weapon.indirect) {
    // Tir indirect : uniquement sur mission de feu (ordre SOUTENIR, ou pièce engagée
    // dans une attaque). Sans cela la pièce se vide seule en quelques minutes.
    const onCall = unit.order && (unit.order.type === 'SOUTENIR' || unit.order.type === 'ATTAQUER');
    const cid = unit.fireMission;
    let target = null;
    if (cid != null) target = world.byId.get(cid);
    if ((!target || target.destroyed) && onCall) {
      const cands = indirectTargets(world, unit);
      if (cands.length) {
        cands.sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y));
        target = world.byId.get(cands[0].id);
        unit.fireMission = target ? target.id : null;
      }
    }
    if (!target || target.destroyed) { unit.engaging = null; return false; }
    return resolveFire(world, unit, target, dt);
  }

  const target = selectTarget(world, unit);
  if (!target) { unit.engaging = null; return false; }
  return resolveFire(world, unit, target, dt);
}

// Contacts vivants et frais connus de l'unité.
function liveContacts(world, unit, maxAge = 12) {
  const out = [];
  for (const [id, c] of unit.contacts) {
    if (c.level < LVL.SEEN) continue;
    if (world.time - c.lastSeen > maxAge) continue;
    const u = world.byId.get(id);
    if (u && !u.destroyed && u.side !== 'CIV') out.push({ c, u, d: Math.hypot(u.x - unit.x, u.y - unit.y) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// ------------------------------------------------------------ ordres

const HANDLERS = {};

HANDLERS.MOUVEMENT = (world, unit, o, dt) => {
  unit.posture = o.posture;
  const wp = o.waypoints[o.wpIndex];
  if (!wp) { finish(world, unit, o); return; }
  o.phase = 'move';
  setDestination(world, unit, wp.x, wp.y);
  if (advance(world, unit, dt)) {
    o.wpIndex++;
    clearPath(unit);
    if (o.wpIndex >= o.waypoints.length) {
      if (o.loop) o.wpIndex = 0; else finish(world, unit, o);
    }
  }
  engage(world, unit, dt);
};

// Un aéronef ne progresse pas par bonds : il se présente à distance de tir et
// traite l'objectif. La voilure tournante tient un stationnaire, la voilure fixe
// enchaîne les orbites — elle ne peut pas s'arrêter en l'air.
function airAttack(world, unit, o, dt, obj) {
  const foes = liveContacts(world, unit, 14);
  const range = unit.spec.weapon.range || 0;
  const target = foes.length ? foes[0] : null;
  const aim = target ? { x: target.u.x, y: target.u.y } : obj;
  const standoff = Math.max(250, range * 0.7);
  const d = Math.hypot(aim.x - unit.x, aim.y - unit.y);

  if (unit.spec.rotary) {
    if (d > standoff) {
      o.phase = 'approach';
      setDestination(world, unit, aim.x, aim.y);
      advance(world, unit, dt);
    } else {
      o.phase = 'fix';                      // stationnaire de tir, atteint en décélérant
      flyStep(world, unit, aim.x, aim.y, dt, true);
    }
  } else {
    // orbite autour de l'objectif : l'appareil reste en mouvement
    o.memo.orbit = (o.memo.orbit || world.rng() * 6.28) + dt * 0.10;
    o.phase = d > standoff * 2 ? 'approach' : 'overwatch';
    const r = standoff;
    setDestination(world, unit,
      aim.x + Math.cos(o.memo.orbit) * r,
      aim.y + Math.sin(o.memo.orbit) * r);
    advance(world, unit, dt);
  }

  engage(world, unit, dt);

  if (!target && Math.hypot(obj.x - unit.x, obj.y - unit.y) < standoff * 1.2 && o.since > 60) {
    world.intel.transmit(unit, 'Objectif survolé, plus rien à traiter. Je reste en attente.', 'status');
    o.phase = 'overwatch';
  }
}

HANDLERS.ATTAQUER = (world, unit, o, dt) => {
  const obj = o.waypoints[o.waypoints.length - 1] || o.target;
  if (!obj) { finish(world, unit, o); return; }
  if (unit.spec.kind === 'air') return airAttack(world, unit, o, dt, obj);
  const foes = liveContacts(world, unit, 10);
  const range = unit.spec.weapon.range;

  if (o.phase === 'init') { o.phase = 'approach'; o.memo.boundEnd = 0; }

  if (o.phase === 'approach' || o.phase === 'bound') {
    unit.posture = foes.length ? 'tactical' : (dist(unit, obj) > 600 ? 'normal' : 'tactical');
    const wp = o.waypoints[o.wpIndex] || obj;
    setDestination(world, unit, wp.x, wp.y);
    const arrived = advance(world, unit, dt);
    if (arrived) {
      if (o.wpIndex < o.waypoints.length - 1) { o.wpIndex++; clearPath(unit); }
      else if (!foes.length) { o.phase = 'consolidate'; o.memo.consolidateAt = world.time; }
    }
    if (foes.length && foes[0].d < range * 0.85) {
      o.phase = 'fix'; o.memo.fixSince = world.time; clearPath(unit);
    }
    if (o.phase === 'bound' && world.time > o.memo.boundEnd) { o.phase = 'fix'; o.memo.fixSince = world.time; clearPath(unit); }
  } else if (o.phase === 'fix') {
    unit.posture = unit.suppression > 0.4 ? 'prone' : 'tactical';
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    if (!foes.length && world.time - o.memo.fixSince > 8) {
      o.phase = dist(unit, obj) < 60 ? 'consolidate' : 'approach';
      o.memo.consolidateAt = world.time;
    } else if (foes.length) {
      // on progresse par bonds quand l'adversaire est suffisamment cloué
      const pinned = foes[0].u.suppression > 0.55 || foes[0].u.effective === 0;
      const longEnough = world.time - o.memo.fixSince > 12;
      if ((pinned || longEnough) && unit.suppression < 0.35 && unit.morale > 0.45) {
        const tx = foes[0].u.x, ty = foes[0].u.y;
        const d = Math.hypot(tx - unit.x, ty - unit.y);
        const step = Math.min(70, Math.max(25, d * 0.35));
        const spot = findFightingPosition(world, unit,
          unit.x + (tx - unit.x) / d * step, unit.y + (ty - unit.y) / d * step, 35,
          { facing: { x: tx, y: ty }, buildings: d > 60 });
        if (spot) {
          setDestination(world, unit, spot.x, spot.y, { allowBuilding: spot.building });
          unit.allowBuilding = spot.building;
          o.phase = 'bound';
          o.memo.boundEnd = world.time + 22;
          unit.posture = d < 90 ? 'rush' : 'tactical';
        }
      }
    }
  } else if (o.phase === 'consolidate') {
    holdPosition(world, unit, o, dt, obj, 90);
  }
  engage(world, unit, dt);
};

HANDLERS.DEFENDRE = (world, unit, o, dt) => {
  const c = o.target || o.waypoints[0];
  if (!c) { finish(world, unit, o); return; }
  if (o.phase === 'init') o.phase = 'move';
  if (o.phase === 'move') {
    unit.posture = 'normal';
    if (!o.memo.spot) {
      o.memo.spot = findFightingPosition(world, unit, c.x, c.y, o.radius, { facing: o.facing });
    }
    const s = o.memo.spot || c;
    unit.allowBuilding = s.building != null ? s.building : -1;
    setDestination(world, unit, s.x, s.y, { allowBuilding: s.building });
    if (advance(world, unit, dt)) {
      clearPath(unit);
      if (s.building != null && s.building >= 0) enterBuilding(world, unit, s.building);
      o.phase = 'hold';
      world.intel.transmit(unit, 'En position sur l’objectif, dispositif en place.', 'status');
    }
  } else {
    holdPosition(world, unit, o, dt, c, o.radius);
  }
  engage(world, unit, dt);
};

HANDLERS.GARDER = (world, unit, o, dt) => {
  const c = o.target || o.waypoints[0];
  if (!c) { finish(world, unit, o); return; }
  const foes = liveContacts(world, unit, 12);
  if (o.phase === 'init') o.phase = 'move';

  if (foes.length) {
    const f = foes[0];
    const dFromPost = Math.hypot(f.u.x - c.x, f.u.y - c.y);
    if (dFromPost < o.radius * 1.6 && f.d > unit.spec.weapon.range * 0.7) {
      // intrusion : on se déplace pour l'intercepter, sans quitter la zone
      const ix = c.x + (f.u.x - c.x) / Math.max(1, dFromPost) * Math.min(o.radius, dFromPost);
      const iy = c.y + (f.u.y - c.y) / Math.max(1, dFromPost) * Math.min(o.radius, dFromPost);
      const spot = findFightingPosition(world, unit, ix, iy, 60, { facing: f.u });
      if (spot) { setDestination(world, unit, spot.x, spot.y, { allowBuilding: spot.building }); o.phase = 'move'; o.memo.spot = spot; }
    } else {
      o.phase = 'hold';
    }
  }

  if (o.phase === 'move') {
    unit.posture = 'tactical';
    const s = o.memo.spot || (o.memo.spot = findFightingPosition(world, unit, c.x, c.y, o.radius * 0.6, {}) || c);
    setDestination(world, unit, s.x, s.y, { allowBuilding: s.building });
    if (advance(world, unit, dt)) { clearPath(unit); o.phase = 'hold'; }
  } else {
    holdPosition(world, unit, o, dt, c, o.radius, 0.4);
  }
  engage(world, unit, dt);
};

HANDLERS.PATROUILLER = (world, unit, o, dt) => {
  if (!o.waypoints.length) { finish(world, unit, o); return; }
  const foes = liveContacts(world, unit, 8);
  unit.posture = foes.length ? 'tactical' : 'tactical';

  if (foes.length && !o.memo.halted && unit.spec.kind !== 'air') {
    o.memo.halted = world.time;
    world.intel.transmit(unit, 'Halte au contact, je prends la position.', 'status', 1);
  }
  if (o.memo.halted && !foes.length && world.time - o.memo.halted > 20) o.memo.halted = 0;

  if (o.memo.halted) {
    o.phase = 'fix';
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
  } else {
    o.phase = 'move';
    const wp = o.waypoints[o.wpIndex];
    setDestination(world, unit, wp.x, wp.y);
    if (advance(world, unit, dt)) {
      clearPath(unit);
      o.wpIndex = (o.wpIndex + 1) % o.waypoints.length;
      if (o.wpIndex === 0 && !o.loop) finish(world, unit, o);
    }
  }
  engage(world, unit, dt);
};

HANDLERS.RECHERCHE = (world, unit, o, dt) => {
  const c = o.target || o.waypoints[0];
  if (!c) { finish(world, unit, o); return; }
  if (o.phase === 'init') {
    o.memo.points = buildSearchPattern(world, unit, c, o.radius);
    o.memo.pi = 0;
    o.phase = 'search';
  }
  unit.posture = 'tactical';
  const foes = liveContacts(world, unit, 10);

  if (foes.length && foes[0].d < unit.spec.weapon.range * 0.8) {
    o.phase = 'fix';
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    if (!o.memo.contactAt) {
      o.memo.contactAt = world.time;
      world.intel.transmit(unit, 'Élément ennemi accroché dans la zone, je traite.', 'status', 1);
    }
    engage(world, unit, dt);
    return;
  }
  o.memo.contactAt = 0;

  const pts = o.memo.points || [];
  if (o.memo.pi >= pts.length) {
    world.intel.transmit(unit, 'Zone ratissée, rien à signaler de plus.', 'status');
    o.phase = 'consolidate';
    holdPosition(world, unit, o, dt, c, o.radius * 0.4);
    engage(world, unit, dt);
    return;
  }

  const p = pts[o.memo.pi];
  if (p.building >= 0 && o.phase !== 'clear') {
    unit.allowBuilding = p.building;
  }
  setDestination(world, unit, p.x, p.y, { allowBuilding: p.building });
  if (advance(world, unit, dt)) {
    clearPath(unit);
    if (p.building >= 0 && o.phase !== 'clear') {
      o.phase = 'clear';
      o.memo.clearUntil = world.time + 18 + world.rng() * 12;
    } else if (o.phase === 'clear') {
      if (world.time >= o.memo.clearUntil) {
        o.phase = 'search';
        unit.allowBuilding = -1;
        o.memo.pi++;
      } else {
        unit.speed = 0;
        unit.updateFatigue(world, dt, false);
      }
    } else {
      o.memo.pi++;
    }
  }
  engage(world, unit, dt);
};

HANDLERS.FORTIFIER = (world, unit, o, dt) => {
  const c = o.target || o.waypoints[0] || { x: unit.x, y: unit.y };
  if (o.phase === 'init') {
    o.memo.spot = findFightingPosition(world, unit, c.x, c.y, o.radius, {});
    o.phase = 'move';
  }
  if (o.phase === 'move') {
    unit.posture = 'normal';
    const s = o.memo.spot || c;
    setDestination(world, unit, s.x, s.y, { allowBuilding: s.building });
    if (advance(world, unit, dt)) {
      clearPath(unit);
      if (s.building != null && s.building >= 0) enterBuilding(world, unit, s.building);
      o.phase = 'dig';
      world.intel.transmit(unit, 'Début de l’organisation du terrain.', 'status');
    }
  } else {
    unit.posture = 'tactical';
    unit.speed = 0;
    const rate = 0.0016 * (1 + (unit.spec.engineer || 0) * 1.6) * clamp(unit.effective / unit.initialStrength, 0.2, 1);
    const before = unit.fortify;
    unit.fortify = clamp(unit.fortify + rate * dt * (1 - unit.fatigue * 0.5), 0, 1);
    // creuser fatigue
    for (const s of unit.soldiers) if (s.wound < 3) s.fatigue = clamp(s.fatigue + dt * 0.00007, 0, 1);
    if (before < 1 && unit.fortify >= 1) {
      world.intel.transmit(unit, 'Position organisée, prête à recevoir.', 'status');
      o.phase = 'hold';
    }
  }
  engage(world, unit, dt);
};

HANDLERS.RENFORCER = (world, unit, o, dt) => {
  const tgt = world.byId.get(o.targetUnit);
  if (!tgt || tgt.destroyed) { finish(world, unit, o); return; }
  const d = dist(unit, tgt);
  if (d > 45) {
    o.phase = 'move';
    unit.posture = d > 400 ? 'normal' : 'tactical';
    setDestination(world, unit, tgt.x, tgt.y);
    advance(world, unit, dt);
  } else {
    o.phase = 'hold';
    clearPath(unit);
    unit.posture = tgt.posture;
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    // partage de munitions et raffermissement
    if (unit.ammo > tgt.ammo + 0.15) {
      const give = Math.min(dt * 0.01, (unit.ammo - tgt.ammo) / 2);
      unit.ammo -= give; tgt.ammo += give;
    }
    tgt.morale = clamp(tgt.morale + dt * 0.004, 0, 1);
  }
  engage(world, unit, dt);
};

HANDLERS.SOUTENIR = (world, unit, o, dt) => {
  const tgt = world.byId.get(o.targetUnit);
  if (!tgt || tgt.destroyed) { finish(world, unit, o); return; }
  const range = unit.spec.weapon.range;
  const d = dist(unit, tgt);

  // objectif : se poster à portée d'appui du soutenu, en vue de ses contacts
  const foesOfTarget = [];
  for (const [id, c] of tgt.contacts) {
    if (c.level < LVL.SEEN || world.time - c.lastSeen > 20) continue;
    const u = world.byId.get(id);
    if (u && !u.destroyed) foesOfTarget.push(u);
  }
  // partage de renseignement sur le même réseau
  for (const u of foesOfTarget) {
    if (!unit.contacts.has(u.id)) {
      unit.contacts.set(u.id, {
        id: u.id, awareness: 1.3, level: LVL.SEEN, lastSeen: world.time - 4, lastUpdate: world.time,
        x: u.x, y: u.y, err: 60, type: null, strength: null, reportedLevel: LVL.SEEN, reportedAt: world.time,
      });
    }
  }
  if (unit.spec.weapon.indirect && foesOfTarget.length) unit.fireMission = foesOfTarget[0].id;

  const wantDist = Math.min(range * 0.55, 350);
  if (d > wantDist * 1.4 || !o.memo.spot) {
    if (!o.memo.spot || world.time - (o.memo.spotAt || 0) > 25) {
      const facing = foesOfTarget[0] || null;
      o.memo.spot = findFightingPosition(world, unit, tgt.x, tgt.y, Math.max(80, wantDist), { facing });
      o.memo.spotAt = world.time;
    }
  }
  const s = o.memo.spot;
  if (s && Math.hypot(s.x - unit.x, s.y - unit.y) > 30) {
    o.phase = 'move';
    unit.posture = 'tactical';
    setDestination(world, unit, s.x, s.y, { allowBuilding: s.building });
    advance(world, unit, dt);
  } else {
    o.phase = 'support';
    clearPath(unit);
    unit.speed = 0;
    unit.posture = 'tactical';
    unit.updateFatigue(world, dt, false);
  }
  engage(world, unit, dt);
};

HANDLERS.REARMER = (world, unit, o, dt) => {
  if (o.phase === 'init') {
    const src = findSupply(world, unit);
    if (!src) {
      world.intel.transmit(unit, 'Aucun point de ravitaillement accessible.', 'warn', 1);
      finish(world, unit, o);
      return;
    }
    o.memo.src = src;
    o.phase = 'move';
  }
  const src = o.memo.src;
  const p = src.unit ? { x: src.unit.x, y: src.unit.y } : src;
  const d = Math.hypot(p.x - unit.x, p.y - unit.y);
  if (o.phase === 'move') {
    unit.posture = 'normal';
    setDestination(world, unit, p.x, p.y);
    advance(world, unit, dt);
    if (d < (unit.spec.kind === 'air' ? 260 : 30)) {
      o.phase = 'resupply';
      if (unit.spec.kind === 'air') {
        beginLanding(unit);
        flyStep(world, unit, p.x, p.y, dt, true);
        if (!unit.landed) return;              // on termine l'approche avant de plein
        unit.emergency = false;
      }
      clearPath(unit);
      world.intel.transmit(unit, unit.spec.kind === 'air'
        ? 'Posé sur la base, ravitaillement et remise en œuvre.'
        : 'Sur le point de ravitaillement, complètement des dotations.', 'log');
    }
  } else {
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    const rate = 0.035;
    unit.ammo = clamp(unit.ammo + rate * dt, 0, 1);
    if (unit.spec.fuel) unit.fuel = clamp(unit.fuel + rate * 0.6 * dt, 0, 1);
    if (src.unit && src.unit.supplies != null) src.unit.supplies = clamp(src.unit.supplies - rate * 0.35 * dt, 0, 1);
    if (unit.ammo >= 0.99 && (!unit.spec.fuel || unit.fuel >= 0.98)) {
      world.intel.transmit(unit, 'Dotations complètes, prêt à repartir.', 'status');
      finish(world, unit, o);
    }
  }
  engage(world, unit, dt);
};

HANDLERS.SOIGNER = (world, unit, o, dt) => {
  const isMedic = (unit.spec.medic || 0) >= 0.8;
  if (o.phase === 'init') {
    if (isMedic) {
      const patient = o.targetUnit != null ? world.byId.get(o.targetUnit) : findMostWounded(world, unit);
      if (!patient) { world.intel.transmit(unit, 'Aucun blessé à traiter.', 'log'); finish(world, unit, o); return; }
      o.targetUnit = patient.id;
    } else {
      const ccp = findMedicalPoint(world, unit);
      o.memo.ccp = ccp;
    }
    o.phase = 'move';
  }

  if (isMedic) {
    const patient = world.byId.get(o.targetUnit);
    if (!patient || patient.wounded === 0) {
      const next = findMostWounded(world, unit);
      if (!next) { world.intel.transmit(unit, 'Plus de blessé à prendre en compte.', 'status'); finish(world, unit, o); return; }
      o.targetUnit = next.id;
      o.phase = 'move';
      clearPath(unit);
      return;
    }
    const d = dist(unit, patient);
    if (d > 22) {
      o.phase = 'move';
      unit.posture = 'normal';
      setDestination(world, unit, patient.x, patient.y);
      advance(world, unit, dt);
    } else {
      o.phase = 'treat';
      clearPath(unit);
      unit.speed = 0;
      unit.updateFatigue(world, dt, false);
      treat(world, patient, dt * (1 + (unit.spec.medic || 0)) * 1.6);
    }
  } else {
    const p = o.memo.ccp;
    if (!p) { treat(world, unit, dt * 0.25); o.phase = 'treat'; unit.speed = 0; return; }
    const d = Math.hypot(p.x - unit.x, p.y - unit.y);
    if (d > 25) {
      o.phase = 'move';
      unit.posture = 'normal';
      setDestination(world, unit, p.x, p.y);
      advance(world, unit, dt);
    } else {
      o.phase = 'treat';
      clearPath(unit);
      unit.speed = 0;
      unit.updateFatigue(world, dt, false);
      treat(world, unit, dt * 1.4);
      if (unit.wounded === 0) { world.intel.transmit(unit, 'Blessés pris en compte, unité reconditionnée.', 'status'); finish(world, unit, o); }
    }
  }
  engage(world, unit, dt);
};

// Ramène un point dans la zone d'opération, avec une marge de manœuvre.
function clampToAo(terrain, p, margin) {
  const lim = terrain.half - (margin != null ? margin : 700);
  return { x: clamp(p.x, -lim, lim), y: clamp(p.y, -lim, lim) };
}

// Plus longue pénétration tenant dans la zone, sur l'axe demandé.
function fitInside(terrain, aim, ax, want) {
  const lim = terrain.half - 700;
  for (let d = want; d > 500; d -= 200) {
    const px = aim.x - ax.x * d, py = aim.y - ax.y * d;
    if (Math.abs(px) < lim && Math.abs(py) < lim) return d;
  }
  return 500;
}

// ------------------------------------------------------------ passe de tir

// Distance du point initial (IP) au but, et prolongement au-delà pour le dégagement.
function passGeometry(unit) {
  return unit.spec.rotary
    ? { ip: 3200, standoff: 2400, over: 0 }        // la voilure tournante s'arrête sur l'axe
    : { ip: 8000, standoff: 0, over: 3000 };       // la voilure fixe traverse
}

HANDLERS.PASSE = (world, unit, o, dt) => {
  if (unit.spec.kind !== 'air') { finish(world, unit, o); return; }
  const aim = o.target || o.waypoints[0];
  if (!aim) { finish(world, unit, o); return; }

  unit.armament = o.armament || 'both';
  const geo = passGeometry(unit);

  // Axe de pénétration : du point désigné par le chef vers l'objectif. À défaut,
  // l'appareil arrive de là où il se trouve.
  if (!o.memo.axis) {
    const from = o.waypoints[1] || { x: unit.x, y: unit.y };
    const dx = aim.x - from.x, dy = aim.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    o.memo.axis = { x: dx / len, y: dy / len };
    o.memo.bearing = Math.round(azimuth(from, aim));
    // Le point initial doit rester dans la zone : sur un objectif proche d'un
    // bord, on raccourcit la pénétration plutôt que de viser un point hors carte,
    // que l'appareil ne pourrait jamais rallier.
    const run = fitInside(world.terrain, aim, o.memo.axis, geo.ip);
    o.memo.runIn = run;
    o.memo.ip = { x: aim.x - o.memo.axis.x * run, y: aim.y - o.memo.axis.y * run };
  }
  const ax = o.memo.axis;

  if (o.phase === 'init') {
    o.phase = 'ingress';
    const arme = o.armament === 'gun' ? 'au canon' : o.armament === 'missile' ? 'au missile' : 'canon et missile';
    world.intel.transmit(unit, 'Mission de tir acceptée : ' + o.passes + ' passe(s) ' + arme +
      ', axe de pénétration ' + o.memo.bearing + '. Je rallie le point initial.', 'fire', 1);
  }

  // --- ralliement du point initial ---
  if (o.phase === 'ingress') {
    unit.posture = 'rush';
    const done = flyStep(world, unit, o.memo.ip.x, o.memo.ip.y, dt, false);
    if (done || Math.hypot(unit.x - o.memo.ip.x, unit.y - o.memo.ip.y) < (unit.spec.rotary ? 320 : 900)) {
      o.phase = 'finale';
      o.memo.finaleAt = world.time;
      world.intel.transmit(unit, 'En finale sur l’objectif, axe ' + o.memo.bearing + '.', 'fire', 1);
    }
    engage(world, unit, dt);
    return;
  }

  // --- la passe elle-même ---
  if (o.phase === 'finale') {
    unit.posture = 'normal';
    const d = Math.hypot(aim.x - unit.x, aim.y - unit.y);

    if (unit.spec.rotary) {
      // on s'arrête sur l'axe, à distance de tir, et on traite
      const stop = { x: aim.x - ax.x * geo.standoff, y: aim.y - ax.y * geo.standoff };
      const near = Math.hypot(unit.x - stop.x, unit.y - stop.y) < 120;
      flyStep(world, unit, stop.x, stop.y, dt, near);
      if (near) unit.heading = azimuth(unit, aim);
      if (near && world.time - o.memo.finaleAt > 45) endPass(world, unit, o);
    } else {
      // on traverse : le point visé est au-delà de l'objectif
      const beyond = clampToAo(world.terrain,
        { x: aim.x + ax.x * geo.over, y: aim.y + ax.y * geo.over });
      flyStep(world, unit, beyond.x, beyond.y, dt, false);
      // dépassé l'objectif : la passe est terminée
      if (o.memo.lastD != null && d > o.memo.lastD && d > 700) endPass(world, unit, o);
      o.memo.lastD = d;
    }
    engage(world, unit, dt);
    return;
  }

  // --- dégagement, puis nouvelle passe ou fin de mission ---
  if (o.phase === 'egress') {
    unit.posture = 'rush';
    const brk = o.memo.breakPoint;
    const done = flyStep(world, unit, brk.x, brk.y, dt, false);
    engage(world, unit, dt);
    if (done || world.time - o.memo.egressAt > 60) {
      if (o.passDone < o.passes && unit.ammo > 0.22) {
        o.phase = 'ingress';
        o.memo.lastD = null;
      } else {
        world.intel.transmit(unit, o.passDone >= o.passes
          ? 'Mission de tir terminée, ' + o.passDone + ' passe(s) effectuée(s). Je dégage.'
          : 'Armement épuisé après ' + o.passDone + ' passe(s). Je dégage.', 'fire', 2);
        finish(world, unit, o);
      }
    }
  }
};

function endPass(world, unit, o) {
  o.passDone++;
  o.phase = 'egress';
  o.memo.egressAt = world.time;
  const ax = o.memo.axis;
  // dégagement en écharpe, hors de l'axe, pour ne pas repasser dans le même feu
  const side = (o.passDone % 2) ? 1 : -1;
  const px = -ax.y * side, py = ax.x * side;
  const aim = o.target || o.waypoints[0];
  o.memo.breakPoint = clampToAo(world.terrain, {
    x: aim.x + ax.x * 2500 + px * 2200,
    y: aim.y + ax.y * 2500 + py * 2200,
  });
  world.intel.transmit(unit, 'Passe ' + o.passDone + ' effectuée, je dégage.', 'fire', 1);
}

HANDLERS.EMBARQUER = (world, unit, o, dt) => {
  const veh = world.byId.get(o.targetUnit);
  if (!veh || veh.destroyed) { world.intel.transmit(unit, 'Véhicule indisponible.', 'warn'); finish(world, unit, o); return; }
  const free = veh.capacity - occupiedSeats(world, veh);
  if (free < unit.alive) {
    world.intel.transmit(unit, 'Pas assez de place à bord de ' + veh.callsign + ' (' + free + ' places pour ' + unit.alive + ' hommes).', 'warn', 1);
    finish(world, unit, o);
    return;
  }
  const d = dist(unit, veh);
  if (d > 14) {
    o.phase = 'mount';
    unit.posture = 'normal';
    setDestination(world, unit, veh.x, veh.y);
    advance(world, unit, dt);
  } else if (veh.spec.kind === 'air' && !veh.landed) {
    // on attend que l'appareil se pose
    o.phase = 'wait';
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
  } else {
    leaveBuilding(world, unit);
    unit.mountedIn = veh.id;
    veh.cargo.push(unit.id);
    unit.path = null;
    unit.speed = 0;
    world.intel.transmit(unit, 'Embarqué à bord de ' + veh.callsign + '.', 'status');
    finish(world, unit, o);
  }
};

HANDLERS.DEBARQUER = (world, unit, o, dt) => {
  // un aéronef doit être posé avant de débarquer ses passagers
  if (unit.spec.kind === 'air' && unit.cargo.length && !unit.landed) {
    o.phase = 'dismount';
    clearPath(unit);
    unit.speed = 0;
    unit.landed = true;
    world.intel.transmit(unit, 'Posé, débarquement en cours.', 'status');
    return;
  }
  if (unit.spec.kind === 'vehicle' || unit.spec.kind === 'air') {
    for (const id of unit.cargo.slice()) dismount(world, unit, world.byId.get(id));
    world.intel.transmit(unit, 'Pax débarqués.', 'status');
  } else if (unit.mountedIn != null) {
    const veh = world.byId.get(unit.mountedIn);
    // On ne saute pas d'un appareil en vol : il se pose d'abord sur une aire praticable.
    if (veh && veh.spec.kind === 'air' && !veh.landed) {
      const spot = clearLandingSpot(world, veh);
      if (spot) { veh.x = spot.x; veh.y = spot.y; }
      veh.landed = true;
      veh.speed = 0;
      veh.order = null;
      clearPath(veh);
      world.intel.transmit(veh, 'Posé sur zone, débarquement immédiat.', 'status', 1);
      o.phase = 'dismount';
      return;                       // le débarquement se fait au pas suivant
    }
    dismount(world, veh, unit);
  }
  finish(world, unit, o);
};

// Aire de poser praticable la plus proche : ni eau, ni bâti, ni sous-bois.
function clearLandingSpot(world, veh) {
  const t = world.terrain;
  const ok = (x, y) => t.inside(x, y) && t.buildingAt(x, y) < 0 &&
                       t.typeAt(x, y) !== T.WATER && t.typeAt(x, y) !== T.FOREST;
  if (ok(veh.x, veh.y)) return null;                 // déjà bon, inutile de bouger
  for (let r = 20; r <= 220; r += 20) {
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const px = veh.x + Math.cos(ang) * r, py = veh.y + Math.sin(ang) * r;
      if (ok(px, py)) return { x: px, y: py };
    }
  }
  return null;
}

export function occupiedSeats(world, veh) {
  let n = 0;
  for (const id of veh.cargo) { const u = world.byId.get(id); if (u) n += u.alive; }
  return n;
}

export function dismount(world, veh, pax) {
  if (!veh || !pax) return;
  const i = veh.cargo.indexOf(pax.id);
  if (i >= 0) veh.cargo.splice(i, 1);
  pax.mountedIn = null;
  // on met pied à terre à côté du véhicule, sur une case praticable
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    const px = veh.x + Math.cos(ang) * 12, py = veh.y + Math.sin(ang) * 12;
    if (world.terrain.inside(px, py) && world.terrain.buildingAt(px, py) < 0) { pax.x = px; pax.y = py; break; }
  }
  pax.x = pax.x || veh.x; pax.y = pax.y || veh.y;
  pax.speed = 0;
  clearPath(pax);
}

// Comptes rendus qui rendent le combat lisible depuis le PC : ouverture du feu,
// prise à partie, et bilan des pertes dès qu'un élément encaisse.
function situationReport(world, unit) {
  // 1. bilan des pertes, groupé pour ne pas égrener homme par homme
  if (unit.casualtiesPending && world.time - unit.lastCasualty > 6) {
    const n = unit.casualtiesPending;
    const kia = unit.killed, wia = unit.wounded;
    const sent = world.intel.transmit(unit,
      n + (n > 1 ? ' hommes touchés' : ' homme touché') + '. Bilan : ' +
      kia + ' tué' + (kia > 1 ? 's' : '') + ', ' + wia + ' blessé' + (wia > 1 ? 's' : '') +
      ', il reste ' + unit.effective + ' sur ' + unit.initialStrength + '.', 'loss', 2);
    // hors de portée, le compte rendu reste dû : on ne perd pas le décompte
    if (sent) unit.casualtiesPending = 0;
  }

  // 2. ouverture du feu sur un nouvel adversaire
  if (unit.engaging != null && unit.engaging !== unit.reportedTarget &&
      world.time - unit.lastFired < 3) {
    unit.reportedTarget = unit.engaging;
    const t = world.byId.get(unit.engaging);
    if (t) {
      const c = unit.contacts.get(t.id);
      const what = c && c.level >= 3 ? (TYPE_FR[t.type] || t.type) : 'élément non identifié';
      world.intel.transmit(unit, 'J’ouvre le feu sur ' + what + ', azimut ' +
        Math.round(azimuth(unit, t)) + ', ' + formatDist(dist(unit, t)) + '.', 'fire', 1);
    }
  }
  // on ne réannonce une même cible qu'après une vraie rupture de contact
  if (world.time - unit.lastFired > 60) unit.reportedTarget = null;

  // 3. pris à partie sans savoir par qui : l'information la plus utile au PC
  if (world.time - unit.lastHit < 3 && world.time - (unit.reportedHit || -99) > 25) {
    const seen = liveContacts(world, unit, 8);
    if (!seen.length) {
      unit.reportedHit = world.time;
      const from = unit.lastShooter != null ? world.byId.get(unit.lastShooter) : null;
      world.intel.transmit(unit, 'Nous sommes pris à partie' +
        (from ? ', azimut approximatif ' + Math.round(azimuth(unit, from)) : '') +
        ', origine non identifiée.', 'loss', 2);
    }
  }
}

// ------------------------------------------------------------ helpers d'ordres

function finish(world, unit, o) {
  o.done = true;
  o.phase = 'done';
  unit.statusText = 'Mission exécutée';
  clearPath(unit);
  if (unit.side === 'BLUFOR') world.intel.transmit(unit, 'Mission exécutée, en attente d’ordre.', 'status');
  unit.order = null;
}

// Comportement générique de tenue de position.
function holdPosition(world, unit, o, dt, center, radius, digRate = 0.9) {
  const foes = liveContacts(world, unit, 10);
  unit.posture = unit.suppression > 0.5 ? 'prone' : 'tactical';
  const d = Math.hypot(unit.x - center.x, unit.y - center.y);
  if (d > radius * 1.2) {
    setDestination(world, unit, center.x, center.y);
    advance(world, unit, dt);
    return;
  }
  clearPath(unit);
  unit.speed = 0;
  unit.updateFatigue(world, dt, false);
  o.phase = o.phase === 'consolidate' ? 'consolidate' : 'hold';
  // organisation progressive du terrain
  unit.fortify = clamp(unit.fortify + dt * 0.00055 * digRate * (1 + (unit.spec.engineer || 0)), 0, 0.85);
  // réorientation vers la menace
  if (foes.length) unit.heading = azimuth(unit, foes[0].u);
}

function buildSearchPattern(world, unit, center, radius) {
  const pts = [];
  const bs = nearbyBuildings(world, center.x, center.y, radius);
  for (const { b } of bs.slice(0, 10)) pts.push({ x: b.x, y: b.y, building: b.id });
  // balayage en boustrophédon pour le reste de la zone
  const step = Math.max(90, radius / 3);
  let row = 0;
  for (let y = -radius; y <= radius; y += step, row++) {
    const halfW = Math.sqrt(Math.max(0, radius * radius - y * y));
    const xs = [];
    for (let x = -halfW; x <= halfW; x += step) xs.push(x);
    if (row % 2) xs.reverse();
    for (const x of xs) {
      const px = center.x + x, py = center.y + y;
      if (!world.terrain.inside(px, py)) continue;
      if (world.terrain.buildingAt(px, py) >= 0) continue;
      pts.push({ x: px, y: py, building: -1 });
    }
  }
  // on part du plus proche
  pts.sort((a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y));
  return pts.slice(0, 26);
}

function findSupply(world, unit) {
  // un aéronef ne se ravitaille que sur sa base
  if (unit.spec.kind === 'air' && unit.homeBase) {
    return { x: unit.homeBase.x, y: unit.homeBase.y, d: dist(unit, unit.homeBase), airbase: true };
  }
  const cands = [];
  for (const u of world.units) {
    if (u.side !== unit.side || u.destroyed || u === unit) continue;
    if (u.supplies > 0.05) cands.push({ unit: u, x: u.x, y: u.y, d: dist(unit, u) });
  }
  for (const m of world.intel.markers) {
    if (m.kind === 'rearm point' || m.kind === 'ammunition supply point' || m.kind === 'reload point') {
      cands.push({ x: m.x, y: m.y, d: Math.hypot(m.x - unit.x, m.y - unit.y) });
    }
  }
  if (unit.side === 'BLUFOR') cands.push({ x: world.hq.x, y: world.hq.y, d: Math.hypot(world.hq.x - unit.x, world.hq.y - unit.y), hq: true });
  if (!cands.length) return null;
  cands.sort((a, b) => a.d - b.d);
  return cands[0];
}

function findMedicalPoint(world, unit) {
  const cands = [];
  for (const u of world.units) {
    if (u.side !== unit.side || u.destroyed) continue;
    if ((u.spec.medic || 0) >= 0.8) cands.push({ x: u.x, y: u.y, d: dist(unit, u) });
  }
  for (const m of world.intel.markers) {
    if (m.kind === 'casualty collect point' || m.kind === 'ambulance exhange point') {
      cands.push({ x: m.x, y: m.y, d: Math.hypot(m.x - unit.x, m.y - unit.y) });
    }
  }
  if (unit.side === 'BLUFOR') cands.push({ x: world.hq.x, y: world.hq.y, d: Math.hypot(world.hq.x - unit.x, world.hq.y - unit.y) });
  if (!cands.length) return null;
  cands.sort((a, b) => a.d - b.d);
  return cands[0];
}

function findMostWounded(world, unit) {
  let best = null, bestScore = 0;
  for (const u of world.units) {
    if (u.side !== unit.side || u.destroyed || u === unit) continue;
    const w = u.wounded;
    if (!w) continue;
    const score = w * 100 - dist(unit, u) * 0.05;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return best;
}

function treat(world, unit, amount) {
  for (const s of unit.soldiers) {
    if (s.wound === 0 || s.wound === 3) continue;
    s.care = (s.care || 0) + amount;
    const need = s.wound === 2 ? 55 : 28;
    if (s.care >= need) {
      s.care = 0;
      s.wound -= 1;
      s.hp = s.wound === 0 ? 1 : 0.7;
      if (s.wound === 0) s.fatigue = Math.min(s.fatigue, 0.6);
      world.emit('treated', unit);
      return;
    }
  }
}

// ------------------------------------------------------------ boucle unité

export function updateUnit(world, unit, dt) {
  if (unit.destroyed) return;

  // passagers : ils suivent leur véhicule
  if (unit.mountedIn != null) {
    const veh = world.byId.get(unit.mountedIn);
    if (veh && !veh.destroyed) {
      unit.x = veh.x; unit.y = veh.y; unit.speed = veh.speed;
      unit.updateFatigue(world, dt, false);
      if (unit.order && unit.order.type === 'DEBARQUER') HANDLERS.DEBARQUER(world, unit, unit.order, dt);
      updateMorale(world, unit, dt);
      return;
    }
    unit.mountedIn = null;
  }

  updateMorale(world, unit, dt);

  // Plus aucun combattant valide : on se regroupe sur place, la mission est suspendue.
  if (unit.effective === 0) {
    unit.speed = 0;
    unit.posture = 'prone';
    clearPath(unit);
    unit.updateFatigue(world, dt, false);
    if (unit.order && !unit.order.suspended) {
      unit.order.suspended = true;
      unit.statusText = 'Hors de combat — mission suspendue';
      world.intel.transmit(unit, 'Élément hors de combat, nous ne pouvons plus progresser. Demandons évacuation.', 'warn', 1);
    }
    return;
  }
  if (unit.order && unit.order.suspended) unit.order.suspended = false;

  // Comptes rendus : ils doivent partir AVANT la couche réflexe. Celle-ci prend la
  // main précisément quand l'unité est fixée, en repli ou en reconstitution —
  // c'est-à-dire aux moments où le PC a le plus besoin de nouvelles.
  if (unit.side === 'BLUFOR') {
    situationReport(world, unit);
    if (unit.ammo < 0.25 && !unit.ammoWarned) {
      unit.ammoWarned = 1;
      world.intel.transmit(unit, 'Dotation en munitions à 25 %, demandons réapprovisionnement.', 'warn', 2);
    } else if (unit.ammo < 0.05 && unit.ammoWarned === 1) {
      unit.ammoWarned = 2;
      world.intel.transmit(unit, 'Plus de munitions ! Nous ne pouvons plus riposter.', 'warn', 2);
    } else if (unit.ammo > 0.6) unit.ammoWarned = 0;
  }

  // Couche reflexe : plaquage, recherche de couvert, fixation, repli, deroute.
  // Si elle prend la main, la mission attend son tour.
  if (updateTactical(world, unit, dt)) {
    if (unit.cargo.length) {
      for (const id of unit.cargo) {
        const p = world.byId.get(id);
        if (p) { p.x = unit.x; p.y = unit.y; }
      }
    }
    return;
  }

  // Halte demandée par radio. La mission attend, mais l'élément continue de se
  // défendre : on ne cesse pas de riposter parce qu'on a cessé d'avancer.
  if (unit.halte) {
    unit.speed = 0;
    clearPath(unit);
    unit.updateFatigue(world, dt, false);
    if (unit.suppression > 0.3) unit.posture = 'prone';
    engage(world, unit, dt);
    return;
  }

  if (!unit.order) {
    unit.speed = 0;
    unit.updateFatigue(world, dt, false);
    if (unit.suppression > 0.3) unit.posture = 'prone';
    // un véhicule disponible signale qu'il attend les pax en cours d'embarquement
    if (unit.capacity > 0 && unit.side === 'BLUFOR' && !unit.awaitingPax) {
      for (const p of world.units) {
        if (p.side !== unit.side || !p.order || p.order.type !== 'EMBARQUER') continue;
        if (p.order.targetUnit !== unit.id) continue;
        unit.awaitingPax = true;
        if (unit.spec.kind === 'air') { unit.landed = true; unit.speed = 0; clearPath(unit); }
        world.intel.transmit(unit, unit.spec.kind === 'air'
          ? 'Posé, en attente de ' + p.callsign + ' pour embarquement.'
          : 'En attente de ' + p.callsign + ' pour embarquement, moteur au ralenti.', 'status');
        break;
      }
    } else if (unit.capacity > 0 && unit.awaitingPax && !unit.cargo.length) {
      const still = world.units.some(p => p.order && p.order.type === 'EMBARQUER' && p.order.targetUnit === unit.id);
      if (!still) unit.awaitingPax = false;
    }
    engage(world, unit, dt);
    return;
  }

  // Aéronefs : munitions épuisées ou seuil de retour atteint, on rentre.
  // Le seuil « bingo » est calculé sur la distance réelle à la base plus une
  // réserve : un appareil loin rentre bien plus tôt qu'un appareil au-dessus du PC.
  if (unit.spec.kind === 'air' && unit.side === 'BLUFOR' && unit.homeBase) {
    const armed = !!(unit.spec.weapon && unit.spec.weapon.rof);
    // Un aéronef emporte des munitions comptées : sous 20 % il n'a plus de quoi
    // traiter un objectif et la discipline de feu l'empêche déjà de tirer au loin.
    // Il rentre donc tant qu'il peut encore se défendre, plutôt que de rester en
    // l'air sans utilité.
    const dry = armed && unit.ammo < 0.2;
    const bingo = unit.fuel <= bingoFuel(world, unit);
    if ((dry || bingo) && !unit.rtb) {
      unit.rtb = true;
      unit.order = makeOrder('REARMER');
      world.intel.transmit(unit, dry
        ? 'Munitions épuisées, je romps la mission et rentre pour remise en œuvre.'
        : 'Bingo carburant, je romps la mission et rentre à la base.', 'warn', 2);
    } else if (unit.fuel > 0.9 && unit.ammo > 0.9) {
      unit.rtb = false;
    }
    // panne sèche : poser d'urgence sur place plutôt qu'un vol perpétuel
    if (unit.fuel <= 0 && !unit.landed) {
      beginLanding(unit);
      if (!unit.emergency) {
        unit.emergency = true;
        world.intel.transmit(unit, 'Panne sèche, je me pose en campagne. Appareil immobilisé.', 'loss', 2);
      }
    }
  }

  const o = unit.order;
  o.since += dt;
  const h = HANDLERS[o.type];
  if (h) h(world, unit, o, dt);
  else finish(world, unit, o);

  // les passagers d'un véhicule en mouvement suivent
  if (unit.cargo.length) {
    for (const id of unit.cargo) {
      const p = world.byId.get(id);
      if (p) { p.x = unit.x; p.y = unit.y; }
    }
  }
}

export { HANDLERS };

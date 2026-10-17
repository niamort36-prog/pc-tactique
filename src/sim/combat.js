// Résolution du feu : volume, précision, protection du terrain, suppression, pertes.

import { POSTURE, ROE } from './catalog.js';
import { lineOfSight, eyeHeight } from '../world/los.js';
import { LVL } from './sensors.js';
import { clamp } from '../core/util.js';
import { effectiveLight } from './sensors.js';

// Choisit la cible la plus payante parmi les contacts frais de l'unité.
export function selectTarget(world, unit) {
  if (!unit.combatReady || unit.isMounted && unit.spec.kind !== 'vehicle') return null;
  const roe = ROE[unit.roe] || ROE.free;
  const allowed = roe.engage > 0 || (roe.returnsFire && world.time - unit.lastHit < 25);
  if (!allowed) return null;

  const w = unit.spec.weapon;
  if (!w || !w.rof) return null;
  if (unit.ammo <= 0.001) return null;
  // portée utile réelle : celle du système le plus long parmi ceux autorisés
  let reach = w.range;
  if (unit.armaments) for (const a of unit.armaments()) reach = Math.max(reach, a.w.range || 0);

  let best = null, bestScore = 0;
  for (const [tid, c] of unit.contacts) {
    if (c.level < LVL.SEEN) continue;
    if (world.time - c.lastSeen > 6) continue;
    const tgt = world.byId.get(tid);
    if (!tgt || tgt.destroyed || tgt.side === 'CIV') continue;
    const d = Math.hypot(tgt.x - unit.x, tgt.y - unit.y);
    if (d > reach * (unit.openRange != null ? unit.openRange : 1)) continue;
    if (w.minRange && d < w.minRange) continue;

    const flying = tgt.spec.kind === 'air' && !tgt.landed;
    const armored = tgt.spec.kind === 'vehicle';
    // un aéronef en vol ne se traite qu'avec une capacité sol-air dédiée
    const power = flying ? (w.aair || 0) : armored ? w.aarmor : w.apers;
    if (power < 0.05) continue;
    if (flying && d > (w.airRange || w.range)) continue;
    // discipline de feu : inutile d'arroser un élément déjà cloué
    if (!armored && tgt.suppression > 0.8 && tgt.speed < 0.5) continue;
    // à court de munitions, on ne tire plus qu'au plus près
    if (unit.ammo < 0.15 && d > reach * 0.4) continue;
    let score = power * (1 - d / w.range) * (armored ? 2.2 : 1);
    if (tgt.spec.kind === 'squad' && tgt.spec.weapon.indirect) score *= 1.6;  // priorité aux mortiers
    if (world.time - tgt.lastFired < 8) score *= 1.3;
    if (score > bestScore) { bestScore = score; best = tgt; }
  }
  return best;
}

/**
 * Résout le feu d'un élément sur une cible pour un pas de temps.
 * Un aéronef peut servir plusieurs systèmes : on résout chacun séparément,
 * ce qui donne des effets, des portées et des consommations distincts.
 */
export function resolveFire(world, shooter, target, dt) {
  const sets = shooter.armaments ? shooter.armaments() : [{ key: 'main', w: shooter.spec.weapon }];
  let any = false;
  for (const a of sets) if (fireWeapon(world, shooter, target, dt, a.w, a.key)) any = true;
  return any;
}

function fireWeapon(world, shooter, target, dt, w, weaponKey) {
  const d = Math.hypot(target.x - shooter.x, target.y - shooter.y);
  const air = target.spec.kind === 'air' && !target.landed;
  if (!w || !w.rof) return false;
  if (d > (air ? (w.airRange || w.range) : w.range)) return false;
  if (w.minRange && d < w.minRange) return false;

  // le tir direct exige la vue ; l'indirect exige un observateur ami
  if (air) {
    var quality = 0.9;                 // le ciel est dégagé, mais la cible est fugace
  } else if (!w.indirect) {
    const trans = lineOfSight(world.terrain, shooter.x, shooter.y, eyeHeight(shooter),
                              target.x, target.y, target.posture === 'prone' ? 0.5 : 1.5, w.range);
    if (trans < 0.12) return false;
    quality = trans;
  } else {
    quality = 1;
  }

  const post = POSTURE[shooter.posture] || POSTURE.normal;
  const manned = shooter.spec.kind === 'squad'
    ? shooter.effective / shooter.initialStrength
    : Math.max(0.3, shooter.effective / Math.max(1, shooter.initialStrength)) * shooter.hull;
  if (manned <= 0) return false;

  const shots = (w.rof / 60) * dt * manned;
  const ammoCost = shots * (w.cost != null ? w.cost : (w.indirect ? 0.0045 : 0.0012));
  if (shooter.ammo <= 0) return false;
  shooter.ammo = Math.max(0, shooter.ammo - ammoCost);

  let acc = post.accuracy;
  acc *= 1 - 0.65 * shooter.suppression;
  acc *= 1 - 0.30 * shooter.fatigue;
  acc *= 0.35 + 0.65 * shooter.morale;
  acc *= clamp(1 - Math.pow(d / w.range, 1.7), 0.05, 1);
  acc *= quality;
  acc *= effectiveLight(world, shooter) * 0.6 + 0.4;
  acc *= shooter.training != null ? shooter.training : 1;
  if (shooter.fortify > 0.3) acc *= 1 + 0.25 * shooter.fortify;

  // protection de la cible
  const armored = target.spec.kind === 'vehicle';
  let cover = world.terrain.protectionAt(target.x, target.y);
  cover = clamp(cover + target.fortify * 0.35 + (POSTURE[target.posture].exposure < 0.5 ? 0.15 : 0), 0, 0.9);
  if (target.speed > 2 && !armored) cover = Math.max(0, cover - 0.1);

  const flying = target.spec.kind === 'air' && !target.landed;
  const power = flying ? (w.aair || 0) : armored ? w.aarmor : w.apers;
  let effect = shots * acc * power * (1 - cover);
  if (armored) effect *= clamp(1 - target.spec.armor, 0.06, 1);
  if (flying) {
    // vitesse et altitude rendent la passe difficile
    effect *= clamp(1 - target.spec.armor, 0.1, 1);
    effect *= clamp(1 - target.speed / 260, 0.25, 1);
  }
  if (w.indirect) effect *= 1.4;

  shooter.lastFired = world.time;
  shooter.engaging = target.id;
  target.lastHit = world.time;
  target.lastShooter = shooter.id;

  // Trace visuelle. Un missile se voit voler ; un tir tendu est un trait bref.
  const fxKey = 'fxAt_' + weaponKey;
  const period = weaponKey === 'missile' ? 2.0 : w.indirect ? 2.5 : 0.6;
  if (world.time - (shooter[fxKey] || -99) > period) {
    shooter[fxKey] = world.time;
    if (weaponKey === 'missile') {
      const d2 = Math.hypot(target.x - shooter.x, target.y - shooter.y);
      world.effects.missile(shooter, target, clamp(d2 / 320, 0.4, 3.5));
    } else {
      world.effects.shot(shooter, target, w.indirect ? 'indirect' : armored ? 'heavy' : 'light');
    }
    if (effect > 0.02) world.effects.impact(target.x, target.y, !!w.indirect || power > 2);
  }

  // Journal de bord. Le pas de simulation ne vaut qu'une fraction de coup :
  // on cumule et on n'inscrit que les coups entiers, sinon un missile tiré
  // toutes les 25 s apparaîtrait cent fois.
  if (shooter.noteFire) {
    if (!shooter.shotFrac) shooter.shotFrac = {};
    shooter.shotFrac[weaponKey] = (shooter.shotFrac[weaponKey] || 0) + shots;
    const whole = Math.floor(shooter.shotFrac[weaponKey]);
    if (whole > 0) {
      shooter.shotFrac[weaponKey] -= whole;
      shooter.noteFire(world.time, target.id, weaponKey,
        w.label || (w.indirect ? 'Tir indirect' : 'Armement de bord'),
        whole, effect > 0.02 ? 1 : 0);
    }
  }

  // suppression : bien plus rapide que les pertes réelles
  const suppr = clamp(shots * acc * (armored ? 0.05 : 0.55) * (1 - cover * 0.5), 0, 1);
  const hold = target.cohesion != null ? target.cohesion : 1;
  target.suppression = clamp(target.suppression + suppr * 0.55 / Math.max(0.4, hold), 0, 1);
  if (armored) target.suppression = Math.min(target.suppression, 0.55);

  applyDamage(world, target, effect * 0.09, shooter);
  return true;
}

// `amount` ~ nombre espéré de mises hors de combat sur l'intervalle
export function applyDamage(world, target, amount, shooter) {
  if (amount <= 0 || target.destroyed) return;
  const rng = world.rng;

  if (target.spec.kind === 'vehicle' || target.spec.kind === 'air') {
    target.hull = Math.max(0, target.hull - amount * (target.spec.kind === 'air' ? 0.9 : 0.55));
    if (rng() < amount * 0.5) hurtSoldier(world, target, rng, 0.5, shooter);
    if (target.hull <= 0) return destroyVehicle(world, target, shooter);
    if (target.hull < 0.4 && rng() < amount) target.mobility = Math.max(0.2, (target.mobility || 1) - 0.3);
    return;
  }

  let hits = amount;
  while (hits > 0) {
    const p = Math.min(1, hits);
    if (rng() < p) hurtSoldier(world, target, rng, 1, shooter);
    hits -= 1;
  }
}

function hurtSoldier(world, unit, rng, severityBias, shooter) {
  const pool = unit.soldiers.filter(s => s.wound < 3 && s.hp > 0);
  if (!pool.length) return;
  const s = pool[Math.floor(rng() * pool.length)];
  const r = rng();
  if (r < 0.26 * severityBias) { s.wound = 3; s.hp = 0; }         // tué
  else if (r < 0.60) { s.wound = Math.max(s.wound, 2); s.hp = 0.2; }  // blessé grave
  else { s.wound = Math.max(s.wound, 1); s.hp = 0.7; }                // blessé léger

  unit.lastCasualty = world.time;
  unit.casualtiesPending = (unit.casualtiesPending || 0) + 1;
  unit.morale = clamp(unit.morale - (s.wound === 3 ? 0.10 : 0.05), 0, 1);
  world.effects.casualty(unit, s.wound === 3);

  if (unit.side === 'OPFOR' && shooter && shooter.side === 'BLUFOR') {
    // on ne comptabilise que ce que nos hommes ont réellement vu tomber
    const c = shooter.contacts.get(unit.id);
    if (c && c.level >= 2 && world.time - c.lastSeen < 8) world.stats.redObserved++;
  }
  if (unit.effective === 0 && !unit.lostReported) {
    unit.lostReported = true;               // une unité ne se perd qu'une fois
    unit.destroyed = unit.alive === 0;
    unit.statusText = unit.destroyed ? 'Détruite' : 'Hors de combat';
    world.emit('unitLost', unit);
  }
  world.emit('casualty', { unit, soldier: s });
}

function destroyVehicle(world, unit, shooter) {
  if (unit.destroyed) return;
  unit.destroyed = true;
  unit.lostReported = true;
  unit.statusText = 'Détruit';
  // l'équipage et les passagers subissent
  for (const s of unit.soldiers) {
    const r = world.rng();
    if (r < 0.45) { s.wound = 3; s.hp = 0; }
    else if (r < 0.8) { s.wound = 2; s.hp = 0.2; }
  }
  for (const id of unit.cargo.slice()) {
    const pax = world.byId.get(id);
    if (!pax) continue;
    for (const s of pax.soldiers) {
      const r = world.rng();
      if (r < 0.35) { s.wound = 3; s.hp = 0; }
      else if (r < 0.7) { s.wound = 2; s.hp = 0.2; }
    }
    pax.mountedIn = null;
    pax.x = unit.x + world.rng.range(-12, 12);
    pax.y = unit.y + world.rng.range(-12, 12);
    pax.morale = clamp(pax.morale - 0.3, 0, 1);
    pax.suppression = 1;
    if (pax.alive === 0) pax.destroyed = true;
  }
  unit.cargo = [];
  world.emit('unitLost', unit);
}

// Décroissance de la suppression et récupération du moral.
export function updateMorale(world, unit, dt) {
  const underFire = world.time - unit.lastHit < 4;
  const rate = underFire ? 0.02 : 0.075;
  unit.suppression = clamp(unit.suppression - dt * rate, 0, 1);

  const target = clamp(0.35 + 0.65 * unit.strength - 0.25 * unit.fatigue, 0, 1);
  const recover = underFire ? 0.004 : 0.012;
  if (unit.morale < target) unit.morale = clamp(unit.morale + dt * recover, 0, 1);

  // proximité du commandement : le PC et les chefs raffermissent
  if (unit.side === 'BLUFOR' && world.time % 5 < dt) {
    for (const cmd of world.units) {
      if (cmd.side !== unit.side || cmd.type !== 'command' || cmd.destroyed) continue;
      const d = Math.hypot(cmd.x - unit.x, cmd.y - unit.y);
      if (d < 400) unit.morale = clamp(unit.morale + 0.01, 0, 1);
    }
  }
}

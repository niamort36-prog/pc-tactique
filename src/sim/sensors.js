// Acquisition du renseignement : vue, ouïe, identification, et liaison radio.
// Rien n'apparaît au PC tant qu'un de nos éléments n'a pas vu ou entendu — puis transmis.

import { lineOfSight, eyeHeight } from '../world/los.js';
import { POSTURE } from './catalog.js';
import { clamp } from '../core/util.js';

export const LVL = { NONE: 0, HEARD: 1, SEEN: 2, IDENT: 3 };

// Lumière dont dispose réellement un observateur : le jour pour tous, la nuit
// seulement pour qui possède l'équipement.
export function effectiveLight(world, obs) {
  const l = world.lightLevel;
  const nv = obs.nightVision != null ? obs.nightVision : 1;
  return l + (1 - l) * nv * 0.85;
}
export const LVL_LABEL = ['—', 'ENTENDU', 'VU', 'IDENTIFIÉ'];

const MAX_SENSOR = 3200;

// Taux d'acquisition visuelle (unités d'« éveil » par seconde).
function visualRate(world, obs, tgt) {
  const dx = tgt.x - obs.x, dy = tgt.y - obs.y;
  const d = Math.hypot(dx, dy);
  if (d < 1 || d > MAX_SENSOR) return { rate: 0, d };

  // au-delà du plafond météo (majoré par l'optique), on ne voit rien du tout
  const ceiling = world.visRange * (0.6 + 0.4 * (obs.spec.optics || 1)) *
                  (0.35 + 0.65 * effectiveLight(world, obs) / Math.max(0.05, world.lightLevel));
  if (d > ceiling) return { rate: 0, d, trans: 0 };

  const t = world.terrain;
  const tgtH = tgt.spec.kind === 'air'
    ? (tgt.landed ? 2 : Math.max(2, tgt.agl != null ? tgt.agl : (tgt.spec.altitude || 200)))
    : (tgt.posture === 'prone' ? 0.5 : 1.6);
  const trans = lineOfSight(t, obs.x, obs.y, eyeHeight(obs), tgt.x, tgt.y, tgtH, MAX_SENSOR);
  if (trans <= 0.02) return { rate: 0, d, trans: 0 };

  const conceal = t.concealmentAt(tgt.x, tgt.y);
  const post = POSTURE[tgt.posture] || POSTURE.normal;
  let exposure = (1 - conceal) * post.exposure * (tgt.spec.signature || 1);
  if (tgt.inBuilding != null) exposure *= 0.35;
  if (tgt.speed > 0.4) exposure *= 1.6;
  if (world.time - tgt.lastFired < 10) exposure *= 2.6;
  if (tgt.fortify > 0.4) exposure *= 1 - 0.5 * tgt.fortify;

  // Lumière utile pour CET observateur : la vision nocturne rattrape l'obscurité.
  // C'est ici que se joue l'avantage d'une action de nuit contre un adversaire
  // qui n'en est pas équipé.
  const light = effectiveLight(world, obs);
  let capability = (obs.spec.optics || 1) * light * world.visibilityFactor;
  capability *= 1 - 0.55 * obs.suppression;
  capability *= 1 - 0.30 * obs.fatigue;
  if (obs.isMounted) capability *= 0.4;
  if (obs.posture === 'tactical' || obs.posture === 'stealth') capability *= 1.2;
  if (obs.order && obs.order.type === 'RECHERCHE') capability *= 1.35;
  if (obs.spec.kind === 'air') capability *= 1.4;

  const rate = 0.9 * capability * exposure * trans * Math.pow(900 / d, 1.6);
  return { rate, d, trans };
}

// Taux d'acquisition sonore : pas besoin de vue, la position reste imprécise.
function audioRate(world, obs, tgt, d) {
  if (d > MAX_SENSOR) return 0;
  let loud = 0;
  if (world.time - tgt.lastFired < 6) loud = tgt.spec.weapon && tgt.spec.weapon.indirect ? 2600 : 1900;
  if (tgt.spec.kind === 'vehicle' && tgt.speed > 1) loud = Math.max(loud, 900);
  if (tgt.spec.kind === 'air') loud = Math.max(loud, 500);
  if (tgt.spec.kind === 'squad' && tgt.speed > 1.2 && tgt.posture === 'rush') loud = Math.max(loud, 220);
  else if (tgt.spec.kind === 'squad' && tgt.speed > 0.5) loud = Math.max(loud, 110);
  if (!loud || d > loud) return 0;
  const q = 1 - d / loud;
  return 1.6 * q * q * (1 - 0.4 * obs.suppression) * world.soundFactor;
}

export function updateSensors(world, dt) {
  const observers = world.units.filter(u => !u.destroyed && u.effective > 0 && u.side !== 'CIV');
  for (const obs of observers) {
    const idRange = 700 * (obs.spec.optics || 1) * effectiveLight(world, obs);
    for (const tgt of world.units) {
      if (tgt.destroyed || tgt === obs) continue;
      if (tgt.side === obs.side) continue;
      if (tgt.isMounted) continue;                 // embarqué : on voit le véhicule, pas les pax
      if (obs.isMounted && obs.spec.kind !== 'vehicle') continue;

      let c = obs.contacts.get(tgt.id);
      const vis = visualRate(world, obs, tgt);
      const aud = audioRate(world, obs, tgt, vis.d);

      if (!vis.rate && !aud) {
        if (c) {
          c.awareness = Math.max(0, c.awareness - dt * 0.12);
          if (c.awareness <= 0.01 && world.time - c.lastSeen > 90) obs.contacts.delete(tgt.id);
        }
        continue;
      }

      if (!c) {
        c = { id: tgt.id, awareness: 0, level: LVL.NONE, lastSeen: -999, lastUpdate: -999,
              x: tgt.x, y: tgt.y, err: 400, type: null, strength: null, reportedLevel: -1, reportedAt: -999 };
        obs.contacts.set(tgt.id, c);
      }

      c.awareness = clamp(c.awareness + (vis.rate + aud * 0.7) * dt, 0, 6);

      let level = LVL.NONE;
      if (c.awareness >= 0.45) level = LVL.HEARD;
      if (vis.rate > 0 && c.awareness >= 1.2) level = LVL.SEEN;
      if (vis.rate > 0 && c.awareness >= 2.6 && vis.d < idRange && vis.trans > 0.35) level = LVL.IDENT;

      if (level >= LVL.SEEN) {
        c.lastSeen = world.time;
        c.x = tgt.x; c.y = tgt.y;
        c.err = level === LVL.IDENT ? 15 : 45 + vis.d * 0.02;
        if (level === LVL.IDENT) { c.type = tgt.type; c.strength = tgt.alive; }
        else if (!c.type) { c.strength = Math.round(tgt.alive * (0.7 + Math.random() * 0.6)); }
      } else if (level === LVL.HEARD) {
        // position sonore : biaisée, imprécise, elle ne se met à jour que lentement
        if (world.time - c.lastUpdate > 6) {
          const jitter = 60 + vis.d * 0.14;
          c.x = tgt.x + (Math.random() - 0.5) * jitter * 2;
          c.y = tgt.y + (Math.random() - 0.5) * jitter * 2;
          c.err = jitter;
        }
      }

      if (level > c.level || (level >= LVL.SEEN && world.time - c.lastUpdate > 3)) c.lastUpdate = world.time;
      c.level = Math.max(level, c.level === LVL.IDENT && world.time - c.lastSeen < 30 ? LVL.IDENT : level);
      c.freshLevel = level;
    }
  }
}

// --- Liaison radio ---
// Portée fonction du poste (comms), du relief et de la présence d'un relais.

export function radioLink(world, unit) {
  if (unit.destroyed || unit.effective === 0) return 0;
  // chaque camp a son propre poste de commandement et ses propres relais
  const hq = unit.side === 'OPFOR' ? world.opforHq : world.hq;
  // Sans poste de commandement — cas d'une milice — il n'y a pas de réseau :
  // les groupes ne se coordonnent qu'à la voix, sur place.
  if (!hq) return unit.side === 'OPFOR' ? 0.3 : 0;
  const nodes = [hq];
  for (const u of world.units) {
    if (u.side === unit.side && !u.destroyed && u.spec.relay && u.effective > 0) nodes.push(u);
  }
  let best = 0;
  for (const nd of nodes) {
    const d = Math.hypot(nd.x - unit.x, nd.y - unit.y);
    const power = 5200 * (unit.spec.comms || 1) * ((nd.spec && nd.spec.comms) || 2.5) / 2.5;
    if (d > power) continue;
    const trans = lineOfSight(world.terrain, unit.x, unit.y, eyeHeight(unit) + 2,
                              nd.x, nd.y, (nd.spec && nd.spec.kind === 'air') ? 200 : 6, power);
    // la VHF passe partiellement en défilement, et très bien à courte distance
    const nearField = clamp(1 - d / 500, 0, 1);
    const terrainLoss = Math.max(trans > 0.3 ? 1 : 0.35 + trans, nearField);
    const q = clamp((1 - d / power) * terrainLoss * 1.4, 0, 1);
    if (q > best) best = q;
  }
  if (unit.spec.kind === 'air') best = Math.max(best, 0.9);
  return best;
}

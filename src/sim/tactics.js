// Comportements réflexes de combat, au-dessus de la mission.
//
// Un chef de groupe n'exécute pas son ordre les yeux fermés : sous le feu il se
// plaque, cherche un couvert, ne peut plus progresser tant qu'il est fixé, et
// décroche si la position devient intenable. Cette couche s'intercale entre
// l'ordre reçu et son exécution : elle peut la moduler (posture, interdiction
// d'avancer) ou la suspendre complètement (repli, déroute, reconstitution).

import { T } from '../world/terrain.js';
import { lineOfSight } from '../world/los.js';
import { LVL } from './sensors.js';
import { clamp, dist, azimuth } from '../core/util.js';
import {
  setDestination, advance, clearPath, engage, leaveBuilding, findFightingPosition,
} from './ai.js';
import { beginLanding } from './flight.js';

export const TAC = {
  NORMAL:  'NORMAL',
  ALERTE:  'ALERTE',
  COUVERT: 'GAGNE LE COUVERT',
  FIXE:    'FIXÉ',
  CLOUE:   'CLOUÉ',
  REPLI:   'REPLI',
  DEROUTE: 'DÉROUTE',
  RECONST: 'RECONSTITUTION',
};

// Urgence relative des etats : on peut toujours escalader immediatement (on se
// plaque des qu'on prend du feu), mais on ne redescend qu'apres un temps de
// sejour minimal. Sans cela l'unite oscille plusieurs fois par seconde entre
// ALERTE et FIXE, et aucune decision de repli n'a le temps de murir.
const RANK = {
  [TAC.NORMAL]: 0, [TAC.ALERTE]: 1, [TAC.COUVERT]: 2, [TAC.RECONST]: 2,
  [TAC.FIXE]: 3, [TAC.CLOUE]: 4, [TAC.REPLI]: 5, [TAC.DEROUTE]: 6,
};
const DWELL = {
  [TAC.NORMAL]: 0, [TAC.ALERTE]: 6, [TAC.COUVERT]: 10, [TAC.RECONST]: 0,
  [TAC.FIXE]: 15, [TAC.CLOUE]: 9, [TAC.REPLI]: 0, [TAC.DEROUTE]: 0,
};

// États qui interdisent toute progression vers l'objectif.
const NO_ADVANCE = { [TAC.FIXE]: 1, [TAC.CLOUE]: 1, [TAC.COUVERT]: 1, [TAC.REPLI]: 1, [TAC.DEROUTE]: 1, [TAC.RECONST]: 1 };
// États où la couche tactique prend entièrement la main sur la mission.
const OVERRIDE = { [TAC.REPLI]: 1, [TAC.DEROUTE]: 1, [TAC.RECONST]: 1, [TAC.COUVERT]: 1 };

export function cannotAdvance(unit) { return !!NO_ADVANCE[unit.tactical]; }

// Ténacité : une unité en défense s'accroche bien plus qu'une unité en marche.
function tenacity(unit) {
  const type = unit.order ? unit.order.type : null;
  let t = 1;
  if (type === 'DEFENDRE' || type === 'FORTIFIER') t = 1.8;
  else if (type === 'GARDER') t = 1.4;
  else if (type === 'ATTAQUER' || type === 'RECHERCHE') t = 1.15;
  else if (type === 'PATROUILLER' || type === 'MOUVEMENT') t = 0.85;
  t *= 0.65 + 0.5 * unit.fortify;             // un trou de combat change tout
  if (unit.inBuilding != null) t *= 1.35;
  if (unit.type === 'sf') t *= 1.3;
  if (unit.type === 'medical' || unit.type === 'radio') t *= 0.75;
  return t;
}

// Puissance de combat approximative d'un élément.
function power(u) {
  const w = u.spec.weapon || {};
  const fire = 0.35 + (w.apers || 0) + (w.aarmor || 0) * 0.4;
  return u.effective * fire * (0.45 + 0.55 * u.ammo) * (0.35 + 0.65 * u.morale) * (1 - 0.55 * u.suppression);
}

// Menaces fraîches connues de l'unité, triées par distance.
export function threatsOf(world, unit, maxAge = 20, maxDist = 900) {
  const out = [];
  for (const [id, c] of unit.contacts) {
    if (c.level < LVL.SEEN) continue;
    if (world.time - c.lastSeen > maxAge) continue;
    const t = world.byId.get(id);
    if (!t || t.destroyed || t.side === 'CIV') continue;
    const d = dist(unit, t);
    if (d > maxDist) continue;
    out.push({ unit: t, x: t.x, y: t.y, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// Rapport de force local perçu : > 1 nous sommes les plus forts.
function balance(world, unit, threats) {
  let enemy = 0;
  for (const th of threats) enemy += power(th.unit) * (1 - th.d / 1100);
  let friend = power(unit);
  for (const f of world.units) {
    if (f.side !== unit.side || f === unit || f.destroyed || f.effective === 0) continue;
    const d = dist(unit, f);
    if (d > 450) continue;
    friend += power(f) * (1 - d / 550) * 0.8;
  }
  return friend / Math.max(0.2, enemy);
}

function rearPoint(world, unit) {
  if (unit.side === 'BLUFOR') return world.hq;
  return world.opforRally || { x: 0, y: 0 };
}

// Point de décrochage : à l'abri des vues de la menace, sous couvert, vers l'arrière.
function chooseWithdrawPoint(world, unit, threats) {
  const t = world.terrain, rng = world.rng;
  let tx = 0, ty = 0, n = 0;
  for (const th of threats) { tx += th.x; ty += th.y; n++; }
  if (!n) {
    const r = rearPoint(world, unit);
    tx = 2 * unit.x - r.x; ty = 2 * unit.y - r.y; n = 1;
  }
  tx /= n; ty /= n;

  let ax = unit.x - tx, ay = unit.y - ty;
  const len = Math.max(1, Math.hypot(ax, ay));
  ax /= len; ay /= len;
  const rear = rearPoint(world, unit);

  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 54; i++) {
    const spread = (rng() - 0.5) * 1.7;                 // cône d'environ ±50°
    const c = Math.cos(spread), s = Math.sin(spread);
    const dx = ax * c - ay * s, dy = ax * s + ay * c;
    const dd = 170 + rng() * 300;
    const px = unit.x + dx * dd, py = unit.y + dy * dd;
    if (!t.inside(px, py)) continue;
    if (t.buildingAt(px, py) >= 0) continue;
    if (unit.spec.kind !== 'squad' && t.typeAt(px, py) === T.WATER) continue;

    let score = 0;
    score += t.concealmentAt(px, py) * 2.2;
    score += t.protectionAt(px, py) * 1.8;
    // défilement : l'essentiel est de sortir des vues
    score += (1 - lineOfSight(t, tx, ty, 1.7, px, py, 1.6, 1800)) * 4.5;
    score += Math.min(1, Math.hypot(px - tx, py - ty) / 750) * 2.2;
    score -= Math.hypot(px - rear.x, py - rear.y) / 2500;
    if (score > bestScore) { bestScore = score; best = { x: px, y: py }; }
  }
  return best;
}

// Bond court vers le meilleur couvert immédiat.
function nearestCover(world, unit) {
  const t = world.terrain, rng = world.rng;
  let best = null, bestScore = t.protectionAt(unit.x, unit.y) * 2 + t.concealmentAt(unit.x, unit.y);
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, r = 12 + rng() * 55;
    const px = unit.x + Math.cos(a) * r, py = unit.y + Math.sin(a) * r;
    if (!t.inside(px, py)) continue;
    if (t.buildingAt(px, py) >= 0) continue;
    if (unit.spec.kind !== 'squad' && t.typeAt(px, py) === T.WATER) continue;
    const score = t.protectionAt(px, py) * 2.4 + t.concealmentAt(px, py) * 1.6 - r / 90;
    if (score > bestScore) { bestScore = score; best = { x: px, y: py }; }
  }
  return best;
}

function setState(world, unit, state, message, kind, force) {
  if (unit.tactical === state) return false;
  const held = world.time - unit.tacticalSince;
  // desescalade : on attend d'etre vraiment sorti d'affaire
  if (!force && RANK[state] <= RANK[unit.tactical] && held < (DWELL[unit.tactical] || 0)) return false;
  unit.tactical = state;
  unit.tacticalSince = world.time;
  unit.tacticalMemo = {};
  // une rupture de mission ou une déroute doit toujours parvenir au PC
  const prio = (kind === 'warn' || kind === 'loss') ? 2 : 1;
  if (message) world.intel.transmit(unit, message, kind || 'status', prio);
  return true;
}

// Conduite propre aux aéronefs.
function airTactical(world, unit, dt, threats, underFire) {
  const held = world.time - unit.tacticalSince;
  const base = unit.homeBase || rearPoint(world, unit);
  const atBase = Math.hypot(base.x - unit.x, base.y - unit.y) < 320;

  // La remise en œuvre passe avant tout : une fois posé, on ne repart pas en
  // repli à chaque pas parce que l'appareil est encore abîmé.
  if (unit.tactical === TAC.RECONST) {
    unit.landed = true;
    unit.speed = 0;
    unit.vel = 0;
    unit.agl = 0;
    unit.hull = clamp(unit.hull + dt * 0.0016, 0, 1);
    unit.ammo = clamp(unit.ammo + dt * 0.010, 0, 1);
    unit.fuel = clamp(unit.fuel + dt * 0.012, 0, 1);
    // La sortie doit être plus stricte que l'entrée, sinon l'appareil oscille
    // d'un pas à l'autre entre « abîmé » et « disponible ».
    if (unit.hull >= 0.995 && unit.fuel >= 0.995 && unit.ammo >= 0.995) {
      unit.rtb = false;
      setState(world, unit, TAC.NORMAL, 'Appareil remis en œuvre, disponible.', 'status', true);
    }
    return true;
  }

  // Déjà posé sur sa base avec des dégâts : on enchaîne directement sur la remise en œuvre.
  if (atBase && unit.landed && (unit.hull < 0.97 || unit.fuel < 0.97 || unit.ammo < 0.97)) {
    setState(world, unit, TAC.RECONST, null, null, true);
    return true;
  }

  if (unit.tactical !== TAC.REPLI && !atBase &&
      (unit.hull < 0.55 || (underFire && unit.hull < 0.8))) {
    setState(world, unit, TAC.REPLI, 'Appareil touché, je romps le contact et rentre à la base.', 'warn', true);
  }

  if (unit.tactical === TAC.REPLI) {
    unit.posture = 'rush';
    setDestination(world, unit, base.x, base.y);
    const arrived = advance(world, unit, dt);
    if (arrived || held > 300) {
      beginLanding(unit);
      if (!unit.landed) return true;         // on termine l'approche
      clearPath(unit);
      unit.order = null;
      setState(world, unit, TAC.RECONST, 'Posé sur la base, appareil à remettre en œuvre.', 'status', true);
    }
    return true;
  }

  setState(world, unit, threats.length ? TAC.ALERTE : TAC.NORMAL, null);
  return false;
}

// ---------------------------------------------------------------- évaluation

export function updateTactical(world, unit, dt) {
  if (unit.tactical == null) { unit.tactical = TAC.NORMAL; unit.tacticalSince = 0; unit.tacticalMemo = {}; }

  const threats = threatsOf(world, unit, 15);
  const underFire = world.time - unit.lastHit < 7;

  // Un aéronef ne se plaque pas au sol et ne cherche pas de couvert : soit il tient
  // sa mission, soit il rompt le contact et rentre. Sa seule protection est la vitesse.
  if (unit.spec.kind === 'air') return airTactical(world, unit, dt, threats, underFire);

  const bleeding = world.time - (unit.lastCasualty || -999) < 25;
  const held = world.time - unit.tacticalSince;
  const ten = tenacity(unit);
  const bal = threats.length ? balance(world, unit, threats) : 9;

  // Duree de mise sous pression, mesuree independamment des changements d'etat :
  // une decision de decrochage doit murir sur la duree de l'accrochage, pas sur
  // le temps passe dans l'etat courant.
  if (underFire || bleeding || unit.suppression > 0.3) {
    if (!unit.pressureSince) unit.pressureSince = world.time;
  } else if (world.time - unit.lastHit > 18 && unit.suppression < 0.12) {
    unit.pressureSince = 0;
  }
  const pressed = unit.pressureSince ? world.time - unit.pressureSince : 0;

  unit.threatCount = threats.length;
  unit.balance = bal;

  // --- déroute : le moral a lâché, plus rien ne tient ---
  if (unit.morale < 0.2 && unit.effective > 0) {
    setState(world, unit, TAC.DEROUTE, 'Dispositif rompu, nous décrochons sans ordre !', 'warn', true);
  }

  // --- repli délibéré : la position n'est plus tenable ---
  else if (unit.tactical !== TAC.DEROUTE && unit.tactical !== TAC.RECONST) {
    const spent = unit.ammo < 0.08;
    const mauled = unit.strength < 0.5;
    const outgunned = bal < 0.55 / ten && unit.suppression > 0.35;
    const exhausted = unit.fatigue > 0.92 && underFire;
    const noWithdraw = unit.order && (unit.order.type === 'FORTIFIER' || unit.order.type === 'DEFENDRE') && unit.fortify > 0.7;

    // Guérilla : on ne s'attarde pas dans un accrochage. Passé un certain temps
    // au contact, l'élément décroche de lui-même, qu'il gagne ou qu'il perde —
    // c'est le principe même du combat dissymétrique.
    if (unit.breakAfter && pressed > unit.breakAfter && unit.tactical !== TAC.REPLI && !noWithdraw) {
      setState(world, unit, TAC.REPLI, 'Accrochage trop long, nous rompons le contact.', 'warn', true);
    }

    if ((underFire || bleeding) && (spent || mauled || outgunned || exhausted) &&
        unit.tactical !== TAC.REPLI && !noWithdraw && pressed > 10) {
      const why = spent ? 'plus de munitions'
                : mauled ? 'trop de pertes'
                : exhausted ? 'personnel à bout'
                : 'rapport de force défavorable';
      setState(world, unit, TAC.REPLI, 'Position intenable (' + why + '), je décroche et me reconstitue.', 'warn', true);
    }
  }

  // --- états de suppression, seulement si aucun repli en cours ---
  if (unit.tactical !== TAC.REPLI && unit.tactical !== TAC.DEROUTE && unit.tactical !== TAC.RECONST) {
    const inCover = world.terrain.protectionAt(unit.x, unit.y) > 0.18 || unit.inBuilding != null || unit.fortify > 0.35;

    if (unit.suppression > 0.75) {
      setState(world, unit, TAC.CLOUE, held > 20 ? 'Nous sommes cloués au sol, impossible de bouger.' : null, 'warn');
    } else if (unit.suppression > 0.42 || (underFire && bleeding)) {
      setState(world, unit, TAC.FIXE, unit.tactical === TAC.NORMAL || unit.tactical === TAC.ALERTE
        ? 'Pris à partie, nous sommes fixés. Nous ripostons sur place.' : null, 'warn');
    } else if (underFire && !inCover && unit.spec.kind === 'squad') {
      setState(world, unit, TAC.COUVERT, null);
    } else if (unit.suppression < 0.18 && !underFire) {
      if (threats.length) setState(world, unit, TAC.ALERTE, null);
      else if (held > 6) setState(world, unit, TAC.NORMAL, null);
    }
  }

  // ---------------------------------------------------------------- conduite

  switch (unit.tactical) {

    case TAC.CLOUE: {
      unit.posture = 'prone';
      unit.speed = 0;
      clearPath(unit);
      unit.updateFatigue(world, dt, false);
      // on riposte, mal, mais on riposte
      engage(world, unit, dt);
      return true;
    }

    case TAC.FIXE: {
      unit.posture = unit.suppression > 0.3 ? 'prone' : 'tactical';
      unit.speed = 0;
      clearPath(unit);
      unit.updateFatigue(world, dt, false);
      if (threats.length) unit.heading = azimuth(unit, threats[0]);
      engage(world, unit, dt);
      return true;                      // fixé : la mission attend
    }

    case TAC.COUVERT: {
      const m = unit.tacticalMemo;
      if (!m.spot) m.spot = nearestCover(world, unit);
      if (!m.spot) { setState(world, unit, TAC.FIXE, null, null, true); return true; }
      unit.posture = 'rush';
      setDestination(world, unit, m.spot.x, m.spot.y);
      const done = advance(world, unit, dt);
      engage(world, unit, dt);
      if (done || held > 25) {
        clearPath(unit);
        setState(world, unit, TAC.FIXE, null, null, true);
      }
      return true;
    }

    case TAC.REPLI: {
      const m = unit.tacticalMemo;
      if (!m.spot || (m.retryAt && world.time > m.retryAt)) {
        m.spot = chooseWithdrawPoint(world, unit, threats);
        m.retryAt = world.time + 30;
        if (m.spot) { leaveBuilding(world, unit); clearPath(unit); }
      }
      if (!m.spot) { setState(world, unit, TAC.FIXE, null, null, true); return true; }

      // décrochage : vite d'abord, puis à l'allure tactique une fois désengagé
      unit.posture = unit.suppression > 0.25 || threats.length ? 'rush' : 'tactical';
      setDestination(world, unit, m.spot.x, m.spot.y, { avoid: threats.map(t => ({ x: t.x, y: t.y, r: 320, w: 14 })) });
      const arrived = advance(world, unit, dt);
      engage(world, unit, dt);          // repli sous protection du feu

      const safe = !threats.length && unit.suppression < 0.2 && !underFire;
      if ((arrived && safe) || (safe && held > 40) || held > 150) {
        clearPath(unit);
        setState(world, unit, TAC.RECONST, 'Décrochage effectué, nous nous reconditionnons.', 'status', true);
      }
      return true;
    }

    case TAC.DEROUTE: {
      const m = unit.tacticalMemo;
      if (!m.spot) m.spot = rearPoint(world, unit);
      unit.posture = 'rush';
      unit.roe = 'hold';
      leaveBuilding(world, unit);
      setDestination(world, unit, m.spot.x, m.spot.y);
      advance(world, unit, dt);
      // le moral remonte lentement dès qu'on n'est plus sous le feu
      if (!underFire && !threats.length) unit.morale = clamp(unit.morale + dt * 0.006, 0, 1);
      if (unit.morale > 0.34 && held > 45) {
        unit.roe = 'free';
        clearPath(unit);
        setState(world, unit, TAC.RECONST, 'Élément rallié, nous nous reconditionnons.', 'status', true);
      }
      return true;
    }

    case TAC.RECONST: {
      unit.posture = 'tactical';
      unit.speed = 0;
      clearPath(unit);
      unit.updateFatigue(world, dt, false);
      // reconditionnement : moral, répartition des munitions, soins sommaires
      unit.morale = clamp(unit.morale + dt * 0.010, 0, 1);
      for (const s of unit.soldiers) {
        if (s.wound === 1) { s.care = (s.care || 0) + dt * 0.6; if (s.care > 40) { s.care = 0; s.wound = 0; s.hp = 1; } }
      }
      engage(world, unit, dt);
      const recovered = unit.morale > 0.62 && unit.suppression < 0.1 && unit.fatigue < 0.8;
      if ((recovered && held > 45) || held > 260) {
        // Un élément laminé qui repart sur la même mission se fera étriller de la
        // même façon : il boucle repli / reconstitution / repli. Il rend donc la
        // mission au PC et tient sa position en attendant des instructions.
        const capable = unit.strength >= 0.55 && unit.ammo >= 0.25;
        unit.withdrawals = (unit.withdrawals || 0) + 1;
        if (unit.order && (!capable || unit.withdrawals >= 2)) {
          const why = unit.strength < 0.55
            ? 'il me reste ' + unit.effective + ' hommes sur ' + unit.initialStrength
            : 'dotation à ' + Math.round(unit.ammo * 100) + ' %';
          unit.order = null;
          unit.withdrawals = 0;
          unit.statusText = 'Mission rendue';
          setState(world, unit, TAC.NORMAL,
            'Reconditionné mais hors d’état de poursuivre (' + why + '). Je rends la mission et tiens ma position, demande instructions.',
            'warn', true);
        } else {
          setState(world, unit, TAC.NORMAL, unit.order
            ? 'Reconditionnement terminé, nous reprenons la mission.'
            : 'Reconditionnement terminé, en attente d’ordre.', 'status', true);
        }
      }
      return true;
    }

    case TAC.ALERTE:
      // on continue la mission, mais l'oreille tendue
      if (unit.posture === 'normal' || unit.posture === 'rush') unit.posture = 'tactical';
      return false;

    default:
      return false;
  }
}

export { OVERRIDE };

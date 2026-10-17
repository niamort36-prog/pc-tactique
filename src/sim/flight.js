// Mécanique de vol.
//
// Un aéronef ne se téléporte pas vers son but : il accélère, vire à taux limité,
// et doit ralentir avant de s'arrêter. La voilure fixe ne peut pas s'arrêter du
// tout — sous sa vitesse de décrochage elle tombe — d'où les orbites. La voilure
// tournante, elle, sait passer au stationnaire, mais pas instantanément.
//
// L'altitude est comptée **au-dessus du sol** : un hélicoptère en vol tactique
// suit le relief à 35 m et se masque derrière une crête, exactement comme il le
// ferait en vol de contour.

import { clamp } from '../core/util.js';

// Profil de vol selon l'allure demandée : hauteur sol (m) et fraction de vitesse.
const PROFILE = {
  rotary: {
    rush:     { agl: 140, speed: 1.00 },
    normal:   { agl: 100, speed: 0.85 },
    tactical: { agl: 35,  speed: 0.62 },   // vol de contour
    stealth:  { agl: 18,  speed: 0.40 },   // très bas, très lent
    prone:    { agl: 18,  speed: 0.30 },
  },
  fixed: {
    rush:     { agl: 1100, speed: 1.00 },
    normal:   { agl: 700,  speed: 0.82 },
    tactical: { agl: 320,  speed: 0.72 },
    stealth:  { agl: 180,  speed: 0.65 },
    prone:    { agl: 180,  speed: 0.65 },
  },
};

// Caractéristiques par famille.
const PERF = {
  rotary: { accel: 3.2, decel: 4.0, turn: 26, climb: 9,  stall: 0 },
  fixed:  { accel: 7.0, decel: 3.0, turn: 9,  climb: 28, stall: 62 },
};

export function flightPerf(unit) { return unit.spec.rotary ? PERF.rotary : PERF.fixed; }

function profile(unit) {
  const set = unit.spec.rotary ? PROFILE.rotary : PROFILE.fixed;
  return set[unit.posture] || set.normal;
}

// Hauteur sol de croisière voulue par l'allure du moment.
export function cruiseAgl(unit) { return profile(unit).agl; }

// Écart angulaire signé, en degrés, ramené dans [-180, 180].
function angleDelta(from, to) {
  let d = (to - from + 540) % 360 - 180;
  return d;
}

/**
 * Fait voler l'appareil d'un pas. Renvoie true quand le point visé est atteint.
 * `hold` demande le stationnaire sur place (voilure tournante uniquement).
 */
export function flyStep(world, unit, tx, ty, dt, hold) {
  const terrain = world.terrain;
  const perf = flightPerf(unit);
  const prof = profile(unit);

  if (unit.vel == null) unit.vel = 0;
  if (unit.agl == null) unit.agl = unit.landed ? 0 : prof.agl;

  // Garde-fou de zone : près de la limite on remet le cap vers l'intérieur par un
  // virage normal. Un demi-tour instantané se verrait immédiatement à l'écran.
  const margin = Math.min(900, terrain.half * 0.12);
  const lim = terrain.half - margin;
  let gx = tx, gy = ty;
  if (Math.abs(unit.x) > lim || Math.abs(unit.y) > lim) { gx = 0; gy = 0; }

  const dx = gx - unit.x, dy = gy - unit.y;
  const d = Math.hypot(dx, dy);
  const dReal = Math.hypot(tx - unit.x, ty - unit.y);
  const cruise = unit.spec.offSpeed * prof.speed * unit.mobility;

  // --- vitesse voulue -------------------------------------------------------
  let want;
  if (unit.landing) {
    want = 0;
  } else if (hold && unit.spec.rotary) {
    want = 0;                                   // stationnaire
  } else {
    // on ne peut pas s'arrêter plus vite que la décélération ne le permet
    const stopIn = Math.sqrt(Math.max(0, 2 * perf.decel * Math.max(0, dReal - 25)));
    want = Math.min(cruise, unit.spec.rotary ? stopIn : cruise);
    want = Math.max(want, perf.stall);          // la voilure fixe ne décroche pas
  }

  // --- inertie --------------------------------------------------------------
  const rate = want > unit.vel ? perf.accel : perf.decel;
  const step = rate * dt;
  unit.vel = Math.abs(want - unit.vel) <= step ? want
           : unit.vel + Math.sign(want - unit.vel) * step;
  unit.vel = clamp(unit.vel, 0, cruise);

  // --- cap : virage à taux limité ------------------------------------------
  if (d > 1) {
    const wanted = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    // à grande vitesse, le rayon de virage s'allonge
    const speedFactor = unit.vel > 1 ? clamp(60 / Math.max(20, unit.vel), 0.35, 1.6) : 2.5;
    const maxTurn = perf.turn * speedFactor * dt;
    const delta = angleDelta(unit.heading, wanted);
    unit.heading = (unit.heading + clamp(delta, -maxTurn, maxTurn) + 360) % 360;
    unit.bank = clamp(delta / 45, -1, 1);       // inclinaison, pour le rendu
  } else {
    unit.bank = 0;
  }

  // --- déplacement selon le cap tenu, pas vers le but ----------------------
  const hr = unit.heading * Math.PI / 180;
  const nx = Math.sin(hr), ny = Math.cos(hr);
  const adv = unit.vel * dt;
  const px = unit.x + nx * adv, py = unit.y + ny * adv;
  if (terrain.inside(px, py)) {
    unit.x = px; unit.y = py;
  }
  // sinon on longe la limite sans avancer : le virage amorcé plus haut fait le reste
  unit.speed = unit.vel;

  // --- hauteur sol ----------------------------------------------------------
  const wantAgl = unit.landing ? 0 : prof.agl;
  const climb = perf.climb * dt;
  if (Math.abs(wantAgl - unit.agl) <= climb) unit.agl = wantAgl;
  else unit.agl += Math.sign(wantAgl - unit.agl) * climb;

  if (unit.landing && unit.agl <= 0.5 && unit.vel < 1.5) {
    unit.agl = 0;
    unit.vel = 0;
    unit.speed = 0;
    unit.landed = true;
    unit.landing = false;
  } else if (unit.agl > 1) {
    unit.landed = false;
  }

  // --- carburant ------------------------------------------------------------
  if (unit.spec.fuel) {
    // au stationnaire un hélicoptère consomme quand même : la portance a un prix
    const burn = Math.max(unit.vel, unit.spec.rotary && !unit.landed ? 18 : 0);
    unit.fuel = clamp(unit.fuel - burn * dt * unit.spec.fuelUse / unit.spec.fuel, 0, 1);
  }

  return dReal < (unit.spec.rotary ? 30 : 220);
}

// Demande un poser : l'appareil réduit, descend, puis se pose.
export function beginLanding(unit) {
  if (unit.landed) return;
  unit.landing = true;
}

/**
 * Seuil de retour (« bingo ») : carburant nécessaire pour rentrer, plus une
 * réserve. Au-delà d'un simple pourcentage fixe, cela tient compte de la
 * distance réelle à la base — un appareil loin rentre bien plus tôt.
 */
export function bingoFuel(world, unit) {
  const base = unit.homeBase;
  if (!base || !unit.spec.fuel) return 0.12;
  const d = Math.hypot(base.x - unit.x, base.y - unit.y);
  const cruise = Math.max(20, unit.spec.offSpeed);
  const needed = d * unit.spec.fuelUse / unit.spec.fuel;      // fraction pour le trajet
  const reserve = (cruise * 240) * unit.spec.fuelUse / unit.spec.fuel;  // 4 min de marge
  return clamp(needed * 1.25 + reserve, 0.06, 0.75);
}

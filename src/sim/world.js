// État global de la simulation : horloge, unités, renseignement, IA adverse, civils.

import { Emitter, makeRng, clamp, dist } from '../core/util.js';
import { Terrain, CELL, TERRAIN, T } from '../world/terrain.js';
import { NavGrid } from './pathfind.js';
import { Unit, NETS, PHONETIC } from './unit.js';
import { CATALOG } from './catalog.js';
import { Intel } from './intel.js';
import { updateSensors, LVL } from './sensors.js';
import { updateUnit, setDestination, advance, clearPath, engage, occupiedSeats } from './ai.js';
import { makeOrder } from './orders.js';
import { Effects } from './effects.js';
import { EnemyCommander } from './commander.js';
import { forceProfile, applyProfile, briefing as forceBriefing } from './forces.js';

// `maxVis` : portée optique au-delà de laquelle on ne distingue plus rien, en mètres.
// Un simple coefficient ne suffit pas : dans le brouillard il existe un mur, pas un dégradé.
export const WEATHER = {
  clear:    { kind: 'clear',    label: 'Ciel clair', visibility: 1.00, sound: 1.00, maxVis: 6000 },
  overcast: { kind: 'overcast', label: 'Couvert',    visibility: 0.85, sound: 1.05, maxVis: 4000 },
  rain:     { kind: 'rain',     label: 'Pluie',      visibility: 0.62, sound: 0.70, maxVis: 1400 },
  snow:     { kind: 'snow',     label: 'Neige',      visibility: 0.50, sound: 0.65, maxVis: 1200 },
  fog:      { kind: 'fog',      label: 'Brouillard', visibility: 0.30, sound: 0.85, maxVis: 350 },
};

export class World extends Emitter {
  constructor(terrain, frame, opts = {}) {
    super();
    this.terrain = terrain;
    this.frame = frame;
    this.nav = new NavGrid(terrain);
    this.rng = makeRng(opts.seed || 20260819);
    this.time = 0;
    this.hour = opts.hour != null ? opts.hour : 9;
    this.weather = opts.weather || 'clear';
    // Relevé réel de la zone, s'il a pu être obtenu : il remplace alors la
    // table forfaitaire, visibilité comprise.
    this.liveWeather = opts.liveWeather || null;
    this.liveClock = !!opts.liveClock;
    // Température de la zone : relevé réel, ou valeur donnée à la mise en place.
    this.temperature = opts.temperature != null ? opts.temperature : 18;
    // Date et heure de départ sur zone, pour l'horloge de jeu.
    this.startDate = opts.startDate || new Date();
    this.timezone = opts.timezone || null;
    this.units = [];
    this.byId = new Map();
    this.timers = [];
    this.intel = new Intel(this);
    this.hq = null;
    this.opforHq = null;          // poste de commandement adverse, destructible
    this.opforCommander = null;   // le chef adverse et sa situation
    this.opforRally = { x: 0, y: 0 };
    this.forceProfile = forceProfile(opts.force);
    this.effects = new Effects(this);
    // redObserved : pertes ennemies *constatées par nos hommes*, pas la vérité du moteur.
    // redObserved compte les *hommes* ennemis vus tomber ; blueLosses/redLosses
    // comptent les *éléments* mis hors de combat. Les pertes amies en hommes sont
    // recalculées depuis les unités, seule source toujours exacte.
    this.stats = { blueLosses: 0, redLosses: 0, civLosses: 0, redObserved: 0 };
    this.nextOpforThink = 0;

    this.on('unitLost', u => {
      if (u.side === 'BLUFOR') this.stats.blueLosses++;
      else if (u.side === 'OPFOR') this.stats.redLosses++;
      else this.stats.civLosses++;
    });
  }

  get lightLevel() {
    const h = this.hour + this.time / 3600;
    const day = ((h % 24) + 24) % 24;
    if (day > 7 && day < 19) return 1;
    if (day > 5.5 && day <= 7) return 0.35 + (day - 5.5) * 0.43;
    if (day >= 19 && day < 20.5) return 1 - (day - 19) * 0.43;
    return 0.22;   // nuit : jumelles de vision nocturne côté BLUFOR
  }
  // ---------------------------------------------------------------- climat
  //
  // La chaleur est le premier ennemi du fantassin chargé : au-delà de 25 °C
  // l'effort coûte vite le double, et le repos ne répare plus grand-chose. Le
  // froid pèse aussi, la pluie et la neige alourdissent la marche.

  // Contrainte thermique, de 0 (tempéré) à 1 (extrême).
  get heatStress() {
    const t = this.temperature;
    return t > 25 ? Math.min(1, (t - 25) / 18) : 0;      // 25 °C → 0, 43 °C → 1
  }
  get coldStress() {
    const t = this.temperature;
    return t < 2 ? Math.min(1, (2 - t) / 22) : 0;        // 2 °C → 0, −20 °C → 1
  }

  // Multiplicateur de fatigue à l'effort.
  get climateEffort() {
    const k = this.weatherInfo.kind || this.weather;
    let m = 1 + this.heatStress * 1.25 + this.coldStress * 0.55;
    if (k === 'rain') m += 0.12;
    if (k === 'snow') m += 0.35;
    const wind = this.liveWeather && this.liveWeather.wind != null ? this.liveWeather.wind : 0;
    if (wind > 25) m += Math.min(0.20, (wind - 25) / 150);
    return m;
  }

  // Multiplicateur de récupération au repos : sous forte chaleur, on ne récupère plus.
  get climateRecovery() {
    return Math.max(0.15, 1 - this.heatStress * 0.75 - this.coldStress * 0.35);
  }

  // Formule courte pour l'affichage et le briefing.
  get climateNote() {
    const t = Math.round(this.temperature);
    if (this.heatStress > 0.55) return 'forte chaleur ' + t + ' °C';
    if (this.heatStress > 0.15) return 'chaleur ' + t + ' °C';
    if (this.coldStress > 0.5) return 'grand froid ' + t + ' °C';
    if (this.coldStress > 0.1) return 'froid ' + t + ' °C';
    return t + ' °C';
  }

  // Date et heure sur zone à l'instant de jeu courant.
  get clock() { return new Date(this.startDate.getTime() + this.time * 1000); }

  // Conditions retenues : le relevé local s'il existe, la table sinon.
  get weatherInfo() { return this.liveWeather || WEATHER[this.weather] || WEATHER.clear; }
  get visibilityFactor() { return this.weatherInfo.visibility; }
  get soundFactor() { return this.weatherInfo.sound; }
  // Plafond de visibilité du moment : météo, atténué par l'obscurité.
  get visRange() { return this.weatherInfo.maxVis * (0.35 + 0.65 * this.lightLevel); }

  schedule(delay, fn) { this.timers.push({ at: this.time + delay, fn }); }

  add(unit) { this.units.push(unit); this.byId.set(unit.id, unit); return unit; }

  spawn(type, side, x, y, opts = {}) {
    const u = new Unit({ type, side, x, y, ...opts }, this.rng);
    return this.add(u);
  }

  // ---------------------------------------------------------------- boucle

  step(dt) {
    this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.time) { const t = this.timers.splice(i, 1)[0]; t.fn(); }
    }

    updateSensors(this, dt);
    this.intel.update(dt);
    this.effects.update();

    for (const u of this.units) {
      if (u.destroyed) continue;
      if (u.side === 'CIV') updateCivilian(this, u, dt);
      else updateUnit(this, u, dt);
    }

    // les embarqués suivent leur porteur, quel que soit l'état de celui-ci
    for (const v of this.units) {
      if (!v.cargo.length) continue;
      for (const id of v.cargo) {
        const p = this.byId.get(id);
        if (p) { p.x = v.x; p.y = v.y; }
      }
    }

    // Le chef adverse tient sa situation et manœuvre ; les éléments qu'il ne
    // peut pas joindre, ou tous s'il est détruit, retombent sur leur initiative.
    if (this.opforCommander) this.opforCommander.update(dt);
    if (this.time >= this.nextOpforThink) {
      this.nextOpforThink = this.time + 12;
      opforCommand(this);
    }

    // récupération lente des munitions auprès d'un véhicule logistique à proximité
    for (const u of this.units) {
      if (u.destroyed || u.side !== 'BLUFOR' || u.ammo > 0.995) continue;
      for (const s of this.units) {
        if (s.supplies <= 0.02 || s.side !== u.side || s === u) continue;
        if (dist(u, s) < 25) {
          const g = Math.min(dt * 0.012, 1 - u.ammo);
          u.ammo += g; s.supplies = clamp(s.supplies - g * 0.4, 0, 1);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- civils

function updateCivilian(world, u, dt) {
  const near = nearestGunfire(world, u, 450);
  if (near) {
    u.posture = 'rush';
    if (!u.fleeing || world.time - u.fleeing > 12) {
      u.fleeing = world.time;
      const dx = u.x - near.x, dy = u.y - near.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const tx = clamp(u.x + dx / d * 400, -world.terrain.half + 40, world.terrain.half - 40);
      const ty = clamp(u.y + dy / d * 400, -world.terrain.half + 40, world.terrain.half - 40);
      clearPath(u);
      setDestination(world, u, tx, ty);
    }
    advance(world, u, dt);
    return;
  }
  u.posture = 'normal';
  if (!u.path || u.pathIdx >= u.path.length) {
    if (!u.nextWander || world.time > u.nextWander) {
      u.nextWander = world.time + 20 + world.rng() * 60;
      const a = world.rng() * Math.PI * 2, r = 80 + world.rng() * 300;
      const tx = clamp(u.x + Math.cos(a) * r, -world.terrain.half + 30, world.terrain.half - 30);
      const ty = clamp(u.y + Math.sin(a) * r, -world.terrain.half + 30, world.terrain.half - 30);
      clearPath(u);
      setDestination(world, u, tx, ty);
    }
  }
  advance(world, u, dt);
}

function nearestGunfire(world, u, radius) {
  let best = null, bd = radius;
  for (const s of world.units) {
    if (s.side === 'CIV' || s.destroyed) continue;
    if (world.time - s.lastFired > 8) continue;
    const d = dist(u, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------------------------------------------------------------- IA adverse

function opforCommand(world) {
  const foes = [];
  for (const u of world.units) {
    if (u.side !== 'OPFOR' || u.destroyed) continue;
    for (const [id, c] of u.contacts) {
      if (c.level < LVL.SEEN || world.time - c.lastSeen > 45) continue;
      const t = world.byId.get(id);
      if (t && !t.destroyed) foes.push({ x: c.x, y: c.y, unit: t });
    }
  }

  const cmd = world.opforCommander;
  for (const u of world.units) {
    if (u.side !== 'OPFOR' || u.destroyed || u.effective === 0) continue;
    if (u === world.opforHq) continue;
    // Un ordre récent du chef prime sur l'initiative locale.
    if (cmd && cmd.intact && world.time - (u.cmdAt || -999) < 120) continue;
    if (u.order && !u.order.done && u.order.type !== 'DEFENDRE' && u.order.type !== 'PATROUILLER') continue;

    // priorité : défendre son secteur ; contre-attaquer si l'ennemi s'y engage franchement
    const home = u.homePost || (u.homePost = { x: u.x, y: u.y });
    let threat = null, td = 1e9;
    for (const f of foes) {
      const d = Math.hypot(f.x - home.x, f.y - home.y);
      if (d < td) { td = d; threat = f; }
    }

    if (!u.order) {
      // chacun reprend sa routine : la patrouille repart, le poste se remet en place
      if (u.role === 'patrol' && u.patrolRoute) {
        u.order = makeOrder('PATROUILLER', { waypoints: u.patrolRoute });
      } else if (u.role === 'outpost') {
        u.order = makeOrder('GARDER', { target: home, waypoints: [home], radius: 200 });
      } else if (u.type === 'reco' || u.type === 'infantry motorized') {
        u.order = makeOrder('PATROUILLER', { waypoints: patrolRing(world, home, 500) });
      } else if (world.rng() < 0.35) {
        u.order = makeOrder('FORTIFIER', { target: home, radius: 70 });
      } else {
        u.order = makeOrder('DEFENDRE', { target: home, radius: 130 });
      }
      continue;
    }

    // Un contact remonté circule dans leur chaîne : la patrouille disponible la plus
    // proche va voir, sans dégarnir la garnison de l'objectif.
    if (threat && u.role === 'patrol' && td < 2500 && u.order.type === 'PATROUILLER' &&
        u.strength > 0.6 && u.morale > 0.6 && world.rng() < 0.5) {
      u.order = makeOrder('RECHERCHE', { target: { x: threat.x, y: threat.y },
        waypoints: [{ x: threat.x, y: threat.y }], radius: 300 });
      continue;
    }

    if (threat && td < 250 && u.strength > 0.6 && u.morale > 0.6 && world.rng() < 0.35) {
      u.order = makeOrder('ATTAQUER', { waypoints: [{ x: threat.x, y: threat.y }] });
    }
  }
}

function patrolRing(world, center, radius) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + world.rng() * 0.6;
    const px = clamp(center.x + Math.cos(a) * radius, -world.terrain.half + 50, world.terrain.half - 50);
    const py = clamp(center.y + Math.sin(a) * radius, -world.terrain.half + 50, world.terrain.half - 50);
    pts.push({ x: px, y: py });
  }
  return pts;
}

// ---------------------------------------------------------------- scénario

// Cherche une position praticable proche du point voulu.
function findOpenSpot(world, x, y, radius, opts = {}) {
  const t = world.terrain;
  for (let i = 0; i < 260; i++) {
    const a = world.rng() * Math.PI * 2, r = Math.sqrt(world.rng()) * radius;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (!t.inside(px, py)) continue;
    if (t.buildingAt(px, py) >= 0) continue;
    const ty = t.typeAt(px, py);
    if (ty === T.WATER) continue;
    if (opts.road && !TERRAIN[ty].road) continue;
    if (opts.cover && TERRAIN[ty].concealment < 0.3) continue;
    return { x: px, y: py };
  }
  return { x, y };
}

function densestBuildingCluster(world) {
  const bs = world.terrain.buildings;
  if (!bs.length) return { x: 0, y: 0, count: 0 };
  let best = bs[0], bestN = 0;
  const sample = bs.length > 300 ? bs.filter((_, i) => i % Math.ceil(bs.length / 300) === 0) : bs;
  for (const b of sample) {
    let n = 0;
    for (const o of sample) if (Math.hypot(o.x - b.x, o.y - b.y) < 220) n++;
    if (n > bestN) { bestN = n; best = b; }
  }
  return { x: best.x, y: best.y, count: bestN };
}

/**
 * Détermine l'objectif et propose une implantation de PC, sans rien déployer.
 * Sert à l'écran de choix : le chef doit voir l'objectif avant de décider où
 * s'installer, et l'ennemi ne peut être mis en place qu'une fois le PC connu,
 * puisque ses zones d'apparition en dépendent.
 */
export function planScenario(world) {
  const half = world.terrain.half;
  const objective = densestBuildingCluster(world);
  world.objective = { x: objective.x, y: objective.y, radius: 260, name: 'Objectif ÉCHO' };

  // Implantation par défaut : au bord opposé à l'objectif.
  const dirX = objective.x === 0 ? 0 : -Math.sign(objective.x);
  const dirY = objective.y === 0 ? -1 : -Math.sign(objective.y);
  const bx = clamp(objective.x + dirX * half * 0.72, -half * 0.85, half * 0.85);
  const by = clamp(objective.y + dirY * half * 0.72, -half * 0.85, half * 0.85);
  world.suggestedBase = findOpenSpot(world, bx, by, 260);
  return { objective: world.objective, suggestedBase: world.suggestedBase };
}

// Distance minimale entre le PC et l'objectif : en deçà, il n'y a plus de manœuvre.
export function minBaseDistance(world) {
  return Math.max(600, world.terrain.half * 0.28);
}

// Une implantation vaut-elle quelque chose ? Renvoie null si oui, le motif sinon.
export function baseProblem(world, p) {
  const t = world.terrain;
  const m = t.half * 0.06;
  if (!t.inside(p.x, p.y) || Math.abs(p.x) > t.half - m || Math.abs(p.y) > t.half - m) {
    return 'trop près du bord de la zone';
  }
  if (t.buildingAt(p.x, p.y) >= 0) return 'dans un bâtiment';
  if (t.typeAt(p.x, p.y) === T.WATER) return 'dans l’eau';
  const o = world.objective;
  if (o && Math.hypot(p.x - o.x, p.y - o.y) < minBaseDistance(world)) {
    return 'trop près de l’objectif (' + Math.round(minBaseDistance(world)) + ' m minimum)';
  }
  return null;
}

export function buildScenario(world, opts = {}) {
  const half = world.terrain.half;
  const rng = world.rng;

  if (!world.objective) planScenario(world);
  const objective = world.objective;

  // Implantation choisie par le chef, à défaut celle proposée.
  const wanted = opts.base || world.suggestedBase;
  const base = findOpenSpot(world, wanted.x, wanted.y, 260);

  // --- PC (tente de commandement) ---
  world.hq = {
    x: base.x, y: base.y, callsign: 'PC ZULU', freq: NETS.CDT.freq,
    spec: { comms: 3.2, kind: 'hq', optics: 1 },
    name: 'Poste de commandement',
  };

  // --- ordre de bataille ami : une section renforcée ---
  const blue = [];
  const mk = (type, cs, net, dx, dy, extra) => {
    const p = findOpenSpot(world, base.x + dx, base.y + dy, 70);
    const u = world.spawn(type, 'BLUFOR', p.x, p.y, {
      callsign: cs, net, freq: NETS[net].freq, ...extra,
    });
    blue.push(u);
    return u;
  };

  // Zone de rassemblement étalée sur ~400 m : une section ne tient pas sur un point.
  mk('command', 'ALPHA', 'CDT', 0, 60);
  mk('infantry', 'BRAVO', 'MAN', -190, 10);
  mk('infantry', 'CHARLIE', 'MAN', 190, 10);
  mk('infantry', 'DELTA', 'MAN', 0, -150);
  mk('reco', 'ECHO', 'RECO', 90, 170);
  mk('anti tank', 'FOXTROT', 'APP', -120, 130);
  mk('mortar', 'GOLF', 'APP', -60, -230);
  mk('medical', 'HOTEL', 'LOG', 130, -200);

  const roadSpot = i => findOpenSpot(world, base.x + (i - 1) * 120, base.y - 60, 170, { road: true });
  const v1 = roadSpot(0), v2 = roadSpot(1), v3 = roadSpot(2);
  world.spawn('transportation', 'BLUFOR', v1.x, v1.y, { callsign: 'KILO 1', net: 'LOG', freq: NETS.LOG.freq, supplies: 1 });
  world.spawn('transportation', 'BLUFOR', v2.x, v2.y, { callsign: 'KILO 2', net: 'LOG', freq: NETS.LOG.freq, supplies: 1 });
  world.spawn('mechanized armor', 'BLUFOR', v3.x, v3.y, { callsign: 'LIMA', net: 'MAN', freq: NETS.MAN.freq });
  const pm = findOpenSpot(world, base.x + 60, base.y + 240, 90);
  world.spawn('relay radio', 'BLUFOR', pm.x, pm.y, { callsign: 'MIKE', net: 'CDT', freq: NETS.CDT.freq });

  // --- moyens aériens (avant l'ennemi : leurs bases sont des zones protégées) ---
  world.airfields = world.terrain.airfields || [];
  buildAirComponent(world, base, opts);

  // --- ennemi : un dispositif vivant sur toute la zone ---
  buildOpfor(world, base, objective, opts);

  // --- civils ---
  const nCiv = opts.civilians != null ? opts.civilians : 10;
  for (let i = 0; i < nCiv; i++) {
    const b = world.terrain.buildings.length
      ? world.terrain.buildings[Math.floor(rng() * world.terrain.buildings.length)]
      : { x: rng.range(-half, half), y: rng.range(-half, half) };
    const p = findOpenSpot(world, b.x, b.y, 120);
    const u = world.spawn('infantry', 'CIV', p.x, p.y, { callsign: 'CIV ' + (i + 1), net: 'CDT', freq: 0 });
    u.name = 'Groupe de civils';
    u.roe = 'hold';
    u.initialStrength = u.soldiers.length;
  }

  world.intel.say(null, 'Ordre initial : reconnaître et prendre le contrôle de ' + world.objective.name + '. Section en place au PC.', 'brief');
  return { base, objective: world.objective, blue };
}

// ---------------------------------------------------------------- moyens aériens

// Les voilures tournantes opèrent depuis une plateforme sommaire (FARP) montée
// près du PC. Les voilures fixes, elles, exigent une vraie piste : sans terrain
// d'aviation suffisant dans la zone, elles ne sont tout simplement pas mises en ligne.
function buildAirComponent(world, base, opts) {
  if (opts.air === false) {
    world.intel.say(null, 'Aucun moyen aérien alloué pour cette opération.', 'brief');
    return;
  }

  // FARP : une aire dégagée à proximité du PC
  const farp = findOpenSpot(world, base.x - 120, base.y + 160, 220);
  world.farp = { x: farp.x, y: farp.y, name: 'FARP ROMEO' };

  world.spawn('attack helicopter', 'BLUFOR', farp.x - 30, farp.y, {
    callsign: 'NOVEMBER', net: 'AIR', freq: NETS.AIR.freq,
  }).homeBase = world.farp;
  world.spawn('transport helicopter', 'BLUFOR', farp.x + 30, farp.y, {
    callsign: 'OSCAR', net: 'AIR', freq: NETS.AIR.freq,
  }).homeBase = world.farp;

  const fields = world.airfields;
  const best = fields.length ? fields[0] : null;
  const runway = best ? best.runway : 0;

  if (runway >= 800) {
    const u = world.spawn('attack aircraft', 'BLUFOR', best.x, best.y, {
      callsign: 'PAPA', net: 'AIR', freq: NETS.AIR.freq,
    });
    u.homeBase = { x: best.x, y: best.y, name: best.name };
  }
  if (runway >= 600) {
    const u = world.spawn('recon aircraft', 'BLUFOR', best.x + 60, best.y + 60, {
      callsign: 'QUEBEC', net: 'AIR', freq: NETS.AIR.freq,
    });
    u.homeBase = { x: best.x, y: best.y, name: best.name };
  }

  if (runway >= 600) {
    world.intel.say(null, 'Terrain d\u2019aviation « ' + best.name + ' » exploitable (piste ' + runway +
      ' m) : voilures fixes en ligne. FARP ROMEO ouverte pour les voilures tournantes.', 'brief');
  } else if (best) {
    world.intel.say(null, 'Seul terrain de la zone : « ' + best.name + ' » (piste ' +
      (runway ? runway + ' m' : 'aucune') + '), insuffisant pour les voilures fixes. ' +
      'Seules les voilures tournantes sont en ligne, depuis FARP ROMEO.', 'brief');
  } else {
    world.intel.say(null, 'Aucun terrain d\u2019aviation dans la zone : pas de voilure fixe. ' +
      'Voilures tournantes en ligne depuis FARP ROMEO.', 'brief');
  }
}

// ---------------------------------------------------------------- dispositif adverse

// Points d'intérêt de la zone : noyaux bâtis, terrains d'aviation, gros carrefours.
// Ils servent d'ancrage au dispositif adverse — on n'occupe pas des champs au hasard.
function pointsOfInterest(world, want) {
  const t = world.terrain;
  const out = [];

  for (const f of (t.airfields || [])) out.push({ x: f.x, y: f.y, weight: 3, name: f.name });

  const bs = t.buildings;
  if (bs.length) {
    const stride = Math.max(1, Math.ceil(bs.length / 400));
    const sample = bs.filter((_, i) => i % stride === 0);
    const scored = sample.map(b => {
      let n = 0;
      for (const o of sample) if (Math.hypot(o.x - b.x, o.y - b.y) < 260) n++;
      return { x: b.x, y: b.y, weight: n };
    }).sort((a, b) => b.weight - a.weight);

    // on garde des noyaux bien séparés, sinon tout se tasse sur la même ville
    const spacing = Math.max(500, t.half * 0.22);
    for (const c of scored) {
      if (out.length >= want) break;
      if (out.every(o => Math.hypot(o.x - c.x, o.y - c.y) > spacing)) out.push(c);
    }
  }

  // complément : quelques points sur route, pour couvrir les zones vides
  let guard = 0;
  while (out.length < want && guard++ < 400) {
    const p = findOpenSpot(world, world.rng.range(-t.half * 0.9, t.half * 0.9),
                                  world.rng.range(-t.half * 0.9, t.half * 0.9), 400, { road: true });
    if (out.every(o => Math.hypot(o.x - p.x, o.y - p.y) > 700)) out.push({ x: p.x, y: p.y, weight: 1 });
  }
  return out;
}

// Itinéraire de patrouille : une boucle entre points d'intérêt voisins.
function patrolRoute(world, from, pois, radius) {
  const near = pois
    .filter(p => Math.hypot(p.x - from.x, p.y - from.y) < radius)
    .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))
    .slice(0, 5);
  const pts = [];
  for (const p of near) {
    const s = findOpenSpot(world, p.x, p.y, 220, { road: world.rng() < 0.6 });
    pts.push({ x: s.x, y: s.y });
  }
  if (pts.length < 2) return patrolRing(world, from, Math.min(radius * 0.5, 700));
  return pts;
}

function buildOpfor(world, base, objective, opts) {
  const t = world.terrain, rng = world.rng, half = t.half;
  const P = world.forceProfile;

  // Zone interdite au déploiement adverse : on ne fait pas apparaître d'ennemi
  // sur la zone de rassemblement amie. Les patrouilles peuvent y venir ensuite.
  const safe = clamp(half * 0.5, 800, 3500);

  // Toutes nos emprises : PC, plateforme hélicoptères, et les terrains où nos
  // avions sont stationnés. Un ennemi qui apparaîtrait dessus détruirait les
  // appareils au sol avant le premier ordre.
  const keepOut = [{ x: base.x, y: base.y, r: safe }];
  if (world.farp) keepOut.push({ x: world.farp.x, y: world.farp.y, r: safe * 0.7 });
  for (const u of world.units) {
    if (u.side === 'BLUFOR' && u.spec.kind === 'air' && u.homeBase) {
      keepOut.push({ x: u.homeBase.x, y: u.homeBase.y, r: Math.max(1200, safe * 0.8) });
    }
  }
  const clearOfBase = p => keepOut.every(z => Math.hypot(p.x - z.x, p.y - z.y) > z.r);

  const pois = pointsOfInterest(world, Math.max(6, Math.round(half / 700)))
    .filter(clearOfBase);

  // Le profil pèse sur le volume : une milice est nombreuse et faible,
  // une unité d'élite rare et redoutable.
  const total = Math.max(3, Math.round((opts.opfor || 8) * P.count));
  const nGarrison = Math.max(2, Math.round(total * 0.42));
  const nPatrol = Math.max(1, Math.round(total * 0.33));
  const nOutpost = Math.max(1, total - nGarrison - nPatrol);

  let idx = 0;
  const spawn = (type, p, role, extra) => {
    const u = world.spawn(type, 'OPFOR', p.x, p.y, {
      callsign: 'R-' + (11 + idx++), net: 'CDT', freq: 47.500,
    });
    u.homePost = { x: p.x, y: p.y };
    u.role = role;
    u.posture = 'tactical';
    applyProfile(u, P);                    // fiche technique propre au profil
    Object.assign(u, extra || {});
    return u;
  };

  // Un emplacement rejeté (trop près de nos emprises) ne doit pas faire disparaître
  // l'élément : on relance autour, sinon le dispositif se vide silencieusement —
  // d'autant plus sur une petite zone où les exclusions couvrent beaucoup de terrain.
  const place = (cx, cy, radius, opts) => {
    for (let k = 0; k < 8; k++) {
      const a = rng() * Math.PI * 2, r = k * 220;
      const p = findOpenSpot(world, cx + Math.cos(a) * r, cy + Math.sin(a) * r,
                             radius * (1 + k * 0.25), opts);
      if (clearOfBase(p)) return p;
    }
    return null;
  };

  const pick = (role, i) => {
    const list = P.roster[role] || P.roster.garrison;
    return list[i % list.length];
  };
  // une force dissymétrique se terre dans le couvert plutôt que de tenir une ligne
  const hides = P.doctrine === 'guerilla';

  // 1. garnison de l'objectif
  for (let i = 0; i < nGarrison; i++) {
    const a = (i / nGarrison) * Math.PI * 2 + rng() * 0.6;
    const r = (hides ? 60 : 90) + rng() * (hides ? 520 : 380);
    const p = place(objective.x + Math.cos(a) * r, objective.y + Math.sin(a) * r,
                    180, { cover: hides || rng() < 0.6 });
    if (!p) continue;
    spawn(pick('garrison', i), p, 'garrison', { fortify: P.fortify * (0.6 + rng() * 0.8) });
  }

  // 2. patrouilles : elles vivent leur vie sur la zone, loin de l'objectif
  for (let i = 0; i < nPatrol; i++) {
    const poi = pois.length ? pois[(i * 3 + 1) % pois.length]
                            : { x: rng.range(-half * 0.8, half * 0.8), y: rng.range(-half * 0.8, half * 0.8) };
    const p = place(poi.x, poi.y, 350, { road: rng() < 0.7 });
    if (!p) continue;
    const u = spawn(pick('patrol', i), p, 'patrol');
    u.patrolRoute = patrolRoute(world, p, pois, Math.max(1200, half * 0.55));
    u.order = makeOrder('PATROUILLER', { waypoints: u.patrolRoute });
  }

  // 3. postes et points de contrôle : ils tiennent les points de passage
  for (let i = 0; i < nOutpost; i++) {
    const poi = pois.length ? pois[(i * 5 + 3) % pois.length]
                            : { x: rng.range(-half * 0.8, half * 0.8), y: rng.range(-half * 0.8, half * 0.8) };
    const p = place(poi.x, poi.y, 300, { road: rng() < 0.5 });
    if (!p) continue;
    const u = spawn(pick('outpost', i), p, 'outpost', { fortify: P.fortify * (0.5 + rng() * 0.9) });
    u.order = makeOrder('GARDER', { target: u.homePost, waypoints: [u.homePost], radius: 200 });
  }

  // --- poste de commandement adverse ---
  // Placé en arrière de l'objectif, hors des vues directes : c'est lui qui donne
  // sa cohérence au dispositif. Le détruire paralyse la manœuvre d'ensemble.
  const away = { x: objective.x - (base.x - objective.x), y: objective.y - (base.y - objective.y) };
  const len = Math.max(1, Math.hypot(away.x - objective.x, away.y - objective.y));
  const hqSpot = findOpenSpot(world,
    objective.x + (away.x - objective.x) / len * 550,
    objective.y + (away.y - objective.y) / len * 550, 260, { cover: true });
  if (P.hq) {
    const rhq = spawn('command', hqSpot, 'hq', { fortify: 0.5 });
    rhq.callsign = 'R-PC';
    world.opforHq = rhq;
  }

  // --- réserve : elle n'est engagée qu'une fois l'effort adverse confirmé ---
  const nReserve = P.hq ? Math.max(1, Math.round(total * 0.15)) : 0;
  for (let i = 0; i < nReserve; i++) {
    const a = rng() * Math.PI * 2;
    const p = place(hqSpot.x + Math.cos(a) * 260, hqSpot.y + Math.sin(a) * 260,
                    220, { cover: rng() < 0.5 });
    if (!p) continue;
    const u = spawn(pick('reserve', i), p, 'reserve', { fortify: 0.15 });
    u.order = makeOrder('DEFENDRE', { target: u.homePost, waypoints: [u.homePost], radius: 160 });
  }

  world.opforRally = { x: objective.x, y: objective.y };
  world.opforPois = pois;
  world.opforCommander = P.hq ? new EnemyCommander(world) : null;

  const roles = {};
  let nRed = 0;
  for (const u of world.units) if (u.side === 'OPFOR') { roles[u.role] = (roles[u.role] || 0) + 1; nRed++; }
  world.intel.say(null, forceBriefing(P, world), 'brief');
  world.intel.say(null, 'Renseignement de niveau supérieur : ennemi estimé à ' + nRed +
    ' éléments, dont environ ' + (roles.garrison || 0) + ' sur l’objectif, ' +
    (roles.patrol || 0) + ' en patrouille et ' + (roles.outpost || 0) + ' en postes. ' +
    (P.hq ? 'Un poste de commandement coordonne le dispositif : le réduire désarticulerait la défense.'
          : 'Aucun poste de commandement : chaque groupe agit pour son compte.'), 'brief');
}

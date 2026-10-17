// Modèle d'unité : groupe de combat (squad) ou véhicule, avec ses hommes,
// sa charge, sa fatigue, sa radio et son ordre en cours.

import { CATALOG, POSTURE, MAX_LOAD, SIDE } from './catalog.js';
import { TERRAIN, T } from '../world/terrain.js';
import { clamp } from '../core/util.js';

let NEXT_ID = 1;

export function makeSoldier(rng, load) {
  return {
    hp: 1,                       // 1 = valide, 0 = hors de combat
    wound: 0,                    // 0 indemne, 1 blessé léger, 2 blessé grave, 3 tué
    fatigue: rng.range(0, 0.08),
    load: load * rng.range(0.9, 1.12),
    ammo: 1,
    treated: false,
  };
}

export class Unit {
  constructor(opts, rng) {
    const spec = CATALOG[opts.type];
    this.id = NEXT_ID++;
    this.type = opts.type;
    this.spec = spec;
    this.kind = spec.kind;
    this.side = opts.side;
    this.callsign = opts.callsign;
    this.freq = opts.freq;
    this.net = opts.net || 'CDT';
    this.name = opts.name || spec.label;

    this.x = opts.x; this.y = opts.y;
    this.heading = opts.heading || 0;
    this.speed = 0;

    const men = spec.kind === 'squad' ? spec.men : (spec.crew || 0);
    this.soldiers = [];
    for (let i = 0; i < men; i++) this.soldiers.push(makeSoldier(rng, spec.load || 12));
    this.initialStrength = Math.max(1, men);

    this.ammo = 1;              // fraction de dotation
    this.fuel = 1;
    this.hull = spec.kind === 'squad' ? 0 : 1;   // intégrité du véhicule
    this.mobility = 1;          // réduite par les dégâts
    this.suppression = 0;       // 0..1, effet du feu reçu
    this.morale = 1;
    this.lastHit = -999;
    this.lastCasualty = -999;
    this.tactical = 'NORMAL';       // etat reflexe de combat (voir tactics.js)
    this.tacticalSince = 0;
    this.tacticalMemo = {};
    this.landed = spec.kind === 'air';   // un aéronef commence au sol sur sa base
    this.homeBase = null;                // FARP ou terrain d'aviation de rattachement
    this.rtb = false;                    // retour à la base en cours
    this.agl = spec.kind === 'air' ? 0 : 0;   // hauteur au-dessus du sol (m)
    this.vel = 0;                        // vitesse propre, avec inertie
    this.bank = 0;                       // inclinaison, pour le rendu
    this.landing = false;
    // armement choisi pour la mission de tir : 'gun', 'missile' ou 'both'
    this.armament = 'both';
    // Capacités liées au profil de force. Nos éléments sont équipés au complet ;
    // celles de l'adversaire sont écrasées par son profil (voir forces.js).
    this.nightVision = 1;        // 0 = aveugle de nuit, 1 = équipement complet
    this.training = 1;           // multiplicateur de précision
    this.cohesion = 1;           // résistance à la suppression
    this.doctrine = 'conventionnelle';
    this.openRange = 1;          // fraction de portée à laquelle on ouvre le feu
    this.breakAfter = 0;         // décrochage automatique après N s d'accrochage
    this.fireLog = [];           // journal des tirs effectués
    this.link = 1;              // qualité de liaison radio
    this.commsLost = false;
    this.posture = 'normal';
    this.roe = 'free';
    this.fortify = 0;           // 0..1 niveau d'organisation défensive
    this.inBuilding = null;     // id de bâtiment occupé
    this.mountedIn = null;      // id du véhicule porteur
    this.cargo = [];            // ids des unités embarquées (véhicules)
    this.capacity = spec.capacity || 0;

    this.order = null;
    this.path = null;
    this.pathIdx = 0;
    this.repathAt = 0;
    this.destKey = null;
    this.dest = null;
    this.allowBuilding = -1;
    this.fireMission = null;
    this.brokenAt = 0;
    this.destroyed = false;
    // dotation de ravitaillement transportée (véhicules logistiques)
    this.supplies = opts.supplies != null ? opts.supplies : (opts.type === 'transportation' ? 1 : 0);

    this.contacts = new Map();  // targetId -> { awareness, level, lastSeen, x, y, type }
    this.engaging = null;
    this.lastFired = -999;
    this.lastReport = -999;
    this.statusText = 'Disponible';
    this.trail = [];
  }

  // --- effectifs ---
  get alive() { let c = 0; for (const s of this.soldiers) if (s.wound < 3 && s.hp > 0) c++; return c; }
  get effective() { let c = 0; for (const s of this.soldiers) if (s.wound < 2 && s.hp > 0) c++; return c; }
  get wounded() { let c = 0; for (const s of this.soldiers) if (s.wound === 1 || s.wound === 2) c++; return c; }
  get killed() { let c = 0; for (const s of this.soldiers) if (s.wound === 3) c++; return c; }
  get strength() { return this.initialStrength ? this.effective / this.initialStrength : 0; }

  get fatigue() {
    let s = 0, c = 0;
    for (const m of this.soldiers) if (m.wound < 3) { s += m.fatigue; c++; }
    return c ? s / c : 0;
  }
  get load() {
    let s = 0, c = 0;
    for (const m of this.soldiers) if (m.wound < 3) { s += m.load; c++; }
    return c ? s / c : 0;
  }
  get combatReady() {
    return !this.destroyed && this.effective > 0 && this.morale > 0.15;
  }
  get isMounted() { return this.mountedIn != null; }

  // état général résumé, pour l'affichage sur l'icône
  get condition() {
    if (this.destroyed) return 'DÉTRUIT';
    if (this.effective === 0) return 'HORS DE COMBAT';
    // l'etat reflexe prime : c'est ce qui explique ce que fait l'unite a l'instant
    if (this.tactical && this.tactical !== 'NORMAL' && this.tactical !== 'ALERTE') return this.tactical;
    if (this.ammo < 0.2) return 'MUNITIONS';
    if (this.strength < 0.4) return 'ÉPROUVÉ';
    if (this.fatigue > 0.75) return 'ÉPUISÉ';
    if (this.strength < 0.75) return 'ENTAMÉ';
    if (this.threatCount) return 'AU CONTACT';
    return 'OPÉRATIONNEL';
  }

  // --- déplacement ---

  // vitesse (m/s) au point courant, tenant compte du terrain, de la pente,
  // de la charge, de la fatigue, de la posture et de la suppression.
  currentSpeed(terrain, dirX, dirY) {
    const spec = this.spec;
    const info = TERRAIN[terrain.typeAt(this.x, this.y)];
    const post = POSTURE[this.posture] || POSTURE.normal;

    let v;
    if (spec.kind === 'air') {
      if (this.landed) return 0;
      return spec.offSpeed * this.mobility;
    }
    if (spec.kind === 'vehicle') {
      const onRoad = info.road;
      v = onRoad ? spec.roadSpeed : spec.offSpeed;
      if (!onRoad && !spec.tracked) v *= 0.75;            // roues en tout-terrain
      if (!onRoad && info.cost > 1.5) v *= spec.tracked ? 0.7 : 0.35;
      v *= 0.55 + 0.45 * this.fuelFactor();
    } else {
      v = 1.38 / info.cost;                                // marche à pied
      const overload = clamp(this.load / MAX_LOAD, 0, 1.6);
      v *= 1 - 0.34 * overload;
      v *= 1 - 0.42 * this.fatigue;
      if (this.wounded > 0) v *= 1 - 0.25 * (this.wounded / Math.max(1, this.alive));
    }

    // pente : formule de Tobler simplifiée
    if (dirX != null) {
      const g = terrain.slopeAlong(this.x, this.y, dirX, dirY);
      v *= Math.exp(-3.0 * Math.abs(g)) * (g < 0 ? 1.08 : 1);
    }

    v *= post.speed;
    v *= 1 - 0.7 * this.suppression;
    v *= this.mobility;
    return Math.max(0.05, v);
  }

  fuelFactor() { return this.spec.fuel ? clamp(this.fuel, 0, 1) : 1; }

  // Systèmes d'arme disponibles, selon la sélection du chef.
  armaments() {
    const set = this.spec.weapons;
    if (!set) return [{ key: 'main', w: this.spec.weapon }];
    const out = [];
    if ((this.armament === 'gun' || this.armament === 'both') && set.gun) out.push({ key: 'gun', w: set.gun });
    if ((this.armament === 'missile' || this.armament === 'both') && set.missile) out.push({ key: 'missile', w: set.missile });
    if (!out.length) out.push({ key: 'main', w: this.spec.weapon });
    return out;
  }

  // Note un tir au journal de bord de l'élément.
  noteFire(time, targetId, weaponKey, label, rounds, hits) {
    const last = this.fireLog[this.fireLog.length - 1];
    // on regroupe les rafales successives sur la même cible avec la même arme
    if (last && last.targetId === targetId && last.key === weaponKey && time - last.last < 12) {
      last.last = time;
      last.rounds += rounds;
      last.hits += hits;
      return;
    }
    this.fireLog.push({ t: time, last: time, targetId, key: weaponKey, label, rounds, hits });
    if (this.fireLog.length > 30) this.fireLog.shift();
  }

  get roundsFired() { let n = 0; for (const e of this.fireLog) n += e.rounds; return n; }
  get hitsScored() { let n = 0; for (const e of this.fireLog) n += e.hits; return n; }

  // accumulation / récupération de la fatigue
  // `world` porte le terrain ET le climat : chaleur, froid, pluie et vent
  // pèsent sur l'effort autant que la pente ou la charge.
  updateFatigue(world, dt, moving) {
    if (this.kind !== 'squad') return;
    const terrain = world.terrain || world;              // tolère un terrain seul
    const info = TERRAIN[terrain.typeAt(this.x, this.y)];
    const post = POSTURE[this.posture] || POSTURE.normal;
    const effort = world.climateEffort != null ? world.climateEffort : 1;
    const recov = world.climateRecovery != null ? world.climateRecovery : 1;
    for (const s of this.soldiers) {
      if (s.wound >= 3) continue;
      if (moving) {
        const loadFactor = 0.6 + 0.9 * clamp(s.load / MAX_LOAD, 0, 1.6);
        s.fatigue += dt * 0.00011 * info.effort * post.effort * loadFactor * effort;
      } else {
        const rest = (this.suppression > 0.3 ? 0.00006 : 0.00028) * recov;
        s.fatigue -= dt * rest;
        // sous une chaleur écrasante, l'immobilité elle-même use
        if (effort > 1.8) s.fatigue += dt * 0.00004 * (effort - 1.8);
      }
      if (s.wound > 0) s.fatigue += dt * 0.00008 * s.wound;
      s.fatigue = clamp(s.fatigue, 0, 1);
    }
  }

  // Le poids total transporté par l'unité (kg), utile pour l'embarquement.
  totalMass() {
    if (this.kind === 'squad') {
      let m = 0;
      for (const s of this.soldiers) if (s.wound < 3) m += 80 + s.load;
      return m;
    }
    return 0;
  }
  seatsNeeded() { return this.alive; }
}

// --- Génération des indicatifs et fréquences ---

export const PHONETIC = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF',
  'HOTEL', 'INDIA', 'JULIETT', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA'];

export function freqString(mhz) { return mhz.toFixed(3) + ' MHz'; }

// Réseaux radio : le PC écoute plusieurs nets simultanément.
export const NETS = {
  CDT:  { label: 'Réseau commandement', freq: 31.250, color: '#ffd45e' },
  MAN:  { label: 'Réseau manœuvre',     freq: 44.775, color: '#7fd4ff' },
  APP:  { label: 'Réseau appui',        freq: 52.100, color: '#ff9d5e' },
  LOG:  { label: 'Réseau logistique',   freq: 38.400, color: '#9fe07f' },
  RECO: { label: 'Réseau renseignement',freq: 61.925, color: '#d59dff' },
  AIR:  { label: 'Réseau 3D',           freq: 122.750, color: '#7fffd4' },
};

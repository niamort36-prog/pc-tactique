// Catalogue des types d'unités. Les clés correspondent aux icônes OTAN du dossier icones/.

export const SIDE = { BLUFOR: 'BLUFOR', OPFOR: 'OPFOR', CIV: 'CIV' };

// weapon: portée efficace (m), cadence (engagements/min), létalité anti-personnel et anti-blindé
// optics : multiplicateur de portée de détection visuelle
// signature : visibilité passive (silhouette / mouvement)
// load : charge portée par homme (kg), influe sur vitesse et fatigue
export const CATALOG = {
  'command': {
    kind: 'squad', label: 'Groupe de commandement', men: 5, load: 24,
    weapon: { range: 300, rof: 12, apers: 0.55, aarmor: 0.02 },
    optics: 1.2, signature: 0.9, comms: 1.6, medic: 0.2, engineer: 0,
  },
  'infantry': {
    kind: 'squad', label: 'Groupe de combat', men: 8, load: 32,
    weapon: { range: 450, rof: 22, apers: 1.0, aarmor: 0.25, aair: 0.06 },
    optics: 1.0, signature: 1.0, comms: 1.0, medic: 0.1, engineer: 0.1,
  },
  'reco': {
    kind: 'squad', label: 'Équipe de reconnaissance', men: 4, load: 22,
    weapon: { range: 400, rof: 12, apers: 0.5, aarmor: 0.05 },
    optics: 2.2, signature: 0.45, comms: 1.4, medic: 0.05, engineer: 0,
  },
  'sniper': {
    kind: 'squad', label: 'Binôme tireur d’élite', men: 2, load: 26,
    weapon: { range: 900, rof: 3, apers: 0.9, aarmor: 0.02 },
    optics: 2.8, signature: 0.25, comms: 1.1, medic: 0, engineer: 0,
  },
  'anti tank': {
    kind: 'squad', label: 'Équipe antichar', men: 3, load: 40,
    // l'équipe antichar sert aussi le missile sol-air très courte portée
    weapon: { range: 2000, rof: 2.5, apers: 0.35, aarmor: 3.2, aair: 1.4, airRange: 3500 },
    optics: 1.6, signature: 0.7, comms: 1.0, medic: 0, engineer: 0,
  },
  'mortar': {
    kind: 'squad', label: 'Pièce de mortier 81 mm', men: 4, load: 45,
    weapon: { range: 4200, rof: 6, apers: 1.8, aarmor: 0.15, indirect: true, minRange: 200 },
    optics: 0.8, signature: 1.1, comms: 1.3, medic: 0, engineer: 0,
  },
  'engineer': {
    kind: 'squad', label: 'Équipe du génie', men: 5, load: 38,
    weapon: { range: 300, rof: 10, apers: 0.5, aarmor: 0.4 },
    optics: 0.9, signature: 1.0, comms: 1.0, medic: 0.05, engineer: 1.0,
  },
  'medical': {
    kind: 'squad', label: 'Équipe sanitaire', men: 3, load: 30,
    weapon: { range: 200, rof: 5, apers: 0.2, aarmor: 0 },
    optics: 0.8, signature: 0.9, comms: 1.1, medic: 1.0, engineer: 0,
  },
  'radio': {
    kind: 'squad', label: 'Équipe transmissions', men: 3, load: 34,
    weapon: { range: 250, rof: 6, apers: 0.3, aarmor: 0 },
    optics: 0.9, signature: 0.9, comms: 2.2, medic: 0, engineer: 0,
  },
  'sf': {
    kind: 'squad', label: 'Détachement forces spéciales', men: 6, load: 28,
    weapon: { range: 500, rof: 20, apers: 1.3, aarmor: 0.6, aair: 0.35 },
    optics: 2.4, signature: 0.3, comms: 1.8, medic: 0.4, engineer: 0.4,
  },
  'uav operator': {
    kind: 'squad', label: 'Équipe drone', men: 2, load: 30,
    weapon: { range: 200, rof: 5, apers: 0.2, aarmor: 0 },
    optics: 1.0, signature: 0.6, comms: 1.9, medic: 0, engineer: 0, launchesUav: true,
  },

  'transportation': {
    kind: 'vehicle', label: 'VTT roues (VAB)', crew: 2, capacity: 10, tracked: false,
    load: 0, armor: 0.45, roadSpeed: 22, offSpeed: 4.5,
    weapon: { range: 800, rof: 14, apers: 1.1, aarmor: 0.3, aair: 0.22 },
    optics: 1.1, signature: 2.2, comms: 1.7, medic: 0, engineer: 0,
    fuel: 900, fuelUse: 0.0015,     // ~600 km d'autonomie
  },
  'mechanized armor': {
    kind: 'vehicle', label: 'Blindé de combat chenillé', crew: 3, capacity: 7, tracked: true,
    load: 0, armor: 0.82, roadSpeed: 16, offSpeed: 9,
    weapon: { range: 2200, rof: 10, apers: 2.4, aarmor: 3.6, aair: 0.8, airRange: 2000 },
    optics: 1.9, signature: 3.0, comms: 1.7, medic: 0, engineer: 0,
    fuel: 1200, fuelUse: 0.0030,    // ~400 km, chenilles gourmandes
  },
  'infantry motorized': {
    kind: 'vehicle', label: 'Véhicule léger armé', crew: 2, capacity: 4, tracked: false,
    load: 0, armor: 0.15, roadSpeed: 25, offSpeed: 5,
    weapon: { range: 700, rof: 12, apers: 0.9, aarmor: 0.2, aair: 0.30 },
    optics: 1.1, signature: 1.7, comms: 1.4, medic: 0, engineer: 0,
    fuel: 700, fuelUse: 0.0012,     // ~600 km
  },
  'relay radio': {
    kind: 'vehicle', label: 'Véhicule relais radio', crew: 2, capacity: 2, tracked: false,
    load: 0, armor: 0.3, roadSpeed: 20, offSpeed: 3.5,
    weapon: { range: 300, rof: 6, apers: 0.3, aarmor: 0 },
    optics: 1.0, signature: 1.9, comms: 3.5, medic: 0, engineer: 0,
    fuel: 800, fuelUse: 0.0016, relay: true,   // ~500 km
  },
  'attack helicopter': {
    kind: 'air', label: 'Hélicoptère d’attaque', crew: 2, capacity: 0, tracked: false,
    load: 0, armor: 0.30, roadSpeed: 78, offSpeed: 78, altitude: 110,
    weapon: { range: 3600, rof: 15, apers: 2.6, aarmor: 4.2 },
    // Deux systèmes distincts : le canon crache vite et près, le missile frappe
    // loin et fort mais compte ses coups.
    weapons: {
      gun:     { label: 'Canon',   range: 1800, rof: 34, apers: 2.4, aarmor: 0.9, cost: 0.0016 },
      missile: { label: 'Missile', range: 4200, rof: 2.4, apers: 1.4, aarmor: 6.0, cost: 0.030 },
    },
    optics: 2.6, signature: 3.4, comms: 2.2,
    fuel: 5400, fuelUse: 0.0077, rotary: true, base: 'farp',      // ~2 h 30 d'autonomie
  },
  'transport helicopter': {
    kind: 'air', label: 'Hélicoptère de manœuvre', crew: 3, capacity: 14, tracked: false,
    load: 0, armor: 0.20, roadSpeed: 72, offSpeed: 72, altitude: 100,
    weapon: { range: 700, rof: 10, apers: 0.8, aarmor: 0.05 },
    weapons: { gun: { label: 'Sabord', range: 700, rof: 10, apers: 0.8, aarmor: 0.05, cost: 0.0018 } },
    optics: 1.5, signature: 3.6, comms: 2.4,
    fuel: 6200, fuelUse: 0.0080, rotary: true, canLand: true, base: 'farp',   // ~3 h
  },
  'attack aircraft': {
    kind: 'air', label: 'Avion d’appui', crew: 1, capacity: 0, tracked: false,
    load: 0, armor: 0.22, roadSpeed: 210, offSpeed: 210, altitude: 700,
    weapon: { range: 4200, rof: 5, apers: 4.2, aarmor: 5.6 },
    weapons: {
      gun:     { label: 'Canon',   range: 1600, rof: 55, apers: 3.4, aarmor: 1.8, cost: 0.0022 },
      missile: { label: 'Missile', range: 6000, rof: 1.8, apers: 4.0, aarmor: 7.5, cost: 0.055 },
    },
    optics: 2.0, signature: 4.0, comms: 2.0,
    fuel: 2600, fuelUse: 0.0023, base: 'runway', minRunway: 800,   // ~1 h 30
  },
  'recon aircraft': {
    kind: 'air', label: 'Avion de reconnaissance', crew: 2, capacity: 0, tracked: false,
    load: 0, armor: 0.06, roadSpeed: 120, offSpeed: 120, altitude: 950,
    weapon: { range: 0, rof: 0, apers: 0, aarmor: 0 },
    optics: 4.2, signature: 2.4, comms: 3.0,
    fuel: 9000, fuelUse: 0.0035, base: 'runway', minRunway: 600,   // ~6 h
  },

  'uav': {
    kind: 'air', label: 'Drone de reconnaissance', crew: 0, capacity: 0, tracked: false,
    load: 0, armor: 0, roadSpeed: 22, offSpeed: 22, altitude: 250,
    weapon: { range: 0, rof: 0, apers: 0, aarmor: 0 },
    optics: 3.5, signature: 0.5, comms: 2.0, medic: 0, engineer: 0,
    fuel: 3600, fuelUse: 0.0040,
  },
};

export const MAX_LOAD = 45;   // kg au-delà desquels le fantassin est saturé

// Postures : influencent vitesse, discrétion, précision et protection.
export const POSTURE = {
  rush:     { label: 'Course',   speed: 1.55, stealth: 0.35, accuracy: 0.45, exposure: 1.5, effort: 2.4 },
  normal:   { label: 'Normal',   speed: 1.00, stealth: 1.00, accuracy: 1.00, exposure: 1.0, effort: 1.0 },
  tactical: { label: 'Tactique', speed: 0.62, stealth: 1.9,  accuracy: 1.25, exposure: 0.6, effort: 1.15 },
  stealth:  { label: 'Furtif',   speed: 0.32, stealth: 3.4,  accuracy: 1.1,  exposure: 0.35, effort: 0.9 },
  prone:    { label: 'Au sol',   speed: 0.10, stealth: 4.0,  accuracy: 1.4,  exposure: 0.25, effort: 0.5 },
};

export const ROE = {
  free:      { label: 'Feu à volonté', engage: 1.0,  openRange: 1.0 },
  returnFire:{ label: 'Riposte seule', engage: 0.0,  openRange: 1.0, returnsFire: true },
  hold:      { label: 'Feu interdit',  engage: 0.0,  openRange: 0.0 },
};

export function isVehicle(unit) { return CATALOG[unit.type].kind === 'vehicle'; }
export function isAir(unit) { return CATALOG[unit.type].kind === 'air'; }
export function isRotary(unit) { return !!CATALOG[unit.type].rotary; }
// un aéronef à voilure fixe a besoin d'une piste : sans terrain, il n'est pas proposé
export function needsRunway(type) { return CATALOG[type].base === 'runway'; }
export function minRunway(type) { return CATALOG[type].minRunway || 0; }
export function isSquad(unit) { return CATALOG[unit.type].kind === 'squad'; }

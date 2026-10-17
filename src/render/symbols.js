// Chargement et sélection des icônes OTAN du dossier icones/.
// Les types aériens, absents de la collection, sont dessinés par airSymbols.js.

import { airIcon, isAirSymbol } from './airSymbols.js';

let MANIFEST = null;
const CACHE = new Map();

export async function loadSymbols() {
  if (MANIFEST) return MANIFEST;
  const res = await fetch('data/icons.json');
  MANIFEST = await res.json();
  return MANIFEST;
}

export function manifest() { return MANIFEST; }

function load(path) {
  if (!path) return null;
  let img = CACHE.get(path);
  if (img) return img;
  img = new Image();
  img.src = encodeURI(path);
  CACHE.set(path, img);
  return img;
}

// affiliation : 'friend' | 'hostile' | 'unknown' | 'neutral'
export function unitIcon(type, affiliation) {
  if (!MANIFEST) return null;
  const e = MANIFEST.units[type];
  // une vraie image du dossier prime toujours sur le symbole généré
  if (e && (e[affiliation] || e.friend || e.unknown)) return load(e[affiliation] || e.friend || e.unknown);
  if (isAirSymbol(type)) return airIcon(type, affiliation || 'friend');
  const fb = MANIFEST.units['infantry'];
  return fb ? load(fb[affiliation] || fb.friend) : null;
}

export function pointIcon(kind, affiliation = 'friend') {
  if (!MANIFEST) return null;
  const e = MANIFEST.points[kind];
  if (!e) return null;
  return load(e[affiliation] || e.friend || Object.values(e)[0]);
}

export function hasUnitIcon(type) { return !!(MANIFEST && MANIFEST.units[type]); }

export function unitTypes() { return MANIFEST ? Object.keys(MANIFEST.units) : []; }
export function pointTypes() { return MANIFEST ? Object.keys(MANIFEST.points) : []; }

// Précharge tout pour éviter les icônes manquantes au premier rendu.
export function preload() {
  if (!MANIFEST) return [];
  const all = [];
  for (const bag of [MANIFEST.units, MANIFEST.points]) {
    for (const k of Object.keys(bag)) {
      for (const aff of Object.keys(bag[k])) all.push(load(bag[k][aff]));
    }
  }
  return all;
}

// Catégorie grossière visible à l'œil nu avant identification formelle.
export function coarseType(unitType) {
  if (unitType === 'mechanized armor' || unitType === 'transportation' ||
      unitType === 'infantry motorized' || unitType === 'relay radio') return 'transportation';
  if (unitType === 'uav') return 'uav';
  // vu sans être identifié, un aéronef n'est qu'un aéronef
  if (isAirSymbol(unitType)) return 'air';
  return 'infantry';
}

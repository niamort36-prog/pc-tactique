// Génère data/icons.json à partir du dossier icones/.
// Gère les irrégularités de nommage (espaces doubles, majuscules, "transport neutre" vs "transportation", ...).
import { readdirSync, writeFileSync } from 'node:fs';

const AFFIX = [
  ['hostile', 'hostile'],
  ['inconnu', 'unknown'],
  ['neutre', 'neutral'],
];

// alias de clé -> clé canonique
const ALIAS = {
  'transport': 'transportation',
  'motorized': 'infantry motorized',
  'rearm refuel ressuply point': 'rearm point',
};

const files = readdirSync('icones').filter(f => f.toLowerCase().endsWith('.png'));

const units = {};
const points = {};

for (const file of files) {
  let base = file.replace(/\.png$/i, '');
  base = base.replace(/\s+/g, ' ').trim().toLowerCase();

  let aff = 'friend';
  for (const [fr, en] of AFFIX) {
    if (base.endsWith(' ' + fr)) { aff = en; base = base.slice(0, -(fr.length + 1)).trim(); break; }
  }

  base = ALIAS[base] || base;

  const isPoint = /(\bpoint\b|\bpost\b|^structure )/.test(base) || base === 'rearm point';
  const bag = isPoint ? points : units;
  bag[base] = bag[base] || {};
  bag[base][aff] = 'icones/' + file;
}

const out = { units, points };
writeFileSync('data/icons.json', JSON.stringify(out, null, 1));

const unitKeys = Object.keys(units).sort();
console.log('UNITS (' + unitKeys.length + '):');
for (const k of unitKeys) console.log('  ' + k.padEnd(22) + Object.keys(units[k]).sort().join(','));
console.log('POINTS (' + Object.keys(points).length + '): ' + Object.keys(points).sort().join(' | '));

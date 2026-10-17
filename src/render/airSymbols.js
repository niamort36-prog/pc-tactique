// Symboles OTAN aériens, dessinés à la volée.
//
// La collection d'icônes fournie ne contient aucun symbole aérien : on les
// construit donc au standard APP-6, où l'aérien se reconnaît à son cadre ouvert
// vers le bas (arche pour un ami, pointe pour un hostile, trèfle pour un inconnu,
// carré pour un neutre). Le glyphe central distingue voilure tournante et voilure
// fixe, la lettre donne la fonction.
//
// Si vous déposez plus tard de vraies images nommées « attack helicopter.png »,
// « attack helicopter hostile.png », etc. dans icones/ puis relancez
// `node tools/build-icons.mjs`, elles prendront automatiquement le dessus.

const SIZE = 64;

export const AIR_SPEC = {
  'attack helicopter':    { glyph: 'rotor', letter: 'A' },
  'transport helicopter': { glyph: 'rotor', letter: 'T' },
  'attack aircraft':      { glyph: 'wing',  letter: 'A' },
  'recon aircraft':       { glyph: 'wing',  letter: 'R' },
  'air':                  { glyph: 'none',  letter: '' },   // aéronef non identifié
};

const AFF = {
  friend:  { fill: '#8cc9f0', line: '#06263c', frame: 'arch' },
  hostile: { fill: '#f08a80', line: '#3a0b07', frame: 'peak' },
  unknown: { fill: '#f2d970', line: '#3a3006', frame: 'clover' },
  neutral: { fill: '#8fe0a0', line: '#08301a', frame: 'square' },
};

const cache = new Map();

// Contour du cadre, laissé ouvert vers le bas comme le veut la symbologie aérienne.
function framePath(ctx, kind) {
  ctx.beginPath();
  if (kind === 'peak') {
    ctx.moveTo(9, 55); ctx.lineTo(9, 35); ctx.lineTo(32, 9); ctx.lineTo(55, 35); ctx.lineTo(55, 55);
  } else if (kind === 'square') {
    ctx.moveTo(9, 55); ctx.lineTo(9, 13); ctx.lineTo(55, 13); ctx.lineTo(55, 55);
  } else if (kind === 'clover') {
    ctx.moveTo(9, 55); ctx.lineTo(9, 37);
    ctx.arc(19, 37, 10, Math.PI, 0);
    ctx.arc(32, 27, 10, Math.PI, 0);
    ctx.arc(45, 37, 10, Math.PI, 0);
    ctx.lineTo(55, 55);
  } else {
    ctx.moveTo(9, 55); ctx.lineTo(9, 32);
    ctx.arc(32, 32, 23, Math.PI, 0);
    ctx.lineTo(55, 55);
  }
}

// Voilure tournante : moyeu et pales vues de dessus.
function drawRotor(ctx, line) {
  ctx.strokeStyle = line;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(17, 38); ctx.lineTo(47, 38);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(32, 33, 13, 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = line;
  ctx.beginPath();
  ctx.arc(32, 33, 3.4, 0, Math.PI * 2);
  ctx.fill();
}

// Voilure fixe : fuselage et ailes en flèche.
function drawWing(ctx, line) {
  ctx.fillStyle = line;
  ctx.beginPath();
  ctx.moveTo(32, 22);
  ctx.lineTo(35, 33);
  ctx.lineTo(48, 41);
  ctx.lineTo(48, 44);
  ctx.lineTo(34, 40);
  ctx.lineTo(34, 46);
  ctx.lineTo(38, 50);
  ctx.lineTo(38, 52);
  ctx.lineTo(32, 50);
  ctx.lineTo(26, 52);
  ctx.lineTo(26, 50);
  ctx.lineTo(30, 46);
  ctx.lineTo(30, 40);
  ctx.lineTo(16, 44);
  ctx.lineTo(16, 41);
  ctx.lineTo(29, 33);
  ctx.closePath();
  ctx.fill();
}

function render(type, affiliation) {
  const spec = AIR_SPEC[type] || AIR_SPEC.air;
  const aff = AFF[affiliation] || AFF.friend;

  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d');

  // corps du cadre
  framePath(ctx, aff.frame);
  ctx.closePath();
  ctx.fillStyle = aff.fill;
  ctx.fill();

  // contour, sans la base : le cadre aérien reste ouvert vers le bas
  framePath(ctx, aff.frame);
  ctx.strokeStyle = aff.line;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (spec.glyph === 'rotor') drawRotor(ctx, aff.line);
  else if (spec.glyph === 'wing') drawWing(ctx, aff.line);

  if (spec.letter) {
    ctx.fillStyle = aff.line;
    ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.letter, 32, spec.glyph === 'rotor' ? 20 : 17);
  }

  return cv.toDataURL();
}

// Renvoie une Image, pour rester interchangeable avec les icônes PNG du dossier.
export function airIcon(type, affiliation) {
  const key = type + '|' + affiliation;
  let img = cache.get(key);
  if (img) return img;
  img = new Image();
  img.src = render(type, affiliation);
  cache.set(key, img);
  return img;
}

export function isAirSymbol(type) { return !!AIR_SPEC[type]; }

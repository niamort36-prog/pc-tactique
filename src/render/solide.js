// Solides en CSS 3D : la brique commune de tout ce qu'on pose dans la tente.
//
// Chaque face porte sa matrice complète, calculée ici plutôt qu'assemblée par
// une suite de rotations CSS : enchaîner rotateX et rotateZ dans une pile
// `transform` donne un résultat qui dépend de l'ordre de composition et se
// laisse mal vérifier. Une matrice posée à plat est sans ambiguïté, et ses
// coins se contrôlent au calcul.
//
// Les matrices sont en colonnes, comme les attend matrix3d(). Les faces
// portent `transform-origin: 0 0` (voir la feuille de style) : le centrage est
// déjà dans la matrice, le navigateur ne doit pas le refaire.

export const RAD = Math.PI / 180;

export function mul(a, b) {
  const r = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let l = 0; l < 4; l++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + l] * b[c * 4 + k];
      r[c * 4 + l] = s;
    }
  }
  return r;
}
export const mT = (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
export const mS = k => [k,0,0,0, 0,k,0,0, 0,0,k,0, 0,0,0,1];
export const mRX = a => { const c = Math.cos(a), s = Math.sin(a);
  return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; };
export const mRY = a => { const c = Math.cos(a), s = Math.sin(a);
  return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; };
export const mRZ = a => { const c = Math.cos(a), s = Math.sin(a);
  return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; };

/**
 * Matrice d'une face : on centre l'élément sur son origine, on le redresse
 * (rx), on l'oriente (ry), on l'incline (rz), puis on le pose.
 */
export function matFace(o) {
  let m = mT(o.x || 0, o.y || 0, o.z || 0);
  if (o.rz) m = mul(m, mRZ(o.rz * RAD));
  if (o.ry) m = mul(m, mRY(o.ry * RAD));
  if (o.rx) m = mul(m, mRX(o.rx * RAD));
  if (o.s) m = mul(m, mS(o.s));
  return mul(m, mT(-o.w / 2, -o.h / 2, 0));
}

export function noeud(cls) {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

// Une face plane, centrée sur (x, y, z). `rx` la couche, `ry` l'oriente,
// `rz` l'incline — dans cet ordre.
/**
 * Les deux cotes qu'une face tire de sa taille.
 *
 * `--trait` : l'épaisseur du tracé. Un cerne fixe de 1,5 cm ne laissait plus
 * rien voir d'un pied de table large de 4 cm — la moitié du meuble virait au
 * noir. À 4,5 % du petit côté, il reste un tracé sans écraser la matière.
 * `--ao` : le rayon de l'ombre de contact, ce creux sur le pourtour qui
 * détache deux volumes de même couleur posés l'un sur l'autre.
 */
function cotes(el, w, h) {
  const petit = Math.min(w, h);
  el.style.setProperty('--trait',
    Math.min(1.7, Math.max(0.4, petit * 0.045)).toFixed(2) + 'px');
  el.style.setProperty('--ao',
    Math.min(34, Math.max(1.6, petit * 0.22)).toFixed(1) + 'px');
}

export function poser(el, o) {
  el.style.width = o.w + 'px';
  el.style.height = o.h + 'px';
  cotes(el, o.w, o.h);
  el.style.transform = 'matrix3d(' + matFace(o).map(v => +v.toFixed(6)).join(',') + ')';
  return el;
}

export function face(cls, o) { return poser(noeud('face ' + cls), o); }

/**
 * Une face dont on fournit la matrice toute faite.
 *
 * `poser()` compose ses rotations dans l'ordre RZ·RY·RX, ce qui décrit la
 * plupart des pièces. Un coffret incliné n'en fait pas partie : le flanc d'un
 * poste penché vers l'arrière demande qu'on l'oriente d'abord et qu'on
 * l'incline ensuite, soit l'ordre inverse. Plutôt que d'ajouter un angle de
 * plus à `poser()`, on laisse l'appelant construire sa matrice.
 */
export function faceMat(cls, w, h, m) {
  const el = noeud('face ' + cls);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  cotes(el, w, h);
  el.style.transform = 'matrix3d('
    + mul(m, mT(-w / 2, -h / 2, 0)).map(v => +v.toFixed(6)).join(',') + ')';
  return el;
}

// Un montant : deux plans croisés, bien assez pour un pied ou un câble tendu.
export function poteau(cls, o) {
  return [
    face(cls, { w: o.w, h: o.h, x: o.x, y: o.y, z: o.z, rz: o.rz || 0 }),
    face(cls, { w: o.w, h: o.h, x: o.x, y: o.y, z: o.z, ry: 90, rz: o.rz || 0 }),
  ];
}

// Une boîte pleine. Le dessous ne se voit qu'au-dessus de l'œil : on ne le pose
// que sur demande (`bas: true`), sinon c'est cinq faces de peintes pour rien.
export function boite(cls, o) {
  const { x, y, z, w, h, d } = o;
  const ry = o.ry || 0, c = Math.cos(ry * RAD), s = Math.sin(ry * RAD);
  // décalage d'une face dans le repère tourné de la boîte
  const dep = (ax, az) => ({ x: x + ax * c + az * s, z: z - ax * s + az * c });
  const av = dep(0, d / 2), ar = dep(0, -d / 2);
  const dr = dep(w / 2, 0), ga = dep(-w / 2, 0);
  return [
    face(cls + ' dessus', { w, h: d, x, y: y - h / 2, z, rx: 90, rz: 0, ry }),
    face(cls + ' av', { w, h, x: av.x, y, z: av.z, ry }),
    face(cls + ' ar', { w, h, x: ar.x, y, z: ar.z, ry }),
    face(cls + ' fl', { w: d, h, x: dr.x, y, z: dr.z, ry: ry + 90 }),
    face(cls + ' fl', { w: d, h, x: ga.x, y, z: ga.z, ry: ry + 90 }),
    ...(o.bas ? [face(cls + ' dessous', { w, h: d, x, y: y + h / 2, z, rx: 90, ry })] : []),
  ];
}


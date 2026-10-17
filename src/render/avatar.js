// Le corps du chef, et demain celui des autres.
//
// Un squelette articulé en CSS 3D : chaque os est un repère vide qui porte sa
// rotation, et les volumes visibles y sont accrochés. Faire tourner un os
// entraîne toute sa descendance — l'épaule emmène le bras, le bras emmène
// l'avant-bras. C'est ce qui permet une marche et une position assise sans
// redessiner quoi que ce soit.
//
// Les mesures sont en centimètres, comme la tente. Le repère du personnage est
// au sol entre ses pieds, y vers le bas : la tête est donc à -175.
//
// Le module ne connaît ni la caméra ni le jeu : on lui donne une position, un
// cap, une allure et il se tient. C'est ce qui le rendra utilisable tel quel
// pour un deuxième joueur.

import { RAD, matFace, noeud, boite } from './solide.js';

// ---------------------------------------------------------------- mesures

const M = {
  // hauteurs, mesurées depuis le sol
  hanche: 92, epaule: 140, cou: 152, sommet: 175,
  // segments
  cuisse: 45, tibia: 42, pied: 8,
  bras: 29, avantBras: 27,
  buste: 48, tete: 23,
  // largeurs
  // l'épaule dégage la demi-largeur du buste, sinon le bras y disparaît
  // l'écart d'épaule pose le bras contre le buste, pas à côté : demi-largeur
  // du torse plus demi-largeur du bras, à un centimètre près
  ecartHanche: 10, ecartEpaule: 23,
  membre: 11, torse: 33, epaisseur: 21,
};

// Amplitudes de la marche, en degrés.
const PAS = {
  hanche: 26, genou: 34, epaule: 20, coude: 22,
  balancement: 3.5, roulis: 2.2,
};

// ---------------------------------------------------------------- squelette

/**
 * Un os : un repère sans épaisseur, articulé sur son point d'attache.
 *
 * `transform-origin` est laissé au coin, comme pour toutes nos faces, et le
 * repère fait zéro par zéro : son origine est donc exactement l'articulation,
 * et la rotation ne peut pas dériver.
 */
function os(cls) {
  const d = noeud('os ' + cls);
  return d;
}

function poserOs(el, x, y, z, rx = 0, ry = 0, rz = 0) {
  el.style.transform =
    'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,' + z.toFixed(2) + 'px)' +
    (ry ? ' rotateY(' + ry.toFixed(2) + 'deg)' : '') +
    (rx ? ' rotateX(' + rx.toFixed(2) + 'deg)' : '') +
    (rz ? ' rotateZ(' + rz.toFixed(2) + 'deg)' : '');
}

// Un volume accroché à un os : sa matrice est relative à l'articulation.
function volume(cls, o) {
  const el = noeud('face ' + cls);
  el.style.width = o.w + 'px';
  el.style.height = o.h + 'px';
  el.style.transform = 'matrix3d(' + matFace(o).map(v => +v.toFixed(6)).join(',') + ')';
  return el;
}

// Un membre pend de son articulation : la boîte descend depuis l'origine.
function membre(parent, cls, w, h, d) {
  for (const f of boite(cls, { x: 0, y: h / 2, z: 0, w, h, d })) parent.append(f);
}

// Le tronc, lui, monte : buste, cou et tête s'élèvent depuis le bassin. Les
// faire pendre comme un bras les empilait dans les jambes.
function tronc(parent, cls, w, h, d) {
  for (const f of boite(cls, { x: 0, y: -h / 2, z: 0, w, h, d })) parent.append(f);
}

// ---------------------------------------------------------------- la tenue

/**
 * Le motif AOR2 de la tenue NWU.
 *
 * Un camouflage numérique est une mosaïque de carrés : on la fabrique donc
 * comme telle, en SVG, à partir d'un tirage reproductible. Quatre valeurs
 * seulement — c'est ce qui fait sa lisibilité de loin, et sa granularité de
 * près. Généré une fois et partagé par tous les corps.
 */
// Relevées sur une NWU Type III : la tenue tire nettement plus au vert
// sombre que la version désert, avec du brun et un noir franc qui portent le
// motif de loin. Le fond clair ne sert qu'à aérer.
const AOR2 = ['#8b8e60', '#5c6a41', '#39472c', '#4d4029', '#1d2016'];

let motif = null;
export function camoAOR2(cote = 72, pas = 6, graine = 20260822) {
  if (motif) return motif;
  let g = graine;
  const alea = () => (g = (g * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const n = Math.round(cote / pas);
  let rects = '';
  // On part d'un fond, puis on jette des taches de quelques carrés : c'est
  // ainsi qu'un camouflage numérique est construit, pas pixel par pixel.
  const grille = new Array(n * n).fill(0);
  for (let couche = 1; couche < AOR2.length; couche++) {
    // les valeurs sombres sont plus nombreuses et plus petites : c'est ce qui
    // donne au motif son grain serré et sa dominante verte
    const taches = couche >= 3 ? 30 : 18;
    for (let t = 0; t < taches; t++) {
      const cx = Math.floor(alea() * n), cy = Math.floor(alea() * n);
      const w = 1 + Math.floor(alea() * (couche >= 3 ? 2 : 4));
      const h = 1 + Math.floor(alea() * (couche >= 3 ? 2 : 4));
      for (let i = 0; i < w; i++) {
        for (let j = 0; j < h; j++) {
          if (alea() < 0.22) continue;            // bord dentelé
          grille[((cy + j) % n) * n + ((cx + i) % n)] = couche;
        }
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = grille[j * n + i];
      if (!c) continue;
      rects += '<rect x="' + i * pas + '" y="' + j * pas + '" width="' + pas +
               '" height="' + pas + '" fill="' + AOR2[c] + '"/>';
    }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cote + '" height="' + cote + '">' +
    '<rect width="' + cote + '" height="' + cote + '" fill="' + AOR2[0] + '"/>' + rects + '</svg>';
  motif = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  return motif;
}

// ---------------------------------------------------------------- le corps

export class Avatar {
  /**
   * @param {object} opts
   *   `local` : c'est le corps du joueur qui regarde. On lui retire la tête,
   *   sans quoi il la verrait de l'intérieur ; le reste, il le voit en
   *   baissant les yeux, ce qui est exactement ce qu'on veut.
   */
  constructor(opts = {}) {
    this.local = !!opts.local;
    // La NWU se porte seule ; le gilet reste possible pour une tenue de combat.
    this.gilet = !!opts.gilet;
    this.phase = 0;          // avancement du cycle de marche
    this.assis = 0;          // 0 debout, 1 assis — interpolé
    this.allure = 0;         // 0 à 1

    this.el = noeud('avatar' + (this.local ? ' local' : ''));
    this.el.style.setProperty('--camo', camoAOR2());
    this.construire();
  }

  construire() {
    const b = this.os = {};

    // bassin : la racine, à hauteur de hanche
    b.bassin = os('bassin');
    this.el.append(b.bassin);

    // buste, puis tête et bras
    b.buste = os('buste');
    b.bassin.append(b.buste);
    tronc(b.buste, 'treillis torse', M.torse, M.buste, M.epaisseur);
    // Vareuse : les deux poches de poitrine et la patte de boutonnage. Ce sont
    // elles qui font lire une NWU plutôt qu'un simple bloc au motif.
    const devant = M.epaisseur / 2 + 0.4;
    for (const c of [-1, 1]) {
      b.buste.append(volume('poche poitrine', {
        w: 12, h: 13, x: c * 8.5, y: -M.buste * 0.72, z: devant,
      }));
    }
    b.buste.append(volume('patte', { w: 3, h: M.buste * 0.84, x: 0, y: -M.buste * 0.5, z: devant }));
    if (this.gilet) {
      for (const z of [M.epaisseur / 2 + 1.6, -M.epaisseur / 2 - 1.6]) {
        b.buste.append(volume('gilet', {
          w: M.torse + 3, h: M.buste * 0.6, x: 0, y: -M.buste * 0.6, z,
        }));
      }
    }

    b.cou = os('cou');
    b.buste.append(b.cou);
    tronc(b.cou, 'peau', 11, M.cou - M.epaule, 11);
    b.tete = os('tete');
    b.cou.append(b.tete);
    if (!this.local) {
      tronc(b.tete, 'peau visage', 17, M.tete, 19);
      // Casquette huit pointes : calotte plate et courte visière. La classe est
      // préfixée — « casque » désigne déjà celui posé sur la table, et la règle
      // de l'avatar le vidait de sa matière.
      for (const f of boite('av-couvre', {
        x: 0, y: -M.tete + 4, z: -0.5, w: 19.5, h: 9, d: 21.5,
      })) b.tete.append(f);
      b.tete.append(volume('av-visiere', {
        w: 18, h: 8, x: 0, y: -M.tete + 8.5, z: 12, rx: 74,
      }));
    }

    for (const c of [-1, 1]) {
      const cote = c < 0 ? 'g' : 'd';
      b['epaule' + cote] = os('epaule ' + cote);
      b.buste.append(b['epaule' + cote]);
      membre(b['epaule' + cote], 'treillis bras', M.membre, M.bras, M.membre);

      b['coude' + cote] = os('coude ' + cote);
      b['epaule' + cote].append(b['coude' + cote]);
      membre(b['coude' + cote], 'treillis bras', M.membre - 1, M.avantBras, M.membre - 1);
      b['coude' + cote].append(volume('gant', {
        w: M.membre, h: 9, x: 0, y: M.avantBras + 4, z: 0,
      }));

      b['hanche' + cote] = os('hanche ' + cote);
      b.bassin.append(b['hanche' + cote]);
      membre(b['hanche' + cote], 'treillis', M.membre + 1, M.cuisse, M.membre + 2);
      // poche de cuisse, sur la face externe
      b['hanche' + cote].append(volume('poche cuisse', {
        w: 12, h: 14, x: c * (M.membre / 2 + 0.9), y: M.cuisse * 0.56, z: 1, ry: 90,
      }));

      b['genou' + cote] = os('genou ' + cote);
      b['hanche' + cote].append(b['genou' + cote]);
      membre(b['genou' + cote], 'treillis', M.membre, M.tibia, M.membre + 1);

      b['cheville' + cote] = os('cheville ' + cote);
      b['genou' + cote].append(b['cheville' + cote]);
      // rangers montantes, noires : elles ferment la silhouette au sol
      for (const f of boite('rangers', {
        x: 0, y: -3 + M.pied, z: 2.5, w: M.membre + 2, h: M.pied * 2.4, d: 26,
      })) b['cheville' + cote].append(f);
    }

    // ombre au sol, qui suit le corps
    this.ombre = volume('ombre-corps', { w: 62, h: 42, x: 0, y: 0.6, z: 0, rx: 90 });
    this.el.append(this.ombre);

    this.poser();
  }

  // ------------------------------------------------------------ animation

  /**
   * Avance le personnage d'un pas de temps.
   * @param dt   secondes
   * @param etat `{ vitesse } en cm/s, `{ assis }` vrai s'il est à un poste
   */
  anime(dt, etat = {}) {
    const v = Math.max(0, etat.vitesse || 0);
    const cible = Math.min(1, v / 170);
    // l'allure suit la vitesse sans à-coup : on ne passe pas de zéro au pas cadencé
    this.allure += (cible - this.allure) * (1 - Math.exp(-dt * 9));
    // la cadence monte avec l'allure : environ deux pas par seconde au pas normal
    this.phase += dt * (3.4 + 2.2 * this.allure) * Math.max(0.15, this.allure);

    const versAssis = etat.assis ? 1 : 0;
    this.assis += (versAssis - this.assis) * (1 - Math.exp(-dt * 6));
    this.poser();
  }

  poser() {
    const b = this.os, p = this.phase, a = this.allure, s = this.assis;
    const sin = Math.sin(p), sinD = Math.sin(p + Math.PI);

    // --- debout / en marche ---
    const hancheG = PAS.hanche * sin * a;
    const hancheD = PAS.hanche * sinD * a;
    // un genou ne plie que vers l'arrière : on ne garde que la moitié utile
    const genouG = Math.max(0, -PAS.genou * Math.sin(p - 0.5)) * a;
    const genouD = Math.max(0, -PAS.genou * Math.sin(p + Math.PI - 0.5)) * a;
    const epauleG = -PAS.epaule * sin * a;
    const epauleD = -PAS.epaule * sinD * a;
    const coudeG = -(12 + PAS.coude * Math.max(0, sin)) * a;
    const coudeD = -(12 + PAS.coude * Math.max(0, sinD)) * a;

    // --- assis : cuisses à l'horizontale, tibias à la verticale ---
    const mel = (marche, assise) => marche * (1 - s) + assise * s;

    const hauteur = mel(-M.hanche + Math.abs(Math.sin(p)) * PAS.balancement * a, -52);
    poserOs(b.bassin, 0, hauteur, mel(0, -6), 0, 0, mel(PAS.roulis * sin * a, 0));

    // le buste part du bassin, le cou du haut du buste, la tête du haut du cou
    poserOs(b.buste, 0, 0, 0, mel(4 + 2 * a, 6), 0, 0);
    poserOs(b.cou, 0, -M.buste, 0, mel(-3, -6));
    poserOs(b.tete, 0, -(M.cou - M.epaule), 0, mel(-2, 0));

    for (const c of [-1, 1]) {
      const cote = c < 0 ? 'g' : 'd';
      const hancheM = c < 0 ? hancheG : hancheD;
      const genouM = c < 0 ? genouG : genouD;
      const epauleM = c < 0 ? epauleG : epauleD;
      const coudeM = c < 0 ? coudeG : coudeD;

      // légèrement en avant et écarté : collé au plan du buste, le bras s'y noie
      poserOs(b['epaule' + cote], c * M.ecartEpaule, -(M.buste - 5), 3,
              mel(epauleM, -22), 0, c * mel(7, 11));
      poserOs(b['coude' + cote], 0, M.bras, 0, mel(coudeM, -62));

      poserOs(b['hanche' + cote], c * (M.ecartHanche / 2 + 2), 0, 0,
              mel(hancheM, -84), 0, c * 2);
      poserOs(b['genou' + cote], 0, M.cuisse, 0, mel(genouM, 86));
      poserOs(b['cheville' + cote], 0, M.tibia, 0, mel(-hancheM * 0.35, -4));
    }
  }

  // Position et cap dans la pièce. Le repère du corps est au sol.
  place(x, y, z, yaw) {
    this.el.style.transform =
      'translate3d(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px,' + z.toFixed(2) + 'px)' +
      ' rotateY(' + (180 - yaw).toFixed(2) + 'deg)';
  }
}

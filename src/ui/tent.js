// La tente de commandement, à la première personne.
//
// Le chef est debout sous la toile et s'y déplace librement : souris pour
// regarder, ZQSD pour marcher. Aucune ouverture vers l'extérieur — ce qui se
// passe dehors n'arrive que par la radio, et seulement si le poste
// correspondant est allumé.
//
// La pièce est en CSS 3D, pas en WebGL, et ce choix est le cœur du dispositif :
// les faces sont de vrais éléments du document, donc l'écran de situation posé
// sur la table est l'interface de jeu elle-même — vivante, nette, cliquable —
// et les postes radio sont de vraies commandes. Rien n'est dupliqué ni redessiné.
//
// Repère : x vers la droite, z vers l'entrée (le fond de la tente est en z
// négatif), y vers le BAS comme partout en CSS. Le sol est à y = 0, les yeux à
// y = -EYE. Une unité vaut un centimètre.

import { SET_TYPES } from '../sim/radios.js';
import { freqString } from '../sim/unit.js';
import { formatClock } from '../core/util.js';
import { lonToTileX, latToTileY } from '../core/geo.js';
import { TYPE_FR } from '../sim/intel.js';
import { NETS } from '../sim/unit.js';
import { RAD, matFace, noeud, poser, face, faceMat, poteau, boite,
  mul, mT, mRX, mRY } from '../render/solide.js';
import { Avatar } from '../render/avatar.js';
import { poserMatieres } from '../render/matiere.js';

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- la pièce

const ROOM = { w: 880, d: 720, mur: 215, faite: 300 };
const EYE = 168;                    // hauteur des yeux
const TABLE = { h: 76, ep: 8 };     // plateau : hauteur et épaisseur
// Largeur telle que la distance de travail (MON_W·f/largeur de fenêtre) reste
// en deçà de ce qu'on peut atteindre en marchant : l'interface n'est jamais
// agrandie au-delà du pixel pour pixel, donc jamais floue.
const MON_W = 104;                  // largeur du moniteur de situation
const MON_EP = 6.5;                 // la dalle affleure devant la carcasse
const RACK_W = 184;                 // ce que les six postes tiennent de plateau

/**
 * Les postes, aux cotes des vrais matériels.
 *
 * Le PRC-117G est un coffret de 19 x 9 x 24 cm posé à plat ; le PRC-152 un
 * portatif de 24 cm de haut sur 7 de large. On les tient à peu près à
 * l'échelle — un peu plus larges, parce qu'il faut que la face avant reste
 * lisible à un mètre, et que la batterie et le berceau épaississent de toute
 * façon l'ensemble.
 *
 * `incl` est l'inclinaison du poste sur son berceau : c'est elle qui présente
 * la face à celui qui se tient devant la table, au lieu de la lui laisser à
 * plat sur le plateau.
 */
const RADIO3D = {
  'PRC-117': { large: 23, prof: 29, incl: 26 },
  'PRC-152': { large: 9, prof: 6, incl: 10 },
};
// Deux coffrets à gauche, quatre portatifs dans leur rack à droite.
const RADIO_PLACES = [
  { x: 206, z: -262 }, { x: 240, z: -262 },
  { x: 292, z: -258 }, { x: 316, z: -258 },
  { x: 340, z: -258 }, { x: 364, z: -258 },
];
const DOCK = { x: 328, z: -258, w: 94, h: 3.5, d: 12 };
const CAHIER_W = 44;                // main courante : 44 cm de large sur la table
const CAHIER_PX = 1080;

// Champ visuel : 2·atan(0,6) ≈ 62°. La focale suit la largeur de la fenêtre
// pour que l'angle reste le même quelle que soit la vitre.
const TAN_FOV = 0.6;

// Emplacements. Les deux tables sont dressées le long du fond, la carte au
// centre et les transmissions sur la droite : le chef entre face à sa carte et
// n'a qu'à se porter sur sa droite pour prendre le trafic.
const MON = { x: 0, y: -150, z: -262 };
const RACK = { x: 300, y: -120, z: -272 };
// Ce qui se lit de près : la carte punaisée et le tableau de dotation. On ne
// s'y « installe » pas — on s'en approche et on les prend en main.
// Les panneaux se punaisent devant les poteaux de paroi, pas derrière : une
// planche accrochée dans une tente charpentée porte sur les montants. À 437,
// le poteau (428 à 438) leur passait au travers et barrait la carte.
const MUR = { x: -428, y: -132, z: -160 };
const TABL = { x: 428, y: -126, z: 40 };
const T_CARTE = { x: 0, z: -250, w: 236, d: 96 };
const T_RADIO = { x: 300, z: -250, w: 258, d: 96 };

// Obstacles au sol, en x et z. On ne traverse pas une table.
const BLOCS = [
  { x0: T_CARTE.x - T_CARTE.w / 2, x1: T_CARTE.x + T_CARTE.w / 2,
    z0: T_CARTE.z - T_CARTE.d / 2, z1: T_CARTE.z + T_CARTE.d / 2 },
  { x0: T_RADIO.x - T_RADIO.w / 2, x1: T_RADIO.x + T_RADIO.w / 2,
    z0: T_RADIO.z - T_RADIO.d / 2, z1: T_RADIO.z + T_RADIO.d / 2 },
];
/**
 * Le mobilier du poste de commandement.
 *
 * Chaque entrée est une caisse posée quelque part : on en tire ses faces et,
 * si elle monte assez haut pour gêner, son empreinte au sol. Un chef ne
 * traverse pas une pile de caisses.
 */
const MOBILIER = [
  // caisses de matériel, empilées le long de la paroi gauche
  { cls: 'caisse', x: -330, y: -26, z: -286, w: 88, h: 52, d: 42, dur: 1 },
  { cls: 'caisse', x: -330, y: -78, z: -286, w: 88, h: 52, d: 42 },
  { cls: 'caisse', x: -336, y: -26, z: -196, w: 88, h: 52, d: 42, dur: 1, ry: 6 },
  { cls: 'caisse', x: -352, y: -26, z: 96, w: 88, h: 52, d: 42, dur: 1, ry: -4 },
  { cls: 'caisse', x: -352, y: -76, z: 96, w: 76, h: 48, d: 38, ry: 5 },
  // caisses côté transmissions
  // elles butent contre les poteaux de paroi, elles ne les traversent pas
  { cls: 'caisse', x: 380, y: -26, z: 118, w: 88, h: 52, d: 42, dur: 1, ry: -8 },
  { cls: 'caisse', x: 376, y: -78, z: 118, w: 76, h: 44, d: 38, ry: 4 },
  { cls: 'caisse', x: 374, y: -26, z: 224, w: 76, h: 52, d: 38, dur: 1 },
  // bidons de carburant
  { cls: 'bidon', x: -394, y: -21, z: -8, w: 18, h: 42, d: 34, dur: 1 },
  { cls: 'bidon', x: -372, y: -21, z: -4, w: 18, h: 42, d: 34 },
  // paquetages
  { cls: 'sac', x: -212, y: -23, z: 214, w: 92, h: 46, d: 48, dur: 1, ry: 12 },
  { cls: 'sac', x: 246, y: -21, z: 236, w: 84, h: 42, d: 44, dur: 1, ry: -9 },
  // coffret d'alimentation et son groupe
  { cls: 'plot', x: 150, y: -18, z: -336, w: 44, h: 36, d: 30 },
  { cls: 'plot', x: -60, y: -14, z: -336, w: 36, h: 28, d: 26 },
  // Caisses de transport rigides, empilées comme on les pose en arrivant.
  { cls: 'pelicase', x: -148, y: -21, z: 66, w: 104, h: 42, d: 64, dur: 1, ry: 5 },
  { cls: 'pelicase', x: -148, y: -63, z: 66, w: 104, h: 42, d: 64, ry: -3 },
  { cls: 'pelicase', x: -152, y: -105, z: 68, w: 88, h: 38, d: 56, ry: 7 },
  { cls: 'pelicase', x: 128, y: -21, z: 208, w: 104, h: 42, d: 64, dur: 1, ry: -6 },
  { cls: 'pelicase', x: 126, y: -63, z: 206, w: 88, h: 38, d: 56, ry: 3 },
  // Caisses à munitions métalliques, alignées près du coffret.
  { cls: 'munitions', x: 44, y: -17, z: -322, w: 52, h: 34, d: 30 },
  { cls: 'munitions', x: 100, y: -17, z: -320, w: 52, h: 34, d: 30, ry: 4 },
  { cls: 'munitions', x: -248, y: -17, z: 152, w: 52, h: 34, d: 30, dur: 1, ry: -7 },
  { cls: 'munitions', x: -248, y: -51, z: 152, w: 52, h: 34, d: 30, ry: 5 },
  // Touret de câble, couché.
  { cls: 'touret', x: -304, y: -30, z: 262, w: 76, h: 60, d: 60, dur: 1, ry: 12 },
  // Étuis à cartes, debout dans l'angle.
  { cls: 'etui', x: -398, y: -44, z: 300, w: 13, h: 88, d: 13, ry: 8 },
  { cls: 'etui', x: -382, y: -40, z: 306, w: 13, h: 80, d: 13, ry: -6 },
  { cls: 'etui', x: -390, y: -46, z: 288, w: 13, h: 92, d: 13, ry: 14 },
  // Téléphone de campagne, sur la table de situation.
  { cls: 'tel', x: -74, y: -87, z: -228, w: 40, h: 22, d: 30, ry: -8 },
  // sur la table de situation : casque, gobelet
  { cls: 'casque', x: 98, y: -86, z: -226, w: 26, h: 20, d: 30 },
  { cls: 'tasse', x: -122, y: -84, z: -216, w: 15, h: 16, d: 15 },
  // sur la table des transmissions : thermos, gobelets, boîte de piles
  { cls: 'thermos', x: 196, y: -90, z: -222, w: 16, h: 28, d: 16 },
  { cls: 'tasse', x: 220, y: -84, z: -216, w: 15, h: 16, d: 15 },
  { cls: 'piles', x: 402, y: -85, z: -230, w: 42, h: 18, d: 30, ry: -7 },
];

// Sacs de sable : un merlon bas contre la paroi de gauche.
// Les sacs s'empilent contre la face intérieure des poteaux (à -428), pas
// contre la toile : à -424 ils passaient au travers de trois d'entre eux.
const MERLON = [];
for (let i = 0; i < 6; i++) {
  MERLON.push({ x: -404, y: -12, z: -250 + i * 48, ry: (i % 2 ? 4 : -3) });
}
for (let i = 0; i < 5; i++) {
  MERLON.push({ x: -404, y: -35, z: -226 + i * 48, ry: (i % 2 ? -4 : 3) });
}

// La carte punaisée à la toile. Le Plan IGN v2 passe par la Géoplateforme sans
// clé ; le SCAN 25, lui, en demande une, et la couverture s'arrête aux
// frontières — hors de France on retombe donc sur le fond OSM du jeu, plutôt
// que d'accrocher une feuille blanche au mur.
const IGN = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ZONE_IGN = { s: 41.2, n: 51.6, o: -5.4, e: 9.8 };   // métropole et Corse

// Mises en page volontairement surdimensionnées : ces feuilles sont réduites
// pour tenir dans la pièce, mais le moteur les rastérise à la taille où elles
// sont écrites. À l'échelle un, elles se brouillaient dès qu'on s'en
// approchait — la perspective les agrandissait au-delà de leur définition.
const FEUILLE = { w: 1680, h: 1176 }; // carte murale, en pixels de mise en page
const TABLEAU = { w: 2280, h: 1800 };  // tableau de dotation
const TUILE = 256;

const SECTION = 9;                  // section d'un pied de table, en cm
const RAYON = 34;                   // encombrement du chef
const MARGE = 46;                   // on ne colle pas la toile

const VITESSE = 178;                // cm/s
const SENS = 0.13;                  // degrés par pixel de souris

// Touches de déplacement, clavier français comme anglais.
// Ce qu'on peut prendre en main, et jusqu'à quelle distance on le repère.
const POSTES = [
  ['carte', MON, 330], ['radio', RACK, 330],
  ['mur', MUR, 200], ['tableau', TABL, 200],
];
const LIBELLE = {
  carte: 'E — s’installer à la table de situation',
  radio: 'E — prendre les transmissions',
  mur: 'E — consulter la carte',
  tableau: 'E — consulter le tableau de dotation',
};

const MARCHE = new Set(['z', 'q', 's', 'd', 'w', 'a', 'shift',
                        'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

export class Tent {
  constructor(world, rack, ui) {
    this.world = world;
    this.rack = rack;
    this.ui = ui;

    this.el = $('#tent');
    this.scene = $('#scene');
    this.w3d = $('#world3d');
    this.game = $('#game');

    // Position et orientation du chef. Il entre face à la table de situation.
    this.cam = { x: 0, y: -EYE, z: 190, yaw: 0, pitch: 4 };
    this.vel = { x: 0, z: 0 };
    this.keys = new Set();
    this.bob = 0;
    this.f = 800;

    this.mode = 'walk';        // 'walk' ou 'focus'
    this.poste = null;         // poste occupé : 'carte' ou 'radio'
    this.glide = null;         // déplacement guidé vers un poste
    this.locked = false;

    this.loupe = $('#loupe');
    this.consulte = null;          // ce qu'on tient sous les yeux, hors 3D

    this.build();
    this.buildRack();
    this.poserRack();

    // Le corps du chef. Sans tête : il la verrait de l'intérieur. Il est là
    // pour qu'on se voie en baissant les yeux — et parce qu'un deuxième joueur
    // devra un jour se voir marcher dans la même tente.
    this.avatar = new Avatar({ local: true });
    this.w3d.append(this.avatar.el);
    this.bind();
    this.resize();
  }

  // ------------------------------------------------------------ la pièce

  build() {
    const w3d = this.w3d;
    w3d.textContent = '';
    const R = ROOM, hw = R.w / 2, hd = R.d / 2;

    // Le sol, en lames comme le toit : chaque lame porte son cerne, et
    // l'ensemble donne le caillebotis.
    // Il déborde des parois : le raccord au pied de la toile tombe alors
    // derrière elles, et aucun jour ne s'ouvre au ras du sol.
    const LAMES = 12, sold = R.d + 80, pas = sold / LAMES;
    for (let i = 0; i < LAMES; i++) {
      w3d.append(face('sol', {
        w: R.w + 80, h: pas + 4, z: -sold / 2 + pas * (i + 0.5), rx: 90,
      }));
    }

    // Parois — la toile est fermée de tous les côtés. En lames, là encore : le
    // cerne de chaque pan tient lieu de couture entre les lés.
    const PANS = 8;
    for (const z of [-hd, hd]) {
      for (let i = 0; i < PANS; i++) {
        w3d.append(face('paroi', {
          w: R.w / PANS + 4, h: R.mur, y: -R.mur / 2, z,
          x: -R.w / 2 + (R.w / PANS) * (i + 0.5),
        }));
      }
    }
    for (const x of [-hw, hw]) {
      for (let i = 0; i < PANS; i++) {
        w3d.append(face('paroi', {
          w: R.d / PANS + 4, h: R.mur, y: -R.mur / 2, x, ry: 90,
          z: -R.d / 2 + (R.d / PANS) * (i + 0.5),
        }));
      }
    }

    // pignons : les triangles sous le faîtage, à l'avant et à l'arrière
    const ht = R.faite - R.mur;
    for (const z of [-hd, hd]) {
      w3d.append(face('pignon', { w: R.w, h: ht, y: -(R.mur + ht / 2), z }));
    }

    // Deux pans de toit qui montent vers le faîtage, débités en lames. Le
    // découpage n'est pas qu'une commodité : le cerne d'encre de chaque lame
    // dessine les arceaux de la charpente, et la bande de lumière court de
    // l'une à l'autre au lieu de fondre sur toute la surface.
    const pente = Math.atan2(ht, hw) / RAD;
    const pan = Math.hypot(hw, ht);
    for (const s of [-1, 1]) {
      // Le pas du toit est celui de la tente, pas celui du plancher : le
      // plancher déborde de 80 cm pour qu'on n'en voie pas le bord, et prendre
      // son pas ici faisait sortir le dernier lé par le pignon d'en face.
      const pasT = R.d / LAMES;
      for (let i = 0; i < LAMES; i++) {
        // les deux pans s'éclairent en miroir : le faîtage est du côté intérieur
        w3d.append(face('toit ' + (s < 0 ? 'g' : 'd'), {
          w: pan, h: pasT + 3, x: s * hw / 2, y: -(R.mur + R.faite) / 2,
          z: -hd + pasT * (i + 0.5), rx: 90, rz: s * pente,
        }));
      }
    }

    // mâts : deux plans croisés suffisent à donner le volume
    // Aux quatre coins : au milieu, ils barreraient la vue des postes. Chaque
    // mât s'arrête au rampant qui le surplombe — une hauteur unique le faisait
    // sortir du toit de quatre-vingts centimètres — et un gousset le relie à
    // ce rampant, appuyé aux deux bouts.
    for (const x of [-428, 428]) {
      const sx = Math.sign(x);
      const yp = -(R.faite - Math.abs(x) / hw * ht);      // sommet du mât
      const xr = x - sx * 60;                             // point d'appui sur le pan
      const yr = -(R.faite - Math.abs(xr) / hw * ht);
      for (const z of [-342, 316]) {
        w3d.append(...boite('bois mat', { w: 13, h: -yp, d: 13, x, y: yp / 2, z }));
        w3d.append(face('gousset', {
          w: Math.hypot(60, yp - yr), h: 3.5,
          x: (x + xr) / 2, y: (yp + yr) / 2, z,
          rz: sx * Math.atan2(yp - yr, 60) / RAD,
        }));
      }
    }

    // Baladeuses, et leur flaque de lumière au sol. Chacune pend du toit à
    // l'aplomb où elle se trouve — sous le faîtage au centre, plus bas sur le
    // rampant — et reste assez haute pour ne masquer aucun écran.
    this.lampes = [];
    for (const p of [{ x: 0, z: -120 }, { x: 300, z: -140 }]) {
      const plafond = -(R.faite - Math.abs(p.x) / hw * ht);
      const yb = plafond + 52;                  // hauteur de l'ampoule
      const l = {
        x: p.x, z: p.z, yb,
        cone: face('cone', { w: 240, h: 150, x: p.x, y: yb + 80, z: p.z }),
        refl: face('reflecteur', { w: 46, h: 30, x: p.x, y: yb - 12, z: p.z }),
        bulb: face('ampoule', { w: 22, h: 22, x: p.x, y: yb + 4, z: p.z }),
      };
      w3d.append(
        face('fil', { w: 2, h: 52, x: p.x, y: plafond + 26, z: p.z }),
        l.cone, l.refl, l.bulb,
        face('halo', { w: 470, h: 470, x: p.x, y: -1.2, z: p.z, rx: 90 }),
      );
      this.lampes.push(l);
    }

    poserMatieres();
    this.charpente();
    this.table(T_CARTE);
    this.table(T_RADIO);
    this.moniteur();
    this.rackFace();
    this.mobilier();
    this.materiel();
  }

  /**
   * Ce qui traîne dans un PC : caisses, bidons, paquetages, sacs de sable,
   * sièges, câbles au sol, cartes punaisées à la toile. C'est ce désordre
   * ordonné qui fait qu'on croit à la pièce.
   */
  mobilier() {
    const w3d = this.w3d;

    // Une tache d'ombre au sol sous chaque objet : sans elle, tout flotte.
    const ombre = (x, z, w, d) => face('ombre', {
      w: w * 1.5, h: d * 1.5, x, z, y: -0.6, rx: 90,
    });

    for (const m of MOBILIER) {
      w3d.append(...boite(m.cls, m));
      // seul ce qui touche le sol projette : le reste est empilé dessus
      if (m.y + m.h / 2 > -2) w3d.append(ombre(m.x, m.z, m.w, m.d));
      // Ce qui arrive au-dessus du genou arrête le chef. L'empreinte suit les
      // vraies dimensions, orientation comprise : prendre le plus grand côté
      // dans les deux sens rendait une caisse carrée et fermait des passages.
      if (m.dur) {
        const a = (m.ry || 0) * RAD, c = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
        const hx = (m.w * c + m.d * si) / 2;
        const hz = (m.w * si + m.d * c) / 2;
        BLOCS.push({ x0: m.x - hx, x1: m.x + hx, z0: m.z - hz, z1: m.z + hz });
      }
    }

    for (const b of MERLON) {
      w3d.append(...boite('sable', { x: b.x, y: b.y, z: b.z, w: 46, h: 24, d: 30, ry: b.ry }));
      if (b.y > -20) w3d.append(ombre(b.x, b.z, 46, 30));
    }
    BLOCS.push({ x0: -430, x1: -378, z0: -276, z1: 66 });

    // Deux sièges de campagne, écartés des tables comme on les laisse. Assise
    // à 45 cm, dossier posé dessus, pieds sous l'assise : tout se touche.
    for (const c of [{ x: -74, z: -138 }, { x: 226, z: -136 }]) {
      w3d.append(...boite('metal', { x: c.x, y: -42, z: c.z, w: 44, h: 6, d: 40 }));
      // dossier côté salle : le siège regarde donc la table, derrière lui
      w3d.append(...boite('metal', { x: c.x, y: -62, z: c.z + 17, w: 44, h: 34, d: 5 }));
      for (const dx of [-17, 17]) {
        for (const dz of [-16, 16]) {
          w3d.append(...boite('metal', {
            w: 4, h: 39, d: 4, x: c.x + dx, y: -19.5, z: c.z + dz,
          }));
        }
      }
      w3d.append(ombre(c.x, c.z, 52, 48));
    }

    // Câbles : du coffret vers chaque table, plaqués au sol.
    // Une fois couché par `rx`, c'est le lacet qui oriente le câble sur le sol :
    // un roulis le ferait sortir du plancher au lieu d'y pivoter.
    const cable = (x1, z1, x2, z2, y = -1.6) => {
      const dx = x2 - x1, dz = z2 - z1;
      w3d.append(face('cable', {
        w: Math.hypot(dx, dz), h: 3.5, x: (x1 + x2) / 2, y, z: (z1 + z2) / 2,
        rx: 90, ry: -Math.atan2(dz, dx) / RAD,
      }));
    };
    cable(150, -336, 40, -300);
    cable(40, -300, 10, -252);
    cable(150, -336, 268, -306);
    cable(268, -306, 296, -254);

    // Descente d'antenne : elle court sur le plateau radio jusqu'à la toile,
    // puis monte droit au haut de la paroi. Chaque tronçon touche le suivant ;
    // les deux d'avant ne se rejoignaient ni l'un l'autre ni la table.
    cable(392, -286, 416, -346, -(TABLE.h + 1.4));
    const hAnt = ROOM.mur - TABLE.h;
    w3d.append(...poteau('cable', {
      w: 4, h: hAnt, x: 416, y: -(TABLE.h + hAnt / 2), z: -352,
    }));

    // Cartes et tableau punaisés à la toile — les seules images du dehors.
    this.carteMurale(this.panneau('carte-murale', MUR.x, MUR.y, MUR.z, 140, 98), 140);
    this.tableauEl = this.panneau('tableau', TABL.x, TABL.y, TABL.z, 116, 92);
    this.tableauFeuille = this.feuilleTableau();
    this.tableauEl.append(this.tableauFeuille);
    this.panneau('affiche', -428, -142, 84, 62, 80);

    // Rien ne pend plus librement sous le toit : les haubans d'autrefois
    // flottaient en l'air d'un bout et sortaient du rampant de l'autre. Ce qui
    // relie le mât au toit est désormais le gousset, posé avec eux.
  }

  /**
   * Le matériel de l'échelon : râtelier d'armes, portemanteau, poêle, nourrice,
   * chevalet, fût, extincteur.
   *
   * Ce sont les objets qui disent à quoi sert la tente. Chacun est bâti de
   * volumes qui se touchent et pose son empreinte au sol : on en fait le tour
   * sans passer au travers, et rien ne flotte.
   */
  materiel() {
    const w3d = this.w3d;
    const ombre = (x, z, w, d) => face('ombre', { w: w * 1.5, h: d * 1.5, x, z, y: -0.6, rx: 90 });
    const dur = (x, z, w, d) => BLOCS.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });

    // ---- Râtelier d'armes, contre le pignon du fond ----------------------
    const R0 = { x: -244, z: -330 };
    w3d.append(
      // socle à encoches, barre d'appui, et les deux montants qui les joignent
      ...boite('bois', { x: R0.x, y: -7, z: R0.z, w: 128, h: 14, d: 34 }),
      ...boite('bois sombre', { x: R0.x, y: -102, z: R0.z - 9, w: 128, h: 10, d: 8 }),
      ...boite('bois', { x: R0.x - 60, y: -56, z: R0.z - 9, w: 8, h: 88, d: 8 }),
      ...boite('bois', { x: R0.x + 60, y: -56, z: R0.z - 9, w: 8, h: 88, d: 8 }),
      ombre(R0.x, R0.z, 128, 34),
    );
    dur(R0.x, R0.z, 128, 34);
    // Trois armes en appui : la crosse au sol dans l'encoche, le canon sur la
    // barre. L'inclinaison vient de ces deux points, elle n'est pas choisie.
    for (let i = 0; i < 3; i++) {
      const x = R0.x - 40 + i * 40, incl = [-4, 3, -2][i];
      w3d.append(
        face('arme crosse', { w: 11, h: 34, x, y: -29, z: R0.z - 4, rz: incl }),
        face('arme boitier', { w: 9, h: 30, x, y: -60, z: R0.z - 6, rz: incl }),
        face('arme chargeur', { w: 7, h: 20, x: x - 7, y: -56, z: R0.z - 3, rz: incl + 10 }),
        face('arme canon', { w: 4, h: 36, x, y: -92, z: R0.z - 8, rz: incl }),
        face('arme lunette', { w: 16, h: 6, x, y: -76, z: R0.z - 9, rz: incl }),
      );
    }

    // ---- Portemanteau de campagne, paroi gauche --------------------------
    const P0 = { x: -408, z: 172 };
    w3d.append(
      ...boite('metal', { x: P0.x, y: -2.5, z: P0.z, w: 46, h: 5, d: 46 }),
      ...boite('metal', { x: P0.x, y: -84, z: P0.z, w: 7, h: 158, d: 7 }),
      ...boite('metal', { x: P0.x, y: -164, z: P0.z, w: 10, h: 8, d: 104 }),
      ombre(P0.x, P0.z, 46, 46),
    );
    dur(P0.x, P0.z, 46, 104);
    // Deux gilets pendus à la traverse. Un porte-plaques n'est pas un bloc : il
    // tient par deux bretelles posées sur la barre, sa plaque avant déborde du
    // buste et une ceinture le serre au bas. Sans ces trois pièces, de près, on
    // ne lisait qu'une armoire.
    for (const dz of [-38, 26]) {
      const z = P0.z + dz;
      for (const e of [-11, 11]) {
        w3d.append(...boite('gilet bretelle', {
          x: P0.x + 6, y: -158, z: z + e, w: 13, h: 20, d: 7,
        }));
      }
      w3d.append(
        ...boite('gilet', { x: P0.x + 6, y: -126, z, w: 17, h: 46, d: 32 }),
        ...boite('gilet plastron', { x: P0.x + 15, y: -122, z, w: 3, h: 26, d: 24 }),
        ...boite('gilet ceinture', { x: P0.x + 6, y: -106, z, w: 19, h: 8, d: 34 }),
      );
    }
    // Les casques, calotte en haut, coiffés sur le bout de la barre.
    for (const dz of [-8, 56]) {
      w3d.append(
        ...boite('casque-lourd', { x: P0.x + 5, y: -156, z: P0.z + dz, w: 22, h: 15, d: 26 }),
        ...boite('casque-lourd jugulaire', { x: P0.x + 5, y: -146, z: P0.z + dz, w: 17, h: 7, d: 21 }),
      );
    }

    // ---- Poêle à bois et son conduit, paroi droite ----------------------
    const F0 = { x: 404, z: -46 };
    const hToit = -(ROOM.mur + (ROOM.faite - ROOM.mur) * (1 - F0.x / (ROOM.w / 2)));
    w3d.append(
      ...boite('poele socle', { x: F0.x, y: -6, z: F0.z, w: 56, h: 12, d: 50 }),
      ...boite('poele', { x: F0.x, y: -42, z: F0.z, w: 50, h: 60, d: 44 }),
      ...boite('poele plaque', { x: F0.x, y: -75, z: F0.z, w: 56, h: 6, d: 50 }),
      face('poele porte', { w: 26, h: 24, x: F0.x, y: -40, z: F0.z + 22.5 }),
      ombre(F0.x, F0.z, 56, 50),
    );
    dur(F0.x, F0.z, 56, 50);
    // Le conduit part du dessus du poêle et monte jusqu'au rampant : il ne
    // s'arrête pas en l'air, et il ne le dépasse pas.
    const hc = Math.abs(hToit) - 78;
    w3d.append(
      ...boite('conduit', { x: F0.x, y: -(78 + hc / 2), z: F0.z, w: 17, h: hc, d: 17 }),
      ...boite('conduit collier', { x: F0.x, y: hToit + 12, z: F0.z, w: 25, h: 7, d: 25 }),
    );
    // La bûche et le seau à charbon, à côté.
    w3d.append(
      ...boite('bois sombre', { x: F0.x - 2, y: -14, z: F0.z + 62, w: 44, h: 28, d: 34, ry: 9 }),
      ...boite('metal', { x: F0.x + 4, y: -15, z: F0.z - 58, w: 30, h: 30, d: 30, ry: -6 }),
      ombre(F0.x, F0.z + 62, 44, 34), ombre(F0.x + 4, F0.z - 58, 30, 30),
    );

    // ---- Nourrice d'eau sur son tréteau, près de l'entrée ---------------
    const E0 = { x: -52, z: 304 };
    w3d.append(
      ...boite('bois', { x: E0.x, y: -47, z: E0.z, w: 54, h: 6, d: 44 }),
      ...boite('nourrice', { x: E0.x, y: -76, z: E0.z, w: 44, h: 52, d: 34 }),
      ...boite('nourrice bouchon', { x: E0.x + 13, y: -105, z: E0.z, w: 13, h: 7, d: 13 }),
      face('nourrice robinet', { w: 7, h: 11, x: E0.x, y: -58, z: E0.z + 18 }),
      ombre(E0.x, E0.z, 54, 44),
    );
    for (const dx of [-23, 23]) {
      for (const dz of [-18, 18]) {
        w3d.append(...boite('bois', { x: E0.x + dx, y: -22, z: E0.z + dz, w: 5, h: 44, d: 5 }));
      }
    }
    dur(E0.x, E0.z, 54, 44);

    // ---- Chevalet et son ardoise ----------------------------------------
    const C0 = { x: -186, z: -52 };
    w3d.append(
      face('ardoise cadre', { w: 100, h: 76, x: C0.x, y: -124, z: C0.z - 9, rx: -9 }),
      face('ardoise', { w: 92, h: 68, x: C0.x, y: -124, z: C0.z - 7, rx: -9 }),
      ...boite('bois', { x: C0.x, y: -90, z: C0.z, w: 104, h: 7, d: 6 }),
      ombre(C0.x, C0.z, 90, 56),
    );
    // Trois pieds : deux devant, un derrière, tous au sol.
    for (const d of [{ dx: -42, dz: 12 }, { dx: 42, dz: 12 }, { dx: 0, dz: -26 }]) {
      w3d.append(...boite('bois', {
        x: C0.x + d.dx, y: -78, z: C0.z + d.dz, w: 6, h: 156, d: 6,
      }));
    }
    dur(C0.x, C0.z, 104, 52);

    // ---- Fût à déchets et extincteur, de part et d'autre du rabat -------
    w3d.append(
      ...boite('fut', { x: 104, y: -34, z: 304, w: 48, h: 68, d: 48 }),
      ...boite('fut cercle', { x: 104, y: -62, z: 304, w: 52, h: 6, d: 52 }),
      ombre(104, 304, 48, 48),
    );
    dur(104, 304, 48, 48);
    w3d.append(
      ...boite('extincteur', { x: 196, y: -34, z: 338, w: 20, h: 60, d: 20 }),
      ...boite('extincteur tete', { x: 196, y: -69, z: 338, w: 12, h: 12, d: 12 }),
      ombre(196, 338, 20, 20),
    );

    // ---- Tabouret pliant et lanterne, pour habiter les coins -------------
    w3d.append(
      ...boite('toile-siege', { x: 318, y: -44, z: 58, w: 36, h: 5, d: 34 }),
      ombre(318, 58, 40, 38),
    );
    for (const dx of [-15, 15]) {
      for (const dz of [-14, 14]) {
        w3d.append(...boite('metal', { x: 318 + dx, y: -23, z: 58 + dz, w: 4, h: 42, d: 4 }));
      }
    }
    w3d.append(
      // le dessus de la pile de Pelicase est à -124 : la lanterne y pose
      ...boite('lanterne', { x: -152, y: -138, z: 68, w: 18, h: 28, d: 18 }),
      ...boite('lanterne poignee', { x: -152, y: -156, z: 68, w: 14, h: 8, d: 3 }),
    );

    // Trousse de secours, accrochée à la lisse du pignon du fond.
    w3d.append(...boite('secours', { x: 232, y: -168, z: -352, w: 36, h: 30, d: 14 }));
  }

  /**
   * Une feuille punaisée à la toile, avec ses quatre punaises.
   *
   * L'orientation se déduit du côté où l'on punaise : une feuille regarde
   * toujours l'intérieur de la tente. Passer le lacet à la main donnait un
   * tableau monté à l'envers sur la paroi de droite — on en lisait le dos.
   */
  panneau(cls, x, y, z, w, h) {
    const dx = x > 0 ? -1.2 : 1.2;
    const ry = x > 0 ? -90 : 90;
    const el = face('papier ' + cls, { w, h, x: x + dx, y, z, ry });
    this.w3d.append(el);
    for (const ex of [-1, 1]) {
      for (const ey of [-1, 1]) {
        this.w3d.append(face('punaise', {
          w: 5, h: 5, x: x + dx * 2, y: y + ey * (h / 2 - 7), z: z + ex * (w / 2 - 7), ry,
        }));
      }
    }
    return el;
  }

  /**
   * Le tableau de dotation, punaisé au-dessus de la table des transmissions.
   *
   * On y lit d'un trait qui est qui : indicatif, rôle, réseau et fréquence. Il
   * se refait tout seul quand l'ordre de bataille change — un élément détruit
   * en disparaît, comme on rature une ligne au marqueur.
   */
  feuilleTableau() {
    const f = noeud('tableau-feuille');
    f.style.width = TABLEAU.w + 'px';
    f.style.height = TABLEAU.h + 'px';
    f.style.transform = 'translate(-50%,-50%) scale(' + (116 / TABLEAU.w) + ')';
    f.innerHTML = '<div class="tab-tete">DOTATION RADIO<span class="sous">PC TACTIQUE</span></div>'
      + '<div class="tab-corps"></div>';
    this.tableauCorps = f.querySelector('.tab-corps');
    return f;
  }

  majTableau() {
    if (!this.tableauCorps || !this.world.units) return;
    const list = this.world.units.filter(u => u.side === 'BLUFOR' && !u.destroyed);
    // on ne refait la feuille que si la composition a bougé
    const sig = list.map(u => u.callsign + '/' + u.net).join('|');
    if (sig === this._sigDotation) return;
    this._sigDotation = sig;

    if (!list.length) {
      this.tableauCorps.innerHTML = '<div class="tab-vide">Section non déployée.</div>';
      return;
    }

    // Un tableau de dotation se lit par réseau, pas par indicatif : ce qu'on
    // cherche devant six postes, c'est qui écoute quoi. La fréquence n'est
    // donc écrite qu'une fois, en tête de son groupe.
    const groupes = [];
    for (const [code, n] of Object.entries(NETS)) {
      const membres = list.filter(u => u.net === code);
      if (membres.length) groupes.push({ code, n, membres });
    }

    // L'interligne se règle sur le volume de la section : un en-tête de groupe
    // pèse un peu moins de deux lignes.
    const h = clamp(1542 / (list.length + groupes.length * 1.7), 34, 92);
    this.tableauCorps.style.setProperty('--ligne', h.toFixed(1) + 'px');

    this.tableauCorps.innerHTML = groupes.map(g =>
      '<div class="tab-groupe" style="--net:' + g.n.color + '">' +
      '  <span class="pastille"></span>' +
      '  <span class="code">' + g.code + '</span>' +
      '  <span class="nom">' + escapeHtml(g.n.label.replace(/^Réseau /, '')) + '</span>' +
      '  <span class="frq">' + g.n.freq.toFixed(3) + ' MHz</span>' +
      '</div>' +
      g.membres.map(u => {
        const eff = u.spec && u.spec.kind === 'squad'
          ? (u.soldiers ? u.soldiers.length : 0) + ' pax'
          : (u.spec && u.spec.crew ? u.spec.crew + ' éq.' : '—');
        return '<div class="tab-l">' +
          '<span class="ind">' + escapeHtml(u.callsign) + '</span>' +
          '<span class="role">' + escapeHtml(TYPE_FR[u.type] || u.type) + '</span>' +
          '<span class="eff">' + eff + '</span>' +
        '</div>';
      }).join('')
    ).join('');
  }

  /**
   * Le Plan IGN de la zone d'opération, collé sur la feuille murale.
   *
   * La mosaïque est calée sur le centre de l'AO et le niveau de zoom choisi
   * pour que la feuille en montre un peu plus que le terrain joué — on doit
   * voir ce qu'il y a autour, c'est tout l'intérêt d'une carte au mur. Le
   * repère de l'objectif est tracé par-dessus, au crayon gras, comme au PC.
   */
  carteMurale(el, largeur) {
    const f = this.world.frame;
    if (!f || !el) return;
    const half = (this.world.terrain && this.world.terrain.half) || 1500;

    // largeur de terre couverte par la feuille : un peu plus que l'AO
    const visible = FEUILLE.w / TUILE;                   // en tuiles
    const tour = 40075016.686 * Math.cos(f.lat0 * RAD);  // circonférence à cette latitude
    // La feuille couvre toujours la même étendue de terrain ; comme elle est
    // écrite deux fois plus large, le zoom monte d'un cran de lui-même et la
    // carte y gagne le détail qui lui manquait de près.
    const z = clamp(Math.round(Math.log2(visible * tour / (3.2 * half))), 9, 18);

    const dans = f.lat0 > ZONE_IGN.s && f.lat0 < ZONE_IGN.n
              && f.lon0 > ZONE_IGN.o && f.lon0 < ZONE_IGN.e;
    const gabarit = dans ? IGN : OSM;

    const cx = lonToTileX(f.lon0, z), cy = latToTileY(f.lat0, z);
    const COL = Math.ceil(FEUILLE.w / TUILE) + 1, LIG = Math.ceil(FEUILLE.h / TUILE) + 1;
    const x0 = Math.floor(cx - COL / 2), y0 = Math.floor(cy - LIG / 2);

    const feuille = noeud('feuille');
    const mos = noeud('mosaique');
    // on décale la mosaïque pour que le centre de l'AO tombe au milieu de la feuille
    mos.style.left = (FEUILLE.w / 2 - (cx - x0) * TUILE) + 'px';
    mos.style.top = (FEUILLE.h / 2 - (cy - y0) * TUILE) + 'px';
    mos.style.width = (COL * TUILE) + 'px';
    mos.style.height = (LIG * TUILE) + 'px';

    for (let i = 0; i < COL; i++) {
      for (let j = 0; j < LIG; j++) {
        const img = document.createElement('img');
        img.className = 'tuile';
        img.alt = '';
        img.style.left = (i * TUILE) + 'px';
        img.style.top = (j * TUILE) + 'px';
        img.src = gabarit.replace('{z}', z).replace('{x}', x0 + i).replace('{y}', y0 + j);
        mos.append(img);
      }
    }
    feuille.append(mos);

    // Repère de l'objectif, au crayon gras.
    const o = this.world.objective;
    if (o) {
      const mpp = tour / (2 ** z * TUILE);               // mètres par pixel
      const rond = noeud('objectif-crayon');
      rond.style.left = (FEUILLE.w / 2 + o.x / mpp) + 'px';
      rond.style.top = (FEUILLE.h / 2 - o.y / mpp) + 'px';
      feuille.append(rond);
    }

    const cart = noeud('cartouche');
    // Un cartouche se lit de loin ou ne sert à rien : on n'y met que l'essentiel.
    cart.textContent = (dans ? 'PLAN IGN' : 'CARTE') + ' — ZONE D’OPÉRATION';
    feuille.append(cart);
    this.murEl = feuille;

    feuille.style.width = FEUILLE.w + 'px';
    feuille.style.height = FEUILLE.h + 'px';
    // la largeur est celle qu'on a donnée à la face, pas sa mise en page : la
    // tente peut être encore masquée à la construction, et offsetWidth vaut
    // alors zéro — la feuille serait réduite à rien
    feuille.style.transform = 'translate(-50%,-50%) scale(' + (largeur / FEUILLE.w) + ')';
    el.append(feuille);
  }

  /**
   * Un coffret : une boîte que l'on peut pencher.
   *
   * `boite()` ne sait pas incliner — ses faces composent leurs rotations dans
   * l'ordre RZ·RY·RX, et le flanc d'un poste penché demande l'ordre inverse.
   * On pose donc chaque face à partir du repère du coffret : on se place au
   * centre, on incline, puis on décale jusqu'à la face et on l'oriente.
   */
  coffret(cls, o) {
    const base = mul(mT(o.x, o.y, o.z), mRX((o.rx || 0) * RAD));
    const m = (dx, dy, dz, r) => mul(mul(base, mT(dx, dy, dz)), r);
    const D = Math.PI / 2, I = mT(0, 0, 0);
    const { w, h, d } = o;
    return [
      faceMat(cls + ' av', w, h, m(0, 0, d / 2, I)),
      faceMat(cls + ' ar', w, h, m(0, 0, -d / 2, mRY(Math.PI))),
      faceMat(cls + ' dessus', w, d, m(0, -h / 2, 0, mRX(D))),
      faceMat(cls + ' dessous', w, d, m(0, h / 2, 0, mRX(-D))),
      faceMat(cls + ' fl', d, h, m(w / 2, 0, 0, mRY(D))),
      faceMat(cls + ' fl', d, h, m(-w / 2, 0, 0, mRY(-D))),
    ];
  }

  // Un point du repère d'un coffret, ramené dans celui de la tente.
  dansCoffret(o, dx, dy, dz) {
    const a = (o.rx || 0) * RAD, c = Math.cos(a), si = Math.sin(a);
    return {
      x: o.x + dx,
      y: o.y + c * dy - si * dz,
      z: o.z + si * dy + c * dz,
    };
  }

  /**
   * L'ossature de la tente : faîtage, arceaux, pannes, lisses et bavette.
   *
   * Une toile tendue ne tient pas toute seule, et c'est la charpente qui
   * explique les lignes qu'on lit sur les pans. Toutes les pièces se déduisent
   * du rampant plutôt que d'être posées à la main : une cote de la tente qui
   * change les déplace toutes ensemble, et rien ne reste en l'air.
   */
  charpente() {
    const w3d = this.w3d, R = ROOM;
    const hw = R.w / 2, hd = R.d / 2, ht = R.faite - R.mur;
    const pente = Math.atan2(ht, hw) / RAD;   // inclinaison du rampant
    const pan = Math.hypot(hw, ht);           // longueur d'un chevron
    // hauteur du dessous du toit à l'abscisse x
    const sousToit = x => -(R.mur + ht * (1 - Math.abs(x) / hw));

    // Faîtière : la poutre de crête, d'un pignon à l'autre. On la voit par
    // dessous, donc elle reçoit sa sixième face.
    w3d.append(...boite('charpente faitiere', {
      x: 0, y: -(R.faite - 7), z: 0, w: 13, h: 13, d: R.d + 10, bas: 1,
    }));

    const ARCEAUX = 7, pasA = R.d / (ARCEAUX - 1);
    for (let i = 0; i < ARCEAUX; i++) {
      const z = -hd + pasA * i;
      for (const c of [-1, 1]) {
        // Chevron : le flanc, puis le dessous. On ne peut pas le croiser avec
        // `poteau` ici — son second plan s'oriente par `ry`, qui ne se compose
        // pas avec l'inclinaison et envoyait une planche de 4,5 m en long dans
        // la tente. Le dessous se couche par `rx` avant d'être incliné, comme
        // les lés du toit : il suit alors exactement le rampant.
        // on descend la pièce d'une demi-épaisseur pour que son arête haute
        // affleure le rampant au lieu de le percer au faîtage
        const yc = -(R.mur + R.faite) / 2 + 5 * Math.cos(pente * RAD);
        w3d.append(
          face('charpente chevron', { w: pan, h: 10, x: c * hw / 2, y: yc, z, rz: c * pente }),
          face('charpente chevron bas', {
            w: pan, h: 10, x: c * hw / 2, y: yc + 5, z, rx: 90, rz: c * pente,
          }),
        );
        // Poteau de paroi, sous l'about du chevron.
        w3d.append(...boite('charpente poteau', {
          x: c * (hw - 7), y: -R.mur / 2, z, w: 10, h: R.mur, d: 10,
        }));
        // Jambe de force : elle part du poteau et va buter sous le chevron.
        // Posée à l'angle, son bout libre pendait à quarante centimètres du
        // rampant ; on calcule donc ses deux appuis et on en déduit le reste.
        const ax = c * (hw - 8), ay = -(R.mur - 48);
        const bx = c * (hw - 60), by = sousToit(bx) - 3;
        w3d.append(face('gousset', {
          w: Math.hypot(bx - ax, by - ay), h: 9,
          x: (ax + bx) / 2, y: (ay + by) / 2, z,
          rz: Math.atan2(by - ay, bx - ax) / RAD,
        }));
      }
      // Entrait : la barre qui tient les deux pans écartés.
      w3d.append(...boite('charpente entrait', {
        x: 0, y: -(R.mur + 5), z, w: R.w - 20, h: 8, d: 8, bas: 1,
      }));
    }

    // Pannes : deux par versant, dans le sens de la longueur, posées sous le
    // rampant à la hauteur exacte qu'il a là où elles passent.
    for (const c of [-1, 1]) {
      for (const t of [0.34, 0.68]) {
        const x = c * hw * (1 - t);
        w3d.append(...boite('charpente panne', {
          x, y: sousToit(x) - 5, z: 0, w: 9, h: 9, d: R.d + 6, bas: 1,
        }));
      }
    }

    // Lisses hautes et bavette basse, sur les quatre parois. La lisse se voit
    // par dessous, la bavette jamais.
    for (const c of [-1, 1]) {
      w3d.append(...boite('charpente lisse', {
        x: 0, y: -(R.mur - 6), z: c * (hd - 7), w: R.w, h: 11, d: 8, bas: 1,
      }));
      w3d.append(face('bavette', { w: R.w, h: 28, y: -14, z: c * (hd - 5) }));
      w3d.append(...boite('charpente lisse', {
        x: c * (hw - 7), y: -(R.mur - 6), z: 0, w: 8, h: 11, d: R.d, bas: 1,
      }));
      w3d.append(face('bavette', { w: R.d, h: 28, y: -14, x: c * (hw - 5), ry: -90 * c }));
    }

    // Le rabat d'entrée, fermé et lacé : la tente n'ouvre nulle part.
    const hr = R.mur - 14;
    w3d.append(face('rabat', { w: 156, h: hr, x: 0, y: -(hr / 2 + 7), z: hd - 5 }));
    for (let i = 0; i < 6; i++) {
      w3d.append(face('lacet', { w: 58, h: 5, x: 0, y: -24 - i * 31, z: hd - 7 }));
    }
    w3d.append(
      face('charpente huisserie', { w: 8, h: hr + 14, x: -82, y: -(hr + 14) / 2, z: hd - 6 }),
      face('charpente huisserie', { w: 8, h: hr + 14, x: 82, y: -(hr + 14) / 2, z: hd - 6 }),
      face('charpente huisserie', { w: 172, h: 8, x: 0, y: -(hr + 10), z: hd - 6 }),
    );
  }

  // Une table à tréteaux : plateau et deux piétements.
  table(t) {
    this.w3d.append(...boite('bois', {
      x: t.x, y: -(TABLE.h - TABLE.ep / 2), z: t.z, w: t.w, h: TABLE.ep, d: t.d,
    }));
    this.w3d.append(face('ombre', {
      w: t.w * 1.25, h: t.d * 1.9, x: t.x, z: t.z, y: -0.5, rx: 90,
    }));

    // Quatre pieds pleins et une entretoise basse. Deux plans croisés faisaient
    // un pied en croix qu'on voyait de biais : c'est ce qui donnait l'impression
    // d'un meuble monté de travers.
    const hp = TABLE.h - TABLE.ep;
    const ecart = t.w / 2 - 16;                 // demi-écartement des pieds
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        this.w3d.append(...boite('bois sombre', {
          w: SECTION, h: hp, d: SECTION,
          x: t.x + dx * ecart, y: -hp / 2, z: t.z + dz * (t.d / 2 - 16),
        }));
      }
    }
    // L'entretoise relie deux pieds : elle s'arrête donc à leur face interne et
    // a de l'épaisseur. Un plan sans épaisseur, posé dans le plan même des
    // pieds et poussé jusqu'à leur axe, les traversait de part en part.
    for (const dz of [-1, 1]) {
      this.w3d.append(...boite('bois sombre', {
        w: 2 * ecart - SECTION, h: 7, d: SECTION - 2,
        x: t.x, y: -20, z: t.z + dz * (t.d / 2 - 16),
      }));
    }
  }

  // Le moniteur de situation, posé sur la table et tourné vers l'entrée. Les
  // éléments ne sont créés qu'une fois ; poserMoniteur() les redimensionne,
  // pour ne jamais avoir à redéplacer l'interface de jeu qu'ils portent.
  /**
   * Le poste de situation.
   *
   * La dalle est le seul élément qu'on ne refait jamais : elle porte
   * l'interface du jeu, et la détacher de son parent la rendrait au mieux
   * floue, au pire muette. Tout le reste — cadre, coque, bombé arrière,
   * charnière, colonne, socle — dépend de la hauteur de l'écran, laquelle
   * suit les proportions de la fenêtre : on le rebâtit donc à chaque
   * redimensionnement, dans un bloc qu'on vide et qu'on remplit.
   */
  moniteur() {
    this.monBloc = noeud('bloc-moniteur');
    this.mon = { dalle: noeud('face dalle') };
    this.mon.dalle.append(this.game);
    this.w3d.append(this.monBloc, this.mon.dalle);
    this.poserMoniteur();
  }

  poserMoniteur() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const monH = MON_W * vh / vw;

    const BZ = 2.4;        // cadre haut et latéral
    const BZB = 5.6;       // cadre bas : il porte la plaque et la diode
    const D = 5.5;         // épaisseur de la dalle
    const HC = 15;         // hauteur de la colonne du pied
    const EP = 2.2;        // épaisseur du socle

    const W = MON_W + 2 * BZ, H = monH + BZ + BZB;
    const avant = MON.z + MON_EP;          // plan de la dalle et du cadre
    const zc = avant - D / 2;              // centre de la coque
    const dos = avant - D;

    // La hauteur se déduit du pied : socle sur le plateau, colonne dessus, et
    // le bas de la coque posé sur la colonne. MON.y reste le centre de l'image,
    // parce que c'est lui qui commande la pose du chef devant l'écran.
    const basCoque = -(TABLE.h + EP + HC);
    MON.y = basCoque - (BZB - BZ) / 2 - H / 2;
    const yc = MON.y + (BZB - BZ) / 2;     // centre de la coque

    const f = [];

    // ---- la coque : quatre chants et un dos ----------------------------
    f.push(
      face('carcasse dessus', { w: W, h: D, x: MON.x, y: yc - H / 2, z: zc, rx: 90 }),
      face('carcasse dessous', { w: W, h: D, x: MON.x, y: yc + H / 2, z: zc, rx: 90 }),
      face('carcasse fl', { w: D, h: H, x: MON.x + W / 2, y: yc, z: zc, ry: 90 }),
      face('carcasse fl', { w: D, h: H, x: MON.x - W / 2, y: yc, z: zc, ry: 90 }),
      face('carcasse ar', { w: W, h: H, x: MON.x, y: yc, z: dos }),
    );

    // ---- le cadre : quatre traverses autour de l'image ------------------
    f.push(
      face('cadre-mon haut', { w: W, h: BZ, x: MON.x, y: MON.y - monH / 2 - BZ / 2, z: avant }),
      face('cadre-mon bas', { w: W, h: BZB, x: MON.x, y: MON.y + monH / 2 + BZB / 2, z: avant }),
      face('cadre-mon cote', { w: BZ, h: monH, x: MON.x - MON_W / 2 - BZ / 2, y: MON.y, z: avant }),
      face('cadre-mon cote', { w: BZ, h: monH, x: MON.x + MON_W / 2 + BZ / 2, y: MON.y, z: avant }),
    );

    // ---- le bombé arrière, où loge l'électronique --------------------
    const bw = W * 0.52, bh = H * 0.44, bd = 5;
    f.push(...boite('carcasse bombe', {
      x: MON.x, y: yc + H * 0.04, z: dos - bd / 2, w: bw, h: bh, d: bd,
    }));
    // ouïes de refroidissement sur son dos
    for (let k = 0; k < 7; k++) {
      f.push(face('ouie', {
        w: bw * 0.56, h: 1.1, x: MON.x, y: yc + H * 0.04 - bh / 2 + 7 + k * 4.4, z: dos - bd - 0.1,
      }));
    }
    // les connectiques, sous le bombé
    f.push(face('connectique', {
      w: bw * 0.44, h: 3.4, x: MON.x, y: yc + H * 0.04 + bh / 2 - 3, z: dos - bd - 0.1,
    }));

    // ---- charnière, colonne, socle --------------------------------------
    f.push(...boite('carcasse charniere', {
      x: MON.x, y: basCoque + 1, z: dos - 3, w: 17, h: 9, d: 11,
    }));
    f.push(...boite('colonne-mon', {
      x: MON.x, y: -(TABLE.h + EP + HC / 2), z: dos - 3, w: 11.5, h: HC, d: 7.5,
    }));
    f.push(...boite('socle-mon', {
      x: MON.x, y: -(TABLE.h + EP / 2), z: dos - 1, w: 40, h: EP, d: 22,
    }));
    f.push(face('ombre', { w: 56, h: 32, x: MON.x, y: -(TABLE.h + 0.4), z: dos - 1, rx: 90 }));

    // ---- plaque, diode de veille, et le câble qui descend ---------------
    const plaque = face('plaque-mon', { w: MON_W * 0.42, h: BZB * 0.62, x: MON.x, y: MON.y + monH / 2 + BZB / 2, z: avant + 0.05 });
    plaque.textContent = 'POSTE DE SITUATION';
    f.push(plaque);
    f.push(face('diode-mon', {
      w: 1.6, h: 1.6, x: MON.x + MON_W / 2 - 2.6, y: MON.y + monH / 2 + BZB / 2, z: avant + 0.05,
    }));
    f.push(face('vitre', { w: MON_W, h: monH, x: MON.x, y: MON.y, z: avant - 0.1 }));
    // le reflet se garde sous la main : il s'efface quand on s'installe devant
    this.mon.reflet = face('reflet', { w: MON_W, h: monH, x: MON.x, y: MON.y, z: avant + 0.1 });
    f.push(this.mon.reflet);

    // le câble sort du dos, descend derrière la colonne et file sur le plateau
    f.push(...poteau('cable', { w: 2.6, h: HC + 6, x: MON.x + 6, y: -(TABLE.h + HC / 2 + 1), z: dos - 6 }));
    f.push(face('cable', {
      w: 34, h: 2.6, x: MON.x + 22, y: -(TABLE.h + 1.2), z: dos - 6, rx: 90,
    }));

    this.monBloc.replaceChildren(...f);
    poser(this.mon.dalle, { w: MON_W, h: monH, x: MON.x, y: MON.y, z: avant });
  }

  /**
   * Les postes, posés sur la table des transmissions, et la main courante à
   * côté.
   *
   * Chaque poste est un vrai volume : un coffret incliné sur son berceau,
   * dont la face avant est la seule partie qui reste un bloc de document. Tout
   * ce qui n'est pas imprimé ou allumé sur cette face — les flancs, le capot,
   * la batterie, les poignées, les antennes — est de la géométrie.
   *
   * `#rack` n'est plus ce qu'on voit : c'est l'atelier où les six faces sont
   * mises en page, hors de la scène, puis le rang où on les regroupe quand le
   * chef les prend en main à la loupe.
   */
  rackFace() {
    const atelier = noeud('rack-atelier');
    const rack = noeud('');
    rack.id = 'rack';
    atelier.append(rack);
    this.el.append(atelier);

    this.cahierEl = noeud('face cahierpos');
    this.cahierEl.innerHTML =
      '<div class="cahier">' +
      '  <div class="cahier-tete">Main courante <span id="perdu" hidden></span></div>' +
      '  <div id="main-courante"></div>' +
      '</div>';
    const cah = this.cahierEl.firstElementChild;
    cah.style.transform = 'translate(-50%,-50%) scale(' + (CAHIER_W / CAHIER_PX) + ')';
    this.w3d.append(this.cahierEl);
  }

  // Appelé une fois les postes construits : leur mise en page est alors connue.
  poserRack() {
    this.postes3d();

    const cah = this.cahierEl.firstElementChild;
    const hC = (cah.offsetHeight || 150) * (CAHIER_W / CAHIER_PX);
    poser(this.cahierEl, {
      w: CAHIER_W, h: hC,
      x: T_RADIO.x, y: -(TABLE.h + 1.2), z: T_RADIO.z + 32, rx: 90, rz: -4,
    });
  }

  /**
   * Bâtit les six volumes et y installe les faces avant.
   *
   * Les cotes de la face viennent de sa mise en page : on mesure le bloc dans
   * l'atelier, on lui donne sa largeur en centimètres, et sa hauteur suit. Le
   * coffret se déduit ensuite de la face, et non l'inverse — ainsi le dessin
   * du panneau et le volume qui le porte ne peuvent pas diverger.
   */
  postes3d() {
    this.coques = new Map();
    const plateau = -TABLE.h;
    let xmin = Infinity, xmax = -Infinity, yPan = 0, zPan = 0;

    // Le socle du rack des portatifs, posé à plat sur le plateau.
    this.w3d.append(...boite('dock', {
      x: DOCK.x, y: plateau - DOCK.h / 2, z: DOCK.z, w: DOCK.w, h: DOCK.h, d: DOCK.d,
    }));

    this.rack.sets.forEach((set, i) => {
      const g = RADIO3D[set.type], pl = RADIO_PLACES[i];
      const card = this.cards.get(set.id).card;
      const px = card.offsetWidth || 1, py = card.offsetHeight || 1;

      const pw = g.large;                 // largeur de la face, en centimètres
      const ph = pw * py / px;            // sa hauteur suit sa mise en page
      const prof = g.prof, incl = g.incl;
      const a = incl * RAD, c = Math.cos(a), si = Math.sin(a);

      // Le poste repose par son arête arrière ; on descend donc son centre de
      // la demi-diagonale verticale du coffret, plus l'épaisseur du socle.
      const assise = plateau - (set.type === 'PRC-152' ? DOCK.h : 0);
      const o = {
        x: pl.x, z: pl.z, w: pw, h: ph, d: prof, rx: incl,
        y: assise - (c * ph / 2 + si * prof / 2),
      };

      const bloc = noeud('bloc-radio');
      bloc.dataset.set = set.id;
      this.w3d.append(bloc);
      this.coques.set(set.id, bloc);

      // La coque, moins la face avant : c'est le panneau qui la ferme.
      const coque = this.coffret('coque', o);
      coque.shift();                      // on jette l'avant du coffret
      bloc.append(...coque);

      // La face avant : un bloc de document, mis à l'échelle de la pièce.
      const av = this.dansCoffret(o, 0, 0, prof / 2 + 0.25);
      const hote = noeud('face radiopos');
      const holder = noeud('radio-holder');
      holder.style.width = px + 'px';
      holder.style.transform = 'translate(-50%,-50%) scale(' + (pw / px) + ')';
      hote.append(holder);
      poser(hote, { w: pw, h: ph, x: av.x, y: av.y, z: av.z, rx: incl });
      this.w3d.append(hote);
      this.cards.get(set.id).hote = holder;

      if (set.type === 'PRC-117') this.manpack3d(bloc, o, pw, ph, prof);
      else this.portatif3d(bloc, o, pw, ph, prof);

      xmin = Math.min(xmin, pl.x - pw / 2);
      xmax = Math.max(xmax, pl.x + pw / 2);
      yPan += av.y; zPan = Math.max(zPan, av.z);
    });

    // Le poste de transmission vise le milieu des six faces avant.
    RACK.x = (xmin + xmax) / 2;
    RACK.y = yPan / this.rack.sets.length;
    RACK.z = zPan;

    this.disperserRack();
  }

  /** Le coffret : berceau, béquille, poignées latérales et fouet d'antenne. */
  manpack3d(bloc, o, pw, ph, prof) {
    const plateau = -TABLE.h;
    const dans = (dx, dy, dz) => this.dansCoffret(o, dx, dy, dz);

    // Berceau : une platine sous le coffret, à la même inclinaison.
    const ber = dans(0, ph / 2 + 1.6, 0);
    bloc.append(...this.coffret('berceau', {
      x: ber.x, y: ber.y, z: ber.z, w: pw + 4, h: 3.2, d: prof - 2, rx: o.rx,
    }));
    // Béquille : du bord avant du berceau jusqu'au plateau. C'est elle qui
    // tient le poste relevé ; sans elle il pencherait en l'air.
    const pied = this.dansCoffret(
      { x: ber.x, y: ber.y, z: ber.z, rx: o.rx }, 0, 1.6, prof / 2 - 3);
    const hp = plateau - pied.y;
    bloc.append(...boite('berceau', {
      x: pied.x, y: pied.y + hp / 2, z: pied.z, w: pw - 6, h: hp, d: 2.4,
    }));

    // Poignées de portage : un arceau sur chaque flanc, tenu par deux pattes.
    for (const c of [-1, 1]) {
      const b = dans(c * (pw / 2 + 3.4), 0, 0);
      bloc.append(...this.coffret('poignee', {
        x: b.x, y: b.y, z: b.z, w: 2.4, h: 2.4, d: prof * 0.46, rx: o.rx,
      }));
      for (const e of [-1, 1]) {
        const q = dans(c * (pw / 2 + 1.7), 0, e * prof * 0.2);
        bloc.append(...this.coffret('poignee patte', {
          x: q.x, y: q.y, z: q.z, w: 3.4, h: 2.2, d: 2.2, rx: o.rx,
        }));
      }
    }

    // Embases et fouets : la grande antenne à l'arrière, la petite à côté.
    for (const t of [{ dx: -pw * 0.3, h: 42, pen: -5 }, { dx: pw * 0.26, h: 22, pen: 4 }]) {
      const e = dans(t.dx, -ph / 2 - 1.2, -prof * 0.3);
      bloc.append(...boite('embase', {
        x: e.x, y: e.y - 1.2, z: e.z, w: 4.2, h: 3.4, d: 4.2,
      }));
      bloc.append(...poteau('fouet', {
        w: 0.9, h: t.h, x: e.x + t.pen * 0.3, y: e.y - 3 - t.h / 2, z: e.z, rz: t.pen,
      }));
    }
  }

  /** Le portatif : batterie à l'arrière, capot d'antenne, fouet et bouton. */
  portatif3d(bloc, o, pw, ph, prof) {
    const dans = (dx, dy, dz) => this.dansCoffret(o, dx, dy, dz);

    // La batterie déborde par l'arrière, sur la moitié basse du poste : c'est
    // ce renflement qui donne au 152 sa silhouette, vue de profil.
    const bat = dans(0, ph * 0.22, -prof / 2 - 1.6);
    bloc.append(...this.coffret('batterie3d', {
      x: bat.x, y: bat.y, z: bat.z, w: pw - 1.2, h: ph * 0.54, d: 3.4, rx: o.rx,
    }));

    // Capot supérieur : l'embase d'antenne et la prise casque.
    const cap = dans(0, -ph / 2 - 1.1, -0.6);
    bloc.append(...this.coffret('capot3d', {
      x: cap.x, y: cap.y, z: cap.z, w: pw - 1.6, h: 2.2, d: prof + 1.2, rx: o.rx,
    }));
    const emb = dans(-pw * 0.26, -ph / 2 - 2.6, 0);
    bloc.append(...boite('embase', { x: emb.x, y: emb.y, z: emb.z, w: 3.2, h: 2.6, d: 3.2 }));
    bloc.append(...poteau('fouet', {
      w: 0.8, h: 21, x: emb.x - 1.1, y: emb.y - 12, z: emb.z, rz: -4,
    }));
    const pr = dans(pw * 0.26, -ph / 2 - 2.4, 0);
    bloc.append(...boite('prise3d', { x: pr.x, y: pr.y, z: pr.z, w: 2.6, h: 2.4, d: 2.6 }));

    // Le bouton d'alternat, sur le flanc gauche.
    const ptt = dans(-pw / 2 - 0.7, -ph * 0.08, 0.6);
    bloc.append(...this.coffret('alternat', {
      x: ptt.x, y: ptt.y, z: ptt.z, w: 1.6, h: ph * 0.26, d: 2.6, rx: o.rx,
    }));
  }

  /**
   * Regroupe les six faces dans `#rack`, pour les lire à la loupe.
   *
   * On déplace les blocs eux-mêmes plutôt que d'en tenir une copie : un poste
   * n'existe qu'une fois, avec ses écouteurs d'événements et son état allumé.
   */
  grouperRack() {
    const rack = $('#rack');
    for (const set of this.rack.sets) rack.append(this.cards.get(set.id).card);
  }

  // ... et les renvoie chacune sur son coffret.
  disperserRack() {
    for (const set of this.rack.sets) {
      const c = this.cards.get(set.id);
      if (c.hote) c.hote.append(c.card);
    }
  }

  // ------------------------------------------------------------ les postes

  buildRack() {
    const host = $('#rack');
    this.cards = new Map();
    host.innerHTML = this.rack.sets.map(s => this.carte(s)).join('');

    for (const s of this.rack.sets) {
      const card = host.querySelector('[data-set="' + s.id + '"]');
      const c = {
        card, set: s,
        rx: card.querySelector('.rx'),
        freq: card.querySelector('.freq'),
        last: card.querySelector('.last'),
        sw: card.querySelector('.switch'),
        swTxt: card.querySelector('.switch .txt'),
        knob: card.querySelector('.knob'),
        val: card.querySelector('.vol-val'),
        manque: card.querySelector('.manque'),
      };
      this.cards.set(s.id, c);
      this.bindSet(c);
    }
    this.paintAll();
  }

  /**
   * Le dessin d'un poste.
   *
   * Deux silhouettes, celles des vrais matériels : le PRC-117G est un coffret
   * couché — écran au centre, connecteurs et rotacteur autour, poignées de
   * portage sur les flancs — et le PRC-152 un portatif debout, grille de
   * haut-parleur, écran, clavier, et sa batterie qui déborde en pied.
   */
  carte(s) {
    const sp = SET_TYPES[s.type];
    const tete =
      '<div class="lcd">' +
      '  <div class="l1"><span class="freq">' + freqString(s.freq) + '</span>' +
      '      <span class="rx">RX</span></div>' +
      '  <div class="l2">' + s.label.toUpperCase() + '</div>' +
      '  <div class="l3 last">— silence réseau —</div>' +
      '</div>';

    // Sérigraphié sur le boîtier, donc lisible même écran éteint : sans cela,
    // un poste coupé devient un boîtier anonyme sur la table.
    const serigraphie =
      '<div class="serigraphie">' +
      '  <b>' + s.net + '</b> · ' + s.freq.toFixed(3) + ' MHz' +
      '  <span class="manque"></span>' +
      '</div>';

    const commandes =
      '<div class="commandes">' +
      '  <button class="switch" title="Marche / arrêt du poste" aria-pressed="true">' +
      '    <span class="rocker"></span><span class="txt">ON</span></button>' +
      '  <div class="knob" tabindex="0" role="slider" aria-label="Volume ' + s.label + '"' +
      '       aria-valuemin="0" aria-valuemax="100"' +
      '       title="Volume — molette, glisser vers le haut, ou flèches">' +
      '    <span class="cap"></span><span class="mark"></span></div>' +
      '  <span class="vol-val">70</span>' +
      '</div>';

    // touche du clavier : chiffre, lettres, fonction
    const t = (n, l, f) => '<i class="t"><b>' + n + '</b>' +
      (l ? '<u>' + l + '</u>' : '') + (f ? '<s>' + f + '</s>' : '') + '</i>';

    if (s.type === 'PRC-117') {
      // Le vrai coffret est deux fois plus large que haut : la face tient sur
      // une seule rangée — rotacteur et embases à gauche, écran au milieu,
      // clavier à droite. Empilée sur deux rangées comme auparavant, elle
      // donnait un boîtier carré qui n'a jamais existé.
      return [
        '<div class="poste-radio manpack" data-set="' + s.id + '" style="--net:' + s.color + '">',
        '  <div class="corps">',
        '    <div class="col gauche">',
        '      <div class="rotacteur"><span class="axe"></span>',
        '        <em>OFF</em><em>CT</em><em>PT</em><em>LD</em><em>Z</em></div>',
        '      <div class="prises">',
        '        <span class="prise grosse"><i></i><em>HB ANT</em><u>J8</u></span>',
        '        <span class="prise petite"><i></i><em>GPS</em><u>J2</u></span>',
        '      </div>',
        '    </div>',
        '    <div class="bloc-ecran">',
        '      <div class="marque"><b>HARRIS</b><span>FALCON III</span></div>',
        tete,
        serigraphie,
        '    </div>',
        '    <div class="clavier c117">',
        '      <i class="t large vol">+<b>VOL</b>\u2212</i>',
        t('1', 'ABC', 'CALL') + t('2', 'DEF', 'LT') + t('3', 'GHI', 'MODE'),
        '      <i class="t large pre">+<b>PRE</b>\u2212</i>',
        t('4', 'JKL', 'SQL') + t('5', 'MNO', 'ZERO') + t('6', 'PQR', ''),
        '      <i class="t">CLR</i>',
        t('7', 'STU', 'OPT') + t('8', 'VWX', 'PGM') + t('9', 'YZ?', ''),
        '      <i class="t">ENT</i>',
        '      <i class="t">0</i><i class="t">\u25c0</i><i class="t">\u25b6</i>',
        '    </div>',
        '    <div class="col droite">',
        '      <div class="prises">',
        '        <span class="prise moyenne"><i></i><em>SATCOM</em><u>J7</u></span>',
        '        <span class="prise audio"><i class="multi"></i><em>AUDIO</em><u>J1</u></span>',
        '      </div>',
        '      ' + commandes,
        '    </div>',
        '  </div>',
        '</div>',
      ].join('');
    }

    // Le fouet, le capot et la batterie ne sont plus dessinés ici : ce sont
    // des volumes, posés autour de cette face par `portatif3d()`. Ne reste sur
    // le panneau que ce qui y est imprimé ou allumé.
    return [
      '<div class="poste-radio portatif" data-set="' + s.id + '" style="--net:' + s.color + '">',
      '  <div class="corps">',
      '    <div class="grille">' + '<i></i>'.repeat(18) + '</div>',
      '    <div class="bandeau">WIDEBAND NETWORKING</div>',
      '    ' + serigraphie,
      '    ' + tete,
      '    <div class="clavier c152">',
      t('1', 'ABC', '') + t('2', 'DEF', '') + t('3', 'GHI', '') + '<i class="t">CLR</i>',
      t('4', 'JKL', '') + t('5', 'MNO', '') + t('6', 'PQR', '') + '<i class="t">ENT</i>',
      t('7', 'STU', '') + t('8', 'VWX', '') + t('9', 'YZ?', '') + '<i class="t">+</i>',
      '      <i class="t">0</i><i class="t">◀</i><i class="t">▶</i><i class="t">−</i>',
      '    </div>',
      '    <div class="signature">FALCON III</div>',
      '    ' + commandes,
      '  </div>',
      '</div>',
    ].join('');
  }

  bindSet(c) {
    const set = c.set;

    c.sw.onclick = e => {
      e.stopPropagation();
      this.rack.setPower(set.id, !set.on);
      this.paint(c);
      // un poste qu'on rallume claque et s'ouvre sur son squelch
      const sfx = window.GAME && window.GAME.sfx;
      if (sfx) sfx.beep(set.net, set.on ? 1 : 0.15, set.on ? 0.55 : 0.25);
    };

    const bump = d => { this.rack.setVolume(set.id, set.volume + d); this.paint(c); };

    c.knob.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      bump(e.deltaY < 0 ? 0.05 : -0.05);
    }, { passive: false });

    c.knob.addEventListener('keydown', e => {
      const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05
              : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      bump(d);
    });

    // Glisser vers le haut ouvre le volume, comme sur un vrai bouton rotatif.
    c.knob.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      c.knob.setPointerCapture(e.pointerId);
      let y = e.clientY;
      const move = ev => { bump((y - ev.clientY) / 160); y = ev.clientY; };
      const up = () => {
        c.knob.removeEventListener('pointermove', move);
        c.knob.removeEventListener('pointerup', up);
        c.knob.removeEventListener('pointercancel', up);
      };
      c.knob.addEventListener('pointermove', move);
      c.knob.addEventListener('pointerup', up);
      c.knob.addEventListener('pointercancel', up);
    });
  }

  paintAll() { for (const c of this.cards.values()) this.paint(c); }

  paint(c) {
    const s = c.set;
    c.card.classList.toggle('off', !s.on);
    c.sw.setAttribute('aria-pressed', String(s.on));
    c.swTxt.textContent = s.on ? 'ON' : 'OFF';
    const pct = Math.round(s.volume * 100);
    c.knob.style.setProperty('--deg', (-135 + s.volume * 270) + 'deg');
    c.knob.setAttribute('aria-valuenow', String(pct));
    c.val.textContent = s.on ? pct : '––';
  }

  // ------------------------------------------------------------ commandes

  bind() {
    // Prendre la main : la souris disparaît et pilote le regard.
    this.scene.addEventListener('click', () => {
      if (this.mode !== 'walk' || this.locked) return;
      const p = this.scene.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.scene;
      this.el.classList.toggle('locked', this.locked);
      if (!this.locked) { this.keys.clear(); this.vel.x = this.vel.z = 0; }
    });

    document.addEventListener('mousemove', e => {
      if (!this.locked || this.mode !== 'walk') return;
      this.cam.yaw += e.movementX * SENS;
      this.cam.pitch = clamp(this.cam.pitch - e.movementY * SENS, -72, 72);
    });

    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ||
          (e.target.classList && e.target.classList.contains('knob'))) return;

      // Échap ne nous relève d'un poste que s'il n'a rien de plus urgent : un
      // ordre en cours d'écriture l'annule d'abord, et pendant le choix de
      // l'implantation il vaut acceptation de la position proposée d'office.
      if (e.key === 'Escape' && this.mode === 'focus' && !this.ui.pending && !this.ui.placing) {
        e.stopPropagation();
        this.quitter();
        return;
      }
      if (this.mode !== 'walk') return;

      const k = e.key.toLowerCase();
      if (k === 'e') { const t = this.cible(); if (t) this.occuper(t); return; }
      if (MARCHE.has(k)) { this.keys.add(k); if (k.startsWith('arrow')) e.preventDefault(); }
    }, true);

    window.addEventListener('keyup', e => { this.keys.delete(e.key.toLowerCase()); }, true);
    window.addEventListener('blur', () => this.keys.clear());

    // Sous la main, un clic vaut « s'installer au poste visé ».
    this.scene.addEventListener('mousedown', e => {
      if (!this.locked || this.mode !== 'walk') return;
      const t = this.cible();
      if (t) { e.preventDefault(); this.occuper(t); }
    });

    const back = $('#btn-step-back');
    if (back) back.onclick = () => this.quitter();

    window.addEventListener('resize', () => { this.resize(); this.ajusterLoupe(); });
  }

  /**
   * Recalage sur la fenêtre.
   *
   * L'écran garde le rapport de la vitre et l'interface garde sa taille : de
   * face, à la bonne distance, elle se projette alors au pixel près, sans rien
   * remettre à l'échelle. C'est ce qui la laisse nette et cliquable.
   */
  resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!vw || !vh) return;
    this.f = vw / (2 * TAN_FOV);
    this.scene.style.perspective = this.f + 'px';

    this.game.style.width = vw + 'px';
    this.game.style.height = vh + 'px';
    this.game.style.transform = 'translate(-50%,-50%) scale(' + (MON_W / vw) + ')';
    this.poserMoniteur();

    if (this.mode === 'focus' && !this.glide) Object.assign(this.cam, this.pose(this.poste));
    this.apply();
  }

  /**
   * Prendre un panneau sous les yeux, hors de la scène.
   *
   * Un panneau lu à travers la perspective est rendu par le moteur à l'échelle
   * où il est écrit dans la pièce — quelques centimètres — puis agrandi d'un
   * facteur dix quand on s'en approche. Aucune définition de mise en page n'y
   * change quoi que ce soit : c'est la rastérisation qui est faite trop tôt.
   * La seule issue est de le sortir du volume et de le poser à plat devant
   * l'œil, où il est rendu à sa taille finale.
   */
  consulter(el) {
    if (!el || this.consulte) return;
    this.consulte = { el, parent: el.parentElement, suivant: el.nextSibling };
    this.loupe.append(el);
    this.loupe.hidden = false;
    this.ajusterLoupe();
  }

  rendre() {
    const c = this.consulte;
    if (!c) return;
    c.parent.insertBefore(c.el, c.suivant);
    if (c.el.id === 'rack') this.disperserRack();
    c.el.style.removeProperty('--zoom');
    this.loupe.hidden = true;
    this.consulte = null;
  }

  // Le panneau occupe la vue sans jamais être agrandi : on ne fait que le réduire.
  ajusterLoupe() {
    const c = this.consulte;
    if (!c) return;
    const L = c.el.offsetWidth || 1, H = c.el.offsetHeight || 1;
    const k = Math.min(1, window.innerWidth * 0.94 / L, window.innerHeight * 0.9 / H);
    c.el.style.setProperty('--zoom', k.toFixed(4));
  }

  // ------------------------------------------------------------ les poses

  /**
   * Où se met le chef pour tenir un poste.
   *
   * Pour la carte, la distance n'est pas choisie au jugé : à MON_W·f/largeur
   * de fenêtre, un moniteur large de MON_W se projette exactement sur toute la
   * vue. L'interface, posée dessus à l'échelle MON_W/largeur, y retrouve le
   * pixel pour pixel — donc nette, et juste sous le curseur.
   */
  pose(nom) {
    if (nom === 'mur' || nom === 'tableau') return null;   // on ne se déplace pas
    if (nom === 'radio') {
      // Le retrait est celui qui fait occuper au râtelier les cinq sixièmes
      // de la vue : assez pour lire les écrans, assez peu pour voir la table.
      const d = RACK_W * this.f / (window.innerWidth * 0.92);
      return { x: RACK.x, y: RACK.y, z: RACK.z + d, yaw: 0, pitch: 0 };
    }
    // La distance se prend depuis la dalle, pas depuis le centre de la
    // carcasse : les six centimètres d'écart grossissaient l'image de 6 %.
    return {
      x: MON.x, y: MON.y, z: MON.z + MON_EP + MON_W * this.f / window.innerWidth,
      yaw: 0, pitch: 0,
    };
  }

  // Le poste visé par le réticule, s'il est assez proche et assez en face.
  cible() {
    const c = this.cam;
    const fx = Math.sin(c.yaw * RAD), fz = -Math.cos(c.yaw * RAD);
    let meilleur = null, seuil = 0.86;          // ~30° autour du réticule
    for (const [nom, p, portee] of POSTES) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > portee) continue;
      const cos = (dx * fx + dz * fz) / (d || 1);
      if (cos > seuil) { seuil = cos; meilleur = nom; }
    }
    return meilleur;
  }

  occuper(nom) {
    this.poste = nom;
    this.mode = 'focus';
    const p = this.pose(nom);
    if (p) this.glide = Object.assign({ t: 0, de: { ...this.cam } }, p);
    if (document.pointerLockElement) document.exitPointerLock();
    this.el.classList.add('focus', 'rode');   // le chef a trouvé ses postes
    this.el.dataset.poste = nom;
    document.body.classList.toggle('leaned', nom === 'carte');

    // Les transmissions et les panneaux muraux se lisent hors de la scène.
    if (nom === 'radio') { this.grouperRack(); this.consulter($('#rack')); }
    else if (nom === 'mur') this.consulter(this.murEl);
    else if (nom === 'tableau') this.consulter(this.tableauFeuille);
  }

  quitter() {
    // Tant que le chef n'a pas posé son PC, il reste à la carte.
    if (this.ui.placing || this.mode !== 'focus') return;
    const nom = this.poste;
    this.rendre();
    this.mode = 'walk';
    this.poste = null;
    this.el.classList.remove('focus');
    document.body.classList.remove('leaned');
    // On recule d'un pas du poste qu'on vient de quitter — sur un emplacement
    // dont on s'est assuré qu'il est libre.
    // Un panneau consulté se repose sur place : on ne s'était pas déplacé.
    if (nom === 'carte' || nom === 'radio') {
      const p = nom === 'carte'
        ? this.degager(MON.x, MON.z + 215)
        : this.degager(RACK.x, RACK.z + 215);
      this.glide = Object.assign({ y: -EYE, pitch: 0, yaw: 0, t: 0, de: { ...this.cam } }, p);
    }
  }

  // Se poser d'emblée à la carte, sans mouvement : le choix de l'implantation
  // se fait à l'écran avant même que le chef ait pris ses quartiers.
  snapTo(on) {
    if (on) {
      this.occuper('carte');
      Object.assign(this.cam, this.pose('carte'));
      this.glide = null;
    } else {
      this.quitter();
    }
    this.apply();
  }

  // Conservé pour l'amorçage : le chef se redresse et découvre la tente.
  lean(on) { if (on) this.snapTo(true); else this.quitter(); }

  // ------------------------------------------------------------ boucle

  frame(dt) {
    dt = Math.min(0.05, dt > 0 ? dt : 0.016);

    if (this.glide) this.avancer(dt);
    else if (this.mode === 'walk') this.marcher(dt);

    // Le corps suit le regard : même position au sol, même cap, et il s'assied
    // dès qu'on tient un poste.
    this.avatar.anime(dt, {
      vitesse: Math.hypot(this.vel.x, this.vel.z),
      assis: this.mode === 'focus' && (this.poste === 'carte' || this.poste === 'radio'),
    });
    this.avatar.place(this.cam.x, 0, this.cam.z, this.cam.yaw);

    this.apply();
    if (!this._at || performance.now() - this._at > 220) { this._at = performance.now(); this.tick(); }
  }

  // Déplacement guidé vers un poste, ou retour en arrière.
  avancer(dt) {
    const g = this.glide, de = g.de, c = this.cam;
    g.t = Math.min(1, g.t + dt * 2.2);
    // accélération puis freinage : un pas, pas un glissement linéaire
    const t = g.t < 0.5 ? 4 * g.t ** 3 : 1 - Math.pow(-2 * g.t + 2, 3) / 2;
    // le lacet se rejoint par le plus court chemin, sinon on fait un tour complet
    const dyaw = ((g.yaw - de.yaw + 540) % 360) - 180;

    c.x = de.x + (g.x - de.x) * t;
    c.y = de.y + (g.y - de.y) * t;
    c.z = de.z + (g.z - de.z) * t;
    c.yaw = de.yaw + dyaw * t;
    c.pitch = de.pitch + (g.pitch - de.pitch) * t;

    if (g.t >= 1) {
      this.glide = null;
      c.yaw = ((c.yaw % 360) + 360) % 360;
      this.vel.x = this.vel.z = 0;
    }
  }

  marcher(dt) {
    const c = this.cam, k = this.keys;
    let av = 0, la = 0;
    if (k.has('z') || k.has('w') || k.has('arrowup')) av += 1;
    if (k.has('s') || k.has('arrowdown')) av -= 1;
    if (k.has('d') || k.has('arrowright')) la += 1;
    if (k.has('q') || k.has('a') || k.has('arrowleft')) la -= 1;

    const n = Math.hypot(av, la);
    let vx = 0, vz = 0;
    if (n) {
      const fx = Math.sin(c.yaw * RAD), fz = -Math.cos(c.yaw * RAD);
      const rx = Math.cos(c.yaw * RAD), rz = Math.sin(c.yaw * RAD);
      const sp = VITESSE * (k.has('shift') ? 1.5 : 1);
      vx = (fx * av + rx * la) / n * sp;
      vz = (fz * av + rz * la) / n * sp;
    }
    // inertie : on ne démarre ni ne s'arrête net
    const a = 1 - Math.exp(-dt * 11);
    this.vel.x += (vx - this.vel.x) * a;
    this.vel.z += (vz - this.vel.z) * a;

    const p = this.glisser(c.x, c.z, c.x + this.vel.x * dt, c.z + this.vel.z * dt);
    c.x = p.x; c.z = p.z;

    // balancement de la marche
    const allure = Math.hypot(this.vel.x, this.vel.z) / VITESSE;
    this.bob += dt * 9.5 * allure;
    c.y = -EYE + Math.sin(this.bob) * 1.7 * allure;
  }

  /**
   * Collision. On glisse le long de l'obstacle plutôt que de s'y coller : un
   * chef qui longe sa table doit pouvoir la suivre, pas s'arrêter dessus. Les
   * deux axes sont donc éprouvés séparément.
   */
  glisser(x0, z0, x, z) {
    x = clamp(x, -(ROOM.w / 2 - MARGE), ROOM.w / 2 - MARGE);
    z = clamp(z, -(ROOM.d / 2 - MARGE), ROOM.d / 2 - MARGE);
    // Déjà dans un meuble ? On laisse passer. Refuser les deux axes quand le
    // chef est à l'intérieur, c'est l'y enfermer définitivement — et c'est ce
    // qui arrivait en se relevant du poste radio, dont le pas de recul tombait
    // dans une caisse.
    if (this.dedans(x0, z0)) return { x, z };
    if (this.dedans(x, z0)) x = x0;
    if (this.dedans(x, z)) z = z0;
    return { x, z };
  }

  /**
   * Le point libre le plus proche. Les emplacements de repli sont écrits à la
   * main dans le code ; le mobilier bouge. On ne dépose donc jamais le chef
   * sans avoir vérifié qu'il a la place de se tenir debout.
   */
  degager(x, z) {
    if (!this.dedans(x, z)) return { x, z };
    const lx = ROOM.w / 2 - MARGE, lz = ROOM.d / 2 - MARGE;
    for (let r = 24; r <= 460; r += 24) {
      for (let a = 0; a < 360; a += 15) {
        const nx = clamp(x + Math.cos(a * RAD) * r, -lx, lx);
        const nz = clamp(z + Math.sin(a * RAD) * r, -lz, lz);
        if (!this.dedans(nx, nz)) return { x: nx, z: nz };
      }
    }
    return { x, z };
  }

  dedans(x, z) {
    for (const b of BLOCS) {
      if (x > b.x0 - RAYON && x < b.x1 + RAYON && z > b.z0 - RAYON && z < b.z1 + RAYON) return true;
    }
    return false;
  }

  /**
   * Calotte, ampoule et cône sont des pièces rondes dessinées à plat. Deux
   * plans croisés en donnaient deux formes distinctes dès qu'on les regardait
   * de biais — une lampe qui semblait montée en double. On les tourne donc
   * vers le chef à chaque image : de partout, la baladeuse en reste une.
   */
  orienterLampes() {
    if (!this.lampes) return;
    const c = this.cam;
    for (const l of this.lampes) {
      // face à l'œil, pas à l'axe du regard : une lampe sur le côté resterait
      // vue par la tranche si on se contentait du cap de la caméra
      const ry = Math.atan2(c.x - l.x, c.z - l.z) / RAD;
      poser(l.cone, { w: 240, h: 150, x: l.x, y: l.yb + 80, z: l.z, ry });
      poser(l.refl, { w: 46, h: 30, x: l.x, y: l.yb - 12, z: l.z, ry });
      poser(l.bulb, { w: 22, h: 22, x: l.x, y: l.yb + 4, z: l.z, ry });
    }
  }

  apply() {
    const c = this.cam;
    this.orienterLampes();
    this.w3d.style.transform =
      'translateZ(' + this.f.toFixed(2) + 'px)' +
      ' rotateX(' + c.pitch.toFixed(3) + 'deg)' +
      ' rotateY(' + c.yaw.toFixed(3) + 'deg)' +
      ' translate3d(' + (-c.x).toFixed(2) + 'px,' + (-c.y).toFixed(2) + 'px,' + (-c.z).toFixed(2) + 'px)';

    // On ne clique dans l'interface qu'installé devant elle : ailleurs, c'est
    // une surface, et la viser suffit à s'y rendre.
    const actif = this.mode === 'focus' && this.poste === 'carte' && !this.glide;
    this.game.style.pointerEvents = actif ? 'auto' : 'none';
    // installé devant l'écran, on ne voit plus le reflet de la vitre
    this.mon.reflet.style.opacity = actif ? '0' : '1';

    // Le rappel : ce qu'on peut faire d'ici, ou comment on s'en va.
    const prompt = $('#prompt');
    if (this.mode === 'focus') {
      // À la carte, le bouton « Tente » de la barre haute suffit et ne masque rien.
      prompt.hidden = this.poste === 'carte' || !!this.glide;
      if (!prompt.hidden) prompt.textContent = 'Échap — reposer';
    } else if (!this.glide) {
      const t = this.locked ? this.cible() : null;
      prompt.hidden = !t;
      if (t) prompt.textContent = LIBELLE[t];
    } else {
      prompt.hidden = true;
    }
  }

  // Vie des postes : diode de réception, dernier message, trafic perdu.
  tick() {
    const now = this.world.time;

    for (const c of this.cards.values()) {
      const s = c.set;
      // le rétroéclairage tient tant que dure le message, pas un temps fixe
      const frais = now < s.parleJusqu;
      c.rx.classList.toggle('lit', s.on && frais);
      // le rétroéclairage ne s'allume que sur un poste en service
      c.card.classList.toggle('trafic', s.on && frais);
      c.card.classList.toggle('off', !s.on);
      // le coffret s'éclaire avec sa face : un poste en trafic se repère de
      // l'autre bout de la tente, sans qu'on ait à lire son écran
      const coque = this.coques && this.coques.get(s.id);
      if (coque) {
        coque.classList.toggle('trafic', s.on && frais);
        coque.classList.toggle('off', !s.on);
      }

      // Poste coupé : l'écran s'éteint, un point. Ce qu'on rate se voit sur le
      // boîtier — un repère rouge et le compte — pour ne pas perdre l'alerte
      // en même temps que l'affichage.
      c.manque.textContent = !s.on && s.missed ? '▲ ' + s.missed : '';
      if (s.on && s.last) {
        c.last.textContent = s.last.from + ' · ' + s.last.text;
        c.last.className = 'l3 last';
      }
    }

    // Main courante : les derniers passages effectivement entendus.
    const feuille = $('#main-courante');
    if (feuille) {
      const log = this.world.intel.log;
      const recus = [];
      for (let i = log.length - 1; i >= 0 && recus.length < 9; i--) {
        if (!log[i].missed) recus.push(log[i]);
      }
      recus.reverse();
      feuille.innerHTML = recus.map(m => {
        const net = this.rack.get(m.net);
        return '<div class="mc"><span class="h">' + formatClock(this.world.hour * 3600 + m.t) + '</span>' +
          '<span class="n" style="color:' + (net ? net.color : '#93a08c') + '">' + m.net + '</span>' +
          '<span class="f">' + escapeHtml(m.from) + '</span>' +
          '<span class="x">' + escapeHtml(m.text) + '</span></div>';
      }).join('') || '<div class="mc vide">Rien à signaler.</div>';
    }

    this.majTableau();

    const perdu = $('#perdu');
    if (perdu) {
      const n = this.rack.missedTotal;
      perdu.hidden = !n;
      perdu.textContent = n + ' message(s) perdus — poste(s) coupé(s)';
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Matières : les textures de surface de la tente, fabriquées au chargement.
//
// Jusqu'ici chaque face était un aplat, au mieux un dégradé à bornes franches.
// C'est lisible, mais une paroi de huit mètres peinte d'une seule valeur se
// lit comme un bloc : rien n'y accroche la lumière, rien n'y donne l'échelle.
// Ce qui manque n'est pas du détail dessiné — il y en a déjà — mais du grain :
// la trame d'une toile, le fil d'une planche, les rayures d'une tôle.
//
// On les fabrique ici plutôt que de charger des images : une texture tirée
// d'un bruit cohérent se répète sans couture, pèse ce qu'on décide, et se
// règle en une ligne. Chacune sort en PNG neutre — du noir et du blanc à
// opacité variable — ce qui lui permet de recouvrir n'importe quelle couleur
// sans la teinter : c'est la même trame qui creuse la toile verte du toit et
// la toile brune d'un sac.
//
// Les faces les portent par `::before` (voir la feuille de style), ce qui
// évite de toucher aux fonds existants et n'ajoute aucun nœud au document.

const TAILLE = 192;   // côté de la tuile, en pixels

// Générateur reproductible : la tente doit être la même à chaque partie.
function graine(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bruit cohérent bouclé sur `n` : une grille de valeurs au hasard, lue en
 * interpolation lissée. Le modulo sur les index est ce qui rend la tuile
 * raccordable — sans lui, le motif coupe net à chaque répétition.
 */
function champ(nx, ny, rnd) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) g[i] = rnd();
  return (u, v) => {
    const u0 = Math.floor(u), v0 = Math.floor(v);
    const fu = u - u0, fv = v - v0;
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    const a = (i, j) => g[(((j % ny) + ny) % ny) * nx + (((i % nx) + nx) % nx)];
    const h = a(u0, v0) * (1 - su) + a(u0 + 1, v0) * su;
    const b = a(u0, v0 + 1) * (1 - su) + a(u0 + 1, v0 + 1) * su;
    return h * (1 - sv) + b * sv;
  };
}

/**
 * Somme d'octaves : les grandes taches donnent les salissures, les petites le
 * grain. `ex` et `ey` étirent le motif — c'est ainsi qu'on obtient du fil.
 *
 * L'étirement joue sur le nombre de cellules, pas sur la coordonnée : une
 * grille garde ainsi un compte entier de cellules sur la tuile, et le motif
 * se raccorde. Étirer la coordonnée aurait coupé le fil à chaque répétition.
 */
function octaves(rnd, n, nb, ex = 1, ey = 1) {
  const c = [];
  for (let i = 0; i < nb; i++) {
    const k = 1 << i;
    c.push({
      f: null, p: 1 / k,
      nx: Math.max(1, Math.round(n * k * ex)),
      ny: Math.max(1, Math.round(n * k * ey)),
    });
    c[i].f = champ(c[i].nx, c[i].ny, rnd);
  }
  const somme = c.reduce((s, o) => s + o.p, 0);
  return (x, y) => {
    let v = 0;
    for (const o of c) v += o.f(x / TAILLE * o.nx, y / TAILLE * o.ny) * o.p;
    return v / somme;
  };
}

/**
 * Trace une tuile et la rend en URL de données.
 *
 * `f(x, y)` rend une valeur dans [-1, 1] : négative, elle creuse ; positive,
 * elle éclaire. On la quantifie par paliers avant d'écrire le pixel, ce qui
 * n'enlève rien à l'œil et divise par trois le poids du PNG — un bruit à
 * 256 niveaux ne se compresse pas.
 */
function tuile(f, creux, relief) {
  const c = document.createElement('canvas');
  c.width = c.height = TAILLE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(TAILLE, TAILLE);
  const d = img.data;
  for (let y = 0; y < TAILLE; y++) {
    for (let x = 0; x < TAILLE; x++) {
      const i = (y * TAILLE + x) * 4;
      const v = Math.max(-1, Math.min(1, f(x, y)));
      const clair = v > 0;
      const a = Math.round((clair ? v * relief : -v * creux) * 255 / 8) * 8;
      d[i] = d[i + 1] = d[i + 2] = clair ? 255 : 0;
      d[i + 3] = Math.min(255, a);
    }
  }
  ctx.putImageData(img, 0, 0);
  return 'url("' + c.toDataURL('image/png') + '")';
}

// ---------------------------------------------------------------- les tuiles

/** Toile de tente : une armure toile, bombée au fil, creuse au croisement. */
function toile(rnd) {
  const sale = octaves(rnd, 3, 3);
  const T = 6;
  return (x, y) => {
    const cx = Math.floor(x / T), cy = Math.floor(y / T);
    const vertical = ((cx + cy) & 1) === 0;
    const u = (vertical ? x % T : y % T) / T;
    // profil du fil : rond au milieu, ombré sur ses deux bords
    let v = Math.sin(u * Math.PI) * 0.9 - 0.42;
    // le fil qui passe dessous reste dans l'ombre de son voisin
    v -= vertical ? 0.06 : 0.16;
    v = v * 0.5 + (sale(x, y) - 0.5) * 1.5;
    return v;
  };
}

/** Toile de jute : même armure, trois fois plus grosse et bien plus irrégulière. */
function jute(rnd) {
  const sale = octaves(rnd, 4, 3);
  const flou = octaves(rnd, 24, 2);
  const T = 11;
  return (x, y) => {
    const dx = (flou(x, y) - 0.5) * 3.2;     // le fil de jute ne va pas droit
    const cx = Math.floor((x + dx) / T), cy = Math.floor(y / T);
    const vertical = ((cx + cy) & 1) === 0;
    const u = (vertical ? (x + dx) % T : y % T) / T;
    let v = Math.sin(Math.abs(u) * Math.PI) * 1.05 - 0.5;
    v -= vertical ? 0.05 : 0.2;
    return v * 0.62 + (sale(x, y) - 0.5) * 1.6;
  };
}

/** Bois : le fil en long, des cernes, et de loin en loin un nœud. */
function bois(rnd) {
  const fil = octaves(rnd, 4, 4, 0.14, 3.4);   // très étiré dans la longueur
  const fin = octaves(rnd, 32, 2, 0.3, 2.2);
  // Un seul nœud par tuile, et discret : à deux, le même dessin de cernes
  // revenait tous les soixante-dix centimètres sur chaque planche, et l'œil
  // ne voyait plus que la répétition.
  const noeuds = [{ x: rnd() * TAILLE, y: rnd() * TAILLE, r: 7 + rnd() * 5 }];
  return (x, y) => {
    // les cernes : le bruit étiré, replié en bandes par un sinus
    let v = Math.sin(fil(x, y) * 22) * 0.46;
    v += (fin(x, y) - 0.5) * 0.7;             // les fibres fines
    for (const n of noeuds) {
      // distance bouclée, pour que le nœud ne coupe pas au raccord
      const dx = Math.min(Math.abs(x - n.x), TAILLE - Math.abs(x - n.x));
      const dy = Math.min(Math.abs(y - n.y), TAILLE - Math.abs(y - n.y));
      const d = Math.hypot(dx, dy);
      if (d < n.r * 2.6) {
        const k = 1 - d / (n.r * 2.6);
        v = v * (1 - k) + Math.sin(d * 0.85) * k * 0.72 - k * 0.2;
      }
    }
    return v;
  };
}

/** Tôle brossée : des rayures dans un sens, et le voile d'usure par-dessus. */
function metal(rnd) {
  const brosse = octaves(rnd, 6, 3, 0.08, 4);
  const voile = octaves(rnd, 3, 2);
  const raies = graine(7701);
  const lignes = [];
  for (let i = 0; i < 34; i++) lignes.push({ y: raies() * TAILLE, l: 0.25 + raies() * 0.5 });
  return (x, y) => {
    // brossage léger : à pleine amplitude, une boîte à munitions se lisait
    // comme un bloc rayé noir et blanc plutôt que comme de la tôle
    let v = (brosse(x, y) - 0.5) * 0.5;
    v += (voile(x, y) - 0.5) * 0.34;
    for (const r of lignes) {
      const dy = Math.min(Math.abs(y - r.y), TAILLE - Math.abs(y - r.y));
      if (dy < 1.1) v += (1 - dy) * r.l * 0.6;   // la rayure accroche la lumière
    }
    return v;
  };
}

/** Polymère moulé : le grain de peau d'une caisse étanche. */
function polymere(rnd) {
  const grain = octaves(rnd, 48, 2);
  const large = octaves(rnd, 4, 2);
  return (x, y) => {
    const g = grain(x, y);
    // on durcit le bruit en cellules : c'est ce qui fait le grain moulé
    let v = (g - 0.5) * 2.4;
    v = Math.sign(v) * Math.pow(Math.abs(v), 0.7) * 0.6;
    return v + (large(x, y) - 0.5) * 0.35;
  };
}

/** Papier et carton : un grain court, sans direction. */
function papier(rnd) {
  const g = octaves(rnd, 40, 2);
  const t = octaves(rnd, 3, 2);
  return (x, y) => (g(x, y) - 0.5) * 1.1 + (t(x, y) - 0.5) * 0.55;
}

// ------------------------------------------------------------------- en place

let posees = false;

/**
 * Fabrique les tuiles et les publie en variables CSS.
 *
 * Appelée une fois : la génération coûte quelques dizaines de millisecondes,
 * et les tuiles ne dépendent de rien qui change en cours de partie.
 */
export function poserMatieres(racine = document.documentElement) {
  if (posees) return;
  posees = true;

  const jeu = [
    ['--t-toile', toile(graine(1041)), 0.30, 0.17],
    ['--t-jute', jute(graine(2207)), 0.34, 0.20],
    ['--t-bois', bois(graine(3313)), 0.26, 0.15],
    ['--t-metal', metal(graine(4409)), 0.24, 0.17],
    ['--t-polymere', polymere(graine(5501)), 0.22, 0.13],
    ['--t-papier', papier(graine(6619)), 0.13, 0.10],
  ];
  for (const [nom, f, creux, relief] of jeu) {
    racine.style.setProperty(nom, tuile(f, creux, relief));
  }
}

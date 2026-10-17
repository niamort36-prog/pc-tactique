// Voix radio.
//
// La synthèse vocale du navigateur lit les comptes rendus. Elle ne peut pas être
// filtrée comme un vrai poste — le son de la synthèse ne passe pas par le graphe
// Web Audio — alors on l'habille : bip de prise de parole, souffle de porteuse
// pendant le message, volume et débit dégradés quand la liaison est mauvaise.
//
// Chaque indicatif reçoit sa voix : timbre et débit dérivés de son nom, donc
// stables d'un bout à l'autre de la partie. On reconnaît BRAVO à l'oreille.

import { sfx } from './audio.js';

// Ce qu'on prend la peine de dire, et avec quelle insistance.
// `order` à 0 : ce sont les ordres que le chef vient de donner lui-même. Les
// relire à voix haute n'apprend rien et encombre le réseau.
const PRIORITY = { loss: 3, warn: 3, contact: 2, brief: 2, fire: 1, status: 1, order: 0, log: 0, info: 0 };

const MAX_QUEUE = 3;

// Noms usuels des voix de synthèse, par sexe. Ce sont les seuls indices
// exploitables : l'API Web Speech n'expose aucune information de ce genre.
const MALE = /\b(paul|thomas|nicolas|henri|mathieu|guillaume|r[ée]my|antoine|bernard|claude|david|pierre|jean|louis|marc|male|homme|man)\b/i;
const FEMALE = /\b(hortense|julie|am[ée]lie|audrey|marie|chantal|c[ée]line|aur[ée]lie|virginie|l[ée]a|manon|charlotte|denise|elo[ïi]se|jacqueline|sylvie|zira|nathalie|sophie|female|femme|woman)\b/i;

// Registre grave et paliers de timbre, débit compris. Timbre ET débit sont
// échelonnés : deux indicatifs distincts diffèrent toujours d'au moins un palier
// entier sur l'un des deux, donc s'entendent.
const PITCH_LOW = 0.58, PITCH_HIGH = 1.00, PITCH_STEPS = 9;
const RATE_LOW = 0.92, RATE_HIGH = 1.16, RATE_STEPS = 5;

class Voice {
  constructor() {
    this.enabled = true;
    this.voices = [];
    this.queue = [];
    this.speaking = false;
    this.rate = 1.05;
    this.lastAt = 0;
    this.deepen = false;
    this.slots = new Map();          // indicatif -> case de timbre
    this.taken = new Set();
    if ('speechSynthesis' in window) {
      const load = () => this.pickVoices();
      load();
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  // L'API ne dit pas le sexe d'une voix : on s'appuie sur les noms usuels des
  // moteurs installés. À défaut de voix masculine, on descend franchement le
  // timbre de ce qui est disponible.
  pickVoices() {
    const all = window.speechSynthesis.getVoices();
    const fr = all.filter(v => /^fr/i.test(v.lang));
    const pool = fr.length ? fr : all;

    const males = pool.filter(v => MALE.test(v.name));
    const neutres = pool.filter(v => !FEMALE.test(v.name));
    const avant = this.voices.length;
    if (males.length) { this.voices = males; this.deepen = false; }
    else if (neutres.length) { this.voices = neutres; this.deepen = false; }
    else { this.voices = pool; this.deepen = true; }
    // le découpage des cases dépend du nombre de voix : il faut le refaire
    if (this.voices.length !== avant) { this.slots.clear(); this.taken.clear(); }
  }

  get available() { return 'speechSynthesis' in window && this.voices.length > 0; }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.stop();
  }

  stop() {
    this.queue.length = 0;
    this.speaking = false;
    sfx.setStatic(0);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // Empreinte stable d'un indicatif, pour lui attribuer toujours la même voix.
  fingerprint(callsign) {
    let h = 0;
    for (let i = 0; i < callsign.length; i++) h = (h * 31 + callsign.charCodeAt(i)) >>> 0;
    return h;
  }

  /**
   * Timbres échelonnés plutôt que tirés au hasard : sur un poste qui n'offre
   * qu'une seule voix d'homme, c'est le pas de hauteur et le débit qui
   * distinguent les indicatifs. Les combinaisons voix × timbre × débit sont
   * réparties en paliers nets.
   *
   * L'empreinte du nom ne donne qu'un point de départ : deux indicatifs
   * tombant sur la même case, on prend la suivante encore libre. Sans cela une
   * poignée d'éléments finit par parler exactement de la même façon, ce qui
   * ruine tout l'intérêt de la manœuvre.
   */
  voiceFor(callsign) {
    if (!this.voices.length) return null;
    const known = this.slots.get(callsign);
    const nv = this.voices.length;
    const total = nv * PITCH_STEPS * RATE_STEPS;

    let slot;
    if (known !== undefined) {
      slot = known;
    } else {
      slot = this.fingerprint(callsign) % total;
      // case déjà prise : on avance jusqu'à une libre, sauf si tout est occupé
      if (this.slots.size < total) {
        while (this.taken.has(slot)) slot = (slot + 1) % total;
        this.taken.add(slot);
      }
      this.slots.set(callsign, slot);
    }

    const vi = slot % nv;
    const pi = Math.floor(slot / nv) % PITCH_STEPS;
    const ri = Math.floor(slot / (nv * PITCH_STEPS)) % RATE_STEPS;

    // registre grave : de 0,58 à 1,00, sans jamais monter dans l'aigu
    let pitch = PITCH_LOW + (pi / (PITCH_STEPS - 1)) * (PITCH_HIGH - PITCH_LOW);
    if (this.deepen) pitch *= 0.78;              // aucune voix d'homme disponible

    return {
      voice: this.voices[vi],
      pitch: Math.max(0.1, pitch),
      rate: RATE_LOW + (ri / (RATE_STEPS - 1)) * (RATE_HIGH - RATE_LOW),
    };
  }

  /**
   * Met un compte rendu en file. `quality` est la qualité de liaison, 0 à 1.
   */
  say(entry, quality = 1, speed = 1, gain = 1) {
    if (!this.enabled || !this.available || gain <= 0) return;
    const prio = PRIORITY[entry.kind] != null ? PRIORITY[entry.kind] : 1;
    if (prio < 1) return;
    // à vitesse accélérée, le réseau déborde : on ne garde que l'essentiel
    if (speed >= 4 && prio < 3) return;
    if (speed >= 2 && prio < 2) return;

    // file courte : un message neuf chasse un moins important
    if (this.queue.length >= MAX_QUEUE) {
      let worst = -1, worstPrio = prio;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].prio < worstPrio) { worstPrio = this.queue[i].prio; worst = i; }
      }
      if (worst < 0) return;
      this.queue.splice(worst, 1);
    }

    this.queue.push({ entry, quality, prio, gain });
    this.pump();
  }

  pump() {
    if (this.speaking || !this.queue.length) return;
    const item = this.queue.shift();
    this.speaking = true;

    const { entry, quality } = item;
    const gain = item.gain != null ? item.gain : 1;
    const v = this.voiceFor(entry.from || 'PC');
    const u = new SpeechSynthesisUtterance(procedure(entry));
    if (v) {
      if (v.voice) u.voice = v.voice;
      u.pitch = v.pitch;
      u.rate = v.rate * this.rate * (quality < 0.4 ? 1.08 : 1);
    }
    u.lang = 'fr-FR';
    // liaison faible : on entend mal, et le souffle prend le dessus
    // le bouton du poste sur la table multiplie le volume général
    u.volume = Math.max(0.25, 0.55 + 0.45 * quality) * gain *
               (sfx.enabled ? sfx.volume * 1.6 : 0);

    u.onstart = () => sfx.setStatic(0.22 + (1 - quality) * 0.55);
    const done = () => {
      sfx.setStatic(0);
      this.speaking = false;
      // court silence entre deux prises de parole
      setTimeout(() => this.pump(), 220);
    };
    u.onend = done;
    u.onerror = done;

    try {
      window.speechSynthesis.speak(u);
    } catch (e) {
      done();
    }
  }
}

// ---------------------------------------------------------------- mise en forme

// Développe les abréviations : à l'écrit « 8 pax, az 300, 80 m » se lit très mal.
function spoken(text) {
  return String(text)
    .replace(/\s*…?\s*\[[^\]]*\]/g, '')                 // mentions techniques entre crochets
    .replace(/\(s\)/g, 's')                             // « passe(s) » ne se dit pas
    .replace(/\baz\b\.?/gi, 'azimut')
    .replace(/(\d)\s*°/g, '$1 degrés')
    .replace(/\bpax\b/gi, 'personnels')
    .replace(/\bcp\b/gi, 'coups')
    .replace(/\bh\.c\.\b/gi, 'hors de combat')
    .replace(/(\d[\d.,]*)\s*km\b/gi, '$1 kilomètres')
    .replace(/(\d)\s*m\b/g, '$1 mètres')
    .replace(/(\d)\s*%/g, '$1 pour cent')
    .replace(/\bVTT\b/g, 'véhicule de transport')
    .replace(/\bFARP\b/g, 'farpe')
    .replace(/\bPC\b/g, 'Pé-Cé')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Chiffres épelés, comme sur un réseau réel : « azimut deux quatre zéro ».
const DIGIT = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
function spell(n) {
  return String(n).split('').map(d => (DIGIT[+d] !== undefined ? DIGIT[+d] : d)).join(' ');
}

// Indicatif prononçable. Les majuscules sont lues lettre par lettre par
// certains moteurs, et les chiffres d'un indicatif s'épellent : « Kilo un ».
const HQ_STATION = 'Zoulou';
function station(cs) {
  return String(cs)
    .replace(/^PC\s+/i, '')
    .replace(/\bZULU\b/i, 'Zoulou')
    .replace(/[-_]+/g, ' ')
    .replace(/\d+/g, m => spell(m))
    .toLowerCase()
    .replace(/(^|\s)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase())
    .trim();
}

/**
 * Mise en forme procédurale.
 *
 * L'appel s'ouvre sur l'indicatif du destinataire, « de », puis celui de
 * l'émetteur — « Zoulou de Alpha » : c'est ainsi qu'on se présente sur un
 * réseau, le PC sachant alors immédiatement qui parle. Ce qui avait été retiré,
 * c'est la description de l'élément (nature, effectif) répétée à chaque
 * transmission ; l'indicatif seul suffit et reste.
 *
 * Suivent les gisements épelés chiffre par chiffre, l'indicatif d'urgence en
 * tête d'un message vital, et la fin de transmission — « Terminé » quand on
 * n'attend rien, « À vous » quand on attend une réponse.
 */
function procedure(entry) {
  let body = spoken(entry.text);

  // gisements et axes : chiffre par chiffre
  body = body
    // un qualificatif peut s'intercaler : « azimut approximatif 143 »
    .replace(/\b(azimut|axe|gisement)((?:\s+[a-zà-ÿ]+){0,2})\s+(\d{1,3})\b/gi,
             (m, mot, adj, n) => mot + adj + ' ' + spell(n));

  const from = entry.from || 'PC';
  if (from === 'PC' || /^PC\b/.test(from)) return body;   // le PC parle en clair

  // « Zoulou de Alpha » : destinataire, puis émetteur.
  const head = HQ_STATION + ' de ' + station(from) + ', ';
  const urgent = entry.kind === 'loss' ? 'message urgent, ' : '';
  const tail = /[?]$/.test(body) ? ' À vous.' : ' Terminé.';
  // le corps enchaîne sur une virgule : sa majuscule initiale n'a plus lieu d'être
  const corps = body.charAt(0).toLowerCase() + body.slice(1);
  return head + urgent + corps + tail;
}

export const voice = new Voice();

// Branche la voix sur le journal radio.
export function bindVoice(world, ui) {
  world.on('radio', entry => {
    if (entry.missed) return;                 // poste coupé : personne n'entend
    const u = world.units.find(x => x.callsign === entry.from);
    const q = u ? Math.max(0.15, u.link) : 1;
    const g = world.rack ? world.rack.gainFor(entry.net) : 1;
    // le bip de prise de parole d'abord, la voix juste après
    setTimeout(() => voice.say(entry, q, ui ? ui.speed : 1, g), 260);
  });
}

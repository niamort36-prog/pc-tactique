// Situation tactique au PC : agrège les comptes rendus radio des éléments,
// vieillit les contacts, et produit le journal radio.

import { LVL, LVL_LABEL, radioLink } from './sensors.js';
import { azimuth, formatDist, clamp } from '../core/util.js';
import { CATALOG } from './catalog.js';
import { NETS } from './unit.js';

const TYPE_FR = {
  'infantry': 'infanterie', 'command': 'PC', 'reco': 'reconnaissance', 'sniper': 'tireur d’élite',
  'anti tank': 'antichar', 'mortar': 'mortier', 'engineer': 'génie', 'medical': 'sanitaire',
  'radio': 'transmissions', 'sf': 'forces spéciales', 'uav operator': 'équipe drone',
  'transportation': 'véhicule de transport', 'mechanized armor': 'blindé',
  'infantry motorized': 'véhicule léger', 'relay radio': 'relais radio', 'uav': 'drone',
  'attack helicopter': 'hélicoptère d’attaque', 'transport helicopter': 'hélicoptère de transport',
  'attack aircraft': 'avion d’appui', 'recon aircraft': 'avion de reconnaissance',
};

export class Intel {
  constructor(world) {
    this.world = world;
    this.contacts = new Map();   // targetId -> contact consolidé au PC
    this.log = [];               // journal radio
    this.pending = [];           // messages en attente de liaison
    this.markers = [];           // points tactiques posés par le joueur
  }

  say(unit, text, kind = 'info') {
    const entry = {
      t: this.world.time,
      from: unit ? unit.callsign : 'PC',
      net: unit ? unit.net : 'CDT',
      freq: unit ? unit.freq : 31.250,
      text, kind,
    };
    this.log.push(entry);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.world.emit('radio', entry);
    return entry;
  }

  /**
   * Le PC prend l'antenne.
   *
   * Ce n'est pas un compte rendu : le message part sur le réseau que le chef a
   * choisi en prenant un poste, et non sur le réseau de commandement par
   * défaut. C'est ce qui fait qu'un poste coupé coupe aussi la parole — on
   * n'émet pas sur un poste qu'on a éteint.
   */
  emettre(net, text, kind = 'order') {
    const info = NETS[net];
    const entry = {
      t: this.world.time,
      from: 'PC', net,
      freq: info ? info.freq : 31.250,
      text, kind,
    };
    this.log.push(entry);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.world.emit('radio', entry);
    return entry;
  }

  // Un élément essaie de transmettre : si la liaison est mauvaise, le message est différé.
  transmit(unit, text, kind, priority = 0) {
    if (!unit || unit.side !== 'BLUFOR') return false;   // seul notre réseau arrive au PC

    // Plancher de débit par élément : un chef ne passe pas trois messages par
    // seconde. Mais une information vitale — pertes, prise à partie, rupture de
    // mission — passe toujours : elle ne doit jamais être écrasée par une routine.
    //   priorité 0 : routine        priorité 1 : tactique       priorité 2 : vital
    const floor = priority >= 2 ? 0 : priority ? 3 : 10;
    if (this.world.time - (unit.lastTx || -999) < floor) return false;
    unit.lastTx = this.world.time;

    const q = unit.link != null ? unit.link : radioLink(this.world, unit);
    if (q <= 0.05) {
      this.pending.push({ unit, text, kind, priority, at: this.world.time });
      unit.commsLost = true;
      return false;
    }
    unit.commsLost = false;
    const delay = (priority ? 0.6 : 2.0) + (1 - q) * 6;
    this.world.schedule(delay, () => {
      if (q < 0.35) this.say(unit, text + ' … [liaison dégradée]', kind);
      else this.say(unit, text, kind);
    });
    return true;
  }

  flushPending() {
    if (!this.pending.length) return;
    const still = [];
    for (const m of this.pending) {
      const q = m.unit.link != null ? m.unit.link : radioLink(this.world, m.unit);
      if (q > 0.05 && !m.unit.destroyed) {
        const age = Math.round(this.world.time - m.at);
        this.say(m.unit, m.text + (age > 20 ? ' (message différé, +' + age + 's)' : ''), m.kind);
      } else if (this.world.time - m.at < 900 && !m.unit.destroyed) {
        still.push(m);
      }
    }
    this.pending = still;
  }

  // Remontée d'un contact depuis un observateur vers le PC.
  report(unit, c, target) {
    const w = this.world;
    const known = this.contacts.get(c.id);
    const az = Math.round(azimuth(unit, { x: c.x, y: c.y }));
    const d = Math.hypot(c.x - unit.x, c.y - unit.y);

    let text;
    if (c.level === LVL.HEARD) {
      text = 'Bruits suspects, azimut ' + az + ', environ ' + formatDist(d) + '. Rien de visuel.';
    } else if (c.level === LVL.SEEN) {
      const n = c.strength ? c.strength + ' pax environ' : 'élément non identifié';
      text = 'Contact ! ' + n + ', azimut ' + az + ', ' + formatDist(d) + '. Pas d’identification.';
    } else {
      const label = TYPE_FR[c.type] || c.type;
      text = 'Contact identifié : ' + label + (c.strength ? ', ' + c.strength + ' pax' : '') +
             ', azimut ' + az + ', ' + formatDist(d) + '.';
    }
    this.transmit(unit, text, 'contact', c.level >= LVL.SEEN ? 1 : 0);

    const entry = known || {
      id: c.id, side: target.side, firstSeen: w.time, level: 0,
      x: c.x, y: c.y, err: c.err, type: null, strength: null, reporter: unit.callsign,
      lastUpdate: w.time, lastFresh: w.time, engaged: false,
    };
    // le PC retient la meilleure information disponible
    if (c.level >= entry.level || w.time - entry.lastFresh > 25) {
      entry.level = Math.max(entry.level, c.level);
      entry.x = c.x; entry.y = c.y; entry.err = c.err;
      entry.reporter = unit.callsign;
      entry.lastFresh = w.time;
    }
    if (c.type) entry.type = c.type;
    if (c.strength != null) entry.strength = c.strength;
    entry.lastUpdate = w.time;
    entry.side = target.side;
    this.contacts.set(c.id, entry);
  }

  update(dt) {
    const w = this.world;

    for (const unit of w.units) {
      if (unit.side !== 'BLUFOR' || unit.destroyed) continue;
      unit.link = radioLink(w, unit);

      for (const [tid, c] of unit.contacts) {
        const target = w.byId.get(tid);
        if (!target || target.side === 'CIV') continue;   // les civils ne polluent pas la situation ennemie
        const fresh = c.freshLevel || 0;
        if (fresh === LVL.NONE) continue;
        // Discipline radio : on ne repete pas un contact inchange. On rend compte
        // d'une aggravation, d'un deplacement notable, ou d'un rafraichissement tardif.
        const levelUp = c.level > c.reportedLevel;
        // Un contact seulement ENTENDU a une position volontairement bruitee :
        // la comparer d'un rafraichissement a l'autre ferait rendre compte en boucle.
        const moved = c.level >= LVL.SEEN && c.reportedX != null &&
                      Math.hypot(c.x - c.reportedX, c.y - c.reportedY) > 90;
        const stale = w.time - c.reportedAt > (c.level >= LVL.SEEN ? 80 : 240);
        if (levelUp || moved || stale) {
          c.reportedLevel = c.level;
          c.reportedAt = w.time;
          c.reportedX = c.x; c.reportedY = c.y;
          this.report(unit, c, target);
        }
      }
    }

    this.flushPending();

    // vieillissement : au bout d'un moment, l'information n'est plus fiable
    for (const [id, e] of this.contacts) {
      const age = w.time - e.lastFresh;
      e.age = age;
      e.err = Math.min(600, e.err + dt * (age > 30 ? 0.9 : 0));
      if (age > 90 && e.level > LVL.HEARD) e.level = LVL.HEARD;
      if (age > 420) this.contacts.delete(id);
    }
  }

  // Contacts affichables sur la carte (avec vétusté).
  visible() {
    const out = [];
    for (const e of this.contacts.values()) out.push(e);
    return out;
  }
}

export { TYPE_FR };

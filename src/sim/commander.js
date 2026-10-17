// Commandement adverse.
//
// L'ennemi n'est pas omniscient : il ne connaît que ce que ses éléments lui ont
// rendu compte, par radio, avec le retard et l'imprécision que cela suppose. Un
// élément hors de portée est un secteur aveugle ; un élément détruit avant
// d'avoir parlé emporte son information avec lui.
//
// Le chef adverse tient une situation, en déduit un axe d'effort probable,
// articule ses moyens en conséquence — renforcement, engagement de la réserve,
// éclairage des contacts douteux, décrochage d'un secteur qui cède — et
// transmet ses ordres, qui mettent eux aussi du temps à parvenir.
//
// Détruire son poste de commandement paralyse cette coordination : chaque
// élément retombe alors sur sa seule initiative.

import { LVL, radioLink } from './sensors.js';
import { makeOrder } from './orders.js';
import { clamp, dist, azimuth } from '../core/util.js';

const REPORT_EVERY = 30;      // un élément ne répète pas un contact plus souvent
const FORGET_AFTER = 300;     // au-delà, l'information n'a plus de valeur
const CLUSTER = 700;          // regroupement des contacts en « paquets »

export class EnemyCommander {
  constructor(world) {
    this.world = world;
    this.picture = new Map();     // bluforId -> ce que le chef croit savoir
    this.nextThink = 20;
    this.posture = 'vigilance';   // vigilance | alerte | engagement | crise
    this.mainAxis = null;
    this.reserveCommitted = false;
    this.log = [];                // journal de décision, pour analyse
  }

  get hq() { return this.world.opforHq; }
  // Le PC adverse tient-il encore ? Sans lui, plus de manœuvre d'ensemble.
  get intact() {
    const h = this.hq;
    return !!h && !h.destroyed && h.effective > 0;
  }

  note(text) {
    this.log.push({ t: this.world.time, text });
    if (this.log.length > 120) this.log.shift();
  }

  // ---------------------------------------------------------------- collecte

  // Les subordonnés rendent compte de ce qu'ils voient, s'ils peuvent parler.
  collect() {
    const w = this.world;
    for (const u of w.units) {
      if (u.side !== 'OPFOR' || u.destroyed || u.effective === 0) continue;
      const link = radioLink(w, u);
      u.link = link;
      if (link <= 0.05) { u.commsLost = true; continue; }
      u.commsLost = false;

      for (const [id, c] of u.contacts) {
        if (c.level < LVL.HEARD) continue;
        const t = w.byId.get(id);
        if (!t || t.side !== 'BLUFOR') continue;
        if (w.time - (c.opforAt || -999) < REPORT_EVERY) continue;
        c.opforAt = w.time;

        const snapshot = {
          x: c.x, y: c.y, level: c.level, err: c.err,
          type: c.type, strength: c.strength, reporter: u.callsign,
        };
        // le compte rendu met d'autant plus de temps que la liaison est mauvaise
        w.schedule(2 + (1 - link) * 14, () => this.receive(id, snapshot));
      }
    }
  }

  receive(id, s) {
    const w = this.world;
    const prev = this.picture.get(id);
    if (prev && prev.level > s.level && w.time - prev.at < 60) {
      prev.at = w.time;                 // on ne dégrade pas une bonne information
      return;
    }
    this.picture.set(id, {
      id, x: s.x, y: s.y, level: s.level, err: s.err,
      type: s.type, strength: s.strength || (s.level >= LVL.SEEN ? 6 : 4),
      reporter: s.reporter, at: w.time, first: prev ? prev.first : w.time,
    });
  }

  // L'information vieillit : la position devient douteuse, puis sans valeur.
  age() {
    const w = this.world;
    for (const [id, c] of this.picture) {
      const a = w.time - c.at;
      if (a > FORGET_AFTER) { this.picture.delete(id); continue; }
      if (a > 120 && c.level > LVL.HEARD) c.level = LVL.HEARD;
      c.err = Math.min(900, c.err + a * 0.02);
    }
  }

  // ---------------------------------------------------------------- analyse

  // Regroupe les contacts en paquets et estime le volume de chacun.
  clusters() {
    const list = [...this.picture.values()];
    const out = [];
    for (const c of list) {
      let host = null;
      for (const g of out) if (Math.hypot(g.x - c.x, g.y - c.y) < CLUSTER) { host = g; break; }
      if (!host) { host = { x: c.x, y: c.y, n: 0, strength: 0, fresh: 0, seen: 0, items: [] }; out.push(host); }
      host.items.push(c);
      host.n++;
      host.strength += c.strength || 5;
      host.fresh = Math.max(host.fresh, -(this.world.time - c.at));
      if (c.level >= LVL.SEEN) host.seen++;
      // barycentre pondéré par la fraîcheur
      host.x = host.items.reduce((a, i) => a + i.x, 0) / host.items.length;
      host.y = host.items.reduce((a, i) => a + i.y, 0) / host.items.length;
    }
    return out;
  }

  // Axe d'effort probable : le paquet le plus fort et le plus proche de l'objectif.
  assess() {
    const w = this.world;
    const obj = w.opforRally || { x: 0, y: 0 };
    const gs = this.clusters();
    let best = null, bestScore = 0;
    for (const g of gs) {
      const d = Math.hypot(g.x - obj.x, g.y - obj.y);
      const age = w.time + g.fresh;                 // fresh est négatif
      const score = g.strength * (g.seen ? 1.4 : 0.7) / (1 + d / 1500) / (1 + age / 180);
      if (score > bestScore) { bestScore = score; best = g; }
    }
    this.mainAxis = best ? {
      x: best.x, y: best.y, strength: Math.round(best.strength),
      bearing: Math.round(azimuth(obj, best)),
      distance: Math.round(Math.hypot(best.x - obj.x, best.y - obj.y)),
      confirmed: best.seen > 0,
    } : null;

    const total = gs.reduce((a, g) => a + g.strength, 0);
    const prev = this.posture;
    const m = this.mainAxis;
    if (!gs.length) this.posture = 'vigilance';
    else if (!m || !m.confirmed) this.posture = 'alerte';
    // La crise, c'est du volume au contact — pas une patrouille isolée qui passe.
    else if ((m.distance < 900 && m.strength >= 10) || total >= 26) this.posture = 'crise';
    else this.posture = 'engagement';
    if (prev !== this.posture) {
      this.note('Posture : ' + prev + ' → ' + this.posture +
        (this.mainAxis ? ' (effort estimé azimut ' + this.mainAxis.bearing + ', ' +
          this.mainAxis.strength + ' pax, ' + this.mainAxis.distance + ' m)' : ''));
    }
    return gs;
  }

  // ---------------------------------------------------------------- ordres

  // Transmet un ordre : il ne part que si l'élément est joignable, et il met du
  // temps à arriver puis à être exécuté.
  send(unit, order, intent) {
    if (unit.cmdIntent === intent && this.world.time - (unit.cmdAt || -999) < 300) return false;
    // inutile de retasker un élément cloué ou fixé : il ne peut pas bouger
    if (unit.tactical === 'FIXÉ' || unit.tactical === 'CLOUÉ' || unit.tactical === 'REPLI') return false;
    const link = radioLink(this.world, unit);
    if (link <= 0.05) return false;
    unit.cmdIntent = intent;
    unit.cmdAt = this.world.time;
    const delay = 4 + (1 - link) * 18 + (this.intact ? 6 : 40);
    this.world.schedule(delay, () => {
      if (unit.destroyed || unit.effective === 0) return;
      unit.order = order;
    });
    this.note(unit.callsign + ' ← ' + intent);
    return true;
  }

  subordinates() {
    return this.world.units.filter(u =>
      u.side === 'OPFOR' && !u.destroyed && u.effective > 0 && u !== this.hq);
  }

  // ---------------------------------------------------------------- décision

  think() {
    const w = this.world;
    this.age();

    // Sans PC, plus d'ordres d'ensemble : chacun tient son secteur.
    if (!this.intact) {
      if (!this.paralysed) {
        this.paralysed = true;
        this.note('Poste de commandement hors service : la manœuvre d’ensemble s’arrête.');
      }
      return;
    }
    this.paralysed = false;

    const gs = this.assess();
    const obj = w.opforRally || { x: 0, y: 0 };
    const main = this.mainAxis;
    const units = this.subordinates();

    // --- 1. éclairer les contacts douteux -----------------------------------
    // Un bruit non identifié vaut qu'on envoie voir, plutôt que d'attendre.
    const vague = gs.filter(g => !g.seen && w.time + g.fresh < 120);
    if (vague.length) {
      const target = vague[0];
      const scout = units
        .filter(u => u.role === 'patrol' && u.strength > 0.6 &&
                     (!u.order || u.order.type === 'PATROUILLER'))
        .sort((a, b) => dist(a, target) - dist(b, target))[0];
      if (scout && dist(scout, target) < 4000) {
        this.send(scout, makeOrder('RECHERCHE', {
          target: { x: target.x, y: target.y },
          waypoints: [{ x: target.x, y: target.y }], radius: 400,
        }), 'éclairer contact azimut ' + Math.round(azimuth(obj, target)));
      }
    }

    if (!main) return;

    // --- 2. densifier l'axe menacé ------------------------------------------
    // On prélève sur les secteurs calmes, jamais sur un secteur lui aussi menacé.
    const threatBearing = main.bearing;
    const sectorOf = u => Math.round(azimuth(obj, u));
    const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

    const menaced = u => gs.some(g => Math.hypot(g.x - u.x, g.y - u.y) < 900);

    if (this.posture === 'engagement' || this.posture === 'crise') {
      const quiet = units.filter(u =>
        u.role === 'garrison' && !menaced(u) &&
        angDiff(sectorOf(u), threatBearing) > 85 && u.strength > 0.6);
      // on ne dégarnit jamais tout : au plus un tiers des secteurs calmes
      const take = quiet.slice(0, Math.max(0, Math.floor(quiet.length / 3)));
      for (const u of take) {
        const px = obj.x + Math.sin(threatBearing * Math.PI / 180) * 320;
        const py = obj.y + Math.cos(threatBearing * Math.PI / 180) * 320;
        this.send(u, makeOrder('DEFENDRE', {
          target: { x: px, y: py }, waypoints: [{ x: px, y: py }], radius: 220,
        }), 'renforcer l’axe ' + threatBearing);
      }
    }

    // --- 3. engager la réserve ----------------------------------------------
    // Une réserve ne se donne qu'une fois : on attend que l'effort soit confirmé.
    if (!this.reserveCommitted && main.confirmed && main.strength >= 12 &&
        (this.posture === 'crise' || this.posture === 'engagement')) {
      const reserve = units.filter(u => u.role === 'reserve' && u.strength > 0.5);
      if (reserve.length) {
        this.reserveCommitted = true;
        for (const u of reserve) {
          this.send(u, makeOrder('ATTAQUER', { waypoints: [{ x: main.x, y: main.y }] }),
            'engagement de la réserve sur l’axe ' + threatBearing);
        }
        this.note('Réserve engagée : effort adverse confirmé azimut ' + threatBearing +
          ', volume estimé ' + main.strength + ' pax.');
      }
    }

    // --- 4. contre-attaque locale -------------------------------------------
    // Seulement là où le chef se croit supérieur, et seulement sur du confirmé.
    for (const g of gs) {
      if (!g.seen || g.strength < 6) continue;
      const near = units.filter(u => dist(u, g) < 900 && u.strength > 0.65 && u.morale > 0.6);
      const mine = near.reduce((a, u) => a + u.effective, 0);
      if (mine > g.strength * 1.8 && near.length >= 2) {
        for (const u of near.slice(0, 2)) {
          if (u.role === 'reserve') continue;
          this.send(u, makeOrder('ATTAQUER', { waypoints: [{ x: g.x, y: g.y }] }),
            'contre-attaque locale, rapport favorable');
        }
      }
    }

    // --- 5. rétablir ce qui a cédé ------------------------------------------
    // Un élément laminé n'est pas laissé en place : il se replie sur l'objectif.
    for (const u of units) {
      if (u.strength > 0.45 || u.role === 'reserve') continue;
      if (u.order && u.order.type === 'DEFENDRE' && dist(u, obj) < 400) continue;
      const px = obj.x + (u.x - obj.x) * 0.25;
      const py = obj.y + (u.y - obj.y) * 0.25;
      this.send(u, makeOrder('DEFENDRE', {
        target: { x: px, y: py }, waypoints: [{ x: px, y: py }], radius: 180,
      }), 'repli sur l’objectif, élément entamé');
    }
  }

  update(dt) {
    const w = this.world;
    this.collect();
    if (w.time >= this.nextThink) {
      // Le chef n'a pas les yeux partout en permanence : il décide par cycles.
      this.nextThink = w.time + (this.intact ? 25 + w.rng() * 20 : 60);
      this.think();
    }
  }

  // Résumé lisible, pour analyse depuis la console.
  summary() {
    return {
      pc: this.intact ? 'opérationnel' : 'hors service',
      posture: this.posture,
      contactsConnus: this.picture.size,
      axeEffort: this.mainAxis,
      reserveEngagee: this.reserveCommitted,
      dernieresDecisions: this.log.slice(-8).map(e => Math.round(e.t / 60) + 'min ' + e.text),
    };
  }
}

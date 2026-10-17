// Les postes radio de la tente.
//
// Le PC ne reçoit pas « le réseau » de façon abstraite : il reçoit six postes
// posés sur une table, chacun calé sur un réseau. Un poste éteint, c'est du
// trafic qui n'arrive jamais au chef — pas un message atténué, un message perdu.
// Le modèle est donc le point de passage obligé de tout ce qui se dit : il
// marque le message avant que le son, la voix et le journal ne le voient.

import { NETS } from './unit.js';

// Les deux familles en service. Le portatif tient le réseau de la section ;
// le poste de sac, plus puissant et large bande, tient le commandement et la 3D.
export const SET_TYPES = {
  'PRC-152': {
    ref: 'AN/PRC-152A',
    famille: 'Poste portatif',
    bande: '30 – 512 MHz',
    note: 'Portatif de combat, antenne fouet. Alimentation batterie.',
    puissance: 5,
    portee: 'Réseau de contact',
  },
  'PRC-117': {
    ref: 'AN/PRC-117G',
    famille: 'Poste de sac',
    bande: '30 – 2 000 MHz',
    note: 'Poste de sac large bande, combiné déporté. Portée et débit supérieurs.',
    puissance: 20,
    portee: 'Longue distance et 3D',
  },
};

// Râtelier de la table : un poste par réseau, dans l'ordre où ils sont posés.
// Le commandement et la 3D prennent les deux postes de sac ; les réseaux de
// contact se contentent des portatifs.
export const RACK = [
  { id: 'P1', type: 'PRC-117', net: 'CDT'  },
  { id: 'P2', type: 'PRC-117', net: 'AIR'  },
  { id: 'P3', type: 'PRC-152', net: 'MAN'  },
  { id: 'P4', type: 'PRC-152', net: 'APP'  },
  { id: 'P5', type: 'PRC-152', net: 'LOG'  },
  { id: 'P6', type: 'PRC-152', net: 'RECO' },
];

export class RadioSet {
  constructor(def) {
    this.id = def.id;
    this.type = def.type;
    this.net = def.net;
    this.spec = SET_TYPES[def.type];
    this.netInfo = NETS[def.net];
    this.freq = this.netInfo.freq;

    this.on = true;
    this.volume = 0.7;
    this.rxAt = -99;          // date de la dernière réception, pour la diode
    this.parleJusqu = -99;    // tant que quelqu'un parle, le poste reste éclairé
    this.last = null;         // dernier message entendu
    this.missed = 0;          // trafic perdu pendant que le poste était coupé
    this.heard = 0;
  }

  get label() { return this.netInfo.label; }
  get color() { return this.netInfo.color; }
  // Gain effectif : un poste coupé ne laisse rien passer.
  get gain() { return this.on ? this.volume : 0; }
}

export class RadioRack {
  constructor(world) {
    this.world = world;
    this.sets = RACK.map(d => new RadioSet(d));
    this.byNet = new Map(this.sets.map(s => [s.net, s]));

    // Premier abonné au trafic : le marquage doit précéder le son, la voix et
    // le journal, sinon un message coupé serait quand même lu à voix haute.
    world.on('radio', entry => this.receive(entry));
  }

  get(net) { return this.byNet.get(net) || null; }
  gainFor(net) { const s = this.byNet.get(net); return s ? s.gain : 1; }
  get anyOff() { return this.sets.some(s => !s.on); }
  get missedTotal() { return this.sets.reduce((a, s) => a + s.missed, 0); }

  setPower(id, on) {
    const s = this.sets.find(x => x.id === id);
    if (!s) return null;
    s.on = !!on;
    if (s.on) s.missed = 0;          // on reprend l'écoute, le retard est acté
    return s;
  }

  setVolume(id, v) {
    const s = this.sets.find(x => x.id === id);
    if (s) s.volume = Math.max(0, Math.min(1, v));
    return s;
  }

  // Tout le trafic passe ici. Un poste coupé perd le message : il est marqué
  // comme non reçu, et le journal du PC ne pourra en montrer que l'existence.
  receive(entry) {
    const s = this.byNet.get(entry.net);
    if (!s) return;
    if (!s.on) {
      entry.missed = true;
      s.missed++;
      return;
    }
    s.rxAt = this.world.time;
    // Durée approximative du message : c'est elle qui tient le rétroéclairage
    // allumé, pas un délai fixe — un poste s'illumine le temps qu'on y parle.
    s.parleJusqu = s.rxAt + Math.min(11, 2.2 + String(entry.text).length / 15);
    s.heard++;
    s.last = entry;
  }
}

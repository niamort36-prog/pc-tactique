// Ambiance sonore, entièrement synthétisée (Web Audio) : aucun fichier à charger.
//
// Trois familles :
//   - le « bip » de prise de parole radio, en tête de chaque message, dont la
//     tonalité dépend du réseau : on reconnaît le net à l'oreille ;
//   - les départs de coup, filtrés et atténués selon la distance au centre de
//     la vue, avec panoramique stéréo — on entend le combat là où on regarde ;
//   - le roulement des moteurs des véhicules proches, un lit sonore continu.

import { NETS } from '../sim/unit.js';

const MAX_VOICES = 14;          // polyphonie des coups de feu
const SHOT_BUDGET = 11;         // evenements sonores par seconde reelle
const AUDIBLE = 2400;           // portee sonore utile, en metres

// Tonalité du bip par réseau : chaque net a sa couleur sonore.
const NET_TONE = { CDT: 1180, MAN: 900, APP: 720, LOG: 1420, RECO: 1620, AIR: 2050 };

class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
    this.voices = 0;
    this.budget = SHOT_BUDGET;
    this.lastBudgetAt = 0;
    this.lastBeepAt = 0;
    this.engine = null;
  }

  // Les navigateurs refusent tout son avant un geste de l'utilisateur.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.ctx.destination);

    // bruit blanc réutilisé par toutes les détonations
    const n = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.buildStatic();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
    if (on) this.unlock();
  }
  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.value = v;
  }

  pan(value) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, value));
      return p;
    }
    return ctx.createGain();      // repli si le navigateur ne sait pas panoramiquer
  }

  // ---------------------------------------------------------------- radio

  // Clic de pédale, tonalité du réseau, puis souffle de squelch.
  // `gain` est le réglage du poste sur la table : à zéro, rien n'est joué.
  beep(net, quality = 1, gain = 1) {
    if (!this.ctx || !this.enabled || gain <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBeepAt < 0.12) return;
    this.lastBeepAt = now;

    const f = NET_TONE[net] || 1000;
    const out = this.ctx.createGain();
    out.gain.value = 0.30 * gain;
    out.connect(this.master);

    // 1. clic sec de prise de ligne
    this.burst(out, now, {
      dur: 0.02, peak: 0.5, band: 2600, q: 0.7, lpFrom: 6000, lpTo: 3000, body: 0,
    });

    // 2. tonalité du réseau
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const og = this.ctx.createGain();
    const t0 = now + 0.03;
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.16, t0 + 0.008);
    og.gain.setValueAtTime(0.16, t0 + 0.055);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    osc.connect(og); og.connect(lp); lp.connect(out);
    osc.start(t0); osc.stop(t0 + 0.10);

    // 3. souffle de squelch : d'autant plus long que la liaison est mauvaise
    const hiss = 0.05 + (1 - quality) * 0.16;
    this.burst(out, now + 0.115, {
      dur: hiss, peak: 0.10 + (1 - quality) * 0.22, band: 1700, q: 0.6,
      lpFrom: 3200, lpTo: 900, body: 0,
    });
  }

  // ---------------------------------------------------------------- feu

  // Brique commune : souffle filtré à enveloppe percussive, plus un corps grave.
  burst(dest, at, o) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = o.band;
    bp.Q.value = o.q;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(o.lpFrom, at);
    lp.frequency.exponentialRampToValueAtTime(Math.max(120, o.lpTo), at + o.dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(o.peak, at + 0.0025);
    g.gain.exponentialRampToValueAtTime(0.0004, at + o.dur);

    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(dest);
    src.start(at); src.stop(at + o.dur + 0.02);

    if (o.body) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(o.body, at);
      osc.frequency.exponentialRampToValueAtTime(o.body * 0.45, at + o.dur * 0.8);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at);
      og.gain.linearRampToValueAtTime(o.peak * 0.9, at + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0004, at + o.dur * 0.9);
      osc.connect(og); og.connect(dest);
      osc.start(at); osc.stop(at + o.dur + 0.02);
    }
  }

  // kind : 'small' (armes légères), 'auto' (rafale), 'cannon', 'mortar'
  shot(kind, gain, panValue) {
    if (!this.ctx || !this.enabled || gain <= 0.004) return;
    if (this.voices >= MAX_VOICES) return;
    this.voices++;
    setTimeout(() => { this.voices--; }, 900);

    const p = this.pan(panValue);
    const out = this.ctx.createGain();
    out.gain.value = gain;
    out.connect(p); p.connect(this.master);

    const now = this.ctx.currentTime;
    // la distance mange les aigus : un tir lointain n'est qu'un claquement sourd
    const far = 1 - Math.min(1, gain * 1.7);
    const hi = 5200 - far * 3800;

    if (kind === 'cannon') {
      this.burst(out, now, { dur: 0.42, peak: 0.95, band: 320, q: 0.5, lpFrom: hi * 0.5, lpTo: 160, body: 68 });
    } else if (kind === 'mortar') {
      this.burst(out, now, { dur: 0.70, peak: 0.85, band: 210, q: 0.4, lpFrom: hi * 0.4, lpTo: 110, body: 44 });
    } else if (kind === 'auto') {
      // rafale : 3 à 5 coups très rapprochés
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.burst(out, now + i * (0.055 + Math.random() * 0.02), {
          dur: 0.085, peak: 0.55, band: 1250, q: 0.75, lpFrom: hi, lpTo: 380, body: 96,
        });
      }
    } else {
      this.burst(out, now, { dur: 0.11, peak: 0.7, band: 1150, q: 0.7, lpFrom: hi, lpTo: 340, body: 88 });
    }
  }

  // Souffle de porteuse : il tourne en permanence à gain nul et ne monte que
  // pendant qu'une voix passe. C'est lui qui donne l'impression du poste radio,
  // la synthèse vocale ne pouvant pas être filtrée elle-même.
  buildStatic() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.7;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;

    const g = ctx.createGain();
    g.gain.value = 0;

    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(this.master);
    src.start();
    this.static = { gain: g };
  }

  setStatic(level) {
    if (!this.static || !this.ctx) return;
    this.static.gain.gain.setTargetAtTime(level * 0.20, this.ctx.currentTime, 0.06);
  }

  // ---------------------------------------------------------------- moteurs

  buildEngine() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 52;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 26;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 320;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;

    const ng = ctx.createGain(); ng.gain.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0;

    osc.connect(lp); sub.connect(lp);
    src.connect(nf); nf.connect(ng); ng.connect(lp);
    lp.connect(g); g.connect(this.master);

    osc.start(); sub.start(); src.start();
    this.engine = { osc, sub, gain: g, lp };
  }

  setEngine(level, pitch) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.engine.gain.gain.setTargetAtTime(level * 0.42, t, 0.25);
    this.engine.osc.frequency.setTargetAtTime(pitch, t, 0.4);
    this.engine.sub.frequency.setTargetAtTime(pitch * 0.5, t, 0.4);
    this.engine.lp.frequency.setTargetAtTime(180 + pitch * 2.2, t, 0.4);
  }

  // ---------------------------------------------------------------- boucle

  // Balaye l'état du monde et déclenche ce qui doit s'entendre.
  update(world, view) {
    if (!this.ctx || !this.enabled) return;

    const real = this.ctx.currentTime;
    if (real - this.lastBudgetAt > 1) { this.budget = SHOT_BUDGET; this.lastBudgetAt = real; }

    const c = view.map.getCenter();
    const centre = view.frame.toLocal(c.lat, c.lng);
    const halfW = Math.max(80, view.scale * view.map.getSize().x / 2);

    let engineLevel = 0, enginePitch = 50;

    for (const u of world.units) {
      if (u.destroyed) continue;
      const dx = u.x - centre.x, dy = u.y - centre.y;
      const d = Math.hypot(dx, dy);
      if (d > AUDIBLE) continue;

      const near = 1 - d / AUDIBLE;
      const gain = near * near;
      const panValue = Math.max(-1, Math.min(1, dx / halfW));

      // --- départs de coup ---
      if (world.time - u.lastFired < 0.5 && this.budget > 0) {
        const w = u.spec.weapon || {};
        // cadence sonore : on ne joue pas un evenement par pas de simulation
        const period = w.indirect ? 3.2 : Math.max(0.55, 90 / Math.max(4, w.rof));
        if (real - (u.sfxAt || -99) > period * (0.75 + Math.random() * 0.6)) {
          u.sfxAt = real;
          this.budget--;
          const kind = w.indirect ? 'mortar'
                     : u.spec.kind === 'vehicle' && w.aarmor > 1 ? 'cannon'
                     : w.rof > 14 ? 'auto' : 'small';
          this.shot(kind, gain * 0.85, panValue);
        }
      }

      // --- moteurs ---
      if (u.spec.kind === 'vehicle' && u.speed > 0.4) {
        const lvl = gain * Math.min(1, 0.35 + u.speed / 12);
        if (lvl > engineLevel) {
          engineLevel = lvl;
          enginePitch = 42 + u.speed * 2.6;
        }
      }
    }

    this.setEngine(engineLevel, enginePitch);
  }
}

export const sfx = new Sfx();

// Branche le bip radio sur le journal, et l'ouverture du contexte sur le premier geste.
export function bindAudio(world) {
  const unlock = () => sfx.unlock();
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  world.on('radio', entry => {
    if (entry.missed) return;                 // poste coupé : rien n'est arrivé
    const u = world.units.find(x => x.callsign === entry.from);
    const g = world.rack ? world.rack.gainFor(entry.net) : 1;
    sfx.beep(entry.net, u ? Math.max(0.15, u.link) : 1, g);
  });
}

export { NETS };

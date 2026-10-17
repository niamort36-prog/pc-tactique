// Utilitaires transverses : RNG déterministe, maths, bus d'événements.

export function makeRng(seed = 1234) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  // loi normale (Box-Muller)
  f.gauss = (mu = 0, sd = 1) => {
    const u = Math.max(1e-9, f()), v = f();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return f;
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const dist2 = (a, b) => (b.x - a.x) ** 2 + (b.y - a.y) ** 2;

// azimut OTAN : 0 = Nord, sens horaire, en degrés
export function azimuth(from, to) {
  const a = Math.atan2(to.x - from.x, to.y - from.y) * 180 / Math.PI;
  return (a + 360) % 360;
}
export const mils = deg => Math.round(deg * 6400 / 360);

export function formatClock(sec) {
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = Math.floor(sec) % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export function formatDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';
}

export class Emitter {
  constructor() { this._h = new Map(); }
  on(evt, fn) { (this._h.get(evt) || this._h.set(evt, []).get(evt)).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { const a = this._h.get(evt); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(evt, payload) { const a = this._h.get(evt); if (a) for (const fn of a.slice()) fn(payload); }
}

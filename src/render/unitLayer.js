// Rendu tactique : symboles OTAN, ordres, contacts, incertitude, appuis.

import { unitIcon, pointIcon, coarseType } from './symbols.js';
import { ORDERS } from '../sim/orders.js';
import { LVL } from '../sim/sensors.js';
import { NETS } from '../sim/unit.js';
import { formatDist, azimuth } from '../core/util.js';

const ICON = 30;

export class UnitLayer {
  constructor(canvas, view, world, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = view;
    this.world = world;
    this.ui = ui;
    this.options = {
      contours: false, trails: true, ranges: false, paths: true,
      labels: true, civilians: true, radio: false, grid: false,
    };
    this.contours = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    // Taille de mise en page, pas taille à l'écran : posée dans la tente,
    // l'interface est mise à l'échelle par transformation CSS, et un
    // getBoundingClientRect() renverrait le rectangle réduit. Le canevas
    // serait alors dimensionné une seconde fois et les symboles glisseraient
    // hors de la carte, qui raisonne, elle, en pixels de mise en page.
    const host = this.canvas.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
  }

  p(x, y) { const q = this.view.toPoint(x, y); return { x: q.x * this.dpr, y: q.y * this.dpr }; }
  m2px(m) { return m / this.view.scale * this.dpr; }

  draw() {
    const ctx = this.ctx, w = this.world;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Niveau de detail selon l'echelle : a petite echelle les etiquettes se
    // chevauchent en pate illisible. 2 = tout, 1 = indicatif seul, 0 = symbole seul.
    const mpp = this.view.scale;
    this.lod = mpp < 2.5 ? 2 : mpp < 9 ? 1 : 0;
    this.iconSize = this.lod === 0 ? 18 : this.lod === 1 ? 25 : ICON;
    this.boxes = [];                       // etiquettes deja posees cette image

    if (this.options.grid) this.drawGrid();
    if (this.options.contours) this.drawContours();
    this.drawObjective();
    if (this.options.radio) this.drawRadio();
    this.drawMarkers();
    this.drawOrders();
    if (this.options.trails) this.drawTrails();
    this.drawFires();
    this.drawContacts();
    if (this.options.civilians) this.drawCivilians();
    this.drawFriendlies();
    this.drawPending();
    this.drawPlacement();
    this.drawHq();
    this.drawAirBases();
  }

  // ---------------------------------------------------------------- fonds

  drawContours() {
    if (!this.contours) this.contours = this.view.contourSegments(10);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 86, 48, 0.55)';
    ctx.lineWidth = 1 * this.dpr;
    ctx.beginPath();
    for (const s of this.contours) {
      const a = this.p(s.a.x, s.a.y), b = this.p(s.b.x, s.b.y);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Grille de coordonnées, calée sur le carroyage kilométrique du repère local.
  // Les carreaux de 1 km portent leur amorce à deux chiffres, comme sur une carte
  // d'état-major ; les subdivisions de 100 m n'apparaissent qu'une fois zoomé.
  drawGrid() {
    const ctx = this.ctx, t = this.world.terrain, mpp = this.view.scale;
    const half = t.half;
    const fine = mpp < 1.2;                        // 100 m lisibles seulement de près
    const step = fine ? 100 : 1000;

    // bornes visibles, arrondies au pas
    const tl = this.view.toLocal(L.point(0, 0));
    const br = this.view.toLocal(L.point(this.canvas.width / this.dpr, this.canvas.height / this.dpr));
    const x0 = Math.max(-half, Math.floor(Math.min(tl.x, br.x) / step) * step);
    const x1 = Math.min(half, Math.ceil(Math.max(tl.x, br.x) / step) * step);
    const y0 = Math.max(-half, Math.floor(Math.min(tl.y, br.y) / step) * step);
    const y1 = Math.min(half, Math.ceil(Math.max(tl.y, br.y) / step) * step);
    if ((x1 - x0) / step > 400 || (y1 - y0) / step > 400) return;   // garde-fou

    ctx.save();
    const drawLines = (pas, couleur, epaisseur) => {
      ctx.strokeStyle = couleur;
      ctx.lineWidth = epaisseur * this.dpr;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / pas) * pas; x <= x1; x += pas) {
        const a = this.p(x, y0), b = this.p(x, y1);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      for (let y = Math.ceil(y0 / pas) * pas; y <= y1; y += pas) {
        const a = this.p(x0, y), b = this.p(x1, y);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    };

    if (fine) drawLines(100, 'rgba(20, 30, 45, 0.16)', 0.8);
    drawLines(1000, 'rgba(20, 40, 70, 0.42)', 1.4);

    // amorces : deux chiffres du carreau kilométrique, en bord de vue
    ctx.font = '600 ' + (10 * this.dpr) + 'px "Consolas", monospace';
    ctx.textBaseline = 'top';
    const amorce = v => String(Math.floor((v + 100000) / 1000) % 100).padStart(2, '0');
    for (let x = Math.ceil(x0 / 1000) * 1000; x <= x1; x += 1000) {
      const q = this.p(x, y1);
      ctx.textAlign = 'left';
      this.label(amorce(x), q.x + 3 * this.dpr, 3 * this.dpr, '#2e4c72', 10, 'left', true);
    }
    for (let y = Math.ceil(y0 / 1000) * 1000; y <= y1; y += 1000) {
      const q = this.p(x0, y);
      this.label(amorce(y), 3 * this.dpr, q.y + 3 * this.dpr, '#2e4c72', 10, 'left', true);
    }
    ctx.restore();
  }

  drawObjective() {
    const o = this.world.objective;
    if (!o) return;
    const ctx = this.ctx, c = this.p(o.x, o.y), r = this.m2px(o.radius);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 212, 94, 0.85)';
    ctx.lineWidth = 2 * this.dpr;
    ctx.setLineDash([10 * this.dpr, 7 * this.dpr]);
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    this.label(o.name, c.x, c.y - r - 6 * this.dpr, '#ffd45e', 13, 'center');
    ctx.restore();
  }

  drawRadio() {
    const ctx = this.ctx;
    ctx.save();
    for (const u of this.world.units) {
      if (u.side !== 'BLUFOR' || u.destroyed) continue;
      const a = this.p(u.x, u.y), b = this.p(this.world.hq.x, this.world.hq.y);
      const q = u.link || 0;
      ctx.strokeStyle = q > 0.5 ? 'rgba(120,255,160,0.30)' : q > 0.05 ? 'rgba(255,200,80,0.35)' : 'rgba(255,80,80,0.45)';
      ctx.lineWidth = (q > 0.05 ? 1 : 2) * this.dpr;
      ctx.setLineDash(q > 0.5 ? [] : [4 * this.dpr, 5 * this.dpr]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawMarkers() {
    for (const m of this.world.intel.markers) {
      const img = pointIcon(m.kind, 'friend');
      const c = this.p(m.x, m.y);
      if (img && img.complete && img.naturalWidth) {
        const s = 26 * this.dpr;
        this.ctx.drawImage(img, c.x - s / 2, c.y - s / 2, s, s);
      }
      if (m.label) this.label(m.label, c.x, c.y + 18 * this.dpr, '#cfe6ff', 11, 'center');
    }
  }

  // ---------------------------------------------------------------- ordres

  drawOrders() {
    if (!this.options.paths) return;
    const ctx = this.ctx;
    for (const u of this.world.units) {
      if (u.side !== 'BLUFOR' || u.destroyed || !u.order) continue;
      const sel = this.ui.selection.has(u.id);
      const spec = ORDERS[u.order.type];
      const alpha = sel ? 1 : 0.42;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = (sel ? 2.4 : 1.5) * this.dpr;

      // itinéraire calculé
      if (u.path && u.pathIdx < u.path.length) {
        ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
        ctx.beginPath();
        const s = this.p(u.x, u.y);
        ctx.moveTo(s.x, s.y);
        for (let i = u.pathIdx; i < u.path.length; i++) {
          const q = this.p(u.path[i].x, u.path[i].y);
          ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // points de passage de la mission
      const wps = u.order.waypoints;
      if (wps.length) {
        ctx.beginPath();
        const s = this.p(u.x, u.y);
        ctx.moveTo(s.x, s.y);
        for (const wp of wps) { const q = this.p(wp.x, wp.y); ctx.lineTo(q.x, q.y); }
        ctx.globalAlpha = alpha * 0.55;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        for (let i = 0; i < wps.length; i++) {
          const q = this.p(wps[i].x, wps[i].y);
          const last = i === wps.length - 1;
          this.orderIcon(spec, q, last ? 26 : 18);
        }
      }
      const zone = u.order.target || wps[wps.length - 1];
      if (zone && u.order.radius > 0) {
        const c = this.p(zone.x, zone.y);
        ctx.globalAlpha = alpha * 0.7;
        ctx.setLineDash([5 * this.dpr, 6 * this.dpr]);
        ctx.beginPath(); ctx.arc(c.x, c.y, this.m2px(u.order.radius), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        if (!wps.length) this.orderIcon(spec, c, 26);
      }
      // Axe de pénétration d'une passe de tir : flèche entrant sur l'objectif.
      if (u.order.type === 'PASSE' && u.order.memo && u.order.memo.axis) {
        const aim = u.order.target || wps[0];
        const ax = u.order.memo.axis;
        if (aim) {
          const back = this.p(aim.x - ax.x * 2600, aim.y - ax.y * 2600);
          const at = this.p(aim.x, aim.y);
          ctx.globalAlpha = alpha;
          ctx.setLineDash([]);
          ctx.lineWidth = 2.6 * this.dpr;
          ctx.beginPath(); ctx.moveTo(back.x, back.y); ctx.lineTo(at.x, at.y); ctx.stroke();
          const ang = Math.atan2(at.y - back.y, at.x - back.x);
          const hs = 10 * this.dpr;
          ctx.beginPath();
          ctx.moveTo(at.x, at.y);
          ctx.lineTo(at.x - Math.cos(ang - 0.4) * hs, at.y - Math.sin(ang - 0.4) * hs);
          ctx.moveTo(at.x, at.y);
          ctx.lineTo(at.x - Math.cos(ang + 0.4) * hs, at.y - Math.sin(ang + 0.4) * hs);
          ctx.stroke();
          if (this.lod >= 1) {
            this.label('axe ' + u.order.memo.bearing + '°', back.x, back.y - 12 * this.dpr, spec.color, 10, 'center');
          }
        }
      }

      if (u.order.targetUnit != null) {
        const t = this.world.byId.get(u.order.targetUnit);
        if (t) {
          const a = this.p(u.x, u.y), b = this.p(t.x, t.y);
          ctx.setLineDash([3 * this.dpr, 5 * this.dpr]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
  }

  orderIcon(spec, q, size) {
    const img = pointIcon(spec.icon, 'friend');
    const s = size * this.dpr;
    if (img && img.complete && img.naturalWidth) {
      this.ctx.drawImage(img, q.x - s / 2, q.y - s / 2, s, s);
    } else {
      this.ctx.beginPath();
      this.ctx.arc(q.x, q.y, s / 3, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  drawTrails() {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1.2 * this.dpr;
    for (const u of this.world.units) {
      if (u.destroyed || u.trail.length < 2) continue;
      if (u.side === 'BLUFOR') ctx.strokeStyle = 'rgba(120, 190, 255, 0.28)';
      else continue;
      ctx.beginPath();
      const t0 = this.p(u.trail[0].x, u.trail[0].y);
      ctx.moveTo(t0.x, t0.y);
      for (const t of u.trail) { const q = this.p(t.x, t.y); ctx.lineTo(q.x, q.y); }
      const now = this.p(u.x, u.y);
      ctx.lineTo(now.x, now.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Traits de feu, impacts et hommes tombés.
  //
  // Le trait n'est tracé que si le tireur est connu de nous : quand une unité
  // encaisse d'un ennemi non repéré, seul l'impact apparaît — c'est précisément
  // l'information que le chef possède, et ce qui rend la situation lisible.
  drawFires() {
    const ctx = this.ctx, w = this.world;
    ctx.save();
    for (const e of w.effects.active()) {
      const life = 1 - (w.time - e.t) / e.ttl;
      if (life <= 0) continue;

      if (e.type === 'shot') {
        const known = e.side === 'BLUFOR' || w.intel.contacts.has(e.id);
        if (!known) continue;
        const a = this.p(e.x, e.y), b = this.p(e.x2, e.y2);
        const blue = e.side === 'BLUFOR';
        const wide = e.kind === 'indirect' ? 3.2 : e.kind === 'heavy' ? 2.4 : 1.4;

        // halo large puis cœur clair : le trait se lit même sur fond chargé
        ctx.globalAlpha = life * 0.35;
        ctx.strokeStyle = blue ? '#3f8fd8' : '#d8452f';
        ctx.lineWidth = (wide + 2.6) * this.dpr;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

        ctx.globalAlpha = life;
        ctx.strokeStyle = blue ? '#bfe4ff' : '#ffc9a8';
        ctx.lineWidth = wide * this.dpr;
        ctx.setLineDash(e.kind === 'indirect' ? [10 * this.dpr, 7 * this.dpr] : []);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);

        // départ de coup
        ctx.fillStyle = blue ? '#e8f6ff' : '#ffd9b0';
        ctx.beginPath(); ctx.arc(a.x, a.y, 3 * this.dpr * life + 1, 0, Math.PI * 2); ctx.fill();

      } else if (e.type === 'missile') {
        // Le missile se voit voler : position interpolée, fumée derrière lui.
        const f = Math.min(1, (w.time - e.t) / e.flight);
        const hx = e.x + (e.x2 - e.x) * f, hy = e.y + (e.y2 - e.y) * f;
        const tailF = Math.max(0, f - 0.35);
        const tx0 = e.x + (e.x2 - e.x) * tailF, ty0 = e.y + (e.y2 - e.y) * tailF;
        const a = this.p(tx0, ty0), h = this.p(hx, hy);
        ctx.globalAlpha = 0.55 * (f < 1 ? 1 : Math.max(0, 1 - (f - 1) * 3));
        ctx.strokeStyle = '#e8e8e8';
        ctx.lineWidth = 2.6 * this.dpr;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(h.x, h.y); ctx.stroke();
        if (f < 1) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff0c0';
          ctx.beginPath(); ctx.arc(h.x, h.y, 3.4 * this.dpr, 0, Math.PI * 2); ctx.fill();
        }

      } else if (e.type === 'impact') {
        const p = this.p(e.x, e.y);
        const r = (e.heavy ? 13 : 7) * this.dpr * (1.25 - life * 0.5);
        ctx.globalAlpha = life * 0.85;
        ctx.strokeStyle = e.heavy ? '#ffd27a' : '#ffb060';
        ctx.lineWidth = 2 * this.dpr;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();

      } else if (e.type === 'casualty') {
        const p = this.p(e.x, e.y);
        const s = 5.5 * this.dpr;
        ctx.globalAlpha = Math.min(1, life * 2.2);
        ctx.strokeStyle = e.side === 'BLUFOR' ? (e.killed ? '#ff5a5a' : '#ffa85a')
                                              : (e.killed ? '#c86a6a' : '#a8845a');
        ctx.lineWidth = 2.4 * this.dpr;
        ctx.beginPath();
        ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
        ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Cible de l'élément sélectionné : liaison explicite tireur → but.
    for (const id of this.ui.selection) {
      const u = w.byId.get(id);
      if (!u || u.destroyed || u.engaging == null) continue;
      if (w.time - u.lastFired > 6) continue;
      const t = w.byId.get(u.engaging);
      if (!t) continue;
      const b = this.p(t.x, t.y);
      const r = 17 * this.dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8 * this.dpr;
      ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x - r - 5 * this.dpr, b.y); ctx.lineTo(b.x - r + 3 * this.dpr, b.y);
      ctx.moveTo(b.x + r + 5 * this.dpr, b.y); ctx.lineTo(b.x + r - 3 * this.dpr, b.y);
      ctx.moveTo(b.x, b.y - r - 5 * this.dpr); ctx.lineTo(b.x, b.y - r + 3 * this.dpr);
      ctx.moveTo(b.x, b.y + r + 5 * this.dpr); ctx.lineTo(b.x, b.y + r - 3 * this.dpr);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- contacts

  drawContacts() {
    const ctx = this.ctx, w = this.world;
    for (const c of w.intel.contacts.values()) {
      const p = this.p(c.x, c.y);
      const age = w.time - c.lastFresh;
      const fade = Math.max(0.25, 1 - age / 240);
      ctx.save();
      ctx.globalAlpha = fade;

      // ellipse d'incertitude
      const r = this.m2px(Math.max(20, c.err));
      ctx.strokeStyle = c.level >= LVL.IDENT ? 'rgba(255, 90, 70, 0.55)' : 'rgba(255, 205, 80, 0.55)';
      ctx.fillStyle = c.level >= LVL.IDENT ? 'rgba(255, 90, 70, 0.10)' : 'rgba(255, 205, 80, 0.10)';
      ctx.lineWidth = 1.2 * this.dpr;
      ctx.setLineDash([4 * this.dpr, 4 * this.dpr]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);

      let img = null, size = this.iconSize;
      if (c.level >= LVL.IDENT && c.type) {
        img = unitIcon(c.type, 'hostile');
      } else if (c.level === LVL.SEEN) {
        const real = w.byId.get(c.id);
        img = unitIcon(coarseType(real ? real.type : 'infantry'), 'unknown');
      } else {
        img = pointIcon('contact point', 'friend');
        size = 22;
      }
      if (img && img.complete && img.naturalWidth) {
        const s = size * this.dpr;
        ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      }

      if (this.options.labels && this.lod >= 1) {
        const lvlTxt = c.level >= LVL.IDENT ? 'IDENT' : c.level === LVL.SEEN ? 'VU' : 'ENTENDU';
        const n = c.strength ? c.strength + ' pax' : '?';
        this.place(lvlTxt + ' · ' + n, p.x, p.y + size * 0.62 * this.dpr, '#ffd08a', 10, 'center', false, false);
        if (this.lod >= 2 && age > 25) {
          this.label('+' + Math.round(age) + 's · ' + c.reporter, p.x, p.y + (size * 0.62 + 11) * this.dpr, '#c09a60', 9, 'center');
        }
      }
      ctx.restore();
    }
  }

  drawCivilians() {
    const ctx = this.ctx;
    for (const u of this.world.units) {
      if (u.side !== 'CIV' || u.destroyed) continue;
      // les civils ne sont visibles que si un de nos éléments les a vus
      if (!this.civSeen(u)) continue;
      const p = this.p(u.x, u.y);
      const img = unitIcon('infantry', 'neutral');
      ctx.save();
      ctx.globalAlpha = 0.85;
      if (img && img.complete && img.naturalWidth) {
        const s = 22 * this.dpr;
        ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
      }
      if (this.options.labels && this.lod >= 2) this.label('civils ×' + u.alive, p.x, p.y + 15 * this.dpr, '#b9d69a', 9, 'center');
      ctx.restore();
    }
  }

  civSeen(civ) {
    const w = this.world;
    for (const u of w.units) {
      if (u.side !== 'BLUFOR' || u.destroyed) continue;
      const c = u.contacts.get(civ.id);
      if (c && c.level >= LVL.SEEN && w.time - c.lastSeen < 25) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- amis

  drawFriendlies() {
    const ctx = this.ctx, w = this.world;
    // Les elements selectionnes sont traites en premier : leur etiquette est
    // prioritaire et repousse celle des voisins, jamais l'inverse.
    const order = w.units.filter(u => u.side === 'BLUFOR')
      .sort((a, b) => (this.ui.selection.has(b.id) ? 1 : 0) - (this.ui.selection.has(a.id) ? 1 : 0));
    for (const u of order) {
      if (u.mountedIn != null) continue;       // dessiné par son porteur
      const p = this.p(u.x, u.y);
      const sel = this.ui.selection.has(u.id);

      ctx.save();
      if (u.destroyed) ctx.globalAlpha = 0.35;

      if (sel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * this.dpr;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.iconSize * 0.75 * this.dpr, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (this.options.ranges && sel && u.spec.weapon.range) {
        ctx.strokeStyle = 'rgba(120, 200, 255, 0.30)';
        ctx.setLineDash([3 * this.dpr, 6 * this.dpr]);
        ctx.lineWidth = 1 * this.dpr;
        ctx.beginPath(); ctx.arc(p.x, p.y, this.m2px(u.spec.weapon.range), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // secteur d'observation
      if (u.speed < 0.4 && !u.destroyed && this.lod >= 1) {
        const a = (u.heading - 90) * Math.PI / 180;
        const spread = 0.8;
        const rr = this.m2px(180);
        ctx.fillStyle = 'rgba(140, 200, 255, 0.10)';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.arc(p.x, p.y, rr, a - spread, a + spread);
        ctx.closePath();
        ctx.fill();
      }

      const img = unitIcon(u.type, 'friend');
      const s = this.iconSize * this.dpr;
      if (img && img.complete && img.naturalWidth) ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);

      // véhicule chargé : nombre de pax
      if (u.cargo.length && this.lod >= 1) {
        const n = u.cargo.reduce((a, id) => a + (w.byId.get(id) ? w.byId.get(id).alive : 0), 0);
        this.badge('▲ ' + n, p.x + s * 0.5, p.y - s * 0.5, '#9fe07f');
      }
      if (this.lod >= 1) {
        if (u.inBuilding != null) this.badge('⌂', p.x - s * 0.55, p.y - s * 0.5, '#ffd45e');
        if (u.commsLost || u.link < 0.06) this.badge('✖ RAD', p.x - s * 0.5, p.y + s * 0.55, '#ff7a6a');
        else if (u.link < 0.35) this.badge('~ RAD', p.x - s * 0.5, p.y + s * 0.55, '#ffbe5e');
      }

      // Un element selectionne garde sa fiche complete quelle que soit l'echelle.
      const detail = sel ? 2 : this.lod;
      if (this.options.labels && detail >= 1) {
        this.place(u.callsign, p.x, p.y - s * 0.62 - 12 * this.dpr, '#e8f2ff', 12, 'center', true, sel);
        if (detail >= 2) {
          const net = NETS[u.net] || NETS.CDT;
          this.label(u.freq.toFixed(3) + ' · ' + u.net, p.x, p.y + s * 0.62, net.color, 10, 'center');
          this.label(u.condition, p.x, p.y + s * 0.62 + 11 * this.dpr, conditionColor(u), 9.5, 'center');
          this.bars(u, p.x, p.y + s * 0.62 + 22 * this.dpr);
        }
      }
      ctx.restore();
    }
  }

  bars(u, cx, cy) {
    const ctx = this.ctx;
    const w = 34 * this.dpr, h = 3 * this.dpr, gap = 4 * this.dpr;
    const rows = [
      [u.strength, '#7fe08a'],
      [1 - u.fatigue, '#ffd45e'],
      [u.ammo, '#8fd0ff'],
    ];
    let y = cy;
    for (const [v, col] of rows) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(cx - w / 2, y, w, h);
      ctx.fillStyle = col;
      ctx.fillRect(cx - w / 2, y, w * Math.max(0, Math.min(1, v)), h);
      y += h + gap - 2 * this.dpr;
    }
  }

  drawHq() {
    const hq = this.world.hq;
    if (!hq) return;
    const p = this.p(hq.x, hq.y);
    const img = pointIcon('structure fob', 'friend');
    const s = this.iconSize * this.dpr;
    if (img && img.complete && img.naturalWidth) this.ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    if (this.lod >= 1) this.label('PC ZULU', p.x, p.y + s * 0.6, '#ffd45e', 11, 'center', true);
  }

  // Aperçu de l'implantation du PC pendant la phase de choix.
  drawPlacement() {
    const pl = this.placement;
    if (!pl) return;
    const ctx = this.ctx, p = this.p(pl.x, pl.y);
    const ok = !pl.problem;
    const col = ok ? '#8fe0a0' : '#ff7a6a';

    // cercle de distance minimale autour de l'objectif
    const o = this.world.objective;
    if (o && pl.minDist) {
      const c = this.p(o.x, o.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 122, 106, 0.45)';
      ctx.setLineDash([6 * this.dpr, 6 * this.dpr]);
      ctx.lineWidth = 1.4 * this.dpr;
      ctx.beginPath(); ctx.arc(c.x, c.y, this.m2px(pl.minDist), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    const img = pointIcon('structure fob', 'friend');
    const s = 30 * this.dpr;
    ctx.globalAlpha = ok ? 1 : 0.55;
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2 * this.dpr;
    ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.8, 0, Math.PI * 2); ctx.stroke();

    // liaison vers l'objectif, avec la distance
    if (o) {
      const c = this.p(o.x, o.y);
      ctx.strokeStyle = 'rgba(255, 212, 94, 0.55)';
      ctx.setLineDash([5 * this.dpr, 7 * this.dpr]);
      ctx.lineWidth = 1.6 * this.dpr;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.setLineDash([]);
      const d = Math.hypot(pl.x - o.x, pl.y - o.y);
      this.label(formatDist(d) + ' de l’objectif', (p.x + c.x) / 2, (p.y + c.y) / 2 - 14 * this.dpr,
                 '#ffd45e', 11, 'center', true);
    }
    this.label(ok ? 'PC ZULU ici' : pl.problem, p.x, p.y + s * 0.85, col, 12, 'center', true);
    ctx.restore();
  }

  // Terrains d'aviation détectés sur la carte, et FARP des voilures tournantes.
  drawAirBases() {
    const w = this.world;
    const mark = (p, iconKind, label, color) => {
      const q = this.p(p.x, p.y);
      const img = pointIcon(iconKind, 'friend');
      const s = 26 * this.dpr;
      if (img && img.complete && img.naturalWidth) this.ctx.drawImage(img, q.x - s / 2, q.y - s / 2, s, s);
      if (this.lod >= 1) this.label(label, q.x, q.y + s * 0.6, color, 10.5, 'center', true);
    };
    if (w.farp) mark(w.farp, 'rearm point', w.farp.name, '#7fffd4');
    for (const f of (w.airfields || [])) {
      mark(f, 'structure outpost', f.name + (f.runway ? ' · piste ' + f.runway + ' m' : ''), '#9fd8ff');
    }
  }

  // aperçu de l'ordre en cours de saisie
  drawPending() {
    const pend = this.ui.pending;
    if (!pend) return;
    const ctx = this.ctx;
    const spec = ORDERS[pend.type];
    ctx.save();
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 2 * this.dpr;
    ctx.setLineDash([7 * this.dpr, 5 * this.dpr]);

    const origin = [];
    for (const id of this.ui.selection) {
      const u = this.world.byId.get(id);
      if (u) origin.push(this.p(u.x, u.y));
    }
    const pts = pend.waypoints.map(p2 => this.p(p2.x, p2.y));
    if (pend.cursor) pts.push(this.p(pend.cursor.x, pend.cursor.y));

    for (const o of origin) {
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      for (const q of pts) ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const q of pts) this.orderIcon(spec, q, 22);

    if (spec.needs === 'zone' && pts.length) {
      const c = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(c.x, c.y, this.m2px(pend.radius || spec.radius || 120), 0, Math.PI * 2);
      ctx.stroke();
    }
    // distance et azimut depuis le premier sélectionné
    if (origin.length && pts.length) {
      const u = this.world.byId.get([...this.ui.selection][0]);
      const last = pend.cursor || pend.waypoints[pend.waypoints.length - 1];
      if (u && last) {
        const d = Math.hypot(last.x - u.x, last.y - u.y);
        const az = Math.round(azimuth(u, last));
        const q = pts[pts.length - 1];
        this.label(formatDist(d) + ' · az ' + az, q.x, q.y - 20 * this.dpr, spec.color, 12, 'center', true);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- texte

  // Pose une etiquette en evitant celles deja placees : on essaie quelques
  // decalages verticaux, puis on renonce (sauf si elle est prioritaire).
  place(text, x, y, color, size, align, bold, forced) {
    const ctx = this.ctx;
    ctx.font = (bold ? '600 ' : '') + (size * this.dpr) + 'px "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(text).width;
    const h = size * this.dpr * 1.25;
    const half = align === 'center' ? w / 2 : 0;

    const dy = h + 2 * this.dpr;
    const tries = forced ? [0] : [0, dy, -dy, 2 * dy, -2 * dy, 3 * dy];
    for (const off of tries) {
      const box = { x0: x - half - 2, y0: y + off, x1: x - half + w + 2, y1: y + off + h };
      let hit = false;
      for (const b of this.boxes) {
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { hit = true; break; }
      }
      if (!hit || forced) {
        this.boxes.push(box);
        this.label(text, x, y + off, color, size, align, bold);
        return true;
      }
    }
    return false;
  }

  label(text, x, y, color, size, align = 'left', bold = false) {
    const ctx = this.ctx;
    ctx.font = (bold ? '600 ' : '') + (size * this.dpr) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * this.dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  badge(text, x, y, color) {
    const ctx = this.ctx;
    ctx.font = '600 ' + (9 * this.dpr) + 'px "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(text).width + 6 * this.dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(x, y, w, 12 * this.dpr);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x + 3 * this.dpr, y + 1.5 * this.dpr);
  }

  // sélection au clic
  pick(containerPoint) {
    const target = this.view.toLocal(containerPoint);
    let best = null, bestD = 40 * this.view.scale;
    for (const u of this.world.units) {
      if (u.side !== 'BLUFOR' || u.destroyed || u.mountedIn != null) continue;
      const d = Math.hypot(u.x - target.x, u.y - target.y);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }
}

function conditionColor(u) {
  switch (u.condition) {
    case 'OPÉRATIONNEL': return '#8fe0a0';
    case 'AU CONTACT': return '#d8e08f';
    case 'GAGNE LE COUVERT': return '#ffc46a';
    case 'FIXÉ': return '#ff9d5e';
    case 'REPLI': return '#ff7a4a';
    case 'DÉROUTE': return '#ff4a4a';
    case 'RECONSTITUTION': return '#9dc0ff';
    case 'HORS DE COMBAT': return '#a06a6a';
    case 'ENTAMÉ': return '#e0d88f';
    case 'ÉPUISÉ': return '#ffc46a';
    case 'MUNITIONS': return '#ffb04a';
    case 'ÉPROUVÉ': return '#ff8f6a';
    case 'CLOUÉ': return '#ff6a6a';
    case 'ROMPU': return '#ff4a4a';
    default: return '#888';
  }
}

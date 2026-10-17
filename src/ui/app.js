// Interface du poste de commandement : ordre de bataille, ordres, journal radio.

import { ORDERS, ORDER_KEYS, makeOrder, describeOrder, PHASE_FR } from '../sim/orders.js';
import { unitIcon, pointIcon } from '../render/symbols.js';
import { NETS } from '../sim/unit.js';
import { CATALOG, POSTURE, ROE } from '../sim/catalog.js';
import { formatClock, formatDist, azimuth, clamp } from '../core/util.js';
import { WEATHER } from '../sim/world.js';
import { occupiedSeats } from '../sim/ai.js';
import { TERRAIN } from '../world/terrain.js';
import { gridRef } from '../core/geo.js';
import { sfx } from '../render/audio.js';
import { voice } from '../render/voice.js';
import { TYPE_FR } from '../sim/intel.js';
import { bingoFuel } from '../sim/flight.js';

const $ = s => document.querySelector(s);

// Date sur zone, en clair.
const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

export class UI {
  constructor(world, view, layer) {
    this.world = world;
    this.view = view;
    this.layer = layer;
    this.selection = new Set();
    this.pending = null;
    this.speed = 1;
    this.logFilter = 'ALL';
    this.zoneRadius = 120;

    this.bindTop();
    this.bindMap();
    this.bindKeys();
    this.bindLog();

    world.on('radio', () => { this.logDirty = true; });
    this.renderNets();
    this.renderOob();
    this.renderDetail();
    this.renderLog();
  }

  // ------------------------------------------------------------ barre haute

  bindTop() {
    for (const b of document.querySelectorAll('.sp')) {
      b.onclick = () => {
        this.speed = +b.dataset.speed;
        document.querySelectorAll('.sp').forEach(x => x.classList.toggle('active', x === b));
      };
    }
    $('#basemap').onchange = e => this.view.setBase(e.target.value);

    const bind = (id, fn) => { $(id).onchange = e => fn(e.target.checked); };
    bind('#ly-terrain', on => this.toggleOverlay('terrain', on));
    bind('#ly-relief', on => this.toggleOverlay('relief', on));
    bind('#ly-contours', on => { this.layer.options.contours = on; });
    bind('#ly-grid', on => { this.layer.options.grid = on; });
    bind('#ly-radio', on => { this.layer.options.radio = on; });
    bind('#ly-ranges', on => { this.layer.options.ranges = on; });

    const sndOn = $('#snd-on'), sndVol = $('#snd-vol');
    sndOn.onchange = e => sfx.setEnabled(e.target.checked);
    sndVol.oninput = e => sfx.setVolume(+e.target.value / 100);
    sfx.setVolume(+sndVol.value / 100);
    sfx.setEnabled(sndOn.checked);

    const vOn = $('#voice-on');
    vOn.onchange = e => voice.setEnabled(e.target.checked);
    voice.setEnabled(vOn.checked);
    if (!voice.available) {
      vOn.disabled = true;
      vOn.parentElement.title = 'Synthèse vocale indisponible sur ce navigateur';
    }
  }

  toggleOverlay(name, on) {
    const map = this.view.map;
    let ov = this.view.overlays[name];
    if (!ov) {
      ov = name === 'terrain' ? this.view.buildTerrainOverlay() : this.view.buildReliefOverlay();
    }
    if (on) ov.addTo(map); else map.removeLayer(ov);
  }

  // ------------------------------------------------------------ carte

  bindMap() {
    const map = this.view.map;

    map.on('click', e => {
      const cp = e.containerPoint;
      // phase d'implantation : le clic sert à poser le PC, rien d'autre
      if (this.placing) return this.placing(this.view.toLocal(cp));
      if (this.pending) return this.onOrderClick(cp, e.originalEvent);
      const u = this.layer.pick(cp);
      if (u) {
        if (e.originalEvent.ctrlKey || e.originalEvent.shiftKey) {
          if (this.selection.has(u.id)) this.selection.delete(u.id); else this.selection.add(u.id);
        } else {
          this.selection.clear(); this.selection.add(u.id);
        }
      } else if (!e.originalEvent.ctrlKey) {
        this.selection.clear();
      }
      this.renderOob(); this.renderDetail();
    });

    map.on('mousemove', e => {
      const p = this.view.toLocal(e.containerPoint);
      if (this.placing && this.onPlaceMove) this.onPlaceMove(p);
      if (this.pending) this.pending.cursor = p;
      this.showCursor(p);
    });

    const el = map.getContainer();
    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const cp = L.point(ev.clientX - rect.left, ev.clientY - rect.top);
      if (this.pending) {
        this.commitPending();
      } else if (this.selection.size) {
        const p = this.view.toLocal(cp);
        this.issue(makeOrder('MOUVEMENT', { waypoints: [p] }));
      }
    });
  }

  showCursor(p) {
    const t = this.world.terrain;
    const inside = t.inside(p.x, p.y);
    const info = inside ? TERRAIN[t.typeAt(p.x, p.y)] : null;
    const b = inside ? t.buildingAt(p.x, p.y) : -1;
    const g = this.world.frame.toGeo(p.x, p.y);
    $('#cursor-info').textContent = inside
      ? gridRef(this.world.frame, p.x, p.y) + '  ·  ' + g.lat.toFixed(5) + ' ' + g.lon.toFixed(5) +
        '  ·  ' + Math.round(t.elevAt(p.x, p.y)) + ' m  ·  ' +
        (b >= 0 ? 'Bâtiment' : info.name)
      : 'hors zone';
  }

  // ------------------------------------------------------------ ordres

  startOrder(type) {
    if (!this.selection.size) return;
    const spec = ORDERS[type];
    // vérifie que les unités sélectionnées peuvent recevoir cet ordre
    const units = this.units();
    if (type === 'EMBARQUER' && units.every(u => u.spec.kind !== 'squad')) return;

    if (spec.needs === 'auto') {
      this.issue(makeOrder(type));
      return;
    }
    this.pending = { type, waypoints: [], cursor: null, radius: this.zoneRadius };
    this.hint(spec.label.toUpperCase() + ' — ' + spec.hint +
      (spec.needs === 'route' ? ' | Clic gauche : point de passage · Clic droit : valider · Échap : annuler'
       : spec.needs === 'zone' ? ' | Clic gauche : centre de zone · molette : rayon · Échap : annuler'
       : ' | Clic gauche sur l’élément ami · Échap : annuler'));
    this.renderOrders();
  }

  onOrderClick(cp, ev) {
    const spec = ORDERS[this.pending.type];
    const p = this.view.toLocal(cp);
    if (spec.needs === 'unit') {
      const u = this.layer.pick(cp);
      if (!u) return;
      this.pending.targetUnit = u.id;
      this.commitPending();
      return;
    }
    this.pending.waypoints.push(p);
    if (spec.needs === 'zone') this.commitPending();
    else if (!ev.shiftKey && spec.needs === 'route' && this.pending.waypoints.length >= 1 && !ev.ctrlKey) {
      // un seul point suffit : clic droit ou Entrée pour terminer une série
    }
  }

  commitPending() {
    if (!this.pending) return;
    const { type, waypoints, targetUnit } = this.pending;
    const spec = ORDERS[type];
    if (spec.needs === 'route' && !waypoints.length) return this.cancelPending();
    if (spec.needs === 'zone' && !waypoints.length) return this.cancelPending();
    if (spec.needs === 'unit' && targetUnit == null) return this.cancelPending();

    const opts = { waypoints: waypoints.slice(), targetUnit };
    if (spec.needs === 'zone') {
      opts.target = waypoints[waypoints.length - 1];
      opts.waypoints = [opts.target];
      opts.radius = this.pending.radius;
    }
    this.pending = null;
    this.hint(null);
    this.issue(makeOrder(type, opts));
  }

  cancelPending() { this.pending = null; this.hint(null); this.renderOrders(); }

  issue(order) {
    const units = this.units();
    for (const u of units) {
      if (u.destroyed) continue;
      const o = makeOrder(order.type, {
        waypoints: order.waypoints.map(p => ({ ...p })),
        target: order.target ? { ...order.target } : null,
        targetUnit: order.targetUnit,
        radius: order.radius,
        armament: u.armament,
      });
      u.order = o;
      u.path = null; u.pathIdx = 0; u.destKey = null;
      u.withdrawals = 0;              // nouvelle mission : le compteur de replis repart de zero
      u.fortify = order.type === 'FORTIFIER' ? u.fortify : Math.min(u.fortify, 0.2);
      if (u.inBuilding != null && order.type !== 'DEFENDRE' && order.type !== 'FORTIFIER') {
        // on quittera le bâtiment en se mettant en mouvement
      }
      u.statusText = ORDERS[order.type].label;
    }
    const cs = units.map(u => u.callsign).join(', ');
    this.world.intel.say(null, 'Ordre transmis à ' + cs + ' : ' + ORDERS[order.type].label.toLowerCase() + '.', 'order');
    this.renderOob(); this.renderDetail(); this.renderOrders();
  }

  hint(text) {
    const el = $('#order-hint');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
  }

  units() {
    const out = [];
    for (const id of this.selection) {
      const u = this.world.byId.get(id);
      if (u) out.push(u);
    }
    return out;
  }

  // ------------------------------------------------------------ clavier

  bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'Escape') { this.cancelPending(); return; }
      if (e.key === 'Enter') { this.commitPending(); return; }
      if (e.key === ' ') { e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); return; }
      if (e.key >= '1' && e.key <= '4') { this.setSpeed([1, 2, 4, 8][+e.key - 1]); return; }
      if (e.key === 'Delete' && this.selection.size) {
        for (const u of this.units()) { u.order = null; u.path = null; }
        this.renderDetail(); return;
      }
      if (e.key === 'a' && e.ctrlKey) {
        e.preventDefault();
        this.selection.clear();
        for (const u of this.world.units) if (u.side === 'BLUFOR' && !u.destroyed) this.selection.add(u.id);
        this.renderOob(); this.renderDetail(); return;
      }
      const k = e.key.toUpperCase();
      for (const key of ORDER_KEYS) {
        if (ORDERS[key].key === k) { this.startOrder(key); return; }
      }
    });

    this.view.map.getContainer().addEventListener('wheel', e => {
      if (!this.pending || ORDERS[this.pending.type].needs !== 'zone') return;
      e.preventDefault(); e.stopPropagation();
      this.pending.radius = clamp(this.pending.radius + (e.deltaY < 0 ? 20 : -20), 40, 900);
      this.zoneRadius = this.pending.radius;
    }, { passive: false, capture: true });
  }

  setSpeed(v) {
    this.speed = v;
    document.querySelectorAll('.sp').forEach(x => x.classList.toggle('active', +x.dataset.speed === v));
  }

  // ------------------------------------------------------------ panneaux

  renderTop() {
    const w = this.world;
    // Horloge sur zone : heure et date locales, elles avancent avec la partie.
    const d = w.clock;
    $('#clock').textContent =
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
    $('#date').textContent = dateFmt.format(d) + (w.timezone ? ' · ' + w.timezone : '');
    const light = w.lightLevel > 0.85 ? 'plein jour' : w.lightLevel > 0.4 ? 'lumière faible' : 'nuit';
    const strain = w.climateEffort;
    $('#env').innerHTML = w.weatherInfo.label + ' · ' + light +
      ' · vue ' + Math.round(w.visRange) + ' m · ' +
      (strain > 1.35 ? '<b style="color:#ffbe5e">' + w.climateNote + ' — effort ×' + strain.toFixed(1) + '</b>'
                     : w.climateNote) +
      (w.liveClock ? ' · heure locale réelle' : '');
    const blue = w.units.filter(u => u.side === 'BLUFOR');
    const alive = blue.reduce((a, u) => a + u.alive, 0);
    const total = blue.reduce((a, u) => a + u.initialStrength, 0);
    const kia = blue.reduce((a, u) => a + u.killed, 0);
    const wia = blue.reduce((a, u) => a + u.wounded, 0);
    $('#tally').innerHTML = 'Effectif <b>' + alive + '/' + total + '</b> · tués <b>' + kia +
      '</b> · blessés <b>' + wia + '</b> · ennemi <b>~' + w.stats.redObserved +
      ' h.c.</b> · contacts <b>' + w.intel.contacts.size + '</b>';
  }

  renderNets() {
    const el = $('#nets');
    el.innerHTML = '';
    for (const [k, n] of Object.entries(NETS)) {
      const users = this.world.units.filter(u => u.side === 'BLUFOR' && u.net === k && !u.destroyed);
      const d = document.createElement('div');
      d.className = 'net-row';
      d.innerHTML = '<span class="dot" style="background:' + n.color + '"></span>' +
        '<span>' + n.label + '</span><span class="f">' + n.freq.toFixed(3) + '</span>' +
        '<span style="margin-left:auto">' + users.length + '</span>';
      el.appendChild(d);
    }
  }

  renderOob() {
    const el = $('#oob');
    const scroll = el.scrollTop;
    el.innerHTML = '';
    const blue = this.world.units.filter(u => u.side === 'BLUFOR');
    blue.sort((a, b) => a.callsign.localeCompare(b.callsign));
    for (const u of blue) {
      const row = document.createElement('div');
      row.className = 'unit-row' + (this.selection.has(u.id) ? ' sel' : '') + (u.destroyed ? ' dead' : '');
      const img = unitIcon(u.type, 'friend');
      const src = img ? img.src : '';
      row.innerHTML =
        '<img src="' + src + '" alt="">' +
        '<div><div class="cs">' + u.callsign + (u.mountedIn != null ? ' ⬆' : '') + '</div>' +
        // l'etat de combat prime sur la mission : c'est l'information urgente
        '<div class="st' + (abnormal(u) ? ' alarm' : '') + '">' +
          (abnormal(u) ? u.condition : (u.order ? describeOrder(u.order, this.world) : u.condition)) +
        '</div></div>' +
        '<div class="mini">' +
          bar(u.strength, '#7fe08a') + bar(1 - u.fatigue, '#ffd45e') + bar(u.ammo, '#8fd0ff') +
        '</div>';
      row.onclick = ev => {
        if (ev.ctrlKey || ev.shiftKey) {
          if (this.selection.has(u.id)) this.selection.delete(u.id); else this.selection.add(u.id);
        } else { this.selection.clear(); this.selection.add(u.id); }
        this.renderOob(); this.renderDetail();
      };
      row.ondblclick = () => {
        const g = this.world.frame.toGeo(u.x, u.y);
        this.view.map.panTo([g.lat, g.lon]);
      };
      el.appendChild(row);
    }
    el.scrollTop = scroll;
  }

  renderDetail() {
    const el = $('#detail');
    const units = this.units();
    if (!units.length) {
      el.innerHTML = '<p class="empty">Sélectionnez un élément sur la carte ou dans l’ordre de bataille.</p>';
      this.renderOrders();
      return;
    }
    if (units.length > 1) {
      el.innerHTML = '<div class="dhead"><div><div class="cs">' + units.length + ' éléments</div>' +
        '<div class="ty">' + units.map(u => u.callsign).join(' · ') + '</div></div></div>';
      this.renderOrders();
      return;
    }
    const u = units[0];
    const img = unitIcon(u.type, 'friend');
    const w = this.world;
    const net = NETS[u.net] || NETS.CDT;
    const b = u.inBuilding != null ? w.terrain.buildings[u.inBuilding] : null;
    const terr = TERRAIN[w.terrain.typeAt(u.x, u.y)];

    let cargo = '';
    if (u.capacity) {
      const used = occupiedSeats(w, u);
      cargo = '<div class="cargo">Places : <b>' + used + '/' + u.capacity + '</b>' +
        (u.cargo.length ? ' — à bord : ' + u.cargo.map(id => (w.byId.get(id) || {}).callsign).join(', ') : '') + '</div>';
    }
    if (u.mountedIn != null) {
      const veh = w.byId.get(u.mountedIn);
      cargo = '<div class="cargo">Embarqué à bord de <b>' + (veh ? veh.callsign : '?') + '</b></div>';
    }

    el.innerHTML =
      '<div class="dhead"><img src="' + (img ? img.src : '') + '">' +
        '<div><div class="cs">' + u.callsign + '</div><div class="ty">' + u.name + '</div></div></div>' +
      '<dl class="kv">' +
        kv('Réseau', net.label.replace('Réseau ', '')) +
        kv('Fréquence', u.freq.toFixed(3) + ' MHz') +
        kv('Liaison', linkText(u)) +
        kv('État', u.condition) +
        kv('Ordre', u.order ? describeOrder(u.order, w) : '—') +
        kv('Position', gridRef(w.frame, u.x, u.y)) +
        (u.spec.kind === 'air'
          ? kv('Vol', u.landed ? 'posé' : 'en vol, ' + Math.round(u.agl || 0) + ' m sol') +
            kv('Cap', Math.round(u.heading) + '°' + (Math.abs(u.bank || 0) > 0.25 ? ' (en virage)' : '')) +
            kv('Base', u.homeBase ? (u.homeBase.name || 'terrain') : '—') +
            kv('Seuil retour', Math.round(bingoFuel(w, u) * 100) + ' % de carburant')
          : kv('Terrain', (b ? 'Bâtiment (' + b.floors + ' niv.)' : terr.name) + ' · ' + Math.round(w.terrain.elevAt(u.x, u.y)) + ' m')) +
        kv('Vitesse', (u.speed * 3.6).toFixed(1) + ' km/h') +
        kv('Charge', Math.round(u.load) + ' kg/homme') +
        (u.spec.weapon.range ? kv('Portée utile', u.spec.weapon.range + ' m') : '') +
      '</dl>' +
      meter('Effectif', u.strength, '#7fe08a', u.effective + '/' + u.initialStrength) +
      meter('Fatigue', u.fatigue, '#ffd45e', Math.round(u.fatigue * 100) + '%') +
      meter('Munitions', u.ammo, '#8fd0ff', Math.round(u.ammo * 100) + '%') +
      meter('Moral', u.morale, '#c0a0ff', Math.round(u.morale * 100) + '%') +
      meter('Suppression', u.suppression, '#ff8a6a', Math.round(u.suppression * 100) + '%') +
      meter('Organisation du terrain', u.fortify, '#c0a878', Math.round(u.fortify * 100) + '%') +
      (u.spec.fuel ? meter('Carburant', u.fuel, '#9fe07f', Math.round(u.fuel * 100) + '%') : '') +
      (u.hull ? meter('Intégrité', u.hull, '#e0e0e0', Math.round(u.hull * 100) + '%') : '') +
      '<div class="roster">' + u.soldiers.map(s =>
        '<span class="m w' + s.wound + '" title="' + ['valide', 'blessé léger', 'blessé grave', 'tué'][s.wound] + '"></span>').join('') +
      '</div>' + cargo +
      contactSummary(w, u) +
      fireSummary(w, u);

    this.renderOrders();
  }

  renderOrders() {
    const el = $('#orders');
    const units = this.units();
    if (!units.length) { el.innerHTML = ''; return; }

    let html = '<div class="osec">Mission</div><div class="ogrid">';
    const anyAir = units.some(u => u.spec.kind === 'air');
    for (const key of ORDER_KEYS) {
      const s = ORDERS[key];
      if (s.air && !anyAir) continue;          // la passe de tir n'a de sens qu'en l'air
      const ic = pointIcon(s.icon, 'friend');
      const on = this.pending && this.pending.type === key;
      html += '<button class="obtn' + (on ? ' on' : '') + '" data-order="' + key + '">' +
        (ic ? '<img src="' + ic.src + '">' : '') + '<span>' + s.label + '</span>' +
        '<span class="k">' + s.key + '</span></button>';
    }
    html += '</div>';

    html += '<div class="osec">Allure</div><div class="opt-row">';
    for (const [k, p] of Object.entries(POSTURE)) {
      const on = units.every(u => u.posture === k);
      html += '<button class="opt' + (on ? ' on' : '') + '" data-posture="' + k + '">' + p.label + '</button>';
    }
    html += '</div>';

    html += '<div class="osec">Règles d’engagement</div><div class="opt-row">';
    for (const [k, r] of Object.entries(ROE)) {
      const on = units.every(u => u.roe === k);
      html += '<button class="opt' + (on ? ' on' : '') + '" data-roe="' + k + '">' + r.label + '</button>';
    }
    html += '</div>';

    if (units.some(u => u.spec.weapons)) {
      html += '<div class="osec">Armement</div><div class="opt-row">';
      for (const [k, lab] of [['gun', 'Canon'], ['missile', 'Missiles'], ['both', 'Les deux']]) {
        const on = units.every(u => u.armament === k);
        html += '<button class="opt' + (on ? ' on' : '') + '" data-arm="' + k + '">' + lab + '</button>';
      }
      html += '</div>';
    }

    html += '<div class="osec">Réseau radio</div><div class="opt-row">';
    for (const [k, n] of Object.entries(NETS)) {
      const on = units.every(u => u.net === k);
      html += '<button class="opt' + (on ? ' on' : '') + '" data-net="' + k + '">' + k + '</button>';
    }
    html += '</div>';

    if (this.pending && ORDERS[this.pending.type].needs === 'zone') {
      html += '<div class="orderline">Rayon de zone : ' + Math.round(this.pending.radius) + ' m (molette)</div>';
    }
    html += '<div class="osec">Divers</div><div class="opt-row">' +
      '<button class="opt" data-clear="1">Annuler l’ordre</button>' +
      '<button class="opt" data-marker="1">Poser un point</button>' +
      '</div>';

    el.innerHTML = html;

    el.querySelectorAll('[data-order]').forEach(b => b.onclick = () => this.startOrder(b.dataset.order));
    el.querySelectorAll('[data-posture]').forEach(b => b.onclick = () => {
      for (const u of units) u.posture = b.dataset.posture;
      this.renderOrders();
    });
    el.querySelectorAll('[data-arm]').forEach(b => b.onclick = () => {
      for (const u of units) {
        u.armament = b.dataset.arm;
        if (u.order && u.order.type === 'PASSE') u.order.armament = b.dataset.arm;
      }
      this.renderOrders();
    });
    el.querySelectorAll('[data-roe]').forEach(b => b.onclick = () => {
      for (const u of units) u.roe = b.dataset.roe;
      this.renderOrders();
    });
    el.querySelectorAll('[data-net]').forEach(b => b.onclick = () => {
      for (const u of units) { u.net = b.dataset.net; u.freq = NETS[b.dataset.net].freq; }
      this.renderNets(); this.renderDetail();
    });
    const clr = el.querySelector('[data-clear]');
    if (clr) clr.onclick = () => { for (const u of units) { u.order = null; u.path = null; } this.renderDetail(); };
    const mk = el.querySelector('[data-marker]');
    if (mk) mk.onclick = () => this.startMarker();
  }

  startMarker() {
    this.hint('Clic gauche : poser un point tactique (point de ravitaillement) · Échap : annuler');
    const map = this.view.map;
    const once = e => {
      const p = this.view.toLocal(e.containerPoint);
      this.world.intel.markers.push({ x: p.x, y: p.y, kind: 'rearm point', label: 'Ravitaillement' });
      map.off('click', once);
      this.hint(null);
    };
    map.once('click', once);
  }

  // ------------------------------------------------------------ journal

  bindLog() {
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
      this.logFilter = t.dataset.net;
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
      const combat = this.logFilter === 'COMBAT';
      $('#radio').hidden = combat;
      $('#combat').hidden = !combat;
      if (combat) this.renderCombat(); else this.renderLog();
    });
  }

  // Tableau de situation : qui tire sur qui, et où en sont les pertes.
  renderCombat() {
    const w = this.world;
    const blue = w.units.filter(u => u.side === 'BLUFOR');
    const alive = blue.reduce((a, u) => a + u.alive, 0);
    const total = blue.reduce((a, u) => a + u.initialStrength, 0);
    const kia = blue.reduce((a, u) => a + u.killed, 0);
    const wia = blue.reduce((a, u) => a + u.wounded, 0);

    let h = '<div class="bilan">' +
      block('Effectif ami', alive + ' / ' + total, 'blue') +
      block('Tués', String(kia), 'blue') +
      block('Blessés', String(wia), 'blue') +
      block('Éléments perdus', String(w.stats.blueLosses), 'blue') +
      block('Ennemi hors de combat', '~' + w.stats.redObserved + ' hommes', 'red',
            'vus tomber par nos éléments — pas un décompte exact') +
      block('Éléments ennemis réduits', String(w.stats.redLosses), 'red') +
      block('Contacts au PC', String(w.intel.contacts.size), 'red') +
      '</div>';

    // --- engagements en cours ---
    const rows = [];
    for (const u of blue) {
      if (u.destroyed) continue;
      const firing = u.engaging != null && w.time - u.lastFired < 10;
      const hit = w.time - u.lastHit < 10;
      if (!firing && !hit && !u.threatCount) continue;

      let target = '<span class="dim">—</span>', d = '';
      if (firing) {
        const t = w.byId.get(u.engaging);
        if (t) {
          const c = u.contacts.get(t.id);
          const name = c && c.level >= 3 ? (TYPE_FR[t.type] || t.type) : 'non identifié';
          target = '<span class="foe">▶ ' + escapeHtml(name) + '</span>';
          d = formatDist(Math.hypot(t.x - u.x, t.y - u.y));
        }
      } else if (hit) {
        target = '<span class="foe">◀ sous le feu</span>';
      } else {
        target = '<span class="dim">au contact</span>';
      }

      rows.push('<tr class="' + (hit ? 'hot' : '') + '">' +
        '<td class="cs">' + u.callsign + '</td>' +
        '<td>' + u.condition + '</td>' +
        '<td>' + target + '</td>' +
        '<td>' + d + '</td>' +
        '<td>' + u.effective + '/' + u.initialStrength +
          (u.killed || u.wounded ? ' <span class="dim">(' + u.killed + '† ' + u.wounded + '✚)</span>' : '') + '</td>' +
        '<td>' + (u.roundsFired ? u.roundsFired + ' cp' : '<span class="dim">—</span>') + '</td>' +
        '<td><span class="sup"><i style="width:' + Math.round(u.suppression * 100) + '%"></i></span></td>' +
        '</tr>');
    }
    h += '<h3>Engagements en cours</h3>';
    h += rows.length
      ? '<table class="fight"><tr><th>Élément</th><th>État</th><th>Engage</th><th>Distance</th><th>Effectif</th><th>Tirs</th><th>Suppression</th></tr>' + rows.join('') + '</table>'
      : '<div class="none">Aucun élément au contact.</div>';

    // --- situation ennemie telle que le PC la connaît ---
    const foes = [];
    for (const c of w.intel.contacts.values()) {
      const engagedBy = blue.filter(u => u.engaging === c.id && w.time - u.lastFired < 10)
                            .map(u => u.callsign);
      const age = Math.round(w.time - c.lastFresh);
      foes.push({ age, html: '<tr>' +
        '<td class="foe">' + ['—', 'entendu', 'vu', escapeHtml(TYPE_FR[c.type] || c.type || 'identifié')][c.level] + '</td>' +
        '<td>' + (c.strength ? c.strength + ' pax' : '<span class="dim">?</span>') + '</td>' +
        '<td>' + (engagedBy.length ? engagedBy.join(', ') : '<span class="dim">non traité</span>') + '</td>' +
        '<td class="dim">' + (age < 10 ? 'temps réel' : 'il y a ' + age + ' s') + '</td>' +
        '<td class="dim">' + escapeHtml(c.reporter || '') + '</td>' +
        '</tr>' });
    }
    foes.sort((a, b) => a.age - b.age);
    h += '<h3>Situation ennemie connue</h3>';
    h += foes.length
      ? '<table class="fight"><tr><th>Contact</th><th>Volume</th><th>Traité par</th><th>Fraîcheur</th><th>Source</th></tr>' + foes.map(f => f.html).join('') + '</table>'
      : '<div class="none">Aucun contact au tableau.</div>';

    $('#combat').innerHTML = h;
  }

  renderLog() {
    const el = $('#radio');
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const msgs = this.world.intel.log.filter(m => this.logFilter === 'ALL' || m.net === this.logFilter);
    el.innerHTML = msgs.slice(-160).map(m => {
      // Un poste coupé n'a rien transmis au PC : le journal en garde la trace,
      // mais pas le contenu. C'est le prix de l'écoute qu'on a abandonnée.
      if (m.missed) {
        return '<div class="msg missed"><span class="t">' + formatClock(this.world.hour * 3600 + m.t) + '</span>' +
          '<span class="from">' + m.net + '</span><span class="tx">— trafic non reçu, poste coupé —</span></div>';
      }
      return '<div class="msg ' + m.kind + '"><span class="t">' + formatClock(this.world.hour * 3600 + m.t) + '</span>' +
        '<span class="from">' + m.from + '</span><span class="tx">' + escapeHtml(m.text) + '</span></div>';
    }).join('');
    if (near) el.scrollTop = el.scrollHeight;
  }

  tick() {
    this.renderTop();
    // le journal est reconstruit au plus 4 fois par seconde, jamais par message
    if (this.logFilter === 'COMBAT') {
      if (!this.combatAt || performance.now() - this.combatAt > 400) {
        this.combatAt = performance.now();
        this.renderCombat();
      }
    } else if (this.logDirty && (!this.logAt || performance.now() - this.logAt > 250)) {
      this.logAt = performance.now();
      this.logDirty = false;
      this.renderLog();
    }
    if (!this._slow || performance.now() - this._slow > 400) {
      this._slow = performance.now();
      this.renderOob();
      if (this.selection.size === 1) this.renderDetail();
    }
  }
}

// ------------------------------------------------------------ helpers HTML

// Un etat qui doit sauter aux yeux du chef dans l'ordre de bataille.
const ALARM = {
  'FIXÉ': 1, 'CLOUÉ': 1, 'REPLI': 1, 'DÉROUTE': 1, 'RECONSTITUTION': 1,
  'GAGNE LE COUVERT': 1, 'MUNITIONS': 1, 'ÉPROUVÉ': 1, 'HORS DE COMBAT': 1, 'DÉTRUIT': 1,
};
function abnormal(u) { return !!ALARM[u.condition]; }

function kv(k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; }

function block(label, value, tone, note) {
  return '<div class="b"><span class="lab">' + label + '</span>' +
    '<span class="val ' + (tone || '') + '">' + value + '</span>' +
    (note ? '<span class="note">' + note + '</span>' : '') + '</div>';
}

function meter(label, v, color, txt) {
  const p = Math.round(clamp(v, 0, 1) * 100);
  return '<div class="meter"><div class="lab"><span>' + label + '</span><span>' + (txt || p + '%') + '</span></div>' +
    '<div class="bar"><i style="width:' + p + '%;background:' + color + '"></i></div></div>';
}

function bar(v, color) {
  return '<span class="bar"><i style="width:' + Math.round(clamp(v, 0, 1) * 100) + '%;background:' + color + '"></i></span>';
}

function linkText(u) {
  if (u.link > 0.6) return 'bonne (' + Math.round(u.link * 100) + '%)';
  if (u.link > 0.3) return 'dégradée (' + Math.round(u.link * 100) + '%)';
  if (u.link > 0.05) return 'faible (' + Math.round(u.link * 100) + '%)';
  return 'PERDUE';
}

// Ce que l'élément a effectivement tiré : arme, cible, volume, coups au but.
function fireSummary(world, u) {
  if (!u.fireLog || !u.fireLog.length) return '';
  const rows = u.fireLog.slice(-6).reverse().map(e => {
    const t = world.byId.get(e.targetId);
    const known = t && u.contacts.get(t.id) && u.contacts.get(t.id).level >= 3;
    const who = t ? (known ? (TYPE_FR[t.type] || t.type) : 'non identifié') : 'cible perdue';
    const age = Math.round(world.time - e.last);
    return '<dt>' + escapeHtml(e.label) + '</dt><dd>' + e.rounds + ' cp · ' + escapeHtml(who) +
      ' · il y a ' + (age < 60 ? age + ' s' : Math.round(age / 60) + ' min') + '</dd>';
  }).join('');
  return '<div class="osec">Tirs effectués — ' + u.roundsFired + ' coups</div><dl class="kv">' + rows + '</dl>';
}

function contactSummary(world, u) {
  const rows = [];
  for (const [id, c] of u.contacts) {
    if (c.level < 1) continue;
    const t = world.byId.get(id);
    if (!t || t.side === 'CIV') continue;
    const d = Math.hypot(c.x - u.x, c.y - u.y);
    rows.push({ d, html: '<dt>' + ['—', 'entendu', 'vu', 'identifié'][c.level] + '</dt><dd>az ' +
      Math.round(azimuth(u, c)) + ' · ' + formatDist(d) + '</dd>' });
  }
  if (!rows.length) return '';
  rows.sort((a, b) => a.d - b.d);
  return '<div class="osec">Contacts de l’élément</div><dl class="kv">' +
    rows.slice(0, 6).map(r => r.html).join('') + '</dl>';
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

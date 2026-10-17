// Amorçage : choix de la zone d'opération, chargement du terrain réel, boucle de jeu.

import { Frame } from './core/geo.js';
import { Terrain } from './world/terrain.js';
import { fetchOsm, rasterize } from './world/osm.js';
import { loadElevation } from './world/elevation.js';
import { World, buildScenario, planScenario, baseProblem, minBaseDistance } from './sim/world.js';
import { FORCES } from './sim/forces.js';
import { fetchLocalConditions, fmtHour } from './world/weather.js';
import { MapView } from './render/mapView.js';
import { UnitLayer } from './render/unitLayer.js';
import { loadSymbols, preload } from './render/symbols.js';
import { UI } from './ui/app.js';
import { Tent } from './ui/tent.js';
import { RadioRack } from './sim/radios.js';
import { sfx, bindAudio } from './render/audio.js';
import { voice, bindVoice } from './render/voice.js';

const $ = s => document.querySelector(s);

// ---------------------------------------------------------------- écran de mise en place

let preMap, preMarker, preRect;

function initSetup() {
  const lat = +$('#lat').value, lon = +$('#lon').value;
  preMap = L.map('premap', { zoomControl: true, attributionControl: false }).setView([lat, lon], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(preMap);
  preMarker = L.marker([lat, lon]).addTo(preMap);
  updateRect();

  preMap.on('click', e => {
    $('#lat').value = e.latlng.lat.toFixed(5);
    $('#lon').value = e.latlng.lng.toFixed(5);
    preMarker.setLatLng(e.latlng);
    updateRect();
  });

  $('#size').oninput = () => {
    const km = +$('#size').value / 1000;
    $('#size-val').textContent = km.toFixed(1) + ' km';
    // la résolution s'adapte, et le temps de chargement suit la surface
    const half = +$('#size').value / 2;
    const cell = half <= 3000 ? 10 : half <= 6000 ? 15 : 20;
    const note = $('#size-note');
    note.textContent = 'Résolution ' + cell + ' m — ' + (
      km <= 4 ? 'chargement rapide.'
      : km <= 8 ? 'chargement de quelques dizaines de secondes.'
      : 'grande opération : le chargement peut prendre plusieurs minutes en zone urbaine.');
    note.classList.toggle('warn', km > 8);
    // une grande zone vide n'a pas d'intérêt : on propose un volume adverse cohérent
    document.getElementById('opfor').value = Math.min(60, Math.round(5 + km * 1.9));
    document.getElementById('civ').value = Math.min(60, Math.round(4 + km * 1.6));
    updateRect();
  };
  $('#lat').onchange = $('#lon').onchange = () => {
    const p = [+$('#lat').value, +$('#lon').value];
    preMarker.setLatLng(p); preMap.setView(p); updateRect();
  };

  const forceSel = $('#force');
  const showForce = () => {
    const p = FORCES[forceSel.value];
    $('#force-note').innerHTML = '<b>Niveau ' + p.difficulty + '/5</b> — ' + p.summary;
  };
  forceSel.onchange = showForce;
  showForce();

  // les réglages manuels se grisent quand on suit les conditions réelles
  const syncLive = () => {
    const lw = $('#live-weather').checked;
    $('#weather').disabled = lw;
    $('#temp').disabled = lw;
    $('#hour').disabled = $('#live-clock').checked;
  };
  $('#live-weather').onchange = syncLive;
  $('#live-clock').onchange = syncLive;
  syncLive();

  const tempIn = $('#temp');
  const showTemp = () => {
    const t = +tempIn.value;
    $('#temp-val').textContent = t + ' °C';
    const heat = t > 25 ? Math.min(1, (t - 25) / 18) : 0;
    const cold = t < 2 ? Math.min(1, (2 - t) / 22) : 0;
    const eff = 1 + heat * 1.25 + cold * 0.55;
    const note = $('#temp-note');
    note.textContent = heat > 0.55 ? 'Forte chaleur : effort ×' + eff.toFixed(1) + ', récupération très réduite.'
      : heat > 0.15 ? 'Chaleur : effort ×' + eff.toFixed(1) + '.'
      : cold > 0.5 ? 'Grand froid : effort ×' + eff.toFixed(1) + '.'
      : cold > 0.1 ? 'Froid : effort ×' + eff.toFixed(1) + '.'
      : 'Conditions tempérées.';
    note.classList.toggle('warn', eff > 1.35);
  };
  tempIn.oninput = showTemp;
  showTemp();

  $('#btn-search').onclick = search;
  $('#place-search').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
  $('#btn-deploy').onclick = deploy;

  setTimeout(() => preMap.invalidateSize(), 120);
}

function updateRect() {
  const half = +$('#size').value / 2;
  const frame = new Frame(+$('#lat').value, +$('#lon').value);
  const bb = frame.bbox(half);
  if (preRect) preMap.removeLayer(preRect);
  preRect = L.rectangle([[bb.south, bb.west], [bb.north, bb.east]],
    { color: '#ffd45e', weight: 2, fillOpacity: 0.08 }).addTo(preMap);
  preMap.fitBounds(preRect.getBounds().pad(0.6));
}

async function search() {
  const q = $('#place-search').value.trim();
  if (!q) return;
  const st = $('#search-status');

  // coordonnées saisies directement
  const m = q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
  if (m) {
    $('#lat').value = parseFloat(m[1].replace(',', '.'));
    $('#lon').value = parseFloat(m[2].replace(',', '.'));
    preMarker.setLatLng([+$('#lat').value, +$('#lon').value]);
    updateRect();
    st.textContent = 'Coordonnées appliquées.';
    return;
  }

  st.textContent = 'Recherche…';
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
    const js = await res.json();
    if (!js.length) { st.textContent = 'Aucun résultat.'; return; }
    $('#lat').value = (+js[0].lat).toFixed(5);
    $('#lon').value = (+js[0].lon).toFixed(5);
    preMarker.setLatLng([+js[0].lat, +js[0].lon]);
    updateRect();
    st.textContent = js[0].display_name;
  } catch (e) {
    st.textContent = 'Recherche indisponible (' + e.message + '). Cliquez sur la carte.';
  }
}

// Date et heure de départ sur zone : celles du relevé si on suit le temps réel,
// sinon la date du jour à l'heure choisie.
function startDateFor(live, wantClock) {
  if (wantClock && live && live.observedAt) {
    const t = String(live.observedAt);
    const y = +t.slice(0, 4), mo = +t.slice(5, 7) - 1, d = +t.slice(8, 10);
    const h = +t.slice(11, 13), mi = +t.slice(14, 16);
    if (Number.isFinite(y) && Number.isFinite(h)) return new Date(y, mo, d, h, mi, 0);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +document.querySelector('#hour').value, 0, 0);
}

function log(msg, cls) {
  const el = $('#loadlog');
  el.classList.add('on');
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- déploiement

async function deploy() {
  const btn = $('#btn-deploy');
  btn.disabled = true;
  btn.textContent = 'Chargement du terrain…';
  $('#loadlog').innerHTML = '';

  const lat = +$('#lat').value, lon = +$('#lon').value;
  const half = +$('#size').value / 2;
  const seed = +$('#seed').value || 1;

  try {
    log('Zone : ' + lat.toFixed(5) + ' / ' + lon.toFixed(5) + ' — ' + (half * 2 / 1000).toFixed(1) + ' km de côté');
    if (half > 5000) log('Grande zone : soyez patient, Overpass peut mettre plusieurs minutes.');
    const frame = new Frame(lat, lon);
    const terrain = new Terrain(half);
    const bbox = frame.bbox(half * 1.06);

    await loadSymbols();
    preload();
    log('Symboles OTAN chargés.', 'ok');

    // les grandes zones demandent bien plus de temps côté Overpass
    const timeout = half > 6000 ? 300 : half > 3000 ? 180 : 90;
    const elements = await fetchOsm(bbox, log, timeout);
    rasterize(elements, terrain, frame, log);

    try {
      await loadElevation(terrain, frame, bbox, log);
    } catch (e) {
      log('Relief indisponible : ' + e.message + ' — terrain plat.', 'err');
    }
    terrain.computeElevRange();

    // Conditions réelles sur zone, si le chef les a demandées.
    let live = null;
    const wantWeather = $('#live-weather').checked;
    const wantClock = $('#live-clock').checked;
    if (wantWeather || wantClock) {
      live = await fetchLocalConditions(lat, lon, log);
      if (!live) log('On s’en tient aux conditions choisies à la main.', 'err');
    }

    log('Construction du dispositif…');
    const world = new World(terrain, frame, {
      seed,
      hour: (wantClock && live && live.hour != null) ? live.hour : +$('#hour').value,
      weather: (wantWeather && live) ? live.kind : $('#weather').value,
      liveWeather: (wantWeather && live) ? live : null,
      liveClock: !!(wantClock && live && live.hour != null),
      temperature: (wantWeather && live && live.temperature != null) ? live.temperature : +$('#temp').value,
      startDate: startDateFor(live, wantClock),
      timezone: (wantClock && live) ? live.timezone : null,
      force: $('#force').value,
    });
    if (live) {
      log('Conditions retenues : ' + world.weatherInfo.label +
          ' · départ à ' + fmtHour(world.hour) + ' sur zone.', 'ok');
    }
    log('Climat : ' + world.climateNote + ' — effort ×' + world.climateEffort.toFixed(2) +
        ', récupération ×' + world.climateRecovery.toFixed(2) + '.',
        world.climateEffort > 1.35 ? 'err' : null);
    // L'objectif est déterminé d'abord : le chef doit le voir pour choisir où
    // s'implanter, et l'ennemi ne peut être mis en place qu'ensuite.
    planScenario(world);
    log('Objectif retenu : ' + world.objective.name + '.', 'ok');

    startGame(world, {
      pickHq: $('#pick-hq').checked,
      scenario: {
        opfor: +$('#opfor').value,
        civilians: +$('#civ').value,
        air: $('#airsup').checked,
      },
    });
  } catch (e) {
    console.error(e);
    log('ERREUR : ' + e.message, 'err');
    log('Vérifiez votre connexion, ou réessayez avec une zone plus petite.', 'err');
    btn.disabled = false;
    btn.textContent = 'Déployer la section';
  }
}


// Cadre toute la zone d'opération.
function frameAll(world, view) {
  const h = world.terrain.half * 0.98;
  const sw = world.frame.toGeo(-h, -h), ne = world.frame.toGeo(h, h);
  view.map.fitBounds([[sw.lat, sw.lon], [ne.lat, ne.lon]]);
}

/**
 * Laisse le chef poser son PC sur la carte. Résout avec le point retenu, ou
 * null pour l'implantation proposée d'office.
 */
function pickHeadquarters(world, view, layer, ui) {
  return new Promise(resolve => {
    const minD = minBaseDistance(world);
    const suggest = world.suggestedBase;
    const setPreview = p => {
      layer.placement = { x: p.x, y: p.y, problem: baseProblem(world, p), minDist: minD };
      layer.draw();
    };
    setPreview(suggest);

    ui.hint('IMPLANTATION DU POSTE DE COMMANDEMENT — cliquez sur la carte pour poser votre PC. ' +
            'Il doit être à plus de ' + Math.round(minD) + ' m de l’objectif, hors bâti et hors eau. ' +
            'Clic droit ou Échap : implantation automatique.');

    const finish = p => {
      ui.placing = null;
      ui.onPlaceMove = null;
      layer.placement = null;
      ui.hint(null);
      document.removeEventListener('keydown', onKey, true);
      view.map.getContainer().removeEventListener('contextmenu', onRight, true);
      resolve(p);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    const onRight = e => { e.preventDefault(); e.stopPropagation(); finish(null); };

    ui.onPlaceMove = setPreview;
    ui.placing = p => {
      const problem = baseProblem(world, p);
      if (problem) { setPreview(p); return; }        // refus : on laisse le motif affiché
      finish(p);
    };
    document.addEventListener('keydown', onKey, true);
    view.map.getContainer().addEventListener('contextmenu', onRight, true);
  });
}

// ---------------------------------------------------------------- boucle de jeu

async function startGame(world, opts = {}) {
  $('#setup').hidden = true;
  $('#tent').hidden = false;
  $('#game').hidden = false;

  // Le râtelier s'abonne au trafic avant le son, la voix et le journal : un
  // poste coupé doit avoir écarté le message avant que quiconque le lise.
  const rack = new RadioRack(world);
  world.rack = rack;

  const view = new MapView($('#map'), world.frame, world.terrain);
  const layerHolder = { selection: new Set(), pending: null };
  const layer = new UnitLayer($('#tac'), view, world, layerHolder);
  const ui = new UI(world, view, layer);
  // l'UI et le calque partagent le même état de sélection
  layer.ui = ui;

  // La tente enveloppe l'interface : celle-ci devient l'écran posé sur la table.
  const tent = new Tent(world, rack, ui);

  setTimeout(() => { view.map.invalidateSize(); layer.resize(); }, 60);
  view.map.on('resize', () => layer.resize());
  bindAudio(world);
  bindVoice(world, ui);
  window.GAME = { world, view, layer, ui, sfx, voice, rack, tent };

  // La boucle de rendu tourne dès maintenant : la carte reste vivante pendant
  // le choix de l'implantation. La simulation, elle, n'avance qu'ensuite.
  const STEP = 0.25;                 // pas de simulation en secondes
  let acc = 0, last = performance.now(), running = false;

  function frame(now) {
    const real = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (running) {
      acc += real * ui.speed;
      let guard = 0;
      while (acc >= STEP && guard++ < 48) { world.step(STEP); acc -= STEP; }
    }
    layer.draw();
    tent.frame(real);
    if (running) { ui.tick(); sfx.update(world, view); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- phase d'implantation, si le chef veut choisir lui-même ----
  // Elle se fait sur l'écran, avant que le chef n'ait pris ses quartiers : on
  // s'y place d'emblée, sans mouvement de buste.
  let chosen = null;
  if (opts.pickHq) {
    tent.snapTo(true);
    frameAll(world, view);
    layer.draw();
    chosen = await pickHeadquarters(world, view, layer, ui);
  }

  buildScenario(world, { ...(opts.scenario || {}), base: chosen });
  ui.renderNets(); ui.renderOob(); ui.renderDetail(); ui.renderLog();

  // Cadrage initial sur la zone de rassemblement : cadrer toute l'AO empile
  // les symboles sur quelques pixels et rend la section illisible.
  const blue = world.units.filter(u => u.side === 'BLUFOR');
  if (blue.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const u of blue) {
      if (u.x < minX) minX = u.x;
      if (u.x > maxX) maxX = u.x;
      if (u.y < minY) minY = u.y;
      if (u.y > maxY) maxY = u.y;
    }
    const pad = 220;
    const sw = world.frame.toGeo(minX - pad, minY - pad);
    const ne = world.frame.toGeo(maxX + pad, maxY + pad);
    view.map.fitBounds([[sw.lat, sw.lon], [ne.lat, ne.lon]]);
  }

  last = performance.now();
  running = true;                    // le dispositif est en place, la partie commence

  // Le chef se redresse : il découvre la tente, ses deux tables et ses postes.
  tent.lean(false);
}

initSetup();

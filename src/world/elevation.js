// Relief réel : tuiles Terrarium (AWS Open Data / Mapzen), libres et sans clé.
// elevation = (R * 256 + G + B / 256) - 32768

import { lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../core/geo.js';

const SOURCES = [
  z => 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + z + '/{x}/{y}.png',
  z => 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/' + z + '/{x}/{y}.png',
];

function loadTile(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tuile ' + url));
    img.src = url;
  });
}

export async function loadElevation(terrain, frame, bbox, onProgress = () => {}) {
  // zoom tel que la résolution soit proche de la taille de cellule (10 m)
  const z = terrain.half > 4000 ? 13 : terrain.half > 1500 ? 14 : 15;

  const x0 = Math.floor(lonToTileX(bbox.west, z));
  const x1 = Math.floor(lonToTileX(bbox.east, z));
  const y0 = Math.floor(latToTileY(bbox.north, z));
  const y1 = Math.floor(latToTileY(bbox.south, z));
  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  onProgress('Relief : ' + count + ' tuiles d’élévation (z' + z + ')…');

  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Accumulateurs pour rééchantillonner vers la grille.
  const N = terrain.n * terrain.n;
  const sum = new Float64Array(N);
  const hits = new Uint32Array(N);
  let loaded = 0;

  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      let img = null;
      for (const src of SOURCES) {
        try {
          img = await loadTile(src(z).replace('{x}', tx).replace('{y}', ty));
          break;
        } catch (e) { /* source suivante */ }
      }
      if (!img) continue;
      loaded++;

      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(img, 0, 0);
      let data;
      try {
        data = ctx.getImageData(0, 0, 256, 256).data;
      } catch (e) {
        onProgress('Relief indisponible (CORS) — terrain considéré plat.');
        return false;
      }

      const lonA = tileXToLon(tx, z), lonB = tileXToLon(tx + 1, z);
      const latA = tileYToLat(ty, z), latB = tileYToLat(ty + 1, z);

      for (let py = 0; py < 256; py++) {
        const lat = latA + (latB - latA) * ((py + 0.5) / 256);
        for (let px = 0; px < 256; px++) {
          const lon = lonA + (lonB - lonA) * ((px + 0.5) / 256);
          const p = frame.toLocal(lat, lon);
          const i = terrain.idx(p.x, p.y);
          if (i < 0) continue;
          const o = (py * 256 + px) * 4;
          const h = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768;
          sum[i] += h; hits[i]++;
        }
      }
    }
  }

  if (!loaded) {
    onProgress('Aucune tuile de relief chargée — terrain plat.');
    return false;
  }

  for (let i = 0; i < N; i++) if (hits[i]) terrain.elev[i] = sum[i] / hits[i];
  fillGaps(terrain, hits);
  smooth(terrain);
  terrain.computeElevRange();
  onProgress('Relief chargé : ' + terrain.minElev.toFixed(0) + ' m à ' + terrain.maxElev.toFixed(0) + ' m');
  return true;
}

// Comble les cellules sans donnée par diffusion depuis les voisines.
function fillGaps(terrain, hits) {
  const n = terrain.n;
  for (let pass = 0; pass < 4; pass++) {
    let remaining = 0;
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = cy * n + cx;
        if (hits[i]) continue;
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = terrain.cellIdx(cx + dx, cy + dy);
            if (j >= 0 && hits[j]) { s += terrain.elev[j]; c++; }
          }
        }
        if (c) { terrain.elev[i] = s / c; hits[i] = 1; } else remaining++;
      }
    }
    if (!remaining) break;
  }
}

// Léger lissage : le rééchantillonnage laisse des marches d'escalier.
function smooth(terrain) {
  const n = terrain.n, src = terrain.elev.slice();
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = terrain.cellIdx(cx + dx, cy + dy);
          if (j >= 0) { s += src[j]; c++; }
        }
      }
      terrain.elev[cy * n + cx] = s / c;
    }
  }
}

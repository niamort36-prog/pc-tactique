// Météo et heure locales réelles de la zone d'opération.
//
// Source : Open-Meteo — libre, sans clé, et qui répond aux requêtes du navigateur.
// Le même appel donne le relevé du moment et le fuseau du lieu, donc l'heure
// locale exacte de l'opération.
//
// Tout est facultatif : en cas d'échec, ou si le chef préfère fixer lui-même les
// conditions, on retombe sur les réglages manuels de l'écran de mise en place.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// Codes météo OMM → conditions de jeu.
function classify(code, cloud) {
  if (code === 45 || code === 48) return 'fog';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'rain';
  if (code === 3 || cloud > 70) return 'overcast';
  if (code === 2 || cloud > 35) return 'overcast';
  return 'clear';
}

const LABEL = {
  clear: 'Ciel clair', overcast: 'Couvert', rain: 'Pluie',
  snow: 'Neige', fog: 'Brouillard',
};

// Plafond tactique par condition : à quelle distance on distingue encore un
// homme. C'est bien plus court que la visibilité météorologique, qui mesure la
// portée d'un repère de grande taille — 8 km sous la pluie n'a aucun sens ici.
const TACTICAL_VIS = { clear: 6000, overcast: 4000, rain: 1400, snow: 1200, fog: 350 };
const VIS_FACTOR = { clear: 1.0, overcast: 0.85, rain: 0.62, snow: 0.50, fog: 0.30 };
const SOUND = { clear: 1.0, overcast: 1.05, rain: 0.70, snow: 0.65, fog: 0.85 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Relève la météo et l'heure locales du point donné.
 * Renvoie null si le service est injoignable — l'appelant retombe alors sur le manuel.
 */
export async function fetchLocalConditions(lat, lon, onProgress = () => {}) {
  const url = ENDPOINT +
    '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
    '&current=temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day' +
    '&hourly=visibility&forecast_days=1&timezone=auto';

  try {
    onProgress('Relevé météo local…');
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const c = j.current;
    if (!c) throw new Error('relevé vide');

    const kind = classify(c.weather_code, c.cloud_cover != null ? c.cloud_cover : 0);

    // visibilité horaire : on prend le créneau correspondant à l'instant relevé
    let vis = null;
    if (j.hourly && j.hourly.time && j.hourly.visibility) {
      const stamp = String(c.time).slice(0, 13);       // « ...T14 »
      const i = j.hourly.time.findIndex(t => String(t).slice(0, 13) === stamp);
      if (i >= 0 && j.hourly.visibility[i] != null) vis = j.hourly.visibility[i];
    }
    // La condition fixe le plafond ; une visibilité réelle exceptionnellement
    // mauvaise peut encore l'abaisser, jamais le relever.
    const base = TACTICAL_VIS[kind];
    const metric = vis != null ? clamp(vis * 0.45, 150, 7000) : null;
    const maxVis = Math.round(metric != null ? Math.min(base, metric) : base);

    // heure locale du lieu, telle que la donne le fuseau du point
    const t = String(c.time);                          // « 2026-08-21T14:30 »
    const hh = parseInt(t.slice(11, 13), 10);
    const mm = parseInt(t.slice(14, 16), 10);
    const hour = Number.isFinite(hh) ? hh + (Number.isFinite(mm) ? mm / 60 : 0) : null;

    const bits = [];
    if (c.temperature_2m != null) bits.push(Math.round(c.temperature_2m) + ' °C');
    if (c.wind_speed_10m != null) bits.push('vent ' + Math.round(c.wind_speed_10m) + ' km/h');
    if (vis != null) bits.push('visibilité ' + (maxVis >= 1000 ? (maxVis / 1000).toFixed(1) + ' km' : maxVis + ' m'));

    const info = {
      kind,
      key: kind,
      label: LABEL[kind] + (bits.length ? ' (' + bits.join(', ') + ')' : ''),
      visibility: VIS_FACTOR[kind],
      sound: SOUND[kind],
      maxVis,
      hour,
      timezone: j.timezone || null,
      temperature: c.temperature_2m,
      wind: c.wind_speed_10m,
      isDay: c.is_day === 1,
      observedAt: t,
    };
    onProgress('Météo locale : ' + info.label +
      (info.hour != null ? ' — heure sur zone ' + fmtHour(info.hour) +
        (info.timezone ? ' (' + info.timezone + ')' : '') : ''));
    return info;
  } catch (e) {
    onProgress('Météo locale indisponible (' + e.message + ') — réglages manuels conservés.');
    return null;
  }
}

export function fmtHour(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
}

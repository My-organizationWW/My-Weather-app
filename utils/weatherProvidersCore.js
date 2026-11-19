// Pure forecast normalization & circuit-breaker logic (no Expo/RN imports).
// Shared by utils/weatherProviders.js and directly tested via `node --test`.

export const OM_CIRCUIT_TTL_MS = 5 * 60 * 1000;

const omCircuit = { downUntil: 0 };

export function omDown(now = Date.now()) {
  return now < omCircuit.downUntil;
}

export function tripOmCircuit(now = Date.now()) {
  omCircuit.downUntil = now + OM_CIRCUIT_TTL_MS;
}

export function closeOmCircuit() {
  omCircuit.downUntil = 0;
}

export function resetOmCircuit() {
  omCircuit.downUntil = 0;
}

// Only trip the circuit on transport/timeout/5xx/429 failures — never on
// external aborts (user switched city) or client 4xx (except 429).
export function shouldTripCircuitForError(err) {
  if (!err) return true;
  if (err.isExternalAbort) return false;
  if (err.kind === 'http' && typeof err.status === 'number') {
    return err.status === 429 || err.status >= 500;
  }
  return true;
}

const COMPASS_DEG = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

function seventimerCode(entry) {
  const w = String(entry?.weather || '');
  const base = w.replace(/day$|night$/, '');
  const amount = Number(entry?.prec_amount ?? 0);
  const prec = String(entry?.prec_type || 'none');
  switch (base) {
    case 'clear': return 0;
    case 'pcloudy': return 1;
    case 'mcloudy': return 2;
    case 'cloudy': return 3;
    case 'humid': return 45;
    case 'lightrain': return 61;
    case 'oshower':
    case 'ishower': return amount >= 5 ? 81 : 80;
    case 'lightsnow': return 71;
    case 'rain': return amount >= 5 ? 65 : 63;
    case 'snow': return amount >= 5 ? 75 : 73;
    case 'rainsnow': return 67;
    case 'ts': return 95;
    case 'tsrain': return 95;
    default: {
      if (prec === 'snow') return 71;
      if (prec === 'rain') return 61;
      const cc = Number(entry?.cloudcover ?? 0);
      if (cc >= 7) return 3;
      if (cc >= 4) return 2;
      if (cc >= 2) return 1;
      return 0;
    }
  }
}

function seventimerIsDay(entry) {
  const w = String(entry?.weather || '');
  if (/day$/.test(w)) return 1;
  if (/night$/.test(w)) return 0;
  return null;
}

function validSeventimerTemp(val) {
  // 7Timer occasionally emits -9999 as a missing-value sentinel.
  return typeof val === 'number' && Number.isFinite(val) && val > -100 && val < 80 ? val : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseStInit(init) {
  const s = String(init || '');
  if (!/^\d{10}$/.test(s)) return null;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10));
}

function toIsoLocal(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export function seventimerToForecast(st, latitude, longitude, nowMs = Date.now()) {
  const series = Array.isArray(st?.dataseries) ? st.dataseries : [];
  const initMs = parseStInit(st?.init);
  if (series.length === 0 || initMs === null) {
    throw new Error('7Timer: empty series');
  }
  const safeLon = Number.isFinite(longitude) ? longitude : 0;
  const estOffsetSec = Math.round(safeLon / 15) * 3600;
  const nowShifted = nowMs + estOffsetSec * 1000;

  const enriched = series.map((e) => {
    const absMs = initMs + Number(e?.timepoint || 0) * 3600 * 1000 + estOffsetSec * 1000;
    let isDay = seventimerIsDay(e);
    if (isDay === null) {
      const h = new Date(absMs).getUTCHours();
      isDay = h >= 6 && h < 21 ? 1 : 0;
    }
    return {
      ...e,
      temp2m: validSeventimerTemp(e?.temp2m),
      absMs,
      iso: toIsoLocal(absMs),
      code: seventimerCode(e),
      isDay,
    };
  });

  const hourlyTime = [];
  const hourlyTemp = [];
  const hourlyCode = [];
  const lerpTemp = (a, b, f) => {
    if (typeof a === 'number' && typeof b === 'number') {
      return Math.round((a + (b - a) * f) * 10) / 10;
    }
    return typeof a === 'number' ? a : b ?? null;
  };
  for (let i = 0; i < enriched.length; i++) {
    const a = enriched[i];
    const b = enriched[i + 1];
    const span = b ? Math.max(1, Math.round((b.absMs - a.absMs) / 3600000)) : 1;
    for (let h = 0; h < span; h++) {
      const f = span === 1 ? 0 : h / span;
      hourlyTime.push(toIsoLocal(a.absMs + h * 3600000));
      hourlyTemp.push(lerpTemp(a.temp2m, b?.temp2m, f));
      hourlyCode.push(f < 0.5 ? a.code : (b ? b.code : a.code));
    }
  }

  let cur = enriched[0];
  for (const e of enriched) {
    if (e.absMs <= nowShifted) cur = e;
    else break;
  }

  const days = new Map();
  for (const e of enriched) {
    const day = e.iso.slice(0, 10);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(e);
  }
  const dailyTime = [];
  const dailyCode = [];
  const dailyMax = [];
  const dailyMin = [];
  for (const [day, list] of days) {
    const temps = list.map((e) => e.temp2m).filter((t) => typeof t === 'number');
    dailyTime.push(day);
    let rep = list[0];
    let bestDist = Infinity;
    for (const e of list) {
      const h = +e.iso.slice(11, 13);
      const dist = Math.abs(h - 12);
      if (dist < bestDist) {
        bestDist = dist;
        rep = e;
      }
    }
    dailyCode.push(rep.code);
    dailyMax.push(temps.length ? Math.round(Math.max(...temps)) : null);
    dailyMin.push(temps.length ? Math.round(Math.min(...temps)) : null);
  }

  const rawWind = Number(cur?.wind10m?.speed);
  const windMs = Number.isFinite(rawWind) && rawWind >= 0 ? rawWind : null;
  return {
    source: '7timer',
    utc_offset_seconds: estOffsetSec,
    current_weather: {
      temperature: cur.temp2m,
      weathercode: cur.code,
      is_day: cur.isDay,
      time: cur.iso,
      windspeed: windMs !== null ? Math.round(windMs * 3.6 * 10) / 10 : null,
      winddirection: COMPASS_DEG[String(cur?.wind10m?.direction || '').toUpperCase()] ?? null,
    },
    hourly: { time: hourlyTime, temperature_2m: hourlyTemp, weathercode: hourlyCode },
    daily: { time: dailyTime, weathercode: dailyCode, temperature_2m_max: dailyMax, temperature_2m_min: dailyMin },
  };
}

export function normalizeOpenMeteoForecast(data) {
  if (!data || typeof data !== 'object') return null;
  const cw =
    data.current_weather ||
    (data.current
      ? {
          temperature: data.current.temperature_2m,
          weathercode: data.current.weather_code,
          windspeed: data.current.wind_speed_10m ?? null,
          winddirection: data.current.wind_direction_10m ?? null,
          is_day: data.current.is_day,
          time: data.current.time,
        }
      : null);
  if (!cw || typeof cw.temperature !== 'number' || !Number.isFinite(cw.temperature)) {
    return null;
  }
  return { ...data, current_weather: cw, source: 'open-meteo' };
}

function nominatimTypeToFeatureCode(type, cls) {
  const t = String(type || '').toLowerCase();
  const c = String(cls || '').toLowerCase();
  if (t === 'country' || t === 'state' || t === 'county' || t === 'administrative' || c === 'boundary') {
    return 'ADM2';
  }
  return 'PPL';
}

export function nominatimToHit(item) {
  if (!item || item.lat === undefined || item.lon === undefined) return null;
  const addr = item.address || {};
  const name =
    item.namedetails?.name ||
    addr.city || addr.town || addr.village || addr.hamlet || addr.municipality ||
    addr.suburb || addr.county || addr.state || addr.country ||
    String(item.display_name || '').split(',')[0].trim();
  if (!name) return null;
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    name,
    country: addr.country || '',
    latitude,
    longitude,
    feature_code: nominatimTypeToFeatureCode(item.type, item.class),
  };
}

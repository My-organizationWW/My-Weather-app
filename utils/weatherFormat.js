// Pure weather formatting and data-extraction helpers (no React Native / i18n deps).

const COMPASS_KEYS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function weathercodeToType(code) {
  if (typeof code !== 'number' || !Number.isFinite(code)) return 'clear';
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'showers';
  if (code <= 86) return 'snow';
  return 'thunder';
}

function isNightHour(isoTime) {
  const h = parseInt(String(isoTime || '').slice(11, 13), 10);
  if (Number.isNaN(h)) return false;
  return h >= 21 || h < 6;
}

// True when a "country" string is actually just coordinates
// (e.g. old cached snapshots stored "55.75,37.62" as country).
// Such values must not be rendered next to the real coordinates.
function isCoordsLikeText(s) {
  return /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/.test(String(s || ''));
}

// Next N timeline entries (hourly forecast + sunrise/sunset events) starting from current hour.
function getHourlyTimeline(data, count = 24) {
  if (!data) return [];
  if (!data.hourly || !Array.isArray(data.hourly.time) || data.hourly.time.length === 0) {
    const now = new Date();
    const times = [];
    const temps = [];
    const codes = [];
    const baseTemp = typeof data.current_weather?.temperature === 'number'
      ? data.current_weather.temperature
      : null;
    const baseCode = typeof data.current_weather?.weathercode === 'number'
      ? data.current_weather.weathercode
      : 0;
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getTime() + i * 3600000);
      const pad = (n) => String(n).padStart(2, '0');
      times.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
      temps.push(baseTemp);
      codes.push(baseCode);
    }
    data = {
      ...data,
      hourly: { time: times, temperature_2m: temps, weathercode: codes },
    };
  }
  const offset = typeof data.utc_offset_seconds === 'number' ? data.utc_offset_seconds : 0;
  const now = new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + offset * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const nowHour = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}`;

  let startIdx = data.hourly.time.findIndex((t) => String(t).slice(0, 13) >= nowHour);
  if (startIdx === -1) startIdx = 0;

  const endIndex = Math.min(data.hourly.time.length, startIdx + count);
  const startTime = data.hourly.time[startIdx];
  const endTime = data.hourly.time[endIndex - 1] || '9999-12-31T23:59';

  const items = [];
  for (let k = startIdx; k < endIndex; k++) {
    const rawProb = data.hourly.precipitation_probability?.[k];
    const isNowSlot = k === startIdx && data.current_weather;
    const temp =
      isNowSlot && typeof data.current_weather.temperature === 'number' && Number.isFinite(data.current_weather.temperature)
        ? data.current_weather.temperature
        : data.hourly.temperature_2m?.[k];
    const code =
      isNowSlot && typeof data.current_weather.weathercode === 'number' && Number.isFinite(data.current_weather.weathercode)
        ? data.current_weather.weathercode
        : data.hourly.weathercode?.[k];
    items.push({
      type: 'hour',
      time: data.hourly.time[k],
      temp,
      code,
      precipProb: typeof rawProb === 'number' && Number.isFinite(rawProb) ? Math.round(rawProb) : null,
    });
  }

  if (data.daily && Array.isArray(data.daily.sunrise) && Array.isArray(data.daily.sunset)) {
    for (let i = 0; i < data.daily.sunrise.length; i++) {
      const sr = data.daily.sunrise[i];
      if (sr && sr >= startTime && sr <= endTime) {
        items.push({ type: 'sunrise', time: sr });
      }
      const ss = data.daily.sunset[i];
      if (ss && ss >= startTime && ss <= endTime) {
        items.push({ type: 'sunset', time: ss });
      }
    }
  }

  items.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return items.slice(0, count);
}

function beaufortFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
  const v = Math.abs(ms);
  if (v <= 0.2) return 0;
  if (v <= 1.5) return 1;
  if (v <= 3.3) return 2;
  if (v <= 5.4) return 3;
  if (v <= 7.9) return 4;
  if (v <= 10.7) return 5;
  if (v <= 13.8) return 6;
  if (v <= 17.1) return 7;
  if (v <= 20.7) return 8;
  if (v <= 24.4) return 9;
  if (v <= 28.4) return 10;
  if (v <= 32.6) return 11;
  return 12;
}

function convertTemp(celsius, unit) {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) return null;
  if (unit === 'F') return celsius * 9 / 5 + 32;
  return celsius;
}

function convertWind(speedKmh, unit) {
  if (typeof speedKmh !== 'number' || !Number.isFinite(speedKmh)) return null;
  if (unit === 'ms') return speedKmh / 3.6;
  if (unit === 'mph') return speedKmh / 1.609344;
  if (unit === 'knots') return speedKmh / 1.852;
  if (unit === 'beaufort') return beaufortFromMs(speedKmh / 3.6);
  return speedKmh;
}

function formatTemp(celsius, unit) {
  const v = convertTemp(celsius, unit);
  if (v === null) return '–';
  const rounded = Math.round(v);
  // Avoid displaying "-0°"
  return `${rounded === 0 ? 0 : rounded}°`;
}

function windDirectionKey(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return COMPASS_KEYS[idx];
}

function hpaToMmHg(hpa) {
  if (typeof hpa !== 'number' || !Number.isFinite(hpa) || hpa <= 0) return null;
  return Math.round(hpa * 0.750062);
}

function computeWeeklyTempBounds(daily) {
  if (!daily || !Array.isArray(daily.temperature_2m_min) || !Array.isArray(daily.temperature_2m_max)) {
    return null;
  }
  const vals = [];
  for (const v of daily.temperature_2m_min) {
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  for (const v of daily.temperature_2m_max) {
    if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length === 0) return null;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

function computeDayRangeFractions(dayMin, dayMax, weekMin, weekMax) {
  if (
    typeof dayMin !== 'number' || !Number.isFinite(dayMin) ||
    typeof dayMax !== 'number' || !Number.isFinite(dayMax) ||
    typeof weekMin !== 'number' || !Number.isFinite(weekMin) ||
    typeof weekMax !== 'number' || !Number.isFinite(weekMax)
  ) {
    return null;
  }
  const lo = Math.min(dayMin, dayMax);
  const hi = Math.max(dayMin, dayMax);
  const span = weekMax - weekMin;
  if (span <= 0.01) {
    return { leftPct: 0, widthPct: 100 };
  }
  const leftPct = Math.max(0, Math.min(100, ((lo - weekMin) / span) * 100));
  const rawWidth = ((hi - lo) / span) * 100;
  const widthPct = Math.max(8, Math.min(100 - leftPct, rawWidth));
  return { leftPct, widthPct };
}

function extractCurrentExtras(data) {
  if (!data) {
    return { feelsLike: null, humidity: null, pressureHpa: null, windDirection: null, precipProb: null };
  }
  const cur = data.current || {};
  const cw = data.current_weather || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const feelsLike = num(cur.apparent_temperature) ?? num(cw.apparent_temperature);
  const humidity = num(cur.relative_humidity_2m) ?? num(cw.relative_humidity_2m);
  const pressureHpa = num(cur.surface_pressure) ?? num(cw.surface_pressure);
  const windDirection = num(cw.winddirection) ?? num(cur.wind_direction_10m);
  const precipProb = num(cur.precipitation_probability) ?? num(data.daily?.precipitation_probability_max?.[0]);
  return { feelsLike, humidity, pressureHpa, windDirection, precipProb };
}

function computeCityClock(data) {
  if (!data || typeof data.utc_offset_seconds !== 'number' || !Number.isFinite(data.utc_offset_seconds)) {
    return null;
  }
  const now = new Date();
  const cityMs = now.getTime() + now.getTimezoneOffset() * 60000 + data.utc_offset_seconds * 1000;
  const d = new Date(cityMs);
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}

const TEMP_COLOR_STOPS = [
  [-20, [59, 130, 246]],   // deep frost blue (#3b82f6)
  [-5, [56, 189, 248]],    // icy sky (#38bdf8)
  [2, [34, 211, 238]],     // cool cyan (#22d3ee)
  [10, [52, 211, 153]],    // mild mint (#34d399)
  [18, [250, 204, 21]],    // warm yellow (#facc15)
  [25, [251, 146, 60]],    // hot orange (#fb923c)
  [34, [239, 68, 68]],     // scorching red (#ef4444)
];

function tempToHexColor(celsius) {
  if (typeof celsius !== 'number' || !Number.isFinite(celsius)) return '#38bdf8';
  const stops = TEMP_COLOR_STOPS;
  if (celsius <= stops[0][0]) {
    const [r, g, b] = stops[0][1];
    return `rgb(${r},${g},${b})`;
  }
  const last = stops[stops.length - 1];
  if (celsius >= last[0]) {
    const [r, g, b] = last[1];
    return `rgb(${r},${g},${b})`;
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (celsius >= t0 && celsius <= t1) {
      const f = (celsius - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return '#38bdf8';
}

function computeTempRangeColors(dayMin, dayMax) {
  const lo = typeof dayMin === 'number' && Number.isFinite(dayMin) ? dayMin : 0;
  const hi = typeof dayMax === 'number' && Number.isFinite(dayMax) ? dayMax : lo;
  return [tempToHexColor(Math.min(lo, hi)), tempToHexColor(Math.max(lo, hi))];
}

function computeCurrentTempPct(currentTemp, weekMin, weekMax, range) {
  if (
    !range ||
    typeof currentTemp !== 'number' || !Number.isFinite(currentTemp) ||
    typeof weekMin !== 'number' || !Number.isFinite(weekMin) ||
    typeof weekMax !== 'number' || !Number.isFinite(weekMax)
  ) {
    return null;
  }
  const span = weekMax - weekMin;
  if (span <= 0.01) return 50;
  const raw = ((currentTemp - weekMin) / span) * 100;
  const lo = range.leftPct;
  const hi = Math.min(100, range.leftPct + range.widthPct);
  return Math.max(lo, Math.min(hi, raw));
}

const COUNTRY_SHORT_MAP = {
  'соединенные штаты америки': 'США',
  'соединённые штаты америки': 'США',
  'соединенные штаты': 'США',
  'соединённые штаты': 'США',
  'united states of america': 'USA',
  'united states': 'USA',
  'российская федерация': 'Россия',
  'russian federation': 'Russia',
  'объединенные арабские эмираты': 'ОАЭ',
  'объединённые арабские эмираты': 'ОАЭ',
  'united arab emirates': 'UAE',
  'соединенное королевство': 'Великобритания',
  'соединённое королевство': 'Великобритания',
  'united kingdom': 'UK',
  'республика корея': 'Южная Корея',
  'republic of korea': 'South Korea',
};

function formatCountryName(country) {
  if (!country || typeof country !== 'string') return '';
  const trimmed = country.trim();
  if (!trimmed || isCoordsLikeText(trimmed)) return '';
  const mapped = COUNTRY_SHORT_MAP[trimmed.toLowerCase()];
  return mapped || trimmed;
}

function formatLocationSubtitle(place, mode = 'both') {
  if (!place || mode === 'hidden') return null;
  const hasCoords =
    typeof place.latitude === 'number' && Number.isFinite(place.latitude) &&
    typeof place.longitude === 'number' && Number.isFinite(place.longitude);
  const coordsLabel = hasCoords ? `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}` : '';
  const rawCountry = formatCountryName(place.country);
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  const countryLabel = rawCountry && norm(rawCountry) !== norm(coordsLabel) ? rawCountry : '';

  if (mode === 'country') {
    return countryLabel || null;
  }
  if (mode === 'coords') {
    return coordsLabel || null;
  }
  if (countryLabel && coordsLabel) return `${countryLabel} · ${coordsLabel}`;
  return countryLabel || coordsLabel || null;
}

export {
  weathercodeToType,
  isNightHour,
  isCoordsLikeText,
  formatCountryName,
  formatLocationSubtitle,
  getHourlyTimeline,
  beaufortFromMs,
  convertWind,
  convertTemp,
  formatTemp,
  windDirectionKey,
  hpaToMmHg,
  computeWeeklyTempBounds,
  computeDayRangeFractions,
  tempToHexColor,
  computeTempRangeColors,
  computeCurrentTempPct,
  extractCurrentExtras,
  computeCityClock,
};

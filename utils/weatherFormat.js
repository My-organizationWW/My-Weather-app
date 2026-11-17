function weathercodeToType(code) {
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 86) return 'showers';
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
  if (!data.hourly || !data.hourly.time) {
    const now = new Date();
    const times = [];
    const temps = [];
    const codes = [];
    const baseTemp = data.current_weather?.temperature ?? 20;
    const baseCode = data.current_weather?.weathercode ?? 0;
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getTime() + i * 3600000);
      const pad = (n) => String(n).padStart(2, '0');
      times.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
      temps.push(baseTemp);
      codes.push(baseCode);
    }
    data = {
      ...data,
      hourly: { time: times, temperature_2m: temps, weathercode: codes }
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
    items.push({
      type: 'hour',
      time: data.hourly.time[k],
      temp: data.hourly.temperature_2m?.[k],
      code: data.hourly.weathercode?.[k],
    });
  }

  if (data.daily && data.daily.sunrise && data.daily.sunset) {
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
  if (unit === 'F') return celsius * 9 / 5 + 32;
  return celsius;
}

function convertWind(speedKmh, unit) {
  if (unit === 'ms') return speedKmh / 3.6;
  if (unit === 'mph') return speedKmh / 1.609344;
  if (unit === 'knots') return speedKmh / 1.852;
  if (unit === 'beaufort') return beaufortFromMs(speedKmh / 3.6);
  return speedKmh;
}

function formatTemp(celsius, unit) {
  return `${Math.round(convertTemp(celsius, unit))}°`;
}

function computeCityClock(data) {
  if (!data || typeof data.utc_offset_seconds !== 'number') return null;
  const now = new Date();
  const cityMs = now.getTime() + now.getTimezoneOffset() * 60000 + data.utc_offset_seconds * 1000;
  const d = new Date(cityMs);
  return (
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}

export { weathercodeToType, isNightHour, isCoordsLikeText, getHourlyTimeline, beaufortFromMs, convertTemp, convertWind, formatTemp, computeCityClock };

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weathercodeToType,
  isNightHour,
  isCoordsLikeText,
  getHourlyTimeline,
  beaufortFromMs,
  convertWind,
  formatTemp,
  computeCityClock,
  convertTemp,
  windDirectionKey,
  hpaToMmHg,
  computeWeeklyTempBounds,
  computeDayRangeFractions,
  tempToHexColor,
  computeTempRangeColors,
  computeCurrentTempPct,
  extractCurrentExtras,
} from '../utils/weatherFormat.js';

test('weathercodeToType maps WMO codes to icon buckets', () => {
  assert.equal(weathercodeToType(0), 'clear');
  assert.equal(weathercodeToType(2), 'partly');
  assert.equal(weathercodeToType(45), 'fog');
  assert.equal(weathercodeToType(63), 'rain');
  assert.equal(weathercodeToType(73), 'snow');
  assert.equal(weathercodeToType(81), 'showers');
  assert.equal(weathercodeToType(82), 'showers');
  assert.equal(weathercodeToType(85), 'snow');
  assert.equal(weathercodeToType(86), 'snow');
  assert.equal(weathercodeToType(95), 'thunder');
});

test('isNightHour uses 21:00-05:59 as night', () => {
  assert.equal(isNightHour('2026-11-17T21:00'), true);
  assert.equal(isNightHour('2026-11-17T05:59'), true);
  assert.equal(isNightHour('2026-11-17T06:00'), false);
  assert.equal(isNightHour('2026-11-17T12:00'), false);
  assert.equal(isNightHour(undefined), false);
});

test('isCoordsLikeText recognises plain coordinate strings only', () => {
  assert.equal(isCoordsLikeText('55.75,37.62'), true);
  assert.equal(isCoordsLikeText(' -33.9 , 151.2 '), true);
  assert.equal(isCoordsLikeText('Russia'), false);
  assert.equal(isCoordsLikeText(''), false);
});

test('temperature and wind conversions', () => {
  assert.equal(convertTemp(0, 'F'), 32);
  assert.equal(convertTemp(100, 'F'), 212);
  assert.equal(convertTemp(21, 'C'), 21);
  assert.equal(formatTemp(-0.4, 'C'), '0°');
  assert.equal(formatTemp(20, 'F'), '68°');
  assert.equal(convertWind(36, 'ms'), 10);
  assert.ok(Math.abs(convertWind(100, 'mph') - 62.1371) < 0.001);
  assert.ok(Math.abs(convertWind(18.52, 'knots') - 10) < 1e-9);
  assert.equal(convertWind(50, 'kmh'), 50);
});

test('beaufortFromMs boundaries', () => {
  assert.equal(beaufortFromMs(0), 0);
  assert.equal(beaufortFromMs(0.2), 0);
  assert.equal(beaufortFromMs(0.3), 1);
  assert.equal(beaufortFromMs(10.7), 5);
  assert.equal(beaufortFromMs(10.8), 6);
  assert.equal(beaufortFromMs(40), 12);
  assert.equal(beaufortFromMs(-5), 3);
  assert.equal(convertWind(36, 'beaufort'), 5);
});

test('computeCityClock needs a numeric utc offset', () => {
  assert.equal(computeCityClock(null), null);
  assert.equal(computeCityClock({}), null);
  assert.match(computeCityClock({ utc_offset_seconds: 3600 }), /^\d{2}:\d{2}$/);
});

function pad(n) {
  return String(n).padStart(2, '0');
}

function localIsoHour(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

test('getHourlyTimeline returns empty for missing data', () => {
  assert.deepEqual(getHourlyTimeline(null), []);
  assert.deepEqual(getHourlyTimeline(undefined), []);
});

test('getHourlyTimeline synthesizes hours from current_weather when hourly is absent', () => {
  const items = getHourlyTimeline({ current_weather: { temperature: 7, weathercode: 3 } }, 5);
  assert.equal(items.length, 5);
  assert.ok(items.every((i) => i.type === 'hour' && i.temp === 7 && i.code === 3));
});

test('getHourlyTimeline starts at the current hour of the city and interleaves sun events', () => {
  const now = new Date();
  const offset = -now.getTimezoneOffset() * 60;
  const cityNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + offset * 1000);
  const hours = Array.from({ length: 30 }, (_, i) => localIsoHour(new Date(cityNow.getTime() + (i - 3) * 3600000)));
  const sunrise = hours[10].slice(0, 11) + hours[10].slice(11, 13) + ':30';
  const data = {
    utc_offset_seconds: offset,
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => i),
      weathercode: hours.map(() => 0),
    },
    daily: { sunrise: [sunrise], sunset: ['1999-01-01T00:00'] },
  };
  const items = getHourlyTimeline(data, 12);
  assert.equal(items.length, 12);
  assert.equal(items[0].type, 'hour');
  assert.equal(items[0].temp, 3, 'first item must be the current hour, not the earliest');
  assert.ok(items.some((i) => i.type === 'sunrise' && i.time === sunrise));
  const times = items.map((i) => i.time);
  assert.deepEqual([...times].sort(), times, 'items are sorted by time');
});

test('getHourlyTimeline syncs the "Now" slot with current_weather so hero and hourly agree', () => {
  const now = new Date();
  const offset = -now.getTimezoneOffset() * 60;
  const cityNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + offset * 1000);
  const hours = Array.from({ length: 6 }, (_, i) => localIsoHour(new Date(cityNow.getTime() + i * 3600000)));
  const data = {
    utc_offset_seconds: offset,
    current_weather: { temperature: 0, weathercode: 85 },
    hourly: {
      time: hours,
      temperature_2m: [1, 0, -1, -1, -2, -2],
      weathercode: [71, 85, 71, 85, 2, 2],
    },
  };
  const items = getHourlyTimeline(data, 6);
  assert.equal(items[0].temp, 0);
  assert.equal(items[0].code, 85);
  assert.equal(weathercodeToType(items[0].code), 'snow');
  assert.equal(items[1].temp, 0);
  assert.equal(items[1].code, 85);
});

test('null and NaN inputs are formatted safely without fake 0° or 32°', () => {
  assert.equal(convertTemp(null, 'C'), null);
  assert.equal(convertTemp(undefined, 'F'), null);
  assert.equal(convertTemp(NaN, 'C'), null);
  assert.equal(formatTemp(null, 'C'), '–');
  assert.equal(formatTemp(undefined, 'F'), '–');
  assert.equal(formatTemp(-0.2, 'C'), '0°');
  assert.equal(convertWind(null, 'kmh'), null);
  assert.equal(convertWind(NaN, 'ms'), null);
});

test('windDirectionKey maps degrees to 8 compass points', () => {
  assert.equal(windDirectionKey(0), 'N');
  assert.equal(windDirectionKey(359), 'N');
  assert.equal(windDirectionKey(45), 'NE');
  assert.equal(windDirectionKey(90), 'E');
  assert.equal(windDirectionKey(225), 'SW');
  assert.equal(windDirectionKey(-90), 'W');
  assert.equal(windDirectionKey(null), null);
});

test('hpaToMmHg converts pressure safely', () => {
  assert.equal(hpaToMmHg(1013.25), 760);
  assert.equal(hpaToMmHg(0), null);
  assert.equal(hpaToMmHg(-5), null);
  assert.equal(hpaToMmHg(null), null);
});

test('weekly temperature bounds and range fractions', () => {
  const daily = { temperature_2m_min: [10, 5, null], temperature_2m_max: [20, 25, 15] };
  assert.deepEqual(computeWeeklyTempBounds(daily), { min: 5, max: 25 });
  assert.equal(computeWeeklyTempBounds(null), null);

  const frac = computeDayRangeFractions(10, 20, 5, 25);
  assert.equal(frac.leftPct, 25);
  assert.equal(frac.widthPct, 50);

  const flat = computeDayRangeFractions(12, 12, 12, 12);
  assert.deepEqual(flat, { leftPct: 0, widthPct: 100 });

  assert.equal(tempToHexColor(-25), 'rgb(59,130,246)');
  assert.equal(tempToHexColor(40), 'rgb(239,68,68)');
  const [cLo, cHi] = computeTempRangeColors(-20, 25);
  assert.equal(cLo, 'rgb(59,130,246)');
  assert.equal(cHi, 'rgb(251,146,60)');

  assert.equal(computeCurrentTempPct(15, 5, 25, frac), 50);
  assert.equal(computeCurrentTempPct(0, 5, 25, frac), 25, 'clamped to day min');
  assert.equal(computeCurrentTempPct(30, 5, 25, frac), 75, 'clamped to day max');
  assert.equal(computeCurrentTempPct(null, 5, 25, frac), null);

  assert.equal(computeDayRangeFractions(null, 20, 5, 25), null);
});

test('extractCurrentExtras reads Open-Meteo current fields and degrades cleanly on 7Timer', () => {
  const om = extractCurrentExtras({
    current_weather: { winddirection: 180 },
    current: { apparent_temperature: 14.5, relative_humidity_2m: 62, surface_pressure: 1015, precipitation_probability: 35 },
  });
  assert.deepEqual(om, { feelsLike: 14.5, humidity: 62, pressureHpa: 1015, windDirection: 180, precipProb: 35 });

  const st = extractCurrentExtras({ current_weather: { temperature: 10, winddirection: 90 } });
  assert.deepEqual(st, { feelsLike: null, humidity: null, pressureHpa: null, windDirection: 90, precipProb: null });
});

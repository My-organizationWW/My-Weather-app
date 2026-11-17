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
} from '../utils/weatherFormat.js';

test('weathercodeToType maps WMO codes to icon buckets', () => {
  assert.equal(weathercodeToType(0), 'clear');
  assert.equal(weathercodeToType(2), 'partly');
  assert.equal(weathercodeToType(45), 'fog');
  assert.equal(weathercodeToType(63), 'rain');
  assert.equal(weathercodeToType(73), 'snow');
  assert.equal(weathercodeToType(81), 'showers');
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

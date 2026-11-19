import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seventimerToForecast,
  normalizeOpenMeteoForecast,
  nominatimToHit,
  shouldTripCircuitForError,
  tripOmCircuit,
  omDown,
  closeOmCircuit,
  resetOmCircuit,
  OM_CIRCUIT_TTL_MS,
} from '../utils/weatherProvidersCore.js';

test('seventimerToForecast normalizes 3h series to 1h steps and filters -9999 sentinel', () => {
  const st = {
    init: '2026111712',
    dataseries: [
      { timepoint: 3, temp2m: 10, weather: 'clearday', wind10m: { speed: 5, direction: 'NE' } },
      { timepoint: 6, temp2m: 16, weather: 'tsrainnight', prec_amount: 4, wind10m: { speed: 8, direction: 'SW' } },
      { timepoint: 9, temp2m: -9999, weather: 'humidnight', wind10m: { speed: -1, direction: '' } },
    ],
  };
  const nowMs = Date.UTC(2026, 10, 17, 15, 30);
  const res = seventimerToForecast(st, 55.75, 37.61, nowMs);
  assert.equal(res.source, '7timer');
  assert.equal(res.current_weather.temperature, 10);
  assert.equal(res.current_weather.weathercode, 0);
  assert.equal(res.current_weather.is_day, 1);
  assert.equal(res.current_weather.winddirection, 45);
  assert.equal(res.current_weather.windspeed, 18);
  // 3h -> 1h interpolation between 10 and 16 gives 10, 12, 14, 16
  assert.deepEqual(res.hourly.temperature_2m.slice(0, 4), [10, 12, 14, 16]);
  // -9999 sentinel must NOT leak into daily min/max
  assert.equal(res.daily.temperature_2m_min[0], 10);
  assert.equal(res.daily.temperature_2m_max[0], 16);
});

test('seventimerToForecast rejects missing series or malformed init', () => {
  assert.throws(() => seventimerToForecast({}, 0, 0), /empty series/);
  assert.throws(() => seventimerToForecast({ init: 'bad', dataseries: [{}] }, 0, 0), /empty series/);
});

test('normalizeOpenMeteoForecast handles current_weather and current shapes', () => {
  const a = normalizeOpenMeteoForecast({ current_weather: { temperature: 12, weathercode: 2 } });
  assert.equal(a.source, 'open-meteo');
  assert.equal(a.current_weather.temperature, 12);

  const b = normalizeOpenMeteoForecast({ current: { temperature_2m: -5, weather_code: 73, wind_speed_10m: 12 } });
  assert.equal(b.current_weather.temperature, -5);
  assert.equal(b.current_weather.weathercode, 73);
  assert.equal(b.current_weather.windspeed, 12);

  assert.equal(normalizeOpenMeteoForecast({ error: true, reason: 'Bad request' }), null);
});

test('nominatimToHit extracts cities and rejects bad coordinates', () => {
  const city = nominatimToHit({
    lat: '55.75',
    lon: '37.61',
    type: 'city',
    class: 'place',
    address: { city: 'Москва', country: 'Россия' },
  });
  assert.deepEqual(city, { name: 'Москва', country: 'Россия', latitude: 55.75, longitude: 37.61, feature_code: 'PPL' });

  const region = nominatimToHit({
    lat: '55',
    lon: '37',
    type: 'administrative',
    class: 'boundary',
    address: { state: 'Московская область', country: 'Россия' },
  });
  assert.equal(region.feature_code, 'ADM2');

  assert.equal(nominatimToHit({ lat: 'NaN', lon: '10', address: { city: 'X' } }), null);
});

test('circuit breaker policy skips external aborts and client 4xx, trips on 5xx/429/network', () => {
  resetOmCircuit();
  assert.equal(shouldTripCircuitForError({ isExternalAbort: true }), false);
  assert.equal(shouldTripCircuitForError({ kind: 'http', status: 400 }), false);
  assert.equal(shouldTripCircuitForError({ kind: 'http', status: 404 }), false);
  assert.equal(shouldTripCircuitForError({ kind: 'http', status: 429 }), true);
  assert.equal(shouldTripCircuitForError({ kind: 'http', status: 503 }), true);
  assert.equal(shouldTripCircuitForError(new TypeError('network')), true);

  const t0 = 1_000_000;
  tripOmCircuit(t0);
  assert.equal(omDown(t0 + 1000), true);
  assert.equal(omDown(t0 + OM_CIRCUIT_TTL_MS + 1), false);
  closeOmCircuit();
  assert.equal(omDown(t0 + 1000), false);
});

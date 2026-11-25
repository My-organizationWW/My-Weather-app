import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndSanitizeCitiesBackup } from '../utils/citiesBackupParser.js';

test('parses valid wrapped and bare array backups', () => {
  const wrapped = JSON.stringify({
    app: 'MyWeather',
    version: 1,
    cities: [
      { name: 'Москва', latitude: 55.75, longitude: 37.61 },
      { name: 'Сочи' },
    ],
  });
  const res1 = parseAndSanitizeCitiesBackup(wrapped, { idPrefix: 't' });
  assert.equal(res1.count, 2);
  assert.equal(res1.skipped, 0);
  assert.deepEqual(res1.cities[0], { id: 't-0', name: 'Москва', latitude: 55.75, longitude: 37.61 });
  assert.deepEqual(res1.cities[1], { id: 't-1', name: 'Сочи' });

  const bare = JSON.stringify([{ name: 'Berlin', latitude: 52.52, longitude: 13.4 }]);
  const res2 = parseAndSanitizeCitiesBackup(bare, { idPrefix: 'b' });
  assert.equal(res2.count, 1);
  assert.equal(res2.cities[0].name, 'Berlin');
});

test('prevents Null Island (0,0) corruption from null, empty string, or boolean coords', () => {
  const payload = JSON.stringify({
    cities: [
      { name: 'NullCoords', latitude: null, longitude: null },
      { name: 'EmptyCoords', latitude: '', longitude: '' },
      { name: 'BoolCoords', latitude: false, longitude: true },
      { name: 'RealZero', latitude: 0, longitude: 0 },
    ],
  });
  const res = parseAndSanitizeCitiesBackup(payload);
  assert.equal(res.cities[0].latitude, undefined);
  assert.equal(res.cities[1].latitude, undefined);
  assert.equal(res.cities[2].latitude, undefined);
  assert.equal(res.cities[3].latitude, 0);
  assert.equal(res.cities[3].longitude, 0);
});

test('strips out-of-range coordinates, control chars, duplicates and enforces maxCities', () => {
  const payload = JSON.stringify([
    { name: '  Лондон\u0007  ', latitude: 95, longitude: 0 },
    { name: 'лондон', latitude: 51.5, longitude: -0.1 },
    { name: '   ' },
    null,
    42,
    { name: 'Токио', latitude: 35.67, longitude: 139.65 },
    { name: 'Париж', latitude: 48.85, longitude: 2.35 },
  ]);
  const res = parseAndSanitizeCitiesBackup(payload, { maxCities: 2 });
  assert.equal(res.count, 2);
  assert.equal(res.skipped, 5);
  assert.equal(res.cities[0].name, 'Лондон');
  assert.equal(res.cities[0].latitude, undefined);
  assert.equal(res.cities[1].name, 'Токио');
  assert.equal(res.cities[1].latitude, 35.67);
});

test('rejects broken JSON, non-array structures and empty valid lists', () => {
  assert.throws(() => parseAndSanitizeCitiesBackup('not json'), /bad-file/);
  assert.throws(() => parseAndSanitizeCitiesBackup('{"foo":1}'), /bad-file/);
  assert.throws(() => parseAndSanitizeCitiesBackup('[]'), /bad-file/);
  assert.throws(() => parseAndSanitizeCitiesBackup(JSON.stringify([{ name: '  ' }])), /bad-file/);
});

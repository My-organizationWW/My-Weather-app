import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPluralSelectedText } from '../utils/plural.js';

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

const ru = flatten(JSON.parse(fs.readFileSync(new URL('../locales/ru.json', import.meta.url), 'utf8')));
const en = flatten(JSON.parse(fs.readFileSync(new URL('../locales/en.json', import.meta.url), 'utf8')));

test('locales/ru.json and locales/en.json have 100% key parity and non-empty strings', () => {
  const onlyRu = Object.keys(ru).filter((k) => !(k in en));
  const onlyEn = Object.keys(en).filter((k) => !(k in ru));
  assert.deepEqual(onlyRu, [], `Keys only in ru.json: ${onlyRu.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Keys only in en.json: ${onlyEn.join(', ')}`);

  for (const [k, v] of Object.entries(ru)) {
    assert.equal(typeof v, 'string', `ru.${k} must be a string`);
    assert.ok(v.trim().length > 0, `ru.${k} must not be empty`);
  }
  for (const [k, v] of Object.entries(en)) {
    assert.equal(typeof v, 'string', `en.${k} must be a string`);
    assert.ok(v.trim().length > 0, `en.${k} must not be empty`);
  }
});

test('every static i18n key referenced in app source exists in both ru.json and en.json', () => {
  const files = [
    'App.js',
    'WeatherApp.js',
    'CityListScreen.js',
    'DraggableCityCard.js',
    'CurrentLocationCard.js',
    'ConfirmDeleteModal.js',
    'WeatherPhenomenonFinder.js',
    'SettingsScreen.js',
    'NetworkDiagnosticsScreen.js',
    'components/CitiesImportModal.js',
    'components/CrashLogViewer.js',
    'components/GlobalErrorBoundary.js',
  ];
  const missing = [];
  for (const rel of files) {
    const src = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr|i18n\.t)\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g)) {
      const key = m[1];
      if (!(key in ru) || !(key in en)) {
        missing.push(`${rel}: ${key}`);
      }
    }
  }
  assert.deepEqual(missing, [], `Missing i18n keys: ${missing.join(', ')}`);
});

test('getPluralSelectedText handles Russian plural categories (1, 2-4, 5-20, 21, 22, 25)', () => {
  const mockT = (key, { count }) => `${key}:${count}`;
  assert.equal(getPluralSelectedText(1, mockT), 'cities.selected_count_one:1');
  assert.equal(getPluralSelectedText(2, mockT), 'cities.selected_count_few:2');
  assert.equal(getPluralSelectedText(4, mockT), 'cities.selected_count_few:4');
  assert.equal(getPluralSelectedText(5, mockT), 'cities.selected_count_many:5');
  assert.equal(getPluralSelectedText(11, mockT), 'cities.selected_count_many:11');
  assert.equal(getPluralSelectedText(14, mockT), 'cities.selected_count_many:14');
  assert.equal(getPluralSelectedText(21, mockT), 'cities.selected_count_one:21');
  assert.equal(getPluralSelectedText(22, mockT), 'cities.selected_count_few:22');
  assert.equal(getPluralSelectedText(25, mockT), 'cities.selected_count_many:25');
});

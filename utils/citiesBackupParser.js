// Pure, Expo-independent parser/sanitizer for saved-cities JSON backups.
// Tested directly via `node --test`.

export const DEFAULT_MAX_CITIES = 200;

function parseValidCoord(raw, min, max) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') {
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

function sanitizeCityName(raw) {
  if (typeof raw !== 'string') return '';
  // Strip control characters and collapse surrounding whitespace.
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 100);
}

/**
 * Validates and sanitizes a JSON cities backup string.
 * Accepts `{ cities: [...] }` or a bare `[...]` array.
 * Drops empty/non-object entries, rejects out-of-range/null coords (preventing
 * Null Island 0,0 corruption), deduplicates by lowercased name, and caps size.
 */
export function parseAndSanitizeCitiesBackup(text, options = {}) {
  const { maxCities = DEFAULT_MAX_CITIES, idPrefix = Date.now().toString(36) } = options;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('bad-file');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('bad-file');
  }
  const arr = Array.isArray(parsed) ? parsed : parsed?.cities;
  if (!Array.isArray(arr)) {
    throw new Error('bad-file');
  }

  const cities = [];
  const seenNames = new Set();
  for (const item of arr) {
    if (cities.length >= maxCities) break;
    if (!item || typeof item !== 'object') continue;
    const name = sanitizeCityName(item.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const entry = { id: `${idPrefix}-${cities.length}`, name };
    const lat = parseValidCoord(item.latitude, -90, 90);
    const lon = parseValidCoord(item.longitude, -180, 180);
    if (lat !== null && lon !== null) {
      entry.latitude = lat;
      entry.longitude = lon;
    }
    cities.push(entry);
  }

  if (cities.length === 0) {
    throw new Error('bad-file');
  }

  return {
    cities,
    count: cities.length,
    skipped: arr.length - cities.length,
    total: arr.length,
  };
}

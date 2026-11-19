// Multi-provider weather layer: Open-Meteo primary, keyless fallbacks.
//
// Why: Open-Meteo's forecast host (api.open-meteo.com) is SNI/DPI-blocked
// on some RU providers and VPN exits while sibling hosts stay reachable.
//   forecast: Open-Meteo full -> 7Timer civil (normalized to the SAME shape)
//   search:   Open-Meteo geocoding (with transliteration) -> Nominatim
//   reverse:  (extended in geocoding.js) native -> OM -> BigDataCloud -> Nominatim
//
// Circuit breaker: once Open-Meteo fails with a transport/timeout/429/5xx error,
// its flag stays down for OM_CIRCUIT_TTL_MS. External aborts (superseded request)
// and non-429 client 4xx do NOT trip the circuit.

import { geocodeCity as omGeocodeCity, isRegionLike } from '../geocoding';
import { sleep } from './netprobe';
import { isExternalAbortError } from './http';
import {
  omDown,
  tripOmCircuit,
  closeOmCircuit,
  resetOmCircuit,
  shouldTripCircuitForError,
  seventimerToForecast,
  normalizeOpenMeteoForecast,
  nominatimToHit,
} from './weatherProvidersCore';

export { seventimerToForecast, resetOmCircuit };

async function fetchSeventimer(lat, lon, fetchFn) {
  const data = await fetchFn(
    `https://www.7timer.info/bin/api.pl?lon=${lon}&lat=${lat}&product=civil&output=json`
  );
  return seventimerToForecast(data, lat, lon);
}

export async function fetchForecast(lat, lon, fetchFn, omUrl) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Invalid coordinates');
  }
  if (!omDown()) {
    try {
      const data = await fetchFn(omUrl);
      const normalized = normalizeOpenMeteoForecast(data);
      if (normalized) {
        closeOmCircuit();
        return normalized;
      }
    } catch (e) {
      if (isExternalAbortError(e)) throw e;
      if (shouldTripCircuitForError(e)) {
        tripOmCircuit();
      }
    }
  }
  // 7Timer is a free hobby service: occasionally slower than a single timeout.
  // One retry (warm connection, 400ms gap) cures most transient failures;
  // external aborts propagate immediately without retrying.
  try {
    return await fetchSeventimer(lat, lon, fetchFn);
  } catch (e) {
    if (isExternalAbortError(e)) throw e;
    await sleep(400);
    return await fetchSeventimer(lat, lon, fetchFn);
  }
}

async function searchNominatim(query, lang, fetchFn) {
  const data = await fetchFn(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5&accept-language=${lang || 'ru'}`
  );
  if (!Array.isArray(data) || data.length === 0) return null;
  let regionFallback = null;
  for (const item of data) {
    const hit = nominatimToHit(item);
    if (!hit) continue;
    if (!isRegionLike(hit)) return hit;
    if (!regionFallback) regionFallback = hit;
  }
  return regionFallback;
}

export async function searchCity(query, lang, fetchFn) {
  const q = String(query || '').trim();
  if (!q) return null;
  let omError = null;
  try {
    const hit = await omGeocodeCity(q, lang, fetchFn);
    if (hit) return { ...hit, source: 'open-meteo' };
  } catch (e) {
    if (isExternalAbortError(e)) throw e;
    omError = e;
  }
  try {
    const hit = await searchNominatim(q, lang, fetchFn);
    if (hit) return { ...hit, source: 'nominatim' };
  } catch (e) {
    if (isExternalAbortError(e)) throw e;
  }
  if (omError) throw omError;
  return null;
}

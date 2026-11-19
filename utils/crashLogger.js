import * as FileSystem from 'expo-file-system/legacy';
import { getAppStorageRoot, ensureDir } from './appStorage';

export const INTERNAL_LOG_FOLDER = 'logs';
export const MAX_LOG_FILES = 20;
export const MAX_LOG_CHARS = 64 * 1024;

function trimLogContent(content) {
  const s = String(content || '');
  if (s.length <= MAX_LOG_CHARS) return s;
  return `${s.slice(0, MAX_LOG_CHARS)}\n\n[...truncated at ${MAX_LOG_CHARS} chars]`;
}

async function pruneOldLogs(dir, trailingSlash) {
  try {
    const names = await FileSystem.readDirectoryAsync(dir);
    const crashNames = names
      .filter((name) => name.startsWith('crash_') && name.endsWith('.txt'))
      .sort()
      .reverse();
    const toDelete = crashNames.slice(MAX_LOG_FILES);
    for (const name of toDelete) {
      const path = trailingSlash ? `${dir}${name}` : `${dir}/${name}`;
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Internal sandbox: /data/user/0/<package>/files/logs (always writable,
// readable only in-app on release builds).
// ---------------------------------------------------------------------------
export function getInternalLogDir() {
  const base = FileSystem.documentDirectory;
  if (!base) return null;
  return `${base.endsWith('/') ? base : `${base}/`}${INTERNAL_LOG_FOLDER}`;
}

async function writeInternal(timestamp, content) {
  const dir = getInternalLogDir();
  if (!dir) throw new Error('documentDirectory is null');
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  const filePath = `${dir}/crash_${timestamp}.txt`;
  await FileSystem.writeAsStringAsync(filePath, trimLogContent(content));
  await pruneOldLogs(dir, false);
  return filePath;
}

export async function listInternalLogs() {
  try {
    const dir = getInternalLogDir();
    if (!dir) return [];
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) return [];
    const names = await FileSystem.readDirectoryAsync(dir);
    const files = [];
    for (const name of names) {
      if (!name.endsWith('.txt') && !name.endsWith('.csv')) continue;
      try {
        const info = await FileSystem.getInfoAsync(`${dir}/${name}`);
        files.push({
          name,
          path: `${dir}/${name}`,
          size: info.size ?? 0,
          mtime: info.modificationTime ?? 0,
          location: 'internal',
        });
      } catch (e) {}
    }
    files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return files;
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// App-owned folder: <app storage>/MyWeatherApp/logs
// (Android: /sdcard/Android/data/<package>/files/MyWeatherApp/logs).
// No SAF, no permission prompt, nothing for the user to create — the
// directory is auto-created on first write. Pullable via adb.
// ---------------------------------------------------------------------------
export function getPublicLogDir() {
  const root = getAppStorageRoot();
  return root ? `${root}logs/` : null;
}

export async function ensurePublicLogDir() {
  const dir = getPublicLogDir();
  if (!dir) throw new Error('no app storage base');
  return ensureDir(dir);
}

async function writePublic(timestamp, content) {
  const dir = await ensurePublicLogDir();
  const filePath = `${dir}crash_${timestamp}.txt`;
  await FileSystem.writeAsStringAsync(filePath, trimLogContent(content));
  await pruneOldLogs(dir, true);
  return filePath;
}

export async function listDownloadLogs() {
  try {
    const dir = getPublicLogDir();
    if (!dir) return [];
    const dirInfo = await FileSystem.getInfoAsync(dir);
    if (!dirInfo.exists) return [];
    const names = await FileSystem.readDirectoryAsync(dir);
    const files = [];
    for (const name of names) {
      if (!name.endsWith('.txt') && !name.endsWith('.csv')) continue;
      try {
        const info = await FileSystem.getInfoAsync(`${dir}${name}`);
        files.push({
          name,
          path: `${dir}${name}`,
          size: info.size ?? 0,
          mtime: info.modificationTime ?? 0,
          location: 'download',
        });
      } catch (e) {
        files.push({ name, path: `${dir}${name}`, size: 0, mtime: 0, location: 'download' });
      }
    }
    files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    return files;
  } catch (e) {
    return [];
  }
}

export async function readDownloadLog(path) {
  return FileSystem.readAsStringAsync(path);
}

export async function deleteDownloadLog(path) {
  return FileSystem.deleteAsync(path, { idempotent: true });
}

// ---------------------------------------------------------------------------
// Main entry: builds the report, tries the app folder (adb-readable) first,
// falls back to the internal sandbox. Never throws.
// ---------------------------------------------------------------------------
export async function logCrash(error, errorInfo = {}, appState = {}) {
  const timestamp = Date.now();

  const errorDetails = [
    '=== Crash Report ===',
    `Timestamp: ${new Date().toISOString()}`,
    `Timestamp (ms): ${timestamp}`,
    `Error Message: ${error?.message || 'Unknown'}`,
    `Stack Trace: ${error?.stack || 'No stack available'}`,
    `Component Stack: ${errorInfo?.componentStack || 'No stack available'}`,
    '--- App State Snapshot ---',
    `Theme: ${appState.theme || 'unknown'}`,
    `Language: ${appState.language || 'unknown'}`,
    `Cities Count: ${appState.cities?.length ?? appState.citiesCount ?? 0}`,
    `Selected City: ${appState.selectedCity || 'none'}`,
    '------------------------',
  ];

  const content = errorDetails.join('\n');
  let lastError = null;

  try {
    const path = await writePublic(timestamp, content);
    return { path, location: 'download' };
  } catch (e) {
    lastError = e;
  }

  try {
    const path = await writeInternal(timestamp, content);
    return { path, location: 'internal' };
  } catch (e) {
    lastError = e;
  }

  console.error('Failed to write crash log:', lastError);
  return null;
}

// ---------------------------------------------------------------------------
// Self-test: writes, reads back and deletes a probe file in the app folder.
// Used by the in-app viewer to diagnose storage problems on the spot.
// ---------------------------------------------------------------------------
export async function testLogWrite() {
  try {
    const dir = await ensurePublicLogDir();
    const probe = `${dir}selftest_probe.txt`;
    await FileSystem.writeAsStringAsync(probe, 'ok');
    const back = await FileSystem.readAsStringAsync(probe);
    await FileSystem.deleteAsync(probe, { idempotent: true });
    if (back !== 'ok') return { ok: false, error: 'read-back mismatch' };
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, error: `${e?.message || e}` };
  }
}

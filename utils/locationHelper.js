// Resilient foreground location acquisition for Android/iOS (Expo Go compatible).
//
// Why this exists:
// Right after the user taps "Allow" in Android's runtime permission dialog,
// FusedLocationProviderClient is cold for this UID and expo-location's
// `getCurrentPositionAsync` frequently resolves with `null` -> throws
// `CurrentLocationIsUnavailableException` immediately, while waking up the
// provider in the background (so the user's *second* tap works).
//
// Strategy:
//  1. Optionally request foreground permission; track `justGranted`.
//  2. If `justGranted`, wait briefly (~350ms) so Activity resumes & AppOps settle.
//  3. Fast path: recent OS last-known fix (<3 min, <=2km accuracy).
//  4. Single-shot `getCurrentPositionAsync` (Balanced) with a tight timeout.
//  5. Cold-start fallback: one-shot `watchPositionAsync` (Low accuracy = cell/Wi-Fi,
//     fast indoors and works with Android 12+ Approximate permission too) — unlike
//     `getCurrentPositionAsync`, `requestLocationUpdates` actually waits for the
//     first real fix instead of rejecting on a cold null. Always unsubscribes.
//  6. Last resort: any-age `getLastKnownPositionAsync()` (now often warmed up).

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label = 'location timeout') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

function hasValidCoords(pos) {
  return Boolean(
    pos &&
    pos.coords &&
    typeof pos.coords.latitude === 'number' &&
    Number.isFinite(pos.coords.latitude) &&
    typeof pos.coords.longitude === 'number' &&
    Number.isFinite(pos.coords.longitude),
  );
}

async function waitForFirstWatchFix(locationApi, accuracy, timeoutMs) {
  if (typeof locationApi.watchPositionAsync !== 'function') return null;
  let sub = null;
  let timer = null;
  let settled = false;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (sub) {
      const toRemove = sub;
      sub = null;
      try {
        toRemove.remove();
      } catch (e) {}
    }
  };

  return new Promise((resolve) => {
    const finish = (pos) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(hasValidCoords(pos) ? pos : null);
    };

    timer = setTimeout(() => finish(null), timeoutMs);

    Promise.resolve()
      .then(() =>
        locationApi.watchPositionAsync(
          {
            accuracy,
            timeInterval: 500,
            distanceInterval: 0,
            mayShowUserSettingsDialog: false,
          },
          (loc) => {
            if (hasValidCoords(loc)) finish(loc);
          },
        ),
      )
      .then((subscription) => {
        if (settled) {
          try {
            subscription?.remove();
          } catch (e) {}
        } else {
          sub = subscription;
        }
      })
      .catch(() => finish(null));
  });
}

/**
 * Acquires the device's foreground location reliably, including right after
 * runtime permission is first granted.
 *
 * Returns `{ status: 'granted', position }` | `{ status: 'denied' }` | `{ status: 'unavailable' }`.
 */
export async function acquireCurrentPosition(locationApi, options = {}) {
  const {
    requestPermission = true,
    settleAfterGrantMs = 350,
    lastKnownMaxAgeMs = 180000,
    lastKnownMaxAccuracyM = 2000,
    singleShotTimeoutMs = 5000,
    watchTimeoutMs = 7000,
    watchTimeoutAfterGrantMs = 9000,
    sleep = defaultSleep,
  } = options;

  let { status } = await locationApi.getForegroundPermissionsAsync();
  let justGranted = false;
  if (status !== 'granted') {
    if (!requestPermission) {
      return { status: 'denied' };
    }
    const perm = await locationApi.requestForegroundPermissionsAsync();
    status = perm.status;
    justGranted = status === 'granted';
  }
  if (status !== 'granted') {
    return { status: 'denied' };
  }

  if (justGranted && settleAfterGrantMs > 0) {
    await sleep(settleAfterGrantMs);
  }

  // 1. Fast path: recent cached OS fix.
  try {
    const cached = await locationApi.getLastKnownPositionAsync({
      maxAge: lastKnownMaxAgeMs,
      requiredAccuracy: lastKnownMaxAccuracyM,
    });
    if (hasValidCoords(cached)) {
      return { status: 'granted', position: cached };
    }
  } catch (e) {}

  const balanced = locationApi.Accuracy?.Balanced ?? 3;
  const low = locationApi.Accuracy?.Low ?? 2;

  // 2. Standard single-shot fix.
  try {
    const pos = await withTimeout(
      locationApi.getCurrentPositionAsync({ accuracy: balanced }),
      singleShotTimeoutMs,
      'gps single-shot timeout',
    );
    if (hasValidCoords(pos)) {
      return { status: 'granted', position: pos };
    }
  } catch (e) {}

  // 3. Cold-provider fallback: one-shot watchPositionAsync actually waits for
  // the first fix after permission grant instead of failing on a cold null.
  const watchFix = await waitForFirstWatchFix(
    locationApi,
    low,
    justGranted ? watchTimeoutAfterGrantMs : watchTimeoutMs,
  );
  if (hasValidCoords(watchFix)) {
    return { status: 'granted', position: watchFix };
  }

  // 4. Last resort: any-age last known fix (previous attempts often warm up cache).
  try {
    const fallback = await locationApi.getLastKnownPositionAsync();
    if (hasValidCoords(fallback)) {
      return { status: 'granted', position: fallback };
    }
  } catch (e) {}

  return { status: 'unavailable' };
}

// Resilient foreground location acquisition for Android/iOS (Expo Go compatible).
//
// Why this exists:
//  1. Right after the user taps "Allow" in Android's runtime permission dialog,
//     FusedLocationProviderClient is cold for this UID and expo-location's
//     `getCurrentPositionAsync` frequently resolves with `null` -> throws
//     `CurrentLocationIsUnavailableException` immediately, while waking up the
//     provider in the background.
//  2. When device location is turned OFF, `getCurrentPositionAsync` opens
//     Google Play Services' `LocationSettingsCheckerActivity` ("Turn on
//     location?"). If a JS timeout is already ticking while the user reads
//     that dialog, the timer expires before or right as GPS turns on. And if
//     the user taps "No thanks", falling back to `watchPositionAsync` would
//     waste another 7-9s waiting on a disabled provider.
//
// Strategy:
//  1. Check/request foreground permission; track `justGranted`.
//  2. Check `hasServicesEnabledAsync()`. If disabled:
//     - in passive mode (`requestPermission: false`), try `getLastKnownPositionAsync`
//       once and otherwise bail immediately with `'services_disabled'` (never pop
//       up a system settings dialog unprompted on CityListScreen);
//     - in interactive mode, call `enableNetworkProviderAsync()` BEFORE starting
//       any fix timeout so dialog interaction time is never counted against the
//       fix budget. If the user declines the dialog, bail immediately.
//  3. If `justGranted` or `justEnabledServices`, wait briefly (~350ms) so
//     Activity resumes & FusedLocationProvider settles.
//  4. Fast path: recent OS last-known fix (<3 min, <=2km accuracy) — ~160ms.
//  5. Single-shot `getCurrentPositionAsync` (Balanced, `mayShowUserSettingsDialog: false`)
//     with a 6.5s timeout (cold Wi-Fi/cell/GNSS scan after enabling GPS takes ~4.5-5.3s).
//  6. Cold-provider fallback: one-shot `watchPositionAsync` (Low accuracy = cell/Wi-Fi,
//     fast indoors and works with Android 12+ Approximate permission too). Always unsubscribes.
//  7. Last resort: any-age `getLastKnownPositionAsync()`.

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
 * runtime permission is first granted or location services are toggled on.
 *
 * Returns `{ status: 'granted', position }` | `{ status: 'denied' }` |
 * `{ status: 'services_disabled' }` | `{ status: 'unavailable' }`.
 */
export async function acquireCurrentPosition(locationApi, options = {}) {
  const {
    requestPermission = true,
    promptEnableServices = requestPermission,
    settleAfterGrantMs = 350,
    lastKnownMaxAgeMs = 180000,
    lastKnownMaxAccuracyM = 2000,
    singleShotTimeoutMs = 6500,
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

  // Check if location services are enabled before starting any fix timers.
  let justEnabledServices = false;
  if (typeof locationApi.hasServicesEnabledAsync === 'function') {
    let enabled = true;
    try {
      enabled = await locationApi.hasServicesEnabledAsync();
    } catch (e) {
      enabled = true;
    }

    if (!enabled) {
      if (!promptEnableServices) {
        try {
          const cached = await locationApi.getLastKnownPositionAsync();
          if (hasValidCoords(cached)) {
            return { status: 'granted', position: cached };
          }
        } catch (e) {}
        return { status: 'services_disabled' };
      }

      if (typeof locationApi.enableNetworkProviderAsync === 'function') {
        try {
          await locationApi.enableNetworkProviderAsync();
          justEnabledServices = true;
        } catch (e) {
          // User declined the "Turn on Location?" dialog -> stop immediately.
          let nowEnabled = false;
          try {
            nowEnabled = await locationApi.hasServicesEnabledAsync();
          } catch {}
          if (!nowEnabled) {
            return { status: 'services_disabled' };
          }
          justEnabledServices = true;
        }
      } else {
        return { status: 'services_disabled' };
      }
    }
  } else if (promptEnableServices && typeof locationApi.enableNetworkProviderAsync === 'function') {
    // Ensure network provider is active on Android ("Device only" mode fix)
    // before starting the fix countdown.
    try {
      await locationApi.enableNetworkProviderAsync();
    } catch (e) {}
  }

  const isColdStart = justGranted || justEnabledServices;
  if (isColdStart && settleAfterGrantMs > 0) {
    await sleep(settleAfterGrantMs);
  }

  // 1. Fast path: recent cached OS fix (skip when GPS was just turned on, since
  // FusedLocationProvider clears its cache on enable).
  if (!justEnabledServices) {
    try {
      const cached = await locationApi.getLastKnownPositionAsync({
        maxAge: lastKnownMaxAgeMs,
        requiredAccuracy: lastKnownMaxAccuracyM,
      });
      if (hasValidCoords(cached)) {
        return { status: 'granted', position: cached };
      }
    } catch (e) {}
  }

  const balanced = locationApi.Accuracy?.Balanced ?? 3;
  const low = locationApi.Accuracy?.Low ?? 2;

  // 2. Standard single-shot fix (dialog already handled above).
  try {
    const pos = await withTimeout(
      locationApi.getCurrentPositionAsync({
        accuracy: balanced,
        mayShowUserSettingsDialog: false,
      }),
      singleShotTimeoutMs,
      'gps single-shot timeout',
    );
    if (hasValidCoords(pos)) {
      return { status: 'granted', position: pos };
    }
  } catch (e) {}

  // 3. Cold-provider fallback: one-shot watchPositionAsync actually waits for
  // the first fix after permission grant / GPS enable instead of failing on a cold null.
  const watchFix = await waitForFirstWatchFix(
    locationApi,
    low,
    isColdStart ? watchTimeoutAfterGrantMs : watchTimeoutMs,
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

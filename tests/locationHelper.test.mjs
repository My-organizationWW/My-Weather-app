import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCurrentPosition } from '../utils/locationHelper.js';

const noSleep = async () => {};

test('fresh permission grant settles and falls back to watchPositionAsync when getCurrentPositionAsync fails cold', async () => {
  const sleeps = [];
  let removed = false;
  const mockLocation = {
    Accuracy: { Low: 2, Balanced: 3 },
    getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }),
    requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => {
      throw new Error('Current location is unavailable');
    },
    watchPositionAsync: async (_opts, cb) => {
      setTimeout(() => cb({ coords: { latitude: 55.75, longitude: 37.61, accuracy: 25 } }), 10);
      return { remove: () => { removed = true; } };
    },
  };

  const res = await acquireCurrentPosition(mockLocation, {
    settleAfterGrantMs: 350,
    watchTimeoutAfterGrantMs: 500,
    sleep: async (ms) => { sleeps.push(ms); },
  });

  assert.equal(res.status, 'granted');
  assert.deepEqual(res.position.coords, { latitude: 55.75, longitude: 37.61, accuracy: 25 });
  assert.deepEqual(sleeps, [350]);
  assert.equal(removed, true, 'watch subscription must be cleaned up immediately after first fix');
});

test('fast path returns fresh lastKnown position without waking GPS', async () => {
  let currentCalled = 0;
  let watchCalled = 0;
  const mockLocation = {
    Accuracy: { Low: 2, Balanced: 3 },
    getForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    getLastKnownPositionAsync: async () => ({ coords: { latitude: 43.11, longitude: 131.87, accuracy: 50 } }),
    getCurrentPositionAsync: async () => { currentCalled++; return null; },
    watchPositionAsync: async () => { watchCalled++; return { remove() {} }; },
  };

  const res = await acquireCurrentPosition(mockLocation, { sleep: noSleep });
  assert.equal(res.status, 'granted');
  assert.equal(res.position.coords.latitude, 43.11);
  assert.equal(currentCalled, 0);
  assert.equal(watchCalled, 0);
});

test('returns denied without prompting when requestPermission is false', async () => {
  let prompted = 0;
  const mockLocation = {
    getForegroundPermissionsAsync: async () => ({ status: 'undetermined' }),
    requestForegroundPermissionsAsync: async () => { prompted++; return { status: 'granted' }; },
  };

  const res = await acquireCurrentPosition(mockLocation, { requestPermission: false, sleep: noSleep });
  assert.deepEqual(res, { status: 'denied' });
  assert.equal(prompted, 0);
});

test('returns unavailable and cleans up subscription when all location legs fail or time out', async () => {
  let removed = false;
  const mockLocation = {
    Accuracy: { Low: 2, Balanced: 3 },
    getForegroundPermissionsAsync: async () => ({ status: 'granted' }),
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async () => new Promise(() => {}),
    watchPositionAsync: async () => ({ remove: () => { removed = true; } }),
  };

  const res = await acquireCurrentPosition(mockLocation, {
    singleShotTimeoutMs: 15,
    watchTimeoutMs: 20,
    sleep: noSleep,
  });

  assert.deepEqual(res, { status: 'unavailable' });
  assert.equal(removed, true);
});

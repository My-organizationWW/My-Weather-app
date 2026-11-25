import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, fetchJsonWithRetry, isRetryableStatus, retryDelayMs, isExternalAbortError } from '../utils/http.js';

const json = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  json: async () => body,
});

const noSleep = async () => {};

test('isRetryableStatus covers 429 and 5xx only', () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(200), false);
});

test('retryDelayMs honours Retry-After and caps it', () => {
  assert.equal(retryDelayMs(json(429, {}, { 'retry-after': '2' }), 0), 2000);
  assert.equal(retryDelayMs(json(429, {}, { 'retry-after': '120' }), 0), 3000);
  assert.equal(retryDelayMs(json(500, {}), 0, 600), 600);
  assert.equal(retryDelayMs(json(500, {}), 1, 600), 1200);
  assert.equal(retryDelayMs(json(500, {}), 20, 600), 3000);
});

test('returns parsed body on 200', async () => {
  const data = await fetchJsonWithRetry('u', { fetchImpl: async () => json(200, { ok: 1 }), sleep: noSleep });
  assert.deepEqual(data, { ok: 1 });
});

test('4xx throws HttpError without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('u', { fetchImpl: async () => (calls++, json(404, { reason: 'x' })), sleep: noSleep }),
    (e) => e instanceof HttpError && e.status === 404 && e.kind === 'http'
  );
  assert.equal(calls, 1);
});

test('5xx is retried once then succeeds', async () => {
  const seq = [json(503, {}), json(200, { temp: 5 })];
  let calls = 0;
  const data = await fetchJsonWithRetry('u', { fetchImpl: async () => seq[calls++], sleep: noSleep });
  assert.deepEqual(data, { temp: 5 });
  assert.equal(calls, 2);
});

test('persistent 429 gives up after the retry budget with HttpError', async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    fetchJsonWithRetry('u', {
      retries: 2,
      fetchImpl: async () => (calls++, json(429, {}, { 'retry-after': '1' })),
      sleep: async (ms) => sleeps.push(ms),
    }),
    (e) => e instanceof HttpError && e.status === 429
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('network errors propagate untouched and are not retried', async () => {
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('u', { fetchImpl: async () => { calls++; throw new TypeError('Network request failed'); }, sleep: noSleep }),
    (e) => e instanceof TypeError
  );
  assert.equal(calls, 1);
});

test('timeout aborts a hanging request with AbortError', async () => {
  await assert.rejects(
    fetchJsonWithRetry('u', {
      timeoutMs: 20,
      fetchImpl: (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      sleep: noSleep,
    }),
    (e) => e.name === 'AbortError' && e.isTimeout === true && !isExternalAbortError(e)
  );
});

test('pre-aborted external signal rejects immediately without calling fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('u', {
      signal: controller.signal,
      fetchImpl: async () => (calls++, json(200, {})),
      sleep: noSleep,
    }),
    (e) => isExternalAbortError(e)
  );
  assert.equal(calls, 0);
});

test('external signal aborts during retry backoff without a second fetch', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    fetchJsonWithRetry('u', {
      retries: 2,
      baseDelayMs: 5000,
      signal: controller.signal,
      fetchImpl: async () => {
        calls++;
        setTimeout(() => controller.abort(), 15);
        return json(503, {});
      },
    }),
    (e) => isExternalAbortError(e)
  );
  assert.equal(calls, 1);
});

// HTTP helper shared by weather/geocoding calls.
//
// Differences from a bare `fetch(url).then(r => r.json())`:
//  - non-2xx responses throw HttpError instead of leaking an error body
//    ({"error":true,"reason":...}) into code that expects forecast data;
//  - 429 and 5xx are retried with a short pause (Retry-After honoured, capped);
//  - network failures and timeouts are NOT retried here: callers already have
//    fallbacks and a circuit breaker, and a second 10s wait would only make a
//    dead host feel slower;
//  - optional external `signal` aborts immediately (both in-flight fetch and
//    retry backoff) with `err.isExternalAbort = true`, so callers can ignore
//    superseded requests without triggering error banners or circuit breakers.

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.kind = 'http';
    this.status = status;
    this.url = url;
  }
}

export function createAbortError(external = false) {
  const err = new Error(external ? 'Aborted' : 'Timeout');
  err.name = 'AbortError';
  if (external) err.isExternalAbort = true;
  else err.isTimeout = true;
  return err;
}

export function isExternalAbortError(err) {
  return Boolean(err && err.isExternalAbort === true);
}

export const isRetryableStatus = (status) => status === 429 || (status >= 500 && status <= 599);

export function retryDelayMs(res, attempt, baseMs = 600, capMs = 3000) {
  const header = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  const seconds = header === null || header === undefined || header === '' ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, capMs);
  return Math.min(baseMs * (attempt + 1), capMs);
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(true));
      return;
    }
    const timer = setTimeout(() => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = signal
      ? () => {
          clearTimeout(timer);
          reject(createAbortError(true));
        }
      : null;
    if (signal && onAbort) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

export async function fetchJsonWithRetry(url, options = {}) {
  const {
    timeoutMs = 10000,
    retries = 1,
    fetchImpl = fetch,
    sleep = defaultSleep,
    baseDelayMs = 600,
    signal,
    headers,
  } = options;

  if (signal?.aborted) {
    throw createAbortError(true);
  }

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let externallyAborted = false;

    const onExternalAbort = () => {
      externallyAborted = true;
      controller.abort();
    };
    if (signal) {
      if (signal.aborted) {
        throw createAbortError(true);
      }
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const init = headers ? { signal: controller.signal, headers } : { signal: controller.signal };
      const res = await fetchImpl(url, init);
      if (!res.ok) {
        if (isRetryableStatus(res.status) && attempt < retries) {
          const delay = retryDelayMs(res, attempt, baseDelayMs);
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onExternalAbort);
          await sleep(delay, signal);
          if (signal?.aborted) throw createAbortError(true);
          continue;
        }
        throw new HttpError(res.status, url);
      }
      return await res.json();
    } catch (e) {
      if (externallyAborted || signal?.aborted) {
        throw createAbortError(true);
      }
      if (timedOut && e && e.name === 'AbortError') {
        e.isTimeout = true;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

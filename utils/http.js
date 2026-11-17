// HTTP helper shared by weather/geocoding calls.
//
// Differences from a bare `fetch(url).then(r => r.json())`:
//  - non-2xx responses throw HttpError instead of leaking an error body
//    ({"error":true,"reason":...}) into code that expects forecast data;
//  - 429 and 5xx are retried with a short pause (Retry-After honoured, capped);
//  - network failures and timeouts are NOT retried here: callers already have
//    fallbacks and a circuit breaker, and a second 10s wait would only make a
//    dead host feel slower.

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.kind = 'http';
    this.status = status;
    this.url = url;
  }
}

export const isRetryableStatus = (status) => status === 429 || (status >= 500 && status <= 599);

export function retryDelayMs(res, attempt, baseMs = 600, capMs = 3000) {
  const header = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  const seconds = header === null || header === undefined || header === '' ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, capMs);
  return Math.min(baseMs * (attempt + 1), capMs);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJsonWithRetry(url, options = {}) {
  const {
    timeoutMs = 10000,
    retries = 1,
    fetchImpl = fetch,
    sleep = defaultSleep,
    baseDelayMs = 600,
  } = options;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) {
        if (isRetryableStatus(res.status) && attempt < retries) {
          const delay = retryDelayMs(res, attempt, baseDelayMs);
          clearTimeout(timer);
          await sleep(delay);
          continue;
        }
        throw new HttpError(res.status, url);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

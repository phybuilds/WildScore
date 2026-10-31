// Bounded retry policy for later WildScore SAM/Spark orchestration.
// Dependency-injected: makes no network call and never reads an API key.
// Retries only HTTP 429, HTTP 500-599, explicit timeouts and explicit
// connection errors. Never logs error bodies, headers, credentials or
// operation values.

export const META_RETRY_DEFAULT_MAX_ATTEMPTS = 3;
export const META_RETRY_MIN_ATTEMPTS = 1;
export const META_RETRY_MAX_ATTEMPTS = 3;
export const META_RETRY_BASE_DELAY_MS = 500;
export const META_RETRY_MAX_WAIT_MS = 60_000;

function isObjectLike(value) {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function readStatus(error) {
  if (!isObjectLike(error)) return undefined;
  const raw = error.status ?? error.statusCode;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed)) return parsed;
  }
  return undefined;
}

function readRetryAfterRaw(error) {
  if (!isObjectLike(error)) return undefined;
  if (error.retryAfter !== undefined) return error.retryAfter;
  const headers = error.headers;
  if (isObjectLike(headers)) {
    if (headers["retry-after"] !== undefined) return headers["retry-after"];
    if (headers["Retry-After"] !== undefined) return headers["Retry-After"];
  }
  return undefined;
}

// Classification helper: deterministic and side-effect free.
export function isRetryableError(error) {
  if (!isObjectLike(error)) return false;
  const status = readStatus(error);
  if (status !== undefined && status >= 400 && status <= 499 && status !== 429) {
    return false;
  }
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return error.isTimeout === true || error.isConnectionError === true;
}

// Parse a Retry-After value (non-negative seconds as number/numeric string,
// or an HTTP date) into milliseconds. Returns undefined when invalid.
// Past HTTP dates resolve to 0 (retry immediately).
export function parseRetryAfterMs(value, nowMs = Date.now()) {
  const now =
    typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return undefined;
    return value * 1000;
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return undefined;
    if (/^\d+(\.\d+)?$/.test(text)) {
      const seconds = Number(text);
      if (!Number.isFinite(seconds) || seconds < 0) return undefined;
      return seconds * 1000;
    }
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return undefined;
    return Math.max(0, parsed - now);
  }
  return undefined;
}

function checkedRandom(random) {
  if (typeof random !== "function") {
    throw new TypeError("random must be a function.");
  }
  const value = random();
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("random must return a finite number in [0, 1].");
  }
  return value;
}

// Delay helper: Retry-After wins when valid, otherwise equalised jitter
// around exponential backoff (base 500ms, doubling per retry). Every wait
// is capped at 60,000 ms. retryIndex is 0 for the first retry.
export function resolveRetryDelayMs(error, retryIndex = 0, deps = {}) {
  const { random = Math.random, now = Date.now } = deps;
  if (!Number.isInteger(retryIndex) || retryIndex < 0) {
    throw new RangeError("retryIndex must be a non-negative integer.");
  }
  if (typeof random !== "function") {
    throw new TypeError("random must be a function.");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }
  const raw = readRetryAfterRaw(error);
  if (raw !== undefined) {
    const parsed = parseRetryAfterMs(raw, now());
    if (parsed !== undefined) {
      return Math.min(parsed, META_RETRY_MAX_WAIT_MS);
    }
  }
  const ceiling = META_RETRY_BASE_DELAY_MS * 2 ** retryIndex;
  const jitter = checkedRandom(random);
  const delay = ceiling / 2 + (ceiling / 2) * jitter;
  return Math.min(delay, META_RETRY_MAX_WAIT_MS);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withMetaRetry(operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function.");
  }
  const {
    maxAttempts = META_RETRY_DEFAULT_MAX_ATTEMPTS,
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new RangeError("maxAttempts must be an integer from 1 through 3.");
  }
  if (typeof sleep !== "function") {
    throw new TypeError("sleep must be a function.");
  }
  if (typeof random !== "function") {
    throw new TypeError("random must be a function.");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function.");
  }

  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }
      const delay = resolveRetryDelayMs(error, attempt - 1, { random, now });
      await sleep(delay);
    }
  }
}

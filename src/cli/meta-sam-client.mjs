// Privacy-safe Meta SAM streaming boundary for later WildScore orchestration.
// Dependency-injected: never reads files, environment variables or media,
// never logs credentials, and makes no request unless runMetaSam is called.

export const META_SAM_URL = "https://api.meta.ai/v1/responses";
export const META_SAM_MODEL = "sam-3.1";
export const META_SAM_TIMEOUT_MS = 600_000;
export const META_SAM_CONCEPT = "animal";

const META_SAM_ERROR_BODY_LIMIT = 16 * 1024;
const META_SAM_EVENT_LIMIT = 2 * 1024 * 1024;
const META_SAM_TOKEN_LIMIT = 64;
const META_SAM_RETRY_AFTER_LIMIT = 256;
const FILE_ID_PATTERN = /^file-\d+$/;

function sanitizeToken(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/u.test(text)) return null;
  return text.slice(0, META_SAM_TOKEN_LIMIT);
}

function sanitizeRetryAfter(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return String(value).slice(0, META_SAM_RETRY_AFTER_LIMIT);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    return text.slice(0, META_SAM_RETRY_AFTER_LIMIT);
  }
  if (Number.isNaN(Date.parse(text))) return null;
  return text.slice(0, META_SAM_RETRY_AFTER_LIMIT);
}

function normalizeStatus(value) {
  return Number.isInteger(value) ? value : null;
}

// The stage is intentionally generic: it never carries operation values.
function normalizeStage() {
  return "request";
}

export class MetaSamApiError extends Error {
  constructor({
    stage = "request",
    status = null,
    type = null,
    code = null,
    retryAfter = null,
    isTimeout = false,
    isConnectionError = false,
  } = {}) {
    super("meta sam request failed");
    this.name = "MetaSamApiError";
    this.stage = normalizeStage(stage);
    this.status = normalizeStatus(status);
    this.type = sanitizeToken(type);
    this.code = sanitizeToken(code);
    this.retryAfter = sanitizeRetryAfter(retryAfter);
    this.isTimeout = isTimeout === true;
    this.isConnectionError = isConnectionError === true;
  }
}

function isMetaSamApiError(value) {
  return value instanceof MetaSamApiError;
}

function defaultCreateSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function resolveFetch(fetchImpl) {
  let impl = fetchImpl;
  if (
    impl !== null &&
    typeof impl === "object" &&
    typeof impl.fetch === "function"
  ) {
    impl = impl.fetch;
  }
  if (typeof impl !== "function") {
    throw new TypeError("fetch must be a function.");
  }
  return impl;
}

function resolveSignalFactory(createSignal) {
  if (createSignal === undefined) return defaultCreateSignal;
  if (typeof createSignal !== "function") {
    throw new TypeError("signal factory must be a function.");
  }
  return createSignal;
}

function unwrapSignal(produced) {
  const signal =
    produced !== null &&
    typeof produced === "object" &&
    produced.signal instanceof AbortSignal
      ? produced.signal
      : produced;
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError("signal factory must return an AbortSignal.");
  }
  return signal;
}

function checkApiKey(apiKey) {
  if (
    typeof apiKey !== "string" ||
    apiKey.trim() === "" ||
    apiKey !== apiKey.trim()
  ) {
    throw new TypeError("apiKey must be a non-empty string.");
  }
}

function checkFileId(fileId) {
  if (typeof fileId !== "string" || !FILE_ID_PATTERN.test(fileId)) {
    throw new TypeError("fileId must match file-<digits>.");
  }
}

function normalizeArgs(args) {
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    ("fileId" in args[0] ||
      "file_id" in args[0] ||
      "id" in args[0] ||
      "apiKey" in args[0] ||
      "consumeEvents" in args[0] ||
      "consume" in args[0])
  ) {
    const opts = args[0];
    return {
      fileId: opts.fileId ?? opts.file_id ?? opts.id,
      apiKey: opts.apiKey ?? opts.key,
      fetchImpl: opts.fetch ?? opts.fetchImpl,
      createSignal:
        opts.createSignal ?? opts.createAbortSignal ?? opts.signalFactory,
      consumeEvents: opts.consumeEvents ?? opts.consume ?? opts.onEvents,
    };
  }
  const [fileId, apiKey, fetchImpl, createSignal, consumeEvents] = args;
  return { fileId, apiKey, fetchImpl, createSignal, consumeEvents };
}

function responseStatusOf(response) {
  if (response !== null && typeof response === "object") {
    return normalizeStatus(response.status);
  }
  return null;
}

function responseOkOf(response) {
  if (response !== null && typeof response === "object") {
    if (typeof response.ok === "boolean") return response.ok;
    if (Number.isInteger(response.status)) {
      return response.status >= 200 && response.status < 300;
    }
  }
  return false;
}

function readRetryAfterHeader(response) {
  try {
    const headers = response?.headers;
    if (headers !== null && typeof headers === "object") {
      if (typeof headers.get === "function") {
        const clean = sanitizeRetryAfter(headers.get("retry-after"));
        if (clean !== null) return clean;
      } else {
        const raw =
          headers["retry-after"] ??
          headers["Retry-After"] ??
          headers["RETRY-AFTER"];
        const clean = sanitizeRetryAfter(raw);
        if (clean !== null) return clean;
      }
    }
  } catch {
    // Ignore header access failures; absence means no retry hint.
  }
  return null;
}

function parseBoundedErrorFields(text) {
  let fields = { type: null, code: null };
  try {
    const parsed = JSON.parse(text);
    const node =
      parsed !== null && typeof parsed === "object" ? parsed.error : undefined;
    if (node !== null && typeof node === "object") {
      fields = {
        type: sanitizeToken(node.type),
        code: sanitizeToken(node.code),
      };
    }
  } catch {
    // Unparseable bodies carry no provider fields.
  }
  return fields;
}

async function readBoundedResponseText(response) {
  const reader = response?.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let text = "";
    let byteCount = 0;
    try {
      while (byteCount < META_SAM_ERROR_BODY_LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes =
          value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
        const remaining = META_SAM_ERROR_BODY_LIMIT - byteCount;
        const bounded = bytes.subarray(0, remaining);
        byteCount += bounded.byteLength;
        text += decoder.decode(bounded, {
          stream: byteCount < META_SAM_ERROR_BODY_LIMIT,
        });
        if (bounded.byteLength < bytes.byteLength) break;
      }
      text += decoder.decode();
      return text;
    } finally {
      try {
        await reader.cancel();
      } catch {
        // The body may already be closed.
      }
    }
  }
  if (response !== null && typeof response.text === "function") {
    return String(await response.text()).slice(0, META_SAM_ERROR_BODY_LIMIT);
  }
  return "";
}

async function buildHttpError(response) {
  const status = responseStatusOf(response);
  const retryAfter = readRetryAfterHeader(response);
  let bounded = "";
  try {
    bounded = await readBoundedResponseText(response);
  } catch {
    bounded = "";
  }
  const { type, code } = parseBoundedErrorFields(bounded);
  return new MetaSamApiError({
    stage: "request",
    status,
    type,
    code,
    retryAfter,
    isTimeout: false,
    isConnectionError: false,
  });
}

function isAbortFailure(error, signal) {
  try {
    if (signal instanceof AbortSignal && signal.aborted) return true;
  } catch {
    // Fall through to name-based detection.
  }
  if (error !== null && typeof error === "object") {
    const name = error.name;
    if (name === "AbortError" || name === "TimeoutError") return true;
  }
  return false;
}

function toSafeNetworkError({ error, signal }) {
  if (isMetaSamApiError(error)) return error;
  const timeout = isAbortFailure(error, signal);
  return new MetaSamApiError({
    stage: "request",
    status: null,
    type: null,
    code: null,
    retryAfter: null,
    isTimeout: timeout,
    isConnectionError: !timeout,
  });
}

function byteLengthOf(text) {
  if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
  return new TextEncoder().encode(text).byteLength;
}

function findEventBoundary(text) {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (lf !== -1 && (crlf === -1 || lf < crlf)) return { end: lf, length: 2 };
  return { end: crlf, length: 4 };
}

function toStreamReader(body) {
  if (body !== null && typeof body === "object") {
    if (typeof body.getReader === "function") {
      try {
        const reader = body.getReader();
        if (reader !== null && typeof reader.read === "function") {
          return reader;
        }
      } catch {
        return null;
      }
    }
    if (typeof body[Symbol.asyncIterator] === "function") {
      const iterator = body[Symbol.asyncIterator]();
      return {
        read: () => iterator.next(),
        cancel: async () => {
          try {
            await iterator.return?.();
          } catch {
            // The iterator may already be closed.
          }
        },
      };
    }
  }
  return null;
}

function chunkToText(value, decoder) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return decoder.decode(value, { stream: true });
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) {
    return decoder.decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      { stream: true },
    );
  }
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
    return decoder.decode(new Uint8Array(value), { stream: true });
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

function decodeEventBlock(block, tracker) {
  const fail = () =>
    new MetaSamApiError({ stage: "request", status: tracker.status });
  if (byteLengthOf(block) > META_SAM_EVENT_LIMIT) throw fail();
  const lines = block.split(/\r\n|\n|\r/);
  const parts = [];
  let hasData = false;
  for (const line of lines) {
    if (line === "") continue;
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      hasData = true;
      const rest = line.slice(5);
      parts.push(rest.startsWith(" ") ? rest.slice(1) : rest);
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9-]*:/.test(line)) continue;
  }
  if (!hasData) return undefined;
  const data = parts.join("\n");
  if (data === "[DONE]") return undefined;
  if (byteLengthOf(data) > META_SAM_EVENT_LIMIT) throw fail();
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw fail();
  }
  const type =
    parsed !== null && typeof parsed === "object" ? parsed.type : undefined;
  if (tracker.completedCount === 1) {
    throw fail();
  }
  if (
    type === "error" ||
    type === "response.failed" ||
    type === "response.incomplete"
  ) {
    throw fail();
  }
  if (type === "response.completed") {
    tracker.completedCount += 1;
    if (tracker.completedCount > 1) throw fail();
    tracker.completed = parsed;
  }
  return parsed;
}

async function* iterateResponseEvents(reader, tracker) {
  const decoder = new TextDecoder();
  let buffer = "";
  const fail = () =>
    new MetaSamApiError({ stage: "request", status: tracker.status });
  try {
    for (;;) {
      let result;
      try {
        result = await reader.read();
      } catch {
        throw fail();
      }
      if (result.done) break;
      buffer += chunkToText(result.value, decoder);
      let boundary = findEventBoundary(buffer);
      while (boundary !== null) {
        const block = buffer.slice(0, boundary.end);
        buffer = buffer.slice(boundary.end + boundary.length);
        const event = decodeEventBlock(block, tracker);
        if (event !== undefined) yield event;
        boundary = findEventBoundary(buffer);
      }
      if (byteLengthOf(buffer) > META_SAM_EVENT_LIMIT) throw fail();
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") throw fail();
    if (tracker.completedCount !== 1) throw fail();
    tracker.exhausted = true;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body may already be closed.
    }
  }
}

function projectUsage(completed) {
  const usage = {};
  const response =
    completed !== null && typeof completed === "object"
      ? completed.response
      : null;
  const source =
    response !== null && typeof response === "object" ? response.usage : null;
  if (source !== null && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
      ) {
        usage[key] = value;
      }
    }
  }
  return usage;
}

export async function runMetaSam(...args) {
  const opts = normalizeArgs(args);
  checkFileId(opts.fileId);
  checkApiKey(opts.apiKey);
  const fetchFn = resolveFetch(opts.fetchImpl);
  const signalFactory = resolveSignalFactory(opts.createSignal);
  if (typeof opts.consumeEvents !== "function") {
    throw new TypeError("consumeEvents must be a function.");
  }

  const signal = unwrapSignal(signalFactory(META_SAM_TIMEOUT_MS));
  let response;
  try {
    response = await fetchFn(META_SAM_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: META_SAM_MODEL,
        store: false,
        stream: true,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: META_SAM_CONCEPT },
              { type: "input_video", file_id: opts.fileId },
            ],
          },
        ],
        metadata: { include_confidence: "true", mask_encoding: "one_bit" },
      }),
      signal,
    });
  } catch (error) {
    throw toSafeNetworkError({ error, signal });
  }
  if (!responseOkOf(response)) {
    throw await buildHttpError(response);
  }
  const status = responseStatusOf(response);
  const reader = toStreamReader(response?.body);
  if (reader === null) {
    throw new MetaSamApiError({ stage: "request", status });
  }
  const tracker = {
    status,
    completedCount: 0,
    completed: null,
    exhausted: false,
  };
  const events = iterateResponseEvents(reader, tracker);
  let summary;
  try {
    summary = await opts.consumeEvents(events);
  } catch {
    try {
      await events.return(undefined);
    } catch {
      // Cleanup only; the safe error below carries the failure.
    }
    throw new MetaSamApiError({ stage: "request", status });
  }
  if (tracker.exhausted !== true && tracker.completedCount !== 1) {
    try {
      await events.return(undefined);
    } catch {
      // Cleanup only; the safe error below carries the failure.
    }
    throw new MetaSamApiError({ stage: "request", status });
  }
  if (tracker.exhausted !== true) {
    try {
      await events.return(undefined);
    } catch {
      // response.completed is terminal; cleanup cannot change the result.
    }
  }
  return { summary, usage: projectUsage(tracker.completed) };
}

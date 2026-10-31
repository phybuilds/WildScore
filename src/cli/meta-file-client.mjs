// Privacy-safe Meta file lifecycle boundary for later SAM orchestration.
// Dependency-injected: never reads env/files/media, never logs credentials,
// and makes no request unless uploadMetaVideo/deleteMetaFile is called.

export const META_FILE_BASE_URL = "https://api.meta.ai/v1";
export const META_FILE_MAX_BYTES = 500 * 1024 * 1024;
export const META_UPLOAD_TIMEOUT_MS = 120_000;
export const META_DELETE_TIMEOUT_MS = 30_000;
const META_ERROR_BODY_LIMIT = 16 * 1024;
const META_TOKEN_LIMIT = 64;
const META_RETRY_AFTER_LIMIT = 256;
const FILE_ID_PATTERN = /^file-\d+$/;

function defaultCreateSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

function sanitizeToken(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^[a-z0-9_]+$/u.test(text)) return null;
  return text.slice(0, META_TOKEN_LIMIT);
}

function sanitizeRetryAfter(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return String(value).slice(0, META_RETRY_AFTER_LIMIT);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^\d+(?:\.\d+)?$/u.test(text)) {
    return text.slice(0, META_RETRY_AFTER_LIMIT);
  }
  if (Number.isNaN(Date.parse(text))) return null;
  return text.slice(0, META_RETRY_AFTER_LIMIT);
}

function normalizeStatus(value) {
  return Number.isInteger(value) ? value : null;
}

function normalizeStage(value) {
  return value === "upload" || value === "delete" ? value : "request";
}

export class MetaFileApiError extends Error {
  constructor({
    stage = "request",
    status = null,
    type = null,
    code = null,
    retryAfter = null,
    isTimeout = false,
    isConnectionError = false,
  } = {}) {
    super(`meta file ${normalizeStage(stage)} failed`);
    this.name = "MetaFileApiError";
    this.stage = normalizeStage(stage);
    this.status = normalizeStatus(status);
    this.type = sanitizeToken(type);
    this.code = sanitizeToken(code);
    this.retryAfter = sanitizeRetryAfter(retryAfter);
    this.isTimeout = isTimeout === true;
    this.isConnectionError = isConnectionError === true;
  }
}

function isMetaFileApiError(value) {
  return value instanceof MetaFileApiError;
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

function isBlobLike(value) {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function checkApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim() === "" || apiKey !== apiKey.trim()) {
    throw new TypeError("apiKey must be a non-empty string.");
  }
}

function checkUploadBlob(blob) {
  if (!isBlobLike(blob)) {
    throw new TypeError("blob must be a Blob.");
  }
  if (blob.type !== "video/mp4") {
    throw new RangeError("blob must have type video/mp4.");
  }
  if (!Number.isFinite(blob.size) || blob.size <= 0) {
    throw new RangeError("blob must be non-empty.");
  }
  if (blob.size > META_FILE_MAX_BYTES) {
    throw new RangeError("blob exceeds the 500 MiB limit.");
  }
}

function checkFileId(fileId) {
  if (typeof fileId !== "string" || !FILE_ID_PATTERN.test(fileId)) {
    throw new TypeError("fileId must match file-<digits>.");
  }
}

function normalizeUploadArgs(blob, apiKey, fetchImpl, createSignal) {
  if (
    blob !== null &&
    typeof blob === "object" &&
    !(typeof Blob !== "undefined" && blob instanceof Blob) &&
    ("blob" in blob || "apiKey" in blob || "fetch" in blob)
  ) {
    const opts = blob;
    return {
      blob: opts.blob,
      apiKey: opts.apiKey,
      fetchImpl: opts.fetch ?? opts.fetchImpl,
      createSignal: opts.createSignal ?? opts.createAbortSignal,
    };
  }
  return { blob, apiKey, fetchImpl, createSignal };
}

function normalizeDeleteArgs(fileId, apiKey, fetchImpl, createSignal) {
  if (
    fileId !== null &&
    typeof fileId === "object" &&
    ("fileId" in fileId || "id" in fileId || "apiKey" in fileId)
  ) {
    const opts = fileId;
    return {
      fileId: opts.fileId ?? opts.id,
      apiKey: opts.apiKey,
      fetchImpl: opts.fetch ?? opts.fetchImpl,
      createSignal: opts.createSignal ?? opts.createAbortSignal,
    };
  }
  return { fileId, apiKey, fetchImpl, createSignal };
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
        const raw = headers.get("retry-after");
        const clean = sanitizeRetryAfter(raw);
        if (clean !== null) return clean;
      } else {
        const raw =
          headers["retry-after"] ?? headers["Retry-After"] ?? headers["RETRY-AFTER"];
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
      fields = { type: sanitizeToken(node.type), code: sanitizeToken(node.code) };
    }
  } catch {
    // Unparseable bodies carry no provider fields.
  }
  return fields;
}

async function buildHttpError({ stage, response }) {
  const status = responseStatusOf(response);
  const retryAfter = readRetryAfterHeader(response);
  let bounded = "";
  try {
    bounded = await readBoundedResponseText(response);
  } catch {
    bounded = "";
  }
  const { type, code } = parseBoundedErrorFields(bounded);
  return new MetaFileApiError({
    stage,
    status,
    type,
    code,
    retryAfter,
    isTimeout: false,
    isConnectionError: false,
  });
}

async function readBoundedResponseText(response) {
  const reader = response?.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let text = "";
    let byteCount = 0;
    try {
      while (byteCount < META_ERROR_BODY_LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
        const remaining = META_ERROR_BODY_LIMIT - byteCount;
        const bounded = bytes.subarray(0, remaining);
        byteCount += bounded.byteLength;
        text += decoder.decode(bounded, { stream: byteCount < META_ERROR_BODY_LIMIT });
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
    return String(await response.text()).slice(0, META_ERROR_BODY_LIMIT);
  }
  return "";
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

function toSafeNetworkError({ stage, error, signal }) {
  if (isMetaFileApiError(error)) return error;
  const timeout = isAbortFailure(error, signal);
  return new MetaFileApiError({
    stage,
    status: null,
    type: null,
    code: null,
    retryAfter: null,
    isTimeout: timeout,
    isConnectionError: !timeout,
  });
}

function checkPositiveIntWithinLimit(value) {
  return (
    Number.isInteger(value) && value > 0 && value <= META_FILE_MAX_BYTES
  );
}

function checkExpiresAt(value) {
  if (value === null || value === undefined) return true;
  return Number.isInteger(value) && value > 0;
}

export async function uploadMetaVideo(blob, apiKey, fetchImpl, createSignal) {
  const args = normalizeUploadArgs(blob, apiKey, fetchImpl, createSignal);
  checkUploadBlob(args.blob);
  checkApiKey(args.apiKey);
  const fetchFn = resolveFetch(args.fetchImpl);
  const signalFactory = resolveSignalFactory(args.createSignal);

  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", "3600");
  form.append("file", args.blob, "analysis.mp4");

  const signal = unwrapSignal(signalFactory(META_UPLOAD_TIMEOUT_MS));
  let response;
  try {
    response = await fetchFn(`${META_FILE_BASE_URL}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal,
    });
  } catch (error) {
    throw toSafeNetworkError({ stage: "upload", error, signal });
  }
  if (!responseOkOf(response)) {
    throw await buildHttpError({ stage: "upload", response });
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new MetaFileApiError({ stage: "upload", status: responseStatusOf(response) });
  }
  const id = data !== null && typeof data === "object" ? data.id : undefined;
  const bytes = data !== null && typeof data === "object" ? data.bytes : undefined;
  const hasExpiresAt =
    data !== null && typeof data === "object" && Object.hasOwn(data, "expires_at");
  const expiresAt = hasExpiresAt ? data.expires_at : undefined;
  if (
    typeof id !== "string" ||
    !FILE_ID_PATTERN.test(id) ||
    !checkPositiveIntWithinLimit(bytes) ||
    bytes !== args.blob.size ||
    !hasExpiresAt ||
    !checkExpiresAt(expiresAt)
  ) {
    throw new MetaFileApiError({
      stage: "upload",
      status: responseStatusOf(response),
    });
  }
  return { id, bytes, expiresAt };
}

export async function deleteMetaFile(fileId, apiKey, fetchImpl, createSignal) {
  const args = normalizeDeleteArgs(fileId, apiKey, fetchImpl, createSignal);
  checkFileId(args.fileId);
  checkApiKey(args.apiKey);
  const fetchFn = resolveFetch(args.fetchImpl);
  const signalFactory = resolveSignalFactory(args.createSignal);

  const signal = unwrapSignal(signalFactory(META_DELETE_TIMEOUT_MS));
  const url = `${META_FILE_BASE_URL}/files/${encodeURIComponent(args.fileId)}`;
  let response;
  try {
    response = await fetchFn(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${args.apiKey}` },
      signal,
    });
  } catch (error) {
    throw toSafeNetworkError({ stage: "delete", error, signal });
  }
  if (!responseOkOf(response)) {
    throw await buildHttpError({ stage: "delete", response });
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new MetaFileApiError({ stage: "delete", status: responseStatusOf(response) });
  }
  if (
    data === null ||
    typeof data !== "object" ||
    data.id !== args.fileId ||
    data.object !== "file" ||
    data.deleted !== true
  ) {
    throw new MetaFileApiError({
      stage: "delete",
      status: responseStatusOf(response),
    });
  }
  return { id: args.fileId, deleted: true };
}

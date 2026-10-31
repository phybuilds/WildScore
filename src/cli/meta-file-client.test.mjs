import { test } from "node:test";
import assert from "node:assert/strict";
import {
  META_FILE_BASE_URL,
  MetaFileApiError,
  deleteMetaFile,
  uploadMetaVideo,
} from "./meta-file-client.mjs";

const KEY = "test-key-sentinel";
const OTHER_MARKER = "PROVIDER-SAYS-NOPE-UNIQUE-77881";

function tinyMp4(content = "tiny-video-bytes") {
  return new Blob([content], { type: "video/mp4" });
}

function captureFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts, calls.length);
  };
  return { fn, calls };
}

function okUploadRes(overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    async json() {
      return {
        id: "file-123",
        bytes: tinyMp4().size,
        expires_at: 9_999_999,
        filename: "should-never-leak.mp4",
        object: "file",
        ...overrides,
      };
    },
    async text() {
      return JSON.stringify({ id: "file-123" });
    },
  };
}

function errorRes({
  status = 400,
  body = { error: { type: "invalid_request", code: "bad_blob" } },
  rawText,
  retryAfter,
} = {}) {
  const headers = new Headers();
  if (retryAfter !== undefined) headers.set("retry-after", retryAfter);
  return {
    ok: false,
    status,
    headers,
    async json() {
      return body;
    },
    async text() {
      if (rawText !== undefined) return rawText;
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

// --- pinned URL + field order + headers ---

test("upload posts to pinned URL with ordered fields and bearer header", async () => {
  const seenTimeouts = [];
  const { fn, calls } = captureFetch(() => okUploadRes());
  const out = await uploadMetaVideo(
    tinyMp4(),
    KEY,
    fn,
    (ms) => {
      seenTimeouts.push(ms);
      return new AbortController().signal;
    },
  );
  assert.deepEqual(out, {
    id: "file-123",
    bytes: tinyMp4().size,
    expiresAt: 9_999_999,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/files");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(seenTimeouts, [120_000]);
  const keys = [...calls[0].opts.body.keys()];
  assert.deepEqual(keys, [
    "purpose",
    "expires_after[anchor]",
    "expires_after[seconds]",
    "file",
  ]);
  const entries = [...calls[0].opts.body.entries()];
  assert.equal(entries[0][1], "user_data");
  assert.equal(entries[1][1], "created_at");
  assert.equal(entries[2][1], "3600");
  const filePart = entries[3][1];
  assert.equal(entries[3][0], "file");
  assert.equal(filePart.name, "analysis.mp4");
  assert.equal(filePart.type, "video/mp4");
});

test("upload/delete accept no host/base override parameter", () => {
  assert.equal(META_FILE_BASE_URL, "https://api.meta.ai/v1");
});

test("delete uses pinned encoded URL with 30s signal and bearer header", async () => {
  const seen = [];
  const { fn, calls } = captureFetch(() => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    async json() {
      return { id: "file-456", object: "file", deleted: true };
    },
    async text() {
      return "{}";
    },
  }));
  const out = await deleteMetaFile("file-456", KEY, fn, (ms) => {
    seen.push(ms);
    return new AbortController().signal;
  });
  assert.deepEqual(out, { id: "file-456", deleted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/files/file-456");
  assert.equal(calls[0].opts.method, "DELETE");
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(seen, [30_000]);
});

// --- response projection ---

test("upload projects only id/bytes/expiresAt", async () => {
  const { fn } = captureFetch(() =>
    okUploadRes({ id: "file-7", bytes: 4, expires_at: 42 }),
  );
  const out = await uploadMetaVideo(tinyMp4("1234"), KEY, fn);
  assert.deepEqual(Object.keys(out).sort(), ["bytes", "expiresAt", "id"]);
  assert.ok(!JSON.stringify(out).includes("should-never-leak"));
});

test("upload accepts null expires_at and rejects missing or aliased expiration", async () => {
  const { fn: f1 } = captureFetch(() =>
    okUploadRes({ id: "file-9", bytes: 5, expires_at: null }),
  );
  assert.deepEqual(await uploadMetaVideo(tinyMp4("12345"), KEY, f1), {
    id: "file-9",
    bytes: 5,
    expiresAt: null,
  });
  const { fn: f2 } = captureFetch(() => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    async json() {
      return { id: "file-10", bytes: 6, expiresAt: 77 };
    },
    async text() {
      return "{}";
    },
  }));
  await assert.rejects(() => uploadMetaVideo(tinyMp4(), KEY, f2), MetaFileApiError);
});

// --- invalid blobs / ids ---

test("upload rejects empty, mistyped and oversized blobs without fetching", async () => {
  const bad = [
    new Blob([], { type: "video/mp4" }),
    new Blob(["x"], { type: "video/webm" }),
    new Blob(["x"], { type: "" }),
    { size: 0, type: "video/mp4" },
    { size: 1, type: "video/mp4" },
    { size: 500 * 1024 * 1024 + 1, type: "video/mp4" },
    null,
    "nope",
  ];
  for (const blob of bad) {
    const { fn, calls } = captureFetch(() => okUploadRes());
    await assert.rejects(() => uploadMetaVideo(blob, KEY, fn));
    assert.equal(calls.length, 0);
  }
});

test("delete rejects invalid ids without fetching", async () => {
  for (const id of [
    "",
    "file-",
    "file-abc",
    "file-12x",
    " file-1",
    "FILE-1",
    null,
    123,
  ]) {
    const { fn, calls } = captureFetch(() => ({}));
    await assert.rejects(() => deleteMetaFile(id, KEY, fn));
    assert.equal(calls.length, 0);
  }
});

test("invalid upload responses fail without leaking filename", async () => {
  const bodies = [
    { id: "oops-1", bytes: 4, expires_at: 1 },
    { id: "file-1", bytes: 0, expires_at: 1 },
    { id: "file-1", bytes: -3, expires_at: 1 },
    { id: "file-1", bytes: 1.5, expires_at: 1 },
    { id: "file-1", bytes: 500 * 1024 * 1024 + 1, expires_at: 1 },
    { id: "file-1", bytes: 4, expires_at: "soon" },
    { id: "file-1", bytes: 4, expires_at: -2 },
    { nope: true },
  ];
  for (const body of bodies) {
    const { fn } = captureFetch(() => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() {
        return body;
      },
      async text() {
        return "{}";
      },
    }));
    const err = await uploadMetaVideo(tinyMp4(), KEY, fn).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof MetaFileApiError, JSON.stringify(body));
    assert.equal(err.stage, "upload");
  }
  const { fn } = captureFetch(() => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    async json() {
      throw new SyntaxError("bad json");
    },
    async text() {
      return "not-json{{{";
    },
  }));
  await assert.rejects(() => uploadMetaVideo(tinyMp4(), KEY, fn));
});

// --- delete confirmation ---

test("delete requires deleted:true with matching id", async () => {
  const variants = [
    { id: "file-5", object: "file", deleted: false },
    { id: "file-5", object: "file" },
    { id: "file-999", object: "file", deleted: true },
    { id: "file-5", object: "thing", deleted: true },
  ];
  for (const body of variants) {
    const { fn } = captureFetch(() => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() {
        return body;
      },
      async text() {
        return "{}";
      },
    }));
    const err = await deleteMetaFile("file-5", KEY, fn).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof MetaFileApiError, JSON.stringify(body));
    assert.equal(err.status, 200);
    assert.equal(err.isTimeout, false);
    assert.equal(err.isConnectionError, false);
  }
});

// --- bounded error parsing + retry-after ---

test("non-2xx parses bounded type/code and exposes retry-after", async () => {
  const big = "t".repeat(500);
  const { fn } = captureFetch(() =>
    errorRes({
      status: 429,
      body: { error: { type: big, code: `${big}_code`, message: OTHER_MARKER } },
      retryAfter: "120",
    }),
  );
  const err = await uploadMetaVideo(tinyMp4(), KEY, fn).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MetaFileApiError);
  assert.equal(err.status, 429);
  assert.equal(err.stage, "upload");
  assert.ok(err.type.length <= 64);
  assert.ok(err.code.length <= 64);
  assert.equal(err.retryAfter, "120");
  assert.ok(!JSON.stringify(err).includes(OTHER_MARKER));
});

test("body beyond 16 KiB is ignored for error fields", async () => {
  const hidden = JSON.stringify({
    error: { type: "late-type", code: "late-code" },
  });
  const rawText = "x".repeat(16 * 1024) + hidden;
  const { fn } = captureFetch(() =>
    errorRes({ status: 500, rawText, retryAfter: "5" }),
  );
  const err = await deleteMetaFile("file-1", KEY, fn).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MetaFileApiError);
  assert.equal(err.status, 500);
  assert.equal(err.type, null);
  assert.equal(err.code, null);
  assert.equal(err.retryAfter, "5");
});

// --- timeout / connection conversion ---

test("abort failure converts to timeout flag without original message", async () => {
  const sensitive = "ORIGINAL-ABORT-SENSITIVE-44551";
  const fn = async () => {
    const e = new DOMException(sensitive, "AbortError");
    throw e;
  };
  const err = await uploadMetaVideo(tinyMp4(), KEY, fn).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MetaFileApiError);
  assert.equal(err.isTimeout, true);
  assert.equal(err.isConnectionError, false);
  assert.equal(err.status, null);
  assert.ok(!String(err.message).includes(sensitive));
  assert.ok(!JSON.stringify(err).includes(sensitive));
  assert.equal(err.cause, undefined);
});

test("connection failure converts without leaking cause", async () => {
  const sensitive = "CONNECTION-SENSITIVE-99887";
  const fn = async () => {
    throw new TypeError(sensitive);
  };
  const err = await deleteMetaFile("file-3", KEY, fn).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MetaFileApiError);
  assert.equal(err.isTimeout, false);
  assert.equal(err.isConnectionError, true);
  assert.equal(err.status, null);
  assert.ok(!String(err.message).includes(sensitive));
  assert.ok(!JSON.stringify(err).includes(sensitive));
});

// --- safe error shape ---

test("safe error retains no raw body/response/request/blob/key", async () => {
  const rawText = JSON.stringify({
    error: { type: "t", code: "c", message: OTHER_MARKER },
  });
  const { fn } = captureFetch(() => errorRes({ status: 400, rawText }));
  const blob = tinyMp4();
  const err = await uploadMetaVideo(blob, KEY, fn).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MetaFileApiError);
  for (const prop of [
    "response",
    "request",
    "headers",
    "rawBody",
    "raw_body",
    "body",
    "blob",
    "file",
    "key",
    "apiKey",
    "filename",
  ]) {
    assert.ok(!(prop in err), prop);
  }
  assert.equal(err.cause, undefined);
  const dumped = JSON.stringify(err);
  assert.ok(!dumped.includes(KEY));
  assert.ok(!dumped.includes(OTHER_MARKER));
  assert.ok(!dumped.includes(rawText.slice(0, 20)));
  assert.deepEqual(
    Object.keys(err).sort(),
    [
      "code",
      "isConnectionError",
      "isTimeout",
      "name",
      "retryAfter",
      "stage",
      "status",
      "type",
    ].sort(),
  );
});

test("validation failures never include the key", async () => {
  const { fn, calls } = captureFetch(() => okUploadRes());
  const err = await uploadMetaVideo(
    new Blob(["x"], { type: "text/plain" }),
    KEY,
    fn,
  ).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error);
  assert.equal(calls.length, 0);
  assert.ok(!String(err.message).includes(KEY));
  assert.ok(!JSON.stringify(err).includes(KEY));
});

test("rejects an invalid abort signal before fetching", async () => {
  const { fn, calls } = captureFetch(() => okUploadRes());
  await assert.rejects(
    () => uploadMetaVideo(tinyMp4(), KEY, fn, () => ({ signal: "not-a-signal" })),
    /AbortSignal/u,
  );
  assert.equal(calls.length, 0);
});

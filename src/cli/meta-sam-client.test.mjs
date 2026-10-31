import test from "node:test";
import assert from "node:assert/strict";
import {
  runMetaSam,
  MetaSamApiError,
  META_SAM_TIMEOUT_MS,
} from "./meta-sam-client.mjs";
import { isRetryableError } from "./meta-retry-policy.mjs";

const enc = new TextEncoder();
const API_KEY = "test-key-abc123";
const FILE_ID = "file-987654321";

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? enc.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

function okResponse(body, headers = new Headers()) {
  return { ok: true, status: 200, headers, body };
}

function errResponse(status, body, headers = new Headers()) {
  return { ok: false, status, headers, body };
}

function dataBlock(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `data: ${text}\n\n`;
}

function completedPayload(usage = { total_tokens: 7 }) {
  return { type: "response.completed", response: { usage } };
}

function factoryProbe() {
  const controller = new AbortController();
  const probe = { timeouts: [], signal: controller.signal };
  const createSignal = (ms) => {
    probe.timeouts.push(ms);
    return controller.signal;
  };
  return { probe, createSignal, controller };
}

async function collect(events) {
  const out = [];
  for await (const event of events) out.push(event);
  return out;
}

function leakCheck(error, secrets = [API_KEY, FILE_ID]) {
  const text = JSON.stringify(error);
  for (const secret of secrets) {
    assert.ok(!text.includes(secret), `error leaks ${secret}`);
    assert.ok(!error.message.includes(secret), "message leaks a secret");
  }
  assert.equal(error.cause, undefined);
  assert.ok(!("headers" in error));
  assert.ok(!("request" in error));
  assert.ok(!("body" in error));
  assert.ok(!("response" in error));
}

test("sends the pinned URL, auth, flags and animal video message", async () => {
  const seen = {};
  const { createSignal } = factoryProbe();
  const summaryValue = { animals: 2 };
  const fetchFn = async (url, init) => {
    seen.url = url;
    seen.init = init;
    return okResponse(streamOf([dataBlock(completedPayload())]));
  };
  const result = await runMetaSam(FILE_ID, API_KEY, fetchFn, createSignal, async (events) => {
    await collect(events);
    return summaryValue;
  });
  assert.equal(seen.url, "https://api.meta.ai/v1/responses");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(seen.init.headers.Accept, "text/event-stream");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, "sam-3.1");
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].type, "message");
  assert.equal(body.input[0].role, "user");
  assert.deepEqual(body.input[0].content, [
    { type: "input_text", text: "animal" },
    { type: "input_video", file_id: FILE_ID },
  ]);
  assert.deepEqual(body.metadata, {
    include_confidence: "true",
    mask_encoding: "one_bit",
  });
  assert.equal(result.summary, summaryValue);
  assert.deepEqual(result.usage, { total_tokens: 7 });
  assert.deepEqual(Object.keys(result).sort(), ["summary", "usage"]);
});

test("uses a bounded 10-minute signal from the injected factory", async () => {
  const seen = {};
  const { probe, createSignal } = factoryProbe();
  const fetchFn = async (url, init) => {
    seen.init = init;
    return okResponse(streamOf([dataBlock(completedPayload())]));
  };
  await runMetaSam(FILE_ID, API_KEY, fetchFn, createSignal, collect);
  assert.deepEqual(probe.timeouts, [600_000]);
  assert.equal(META_SAM_TIMEOUT_MS, 600_000);
  assert.equal(seen.init.signal, probe.signal);
});

test("decodes fragmented, multiline and CRLF SSE with comments and [DONE]", async () => {
  const { createSignal } = factoryProbe();
  const chunks = [
    'data: {"type": "note",\r\n',
    'data: "n": 1}\r\n\r\ndata: {"type": "response.completed", "res',
    'ponse": {"usage": {"total_tokens": 5}}}\n\n: heartbeat\n\ndata: [DONE]\n\n',
  ];
  const fetchFn = async () => okResponse(streamOf(chunks));
  const seen = await runMetaSam(FILE_ID, API_KEY, fetchFn, createSignal, collect);
  assert.deepEqual(seen, {
    summary: [{ type: "note", n: 1 }, completedPayload({ total_tokens: 5 })],
    usage: { total_tokens: 5 },
  });
});

test("supports an object argument form", async () => {
  const { createSignal } = factoryProbe();
  const fetchFn = async () => okResponse(streamOf([dataBlock(completedPayload())]));
  const result = await runMetaSam({
    fileId: FILE_ID,
    apiKey: API_KEY,
    fetch: fetchFn,
    createSignal,
    consumeEvents: collect,
  });
  assert.deepEqual(result.usage, { total_tokens: 7 });
  assert.deepEqual(result.summary, [completedPayload()]);
});

test("projects only finite non-negative numeric usage fields", async () => {
  const { createSignal } = factoryProbe();
  const usage = {
    input_tokens: 10,
    output_tokens: "7",
    total_tokens: -2,
    zero: 0,
    ratio: 2.5,
    nested: { a: 1 },
    list: [1],
    missing: null,
  };
  const fetchFn = async () =>
    okResponse(streamOf([dataBlock(completedPayload(usage))]));
  const result = await runMetaSam(FILE_ID, API_KEY, fetchFn, createSignal, collect);
  assert.deepEqual(result.usage, { input_tokens: 10, zero: 0, ratio: 2.5 });
});

test("validates inputs without sending a request", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls += 1;
    throw new Error("must not be called");
  };
  const signal = () => new AbortController().signal;
  await assert.rejects(
    () => runMetaSam("nope", API_KEY, fetchFn, signal, collect),
    TypeError,
  );
  await assert.rejects(
    () => runMetaSam(FILE_ID, "   ", fetchFn, signal, collect),
    TypeError,
  );
  await assert.rejects(
    () => runMetaSam(FILE_ID, API_KEY, null, signal, collect),
    TypeError,
  );
  await assert.rejects(
    () => runMetaSam(FILE_ID, API_KEY, fetchFn, signal, null),
    TypeError,
  );
  assert.equal(calls, 0);
});

test("projects bounded HTTP errors without leaking response data", async () => {
  const headers = new Headers({ "retry-after": "12" });
  const body = streamOf([
    JSON.stringify({
      error: {
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
        message: `${API_KEY}:${FILE_ID}:private`,
      },
    }),
  ]);
  const err = await runMetaSam(
    FILE_ID,
    API_KEY,
    async () => errResponse(429, body, headers),
    factoryProbe().createSignal,
    collect,
  ).then(() => null, (error) => error);
  assert.ok(err instanceof MetaSamApiError);
  assert.equal(err.status, 429);
  assert.equal(err.type, "rate_limit_error");
  assert.equal(err.code, "rate_limit_exceeded");
  assert.equal(err.retryAfter, "12");
  assert.equal(isRetryableError(err), true);
  leakCheck(err);
});

test("converts timeout and connection failures without retaining causes", async () => {
  const timeout = await runMetaSam(
    FILE_ID,
    API_KEY,
    async () => { throw new DOMException(`${API_KEY}:${FILE_ID}`, "AbortError"); },
    factoryProbe().createSignal,
    collect,
  ).then(() => null, (error) => error);
  assert.equal(timeout.isTimeout, true);
  assert.equal(timeout.isConnectionError, false);
  leakCheck(timeout);

  const connection = await runMetaSam(
    FILE_ID,
    API_KEY,
    async () => { throw new TypeError(`${API_KEY}:${FILE_ID}`); },
    factoryProbe().createSignal,
    collect,
  ).then(() => null, (error) => error);
  assert.equal(connection.isTimeout, false);
  assert.equal(connection.isConnectionError, true);
  leakCheck(connection);
});

test("rejects missing, failed, incomplete, duplicate and post-completion terminal streams", async () => {
  const cases = [
    [],
    [{ type: "error" }],
    [{ type: "response.failed" }],
    [{ type: "response.incomplete" }],
    [completedPayload(), completedPayload()],
    [completedPayload(), { type: "late.event" }],
  ];
  for (const events of cases) {
    const body = streamOf(events.map(dataBlock));
    await assert.rejects(
      () => runMetaSam(
        FILE_ID,
        API_KEY,
        async () => okResponse(body),
        factoryProbe().createSignal,
        collect,
      ),
      MetaSamApiError,
    );
  }
});

test("rejects malformed JSON, trailing incomplete data and missing response body", async () => {
  for (const body of [
    streamOf(["data: {bad}\n\n"]),
    streamOf([dataBlock(completedPayload()), "data: trailing"]),
    null,
  ]) {
    await assert.rejects(
      () => runMetaSam(
        FILE_ID,
        API_KEY,
        async () => okResponse(body),
        factoryProbe().createSignal,
        collect,
      ),
      MetaSamApiError,
    );
  }
});

test("rejects an oversized SSE event", async () => {
  const oversized = `data: ${"x".repeat(2 * 1024 * 1024 + 1)}\n\n`;
  await assert.rejects(
    () => runMetaSam(
      FILE_ID,
      API_KEY,
      async () => okResponse(streamOf([oversized])),
      factoryProbe().createSignal,
      collect,
    ),
    MetaSamApiError,
  );
});

test("rejects a consumer that returns before exhausting the stream", async () => {
  await assert.rejects(
    () => runMetaSam(
      FILE_ID,
      API_KEY,
      async () => okResponse(streamOf([dataBlock(completedPayload())])),
      factoryProbe().createSignal,
      async () => "too-early",
    ),
    MetaSamApiError,
  );
});

test("accepts a parser that returns immediately after consuming response.completed", async () => {
  const result = await runMetaSam(
    FILE_ID,
    API_KEY,
    async () =>
      okResponse(
        streamOf([
          dataBlock({ type: "response.output_text.delta", delta: "saved" }),
          dataBlock(completedPayload({ video_frames_processed: 12 })),
          "data: [DONE]\n\n",
        ]),
      ),
    factoryProbe().createSignal,
    async (events) => {
      for await (const event of events) {
        if (event.type === "response.completed") return "parsed";
      }
      return "missing";
    },
  );
  assert.equal(result.summary, "parsed");
  assert.deepEqual(result.usage, { video_frames_processed: 12 });
});

test("rejects stream reader errors without leaking their messages", async () => {
  const body = {
    getReader() {
      return {
        async read() { throw new Error(`${API_KEY}:${FILE_ID}:stream`); },
        async cancel() {},
      };
    },
  };
  const err = await runMetaSam(
    FILE_ID,
    API_KEY,
    async () => okResponse(body),
    factoryProbe().createSignal,
    collect,
  ).then(() => null, (error) => error);
  assert.ok(err instanceof MetaSamApiError);
  leakCheck(err);
});

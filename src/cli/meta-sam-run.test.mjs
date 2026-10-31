import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeMetaSamRun, MetaSamRunError } from "./meta-sam-run.mjs";

const runId = "run-0123456789abcdef";
const bytes = Buffer.from("sanitized-video");
const derivativeSha256 = createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "wildscore-sam-run-"));
  const runDir = path.join(repositoryRoot, "private", "runs", runId);
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(runDir, "analysis.mp4"), bytes, { mode: 0o600 });
  await writeFile(
    path.join(runDir, "run.json"),
    JSON.stringify({
      derivative: {
        durationSeconds: 2,
        fps: 15,
        height: 360,
        sha256: derivativeSha256,
        width: 640,
      },
      runId,
      schemaVersion: 1,
      stages: { preparation: "completed" },
    }),
    { mode: 0o600 },
  );
  return { repositoryRoot, runDir };
}

function dependencies(calls, overrides = {}) {
  return {
    apiKey: "test-key",
    openBlob: async (_filePath, options) => {
      assert.deepEqual(options, { type: "video/mp4" });
      return new Blob([bytes], { type: "video/mp4" });
    },
    upload: async ({ blob, apiKey, fetch }) => {
      assert.equal(typeof fetch, "function");
      calls.push(["upload", blob.size, apiKey]);
      return { id: "file-123", bytes: blob.size, expiresAt: 1 };
    },
    retry: async (operation, options) => {
      calls.push(["retry", options.maxAttempts]);
      return operation();
    },
    requestSam: async ({ fileId, apiKey, consumeEvents, fetch }) => {
      assert.equal(typeof fetch, "function");
      calls.push(["sam", fileId, apiKey]);
      async function* events() {
        yield { type: "response.output_text.delta", delta: "saved" };
        yield { type: "response.completed", response: { usage: { input_tokens: 1 } } };
      }
      return { summary: await consumeEvents(events()), usage: { input_tokens: 1 } };
    },
    summarise: async (events, media) => {
      const recorded = [];
      for await (const event of events) recorded.push(event.type);
      calls.push(["summarise", media, recorded]);
      return { track_count: 1 };
    },
    removeRemote: async ({ fileId, apiKey, fetch }) => {
      assert.equal(typeof fetch, "function");
      calls.push(["delete", fileId, apiKey]);
      return { id: fileId, deleted: true };
    },
    ...overrides,
  };
}

test("streams private events, deletes remote media, and atomically checkpoints", async () => {
  const { repositoryRoot, runDir } = await fixture();
  const calls = [];
  const result = await executeMetaSamRun({
    repositoryRoot,
    runId,
    ...dependencies(calls),
  });

  assert.equal(result.reused, false);
  assert.deepEqual(calls.map(([name]) => name), ["upload", "retry", "sam", "summarise", "delete"]);
  assert.deepEqual(result.checkpoint.summary, { track_count: 1 });
  assert.deepEqual(result.checkpoint.usage, { input_tokens: 1 });
  const rawPath = path.join(runDir, "sam", "events.jsonl");
  const raw = await readFile(rawPath, "utf8");
  assert.match(raw, /response\.completed/u);
  assert.equal((await stat(rawPath)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(runDir, "sam", "result.json"))).mode & 0o777, 0o600);
  await assert.rejects(stat(`${rawPath}.tmp`), { code: "ENOENT" });
});

test("reuses a verified checkpoint without reading a key or calling the network", async () => {
  const { repositoryRoot } = await fixture();
  const calls = [];
  await executeMetaSamRun({ repositoryRoot, runId, ...dependencies(calls) });
  calls.length = 0;
  const result = await executeMetaSamRun({
    repositoryRoot,
    runId,
    ...dependencies(calls, { apiKey: undefined }),
  });
  assert.equal(result.reused, true);
  assert.deepEqual(calls, []);
});

test("deletes remote media and leaves no checkpoint when SAM fails", async () => {
  const { repositoryRoot, runDir } = await fixture();
  const calls = [];
  await assert.rejects(
    executeMetaSamRun({
      repositoryRoot,
      runId,
      ...dependencies(calls, {
        requestSam: async () => {
          calls.push(["sam"]);
          throw new Error("provider body must not escape");
        },
      }),
    }),
    (error) => error instanceof MetaSamRunError && error.stage === "request" && !error.message.includes("provider"),
  );
  assert.deepEqual(calls.map(([name]) => name), ["upload", "retry", "sam", "delete"]);
  await assert.rejects(stat(path.join(runDir, "sam", "result.json")), { code: "ENOENT" });
});

test("projects only safe provider diagnostics without retaining the cause", async () => {
  const { repositoryRoot } = await fixture();
  const calls = [];
  const error = await executeMetaSamRun({
    repositoryRoot,
    runId,
    ...dependencies(calls, {
      requestSam: async () => {
        const failure = new Error("secret provider body");
        Object.assign(failure, {
          status: 429,
          type: "rate_limit_error",
          code: "rate_limit_exceeded",
          retryAfter: "12",
        });
        throw failure;
      },
    }),
  }).then(() => null, (failure) => failure);
  assert.ok(error instanceof MetaSamRunError);
  assert.equal(error.status, 429);
  assert.equal(error.type, "rate_limit_error");
  assert.equal(error.code, "rate_limit_exceeded");
  assert.equal(error.retryAfter, "12");
  assert.equal(error.cause, undefined);
  assert.ok(!JSON.stringify(error).includes("secret provider body"));
});

test("fails closed when remote cleanup is not confirmed", async () => {
  const { repositoryRoot, runDir } = await fixture();
  const calls = [];
  await assert.rejects(
    executeMetaSamRun({
      repositoryRoot,
      runId,
      ...dependencies(calls, {
        removeRemote: async () => {
          calls.push(["delete"]);
          throw new Error("raw cleanup failure");
        },
      }),
    }),
    (error) => error instanceof MetaSamRunError && error.stage === "remote-cleanup",
  );
  await assert.rejects(stat(path.join(runDir, "sam", "result.json")), { code: "ENOENT" });
});

test("rejects traversal and derivative tampering before network access", async () => {
  const { repositoryRoot, runDir } = await fixture();
  const calls = [];
  await assert.rejects(
    executeMetaSamRun({ repositoryRoot, runId: "../private", ...dependencies(calls) }),
    (error) => error instanceof MetaSamRunError && error.stage === "validation",
  );
  await chmod(path.join(runDir, "analysis.mp4"), 0o600);
  await writeFile(path.join(runDir, "analysis.mp4"), "tampered");
  await assert.rejects(
    executeMetaSamRun({ repositoryRoot, runId, ...dependencies(calls) }),
    (error) => error instanceof MetaSamRunError && error.stage === "validation",
  );
  assert.deepEqual(calls, []);
});

test("rejects a missing key and invalid attempt caps before network access", async () => {
  const { repositoryRoot } = await fixture();
  const calls = [];
  await assert.rejects(
    executeMetaSamRun({
      repositoryRoot,
      runId,
      ...dependencies(calls, { apiKey: undefined }),
    }),
    (error) => error instanceof MetaSamRunError && error.stage === "key",
  );
  await assert.rejects(
    executeMetaSamRun({
      repositoryRoot,
      runId,
      ...dependencies(calls, { maxAttempts: 4 }),
    }),
    (error) => error instanceof MetaSamRunError && error.stage === "validation",
  );
  assert.deepEqual(calls, []);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeSamEventStage, SamEventStageError } from "./sam-event-stage.mjs";

const runId = "run-0123456789abcdef";
const sourceHash = "a".repeat(64);

function parsedFixture() {
  const frame = { frameIndex: 2 };
  return {
    diagnostics: [],
    outcome: { status: "completed" },
    records: [
      {
        bottom: 40,
        confidence: 0.75,
        frame,
        kind: "box",
        left: 10,
        objectId: "7",
        right: 30,
        top: 20,
      },
      {
        frame,
        kind: "mask",
        mask: { encoding: "one_bit", height: 2, payload: "safe", width: 2 },
        objectId: "7",
      },
    ],
  };
}

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "wildscore-events-"));
  const runDir = path.join(repositoryRoot, "private", "runs", runId);
  const checkpoint = {
    rawEventsSha256: sourceHash,
    runId,
    summary: {
      processed_media: { fps: 15, frame_count: 10, height: 100, width: 200 },
    },
  };
  return { checkpoint, repositoryRoot, runDir };
}

test("derives and atomically stores provenance-linked event evidence", async () => {
  const { checkpoint, repositoryRoot, runDir } = await fixture();
  const calls = [];
  const result = await executeSamEventStage({
    repositoryRoot,
    runId,
    verifySamRun: async (options) => {
      calls.push(options);
      return { checkpoint, reused: true, runDir };
    },
    parseStoredEvents: async () => parsedFixture(),
  });
  assert.equal(result.reused, false);
  assert.equal(result.checkpoint.segments.length, 1);
  assert.equal(result.checkpoint.events.length, 2);
  assert.equal(result.checkpoint.segments[0].geometry[0].detection_confidence, 0.75);
  assert.equal(result.checkpoint.sourceRawEventsSha256, sourceHash);
  assert.equal(calls[0].apiKey, undefined);
  await assert.rejects(calls[0].fetch(), /network is disabled/u);
  const outputPath = path.join(runDir, "events", "result.json");
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(outputPath, "utf8")).runId, runId);
});

test("reuses a matching checkpoint without reparsing", async () => {
  const { checkpoint, repositoryRoot, runDir } = await fixture();
  let parses = 0;
  const options = {
    repositoryRoot,
    runId,
    verifySamRun: async () => ({ checkpoint, reused: true, runDir }),
    parseStoredEvents: async () => {
      parses += 1;
      return parsedFixture();
    },
  };
  await executeSamEventStage(options);
  const result = await executeSamEventStage(options);
  assert.equal(result.reused, true);
  assert.equal(parses, 1);
});

test("fails closed on mismatched box and mask evidence", async () => {
  const { checkpoint, repositoryRoot, runDir } = await fixture();
  await assert.rejects(
    executeSamEventStage({
      repositoryRoot,
      runId,
      verifySamRun: async () => ({ checkpoint, reused: true, runDir }),
      parseStoredEvents: async () => ({
        diagnostics: [],
        outcome: { status: "completed" },
        records: parsedFixture().records.slice(0, 1),
      }),
    }),
    SamEventStageError,
  );
});

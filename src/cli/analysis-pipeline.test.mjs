import assert from "node:assert/strict";
import test from "node:test";

import { executeFullAnalysisPipeline, executeSamEventPipeline } from "./analysis-pipeline.mjs";

test("runs preparation, SAM, then deterministic events with bounded inputs", async () => {
  const calls = [];
  const result = await executeSamEventPipeline({
    videoPath: "clip.mp4",
    maxSeconds: 20,
    maxCalls: 2,
    repositoryRoot: "/repo",
    apiKey: "private-key",
    prepare: async (options) => {
      calls.push(["prepare", options]);
      return { runId: "run-0123456789abcdef" };
    },
    runSam: async (options) => {
      calls.push(["sam", options]);
      return { reused: false, checkpoint: { summary: { track_count: 3 } } };
    },
    deriveEvents: async (options) => {
      calls.push(["events", options]);
      return { reused: false, checkpoint: { events: [1, 2], segments: [1, 2, 3] } };
    },
    buildBundle: async (options) => {
      calls.push(["bundle", options]);
      return { outputDir: "/repo/private/runs/run-0123456789abcdef/bundle" };
    },
  });

  assert.deepEqual(calls.map(([stage]) => stage), ["prepare", "sam", "events", "bundle"]);
  assert.equal(calls[1][1].maxAttempts, 2);
  assert.equal(calls[2][1].runId, "run-0123456789abcdef");
  assert.equal(result.events.checkpoint.events.length, 2);
});

test("does not derive events after a failed SAM stage", async () => {
  let derived = false;
  await assert.rejects(
    executeSamEventPipeline({
      videoPath: "clip.mp4",
      maxSeconds: 20,
      maxCalls: 3,
      repositoryRoot: "/repo",
      apiKey: "private-key",
      prepare: async () => ({ runId: "run-0123456789abcdef" }),
      runSam: async () => {
        throw new Error("sam failed");
      },
      deriveEvents: async () => {
        derived = true;
      },
      buildBundle: async () => {},
    }),
    /sam failed/u,
  );
  assert.equal(derived, false);
});

test("runs bounded Spark labels before the final full-analysis bundle", async () => {
  const calls = [];
  const result = await executeFullAnalysisPipeline({
    videoPath: "clip.mp4", maxSeconds: 20, maxCalls: 8,
    repositoryRoot: "/repo", apiKey: "private-key",
    prepare: async () => ({ runId: "run-0123456789abcdef" }),
    runSam: async (options) => { calls.push(["sam", options.maxAttempts]); return { reused: true }; },
    deriveEvents: async () => { calls.push(["events"]); return { reused: true }; },
    labelTracks: async (options) => {
      calls.push(["spark", options.maxCalls]);
      return { checkpoint: { labelProposals: [{ segment_id: "seg-1-1" }] } };
    },
    buildBundle: async (options) => {
      calls.push(["bundle", options.labelProposals.length]);
      return { outputDir: "/repo/private/run/bundle" };
    },
  });
  assert.deepEqual(calls, [["sam", 3], ["events"], ["spark", 5], ["bundle", 1]]);
  assert.equal(result.spark.checkpoint.labelProposals.length, 1);
  await assert.rejects(
    executeFullAnalysisPipeline({ maxCalls: 3 }),
    /4 to 16/u,
  );
});

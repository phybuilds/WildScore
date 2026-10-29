import assert from "node:assert/strict";
import test from "node:test";

import {
  isReplayEvidenceVisible,
  replayProgress,
} from "./saved-analysis-replay.ts";

test("replay progress is clock-derived and clamped", () => {
  assert.equal(replayProgress(5, 20, "running"), 0.25);
  assert.equal(replayProgress(-2, 20, "running"), 0);
  assert.equal(replayProgress(24, 20, "running"), 1);
});

test("idle hides progressive evidence and complete reveals it", () => {
  assert.equal(isReplayEvidenceVisible(1, 10, "idle"), false);
  assert.equal(isReplayEvidenceVisible(20, 0, "complete"), true);
});

test("running replay reveals evidence only after its saved timestamp", () => {
  assert.equal(isReplayEvidenceVisible(4, 3.99, "running"), false);
  assert.equal(isReplayEvidenceVisible(4, 4, "running"), true);
});

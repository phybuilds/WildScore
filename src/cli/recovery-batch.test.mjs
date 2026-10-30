import assert from "node:assert/strict";
import test from "node:test";

import { validateRecoveryBatch } from "./recovery-batch.mjs";

function fixture() {
  return {
    schema: "wildscore-missing-animal-report-batch-v1",
    clip_id: "clip-01",
    annotations: [{
      schema: "wildscore-missing-animal-annotation-v1",
      clip_id: "clip-01",
      processed_fps: 10,
      media_width: 1920,
      media_height: 1080,
      frame_index: 150,
      timestamp_s: 15,
      broad_label: "antelope",
      prompt_kind: "box",
      box: { left: 100, top: 200, right: 180, bottom: 300 },
    }],
  };
}

test("plans bounded box recovery without using optional labels in prompts", () => {
  assert.deepEqual(validateRecoveryBatch(fixture(), 4), {
    clipId: "clip-01",
    annotationCount: 1,
    maxCalls: 4,
    model: "sam-3.1",
    promptKind: "box",
    broadLabelsExcludedFromPrompts: true,
  });
});

test("rejects call-cap overflow, duplicate boxes and timestamp drift", () => {
  const overflow = fixture();
  overflow.annotations.push({ ...overflow.annotations[0], frame_index: 151, timestamp_s: 15.1 });
  assert.throws(() => validateRecoveryBatch(overflow, 1), /exceeding/u);

  const duplicate = fixture();
  duplicate.annotations.push(structuredClone(duplicate.annotations[0]));
  assert.throws(() => validateRecoveryBatch(duplicate, 4), /duplicate/u);

  const drifted = fixture();
  drifted.annotations[0].timestamp_s = 14;
  assert.throws(() => validateRecoveryBatch(drifted, 4), /invalid/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { MissingAnimalAnnotation } from "./missing-animal-annotation.ts";
import {
  appendMissingAnimalAnnotation,
  buildMissingAnimalReportBatch,
  restoreMissingAnimalAnnotations,
} from "./missing-animal-report-queue.ts";

function annotation(frameIndex: number): MissingAnimalAnnotation {
  return {
    schema: "wildscore-missing-animal-annotation-v1",
    clip_id: "clip-01",
    processed_fps: 10,
    media_width: 100,
    media_height: 80,
    frame_index: frameIndex,
    timestamp_s: frameIndex / 10,
    broad_label: null,
    prompt_kind: "box",
    box: { left: 10, top: 20, right: 30, bottom: 40 },
  };
}

test("queues unique annotations in frame order", () => {
  const later = annotation(20);
  const earlier = annotation(10);
  const queued = appendMissingAnimalAnnotation([later], earlier);
  assert.deepEqual(queued.map((item) => item.frame_index), [10, 20]);
  assert.equal(appendMissingAnimalAnnotation(queued, earlier), queued);
});

test("restores only current-clip annotation records", () => {
  assert.deepEqual(
    restoreMissingAnimalAnnotations([annotation(10), { ...annotation(20), clip_id: "other" }, null], "clip-01"),
    [annotation(10)],
  );
});

test("builds one batch without adding private context", () => {
  assert.deepEqual(buildMissingAnimalReportBatch("clip-01", [annotation(10)]), {
    schema: "wildscore-missing-animal-report-batch-v1",
    clip_id: "clip-01",
    annotations: [annotation(10)],
  });
});

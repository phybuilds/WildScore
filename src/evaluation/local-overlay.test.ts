import assert from "node:assert/strict";
import test from "node:test";

import { validateLocalEvaluationOverlay } from "./local-overlay.ts";

function overlay() {
  return {
    schema: "wildscore-local-evaluation-overlay-v1",
    width: 100,
    height: 80,
    fps: 10,
    frames: [{
      frame_index: 2,
      objects: [{ object_id: "0", box: { left: 10, top: 20, right: 30, bottom: 40 } }],
    }],
  };
}

test("accepts bounded, ordered cached geometry", () => {
  assert.equal(validateLocalEvaluationOverlay(overlay()).frames[0].frame_index, 2);
});

test("rejects out-of-bounds boxes and duplicate frames", () => {
  assert.throws(
    () => validateLocalEvaluationOverlay({
      ...overlay(),
      frames: [{ frame_index: 2, objects: [] }, { frame_index: 2, objects: [] }],
    }),
    /frame ordering/u,
  );
  assert.throws(
    () => validateLocalEvaluationOverlay({
      ...overlay(),
      frames: [{ frame_index: 2, objects: [{ object_id: "0", box: { left: 0, top: 0, right: 101, bottom: 40 } }] }],
    }),
    /invalid box/u,
  );
});

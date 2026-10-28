import assert from "node:assert/strict";
import test from "node:test";

import { auditTargetTracks, boxIou, compareTracks } from "./track-overlap.mjs";

function track(trackId, frames, offset = 0) {
  return {
    track_id: trackId,
    geometry: frames.map((frame_index) => ({
      frame_index,
      box: { left: offset, top: 0, right: offset + 10, bottom: 10 },
    })),
  };
}

test("box IoU handles matching, disjoint, and partial boxes", () => {
  assert.equal(boxIou(track("a", [0]).geometry[0].box, track("b", [0]).geometry[0].box), 1);
  assert.equal(boxIou(track("a", [0]).geometry[0].box, track("b", [0], 20).geometry[0].box), 0);
  assert.equal(boxIou(track("a", [0]).geometry[0].box, track("b", [0], 5).geometry[0].box), 1 / 3);
});

test("track comparison uses only explicitly shared frame indices", () => {
  const result = compareTracks(track("target", [3, 4, 5]), track("base", [1, 3, 5]));
  assert.equal(result.shared_frame_count, 2);
  assert.equal(result.high_iou_frame_count, 2);
});

test("audit separates probable duplicates from additive candidates", () => {
  const base = [track("base", [0, 1, 2, 3, 4])];
  const result = auditTargetTracks(base, [
    track("duplicate", [0, 1, 2, 3, 4]),
    track("novel", [0, 1, 2, 3, 4], 20),
    track("too-short", [0, 1]),
  ]);
  assert.deepEqual(result.map((item) => item.classification), [
    "probable_duplicate", "additive_candidate", "additive_candidate",
  ]);
});

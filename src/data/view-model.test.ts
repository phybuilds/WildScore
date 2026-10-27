import assert from "node:assert/strict";
import test from "node:test";

import type { PresenceSegment, WildScoreBundle } from "./bundle-schema.ts";
import {
  buildFrameGeometryIndex,
  currentSegmentLabel,
  formatTime,
  frameAtTime,
} from "./view-model.ts";

test("maps video time to a bounded processed frame", () => {
  assert.equal(frameAtTime(-1, 10, 205), 0);
  assert.equal(frameAtTime(10.29, 10, 205), 102);
  assert.equal(frameAtTime(99, 10, 205), 204);
});

test("indexes geometry without merging gap-separated segments", () => {
  const segment = {
    segment_id: "seg-6-1",
    sam_object_id: "6",
    geometry: [
      {
        frame_index: 12,
        object_id: "6",
        box: { left: 1, top: 2, right: 3, bottom: 4 },
        mask: { encoding: "test", width: 2, height: 2, payload: "x" },
        detection_confidence: null,
      },
    ],
  } as PresenceSegment;
  assert.equal(buildFrameGeometryIndex([segment]).get(12)?.[0].segment_id, "seg-6-1");
});

test("human correction takes precedence while preserving source", () => {
  const bundle = {
    label_proposals: [{ segment_id: "seg-6-1", label_id: "baboon" }],
    reviews: [
      {
        review_kind: "segment_label",
        segment_id: "seg-6-1",
        decision: "accepted",
        original_value: "baboon",
        new_value: "olive_baboon",
      },
    ],
  } as WildScoreBundle;
  assert.deepEqual(currentSegmentLabel(bundle, "seg-6-1"), {
    label: "olive_baboon",
    source: "human",
  });
});

test("formats timestamps without implying frame precision", () => {
  assert.equal(formatTime(10.24), "0:10.2");
  assert.equal(formatTime(65), "1:05.0");
});

import assert from "node:assert/strict";
import test from "node:test";

import type {
  CandidateEvent,
  PresenceSegment,
  WildScoreBundle,
} from "./bundle-schema.ts";
import {
  buildFrameGeometryIndex,
  currentSegmentLabel,
  eventAnchorFrame,
  eventAnchorTime,
  formatTime,
  frameAtTime,
} from "./view-model.ts";

test("maps video time to a bounded processed frame", () => {
  assert.equal(frameAtTime(-1, 10, 205), 0);
  assert.equal(frameAtTime(10.24, 10, 205), 102);
  assert.equal(frameAtTime(10.26, 10, 205), 103);
  assert.equal(frameAtTime(16.4 - 1e-3, 10, 205), 164);
  assert.equal(frameAtTime(16.34, 10, 205), 163);
  assert.equal(frameAtTime(99, 10, 205), 204);
});

test("event anchors use analysed segment boundary frames", () => {
  const segment = {
    first_frame: 12,
    last_frame: 47,
  } as PresenceSegment;
  const appearance = {
    event_kind: "appearance",
    start_s: 1.19,
  } as CandidateEvent;
  const disappearance = {
    event_kind: "disappearance",
    start_s: 4.71,
  } as CandidateEvent;
  assert.equal(eventAnchorFrame(appearance, segment), 12);
  assert.equal(eventAnchorFrame(disappearance, segment), 47);
  assert.equal(eventAnchorTime(appearance, segment, 10), 1.2);
  assert.equal(eventAnchorTime(disappearance, segment, 10), 4.7);
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

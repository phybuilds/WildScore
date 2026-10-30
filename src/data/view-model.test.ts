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
  geometryAnchorTime,
  geometryCentroidPath,
  segmentStartTime,
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

test("segment navigation always uses the first analysed frame", () => {
  const segment = {
    first_frame: 104,
    start_s: 10.39,
  } as PresenceSegment;
  assert.equal(segmentStartTime(segment, 10), 10.4);
  assert.equal(segmentStartTime(segment, 0), 10.39);
});

test("recovery navigation uses the earliest analysed geometry frame", () => {
  assert.equal(
    geometryAnchorTime([{ frame_index: 300 }, { frame_index: 274 }], 15, 18.3),
    274 / 15,
  );
  assert.equal(geometryAnchorTime([], 15, 18.3), 18.3);
  assert.equal(geometryAnchorTime([{ frame_index: 274 }], 0, 18.3), 18.3);
});

test("builds a frame-ordered image-space centroid path", () => {
  assert.equal(
    geometryCentroidPath([
      { frame_index: 2, box: { left: 10, top: 20, right: 30, bottom: 40 } },
      { frame_index: 1, box: { left: 0, top: 2, right: 10, bottom: 12 } },
    ]),
    "5,7 20,30",
  );
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

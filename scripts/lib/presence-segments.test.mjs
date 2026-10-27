import assert from "node:assert/strict";
import test from "node:test";

import { derivePresenceSegments } from "./presence-segments.mjs";

const interior = { left: 20, top: 20, right: 40, bottom: 40 };
const edge = { left: 0, top: 20, right: 20, bottom: 40 };
const config = { fps: 10, frameCount: 5, width: 100, height: 100 };

test("clip-boundary detections do not create arrival or departure events", () => {
  const detections = [0, 1, 2, 3, 4].map((frame_index) => ({
    object_id: "1",
    frame_index,
    box: interior,
  }));
  const result = derivePresenceSegments(detections, config);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].already_visible_at_start, true);
  assert.equal(result.segments[0].still_visible_at_end, true);
  assert.deepEqual(result.events, []);
});

test("an interior gap creates separate uncertain presence segments", () => {
  const detections = [0, 1, 3, 4].map((frame_index) => ({
    object_id: "2",
    frame_index,
    box: interior,
  }));
  const result = derivePresenceSegments(detections, config);
  assert.equal(result.segments.length, 2);
  assert.deepEqual(
    result.events.map((event) => event.event_kind),
    ["disappearance", "appearance"],
  );
  assert.ok(
    result.events.every((event) =>
      event.uncertainty_flags.includes("possible_occlusion_or_detection_failure"),
    ),
  );
});

test("the two-percent edge rule records boundary evidence without asserting entry", () => {
  const detections = [
    { object_id: "3", frame_index: 1, box: edge },
    { object_id: "3", frame_index: 2, box: interior },
  ];
  const result = derivePresenceSegments(detections, config);
  const appearance = result.events.find(
    (event) => event.event_kind === "appearance",
  );
  assert.equal(appearance.boundary_evidence, "edge");
  assert.equal(appearance.decision, "proposed");
});

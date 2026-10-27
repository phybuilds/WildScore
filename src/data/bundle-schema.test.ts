import assert from "node:assert/strict";
import test from "node:test";

import { validateBundle } from "./bundle-schema.ts";

function validBundle() {
  return {
    schema_version: "0.1.0",
    clip: {
      clip_id: "clip-01",
      display_media: "clip-01.mp4",
      processed_duration_s: 2,
      processed_fps: 10,
      processed_frame_count: 20,
      width: 1920,
      height: 1080,
    },
    run: {},
    segments: [],
    label_proposals: [],
    events: [],
    reviews: [],
    evaluation: {
      status: "single_clip_feasibility_only",
      held_out_clip_count: 0,
      limitations: ["No held-out recording."],
    },
  };
}

test("accepts the supported saved-result contract", () => {
  assert.equal(validateBundle(validBundle()).schema_version, "0.1.0");
});

test("rejects display-media path traversal", () => {
  const bundle = validBundle();
  bundle.clip.display_media = "../private/source.mp4";
  assert.throws(() => validateBundle(bundle), /invalid top-level fields/u);
});

test("accepts an uncertain stored event review", () => {
  const bundle = {
    ...validBundle(),
    reviews: [
      {
        review_kind: "event",
        event_id: "event-1",
        decision: "uncertain",
        original_value: "appearance",
        new_value: null,
        reviewer: "local_reviewer",
        reviewed_at: "2026-10-27T12:00:00.000Z",
        correction_note: "Could not determine the boundary.",
      },
    ],
  };
  assert.equal(validateBundle(bundle).reviews[0].decision, "uncertain");
});

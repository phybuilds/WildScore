import assert from "node:assert/strict";
import test from "node:test";

import { validateBundle, type WildScoreBundle } from "./bundle-schema.ts";

function validBundle(): WildScoreBundle {
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

test("accepts a bounded held-out evaluation result", () => {
  const bundle = validBundle();
  bundle.evaluation.held_out_clip_count = 1;
  bundle.evaluation.held_out_result = {
    source_title: "Wolf on Trail Camera",
    source_url: "https://example.test/wolf",
    source_credit: "Public source",
    licence: "Public domain",
    reference_state: "frozen_before_model_output",
    model: "sam-3.1",
    provider: "Meta Model API",
    processed_frames: 100,
    matcher: "frozen one-to-one event matcher",
    tolerance_s: 1,
    reference_event_count: 2,
    matched_predictions: 2,
    missed_events: 0,
    false_alarms: 0,
    sam_latency_ms: 6000,
    total_latency_ms: 12000,
    remote_file_deletion_confirmed: true,
  };
  assert.equal(
    validateBundle(bundle).evaluation.held_out_result?.matched_predictions,
    2,
  );
});

test("rejects an unsafe held-out source URL", () => {
  const bundle = validBundle();
  bundle.evaluation.held_out_result = {
    source_title: "Wolf",
    source_url: "file:///private/wolf.webm",
    source_credit: "Public source",
    licence: "Public domain",
    reference_state: "frozen_before_model_output",
    model: "sam-3.1",
    provider: "Meta Model API",
    processed_frames: 100,
    matcher: "one-to-one",
    tolerance_s: 1,
    reference_event_count: 2,
    matched_predictions: 2,
    missed_events: 0,
    false_alarms: 0,
    sam_latency_ms: 6000,
    total_latency_ms: 12000,
    remote_file_deletion_confirmed: true,
  };
  assert.throws(() => validateBundle(bundle), /invalid top-level fields/u);
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

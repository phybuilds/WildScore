import assert from "node:assert/strict";
import test from "node:test";

import type { WildScoreBundle } from "../data/bundle-schema.ts";
import {
  createInitialReviewState,
  currentReviewedLabel,
  reviewReducer,
  reviewedEventCount,
} from "./review-state.ts";

function fixture(): WildScoreBundle {
  return {
    schema_version: "0.1.0",
    clip: {
      clip_id: "clip-01",
      display_media: "clip.mp4",
      processed_duration_s: 2,
      processed_fps: 10,
      processed_frame_count: 20,
      width: 10,
      height: 10,
    },
    run: { run_id: "run-1", config_hash: "hash" },
    segments: [],
    events: [
      {
        event_id: "event-1",
        segment_id: "segment-1",
        event_kind: "appearance",
        start_s: 1,
        end_s: 1,
        boundary_evidence: "interior",
        uncertainty_flags: [],
        decision: "proposed",
        derivation_source: "sam_geometry",
        config_version: "v1",
      },
    ],
    label_proposals: [
      {
        segment_id: "segment-1",
        label_id: "baboon",
        visible_evidence: "visible evidence",
        uncertainty_reason: null,
        model: "model-1",
        source_run_id: "run-1",
      },
    ],
    reviews: [
      {
        review_kind: "segment_label",
        segment_id: "segment-1",
        decision: "accepted",
        original_value: "baboon",
        new_value: "olive_baboon",
        reviewer: "founder",
        reviewed_at: null,
        correction_note: "Refined species.",
      },
    ],
    evaluation: {
      status: "single_clip_feasibility_only",
      held_out_clip_count: 0,
      limitations: [],
    },
  };
}

test("event decisions do not confirm a label", () => {
  const bundle = fixture();
  const initial = createInitialReviewState(bundle);
  const next = reviewReducer(initial, {
    type: "decide_event",
    event_id: "event-1",
    decision: "accepted",
    reviewer: "local_reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  assert.equal(next.event_reviews["event-1"].decision, "accepted");
  assert.deepEqual(next.label_reviews, initial.label_reviews);
});

test("can't tell completes an event review without forcing a binary decision", () => {
  const bundle = fixture();
  const next = reviewReducer(createInitialReviewState(bundle), {
    type: "decide_event",
    event_id: "event-1",
    decision: "uncertain",
    reviewer: "local_reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  assert.equal(next.event_reviews["event-1"].decision, "uncertain");
  assert.match(next.event_reviews["event-1"].correction_note, /could not determine/u);
  assert.equal(reviewedEventCount(next), 1);
});

test("a correction preserves the machine proposal", () => {
  const bundle = fixture();
  const next = reviewReducer(createInitialReviewState(bundle), {
    type: "review_label",
    segment_id: "segment-1",
    value: "unknown",
    reviewer: "local_reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
    correction_note: "Cannot tell from the saved evidence.",
  });
  assert.equal(next.label_reviews["segment-1"].original_value, "baboon");
  assert.equal(next.label_reviews["segment-1"].new_value, "unknown");
});

test("reset restores the stored bundle review", () => {
  const bundle = fixture();
  const changed = reviewReducer(createInitialReviewState(bundle), {
    type: "review_label",
    segment_id: "segment-1",
    value: "unknown",
    reviewer: "local_reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
    correction_note: "Cannot tell.",
  });
  const reset = reviewReducer(changed, { type: "reset", bundle });
  assert.deepEqual(currentReviewedLabel(bundle, reset, "segment-1"), {
    label: "olive_baboon",
    source: "human",
  });
});

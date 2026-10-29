import assert from "node:assert/strict";
import test from "node:test";

import type { WildScoreBundle } from "../data/bundle-schema.ts";
import type { RecoveryCandidateBundle } from "../data/recovery-schema.ts";
import { buildDevelopmentEvidenceSummary } from "./evidence-summary.ts";

function fixture(): {
  bundle: WildScoreBundle;
  recovery: RecoveryCandidateBundle;
} {
  const bundle = {
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
    run: {
      models: { segmentation: "sam-3.1", label_evidence: "muse-spark-1.3" },
      provider: "Meta Model API",
      sam_runtime_ms: 1500,
      sam_frames_processed: 20,
    },
    segments: [],
    label_proposals: [],
    events: [
      {
        event_id: "event-1",
        segment_id: "segment-1",
        event_kind: "appearance",
        start_s: 1,
        end_s: 1,
        boundary_evidence: "test",
        uncertainty_flags: [],
        decision: "proposed",
        derivation_source: "test",
        config_version: "test",
      },
      {
        event_id: "event-2",
        segment_id: "segment-1",
        event_kind: "disappearance",
        start_s: 2,
        end_s: 2,
        boundary_evidence: "test",
        uncertainty_flags: [],
        decision: "proposed",
        derivation_source: "test",
        config_version: "test",
      },
    ],
    reviews: [
      {
        review_kind: "event",
        event_id: "event-1",
        decision: "accepted",
        original_value: "appearance",
        new_value: null,
        reviewer: "local_reviewer",
        reviewed_at: null,
        correction_note: "",
      },
      {
        review_kind: "event",
        event_id: "event-2",
        decision: "uncertain",
        original_value: "disappearance",
        new_value: null,
        reviewer: "local_reviewer",
        reviewed_at: null,
        correction_note: "",
      },
      {
        review_kind: "segment_label",
        segment_id: "segment-1",
        decision: "rejected",
        original_value: "unknown",
        new_value: "antelope",
        reviewer: "local_reviewer",
        reviewed_at: null,
        correction_note: "",
      },
    ],
    evaluation: {
      status: "single_clip_feasibility_only",
      held_out_clip_count: 0,
      limitations: ["No held-out recording has been evaluated."],
    },
  } satisfies WildScoreBundle;

  const recovery = {
    schema: "wildscore-recovery-candidates-v1",
    clip_id: "clip-01",
    processed_fps: 10,
    processed_frame_count: 20,
    width: 1920,
    height: 1080,
    candidates: [],
    reviews: [],
    label_proposals: [],
    label_reviews: [],
    limitations: [],
  } satisfies RecoveryCandidateBundle;

  return { bundle, recovery };
}

test("summarizes only durable event decisions for known proposals", () => {
  const { bundle, recovery } = fixture();
  const summary = buildDevelopmentEvidenceSummary(bundle, recovery);

  assert.equal(summary.eventProposalCount, 2);
  assert.equal(summary.acceptedEventCount, 1);
  assert.equal(summary.rejectedEventCount, 0);
  assert.equal(summary.uncertainEventCount, 1);
  assert.deepEqual(summary.models, ["sam-3.1", "muse-spark-1.3"]);
});

test("states that development proposal review cannot establish recall", () => {
  const { bundle, recovery } = fixture();
  const summary = buildDevelopmentEvidenceSummary(bundle, recovery);

  assert.equal(summary.heldOutClipCount, 0);
  assert.match(summary.limitations.join(" "), /not a held-out accuracy estimate/u);
  assert.match(summary.limitations.join(" "), /cannot measure recall/u);
});

test("surfaces a stored held-out result without recomputing it", () => {
  const { bundle, recovery } = fixture();
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
  const summary = buildDevelopmentEvidenceSummary(bundle, recovery);

  assert.equal(summary.heldOutClipCount, 1);
  assert.equal(summary.heldOutResult?.matched_predictions, 2);
  assert.match(summary.limitations.join(" "), /remains separate/u);
});

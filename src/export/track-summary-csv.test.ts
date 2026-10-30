import assert from "node:assert/strict";
import test from "node:test";

import type { WildScoreBundle } from "../data/bundle-schema.ts";
import type { RecoveryCandidateBundle } from "../data/recovery-schema.ts";
import { createInitialRecoveryReviewState } from "../review/recovery-state.ts";
import { createInitialReviewState } from "../review/review-state.ts";
import { buildTrackSummaryCsv, trackMetrics, TRACK_SUMMARY_CSV_HEADER } from "./track-summary-csv.ts";

const segment = {
  segment_id: "segment-1",
  sam_object_id: "0",
  first_frame: 0,
  last_frame: 10,
  start_s: 0,
  end_s: 1,
  already_visible_at_start: true,
  still_visible_at_end: false,
  geometry: [
    { frame_index: 0, box: { left: 0, top: 0, right: 2, bottom: 2 } },
    { frame_index: 10, box: { left: 10, top: 0, right: 12, bottom: 2 } },
  ],
};

test("computes transparent pixel-space movement metrics", () => {
  assert.deepEqual(trackMetrics(segment as never, 10), {
    observed_dwell_s: 1,
    geometry_samples: 2,
    path_length_px: 10,
    mean_centroid_motion_px_s: 10,
    peak_centroid_motion_px_s: 10,
    straightness_ratio: 1,
    mean_box_area_px2: 4,
    area_flicker_ratio: 0,
  });
});

test("exports one summary row with existing quality flags", () => {
  const bundle = {
    schema_version: "0.1.0",
    clip: { clip_id: "clip-01", processed_fps: 10 },
    run: { run_id: "run-1" },
    segments: [segment],
    label_proposals: [{ segment_id: "segment-1", label_id: "baboon" }],
    events: [{
      event_id: "event-1",
      segment_id: "segment-1",
      decision: "proposed",
      uncertainty_flags: ["camera_motion_possible"],
    }],
    reviews: [],
  } as unknown as WildScoreBundle;
  const csv = buildTrackSummaryCsv(bundle, createInitialReviewState(bundle));
  const lines = csv.trimEnd().split("\n");
  assert.equal(lines[0], TRACK_SUMMARY_CSV_HEADER.join(","));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"10","10","10","1","4","0","camera_motion_possible"/u);
});

test("adds only accepted recovery tracks with explicit provenance", () => {
  const primary = {
    schema_version: "0.1.0",
    clip: { clip_id: "clip-01", processed_fps: 10 },
    run: { run_id: "run-1", sam_prompt: "animal" },
    segments: [segment],
    label_proposals: [],
    events: [],
    reviews: [],
  } as unknown as WildScoreBundle;
  const recovery = {
    schema: "wildscore-recovery-candidates-v1",
    clip_id: "clip-01",
    processed_fps: 10,
    processed_frame_count: 20,
    candidates: [
      {
        candidate_id: "recovery-antelope-1",
        source_prompt: "antelope",
        source_object_id: "1",
        first_frame: 5,
        last_frame: 6,
        start_s: 0.5,
        end_s: 0.6,
        uncertainty_flags: ["cross_response_identity_unresolved"],
        geometry: [
          { frame_index: 5, box: { left: 0, top: 0, right: 2, bottom: 2 } },
          { frame_index: 6, box: { left: 1, top: 0, right: 3, bottom: 2 } },
        ],
      },
      {
        candidate_id: "recovery-antelope-2",
        source_prompt: "antelope",
        source_object_id: "2",
        first_frame: 5,
        last_frame: 6,
        start_s: 0.5,
        end_s: 0.6,
        uncertainty_flags: [],
        geometry: [],
      },
    ],
    reviews: [
      { candidate_id: "recovery-antelope-1", decision: "accepted" },
      { candidate_id: "recovery-antelope-2", decision: "rejected" },
    ],
    label_proposals: [
      { candidate_id: "recovery-antelope-1", label_id: "antelope" },
    ],
    label_reviews: [
      { candidate_id: "recovery-antelope-1", decision: "accepted", value: "antelope" },
    ],
    limitations: [],
  } as unknown as RecoveryCandidateBundle;
  const csv = buildTrackSummaryCsv(
    primary,
    createInitialReviewState(primary),
    recovery,
    createInitialRecoveryReviewState(recovery),
  );
  assert.match(
    csv,
    /"recovery-antelope-1","recovery:antelope:1","targeted_recovery","meta_sam_targeted_prompt","accepted","antelope"/u,
  );
  assert.match(
    csv,
    /"cross_response_identity_unresolved\|identity_not_merged\|supplemental_targeted_track"/u,
  );
  assert.doesNotMatch(csv, /recovery-antelope-2/u);
});

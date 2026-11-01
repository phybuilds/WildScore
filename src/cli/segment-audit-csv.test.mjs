import assert from "node:assert/strict";
import test from "node:test";

import { buildSegmentAuditCsv } from "./segment-audit-csv.mjs";

const reference = { segment_id: "ref-1", first_frame: 0, last_frame: 10 };
const candidate = { segment_id: "candidate-1", first_frame: 1, last_frame: 9 };

test("exports auditable matches and unmatched rows without merge claims", () => {
  const csv = buildSegmentAuditCsv({
    fps: 10,
    referenceSegments: [reference, { segment_id: "ref-2", first_frame: 11, last_frame: 12 }],
    candidateSegments: [candidate, { segment_id: "candidate-2", first_frame: 13, last_frame: 14 }],
    audit: {
      correspondence_candidates: [{
        reference_segment_id: "ref-1",
        candidate_segment_id: "candidate-1",
        shared_frame_count: 9,
        high_iou_frame_count: 8,
        mean_iou_on_shared_frames: 0.8,
        reference_frame_coverage: 0.9,
        candidate_frame_coverage: 1,
      }],
      reference_segments_without_candidate: ["ref-2"],
      candidate_segments_without_reference: ["candidate-2"],
      duplicate_review: [{ candidate_segment_id: "candidate-1", reference_segment_ids: ["ref-1", "ref-2"] }],
    },
  });
  assert.match(csv, /"Review category"/u);
  assert.match(csv, /"Frames where both segments are visible"/u);
  assert.match(csv, /"Similar time and position — review only"/u);
  assert.match(csv, /"Reviewed segment not present in generic rerun"/u);
  assert.match(csv, /"Generic rerun segment not present in reviewed set"/u);
  assert.match(csv, /"Possible spatial overlap — review only"/u);
  assert.match(csv, /"80\.0%","90\.0%","100\.0%"/u);
  assert.match(csv, /identity is not confirmed/u);
  assert.doesNotMatch(csv, /automatic_merge|confirmed_identity/iu);
});

test("rejects invalid overlap proportions", () => {
  assert.throws(() => buildSegmentAuditCsv({
    fps: 10,
    referenceSegments: [reference],
    candidateSegments: [candidate],
    audit: {
      correspondence_candidates: [{
        reference_segment_id: "ref-1",
        candidate_segment_id: "candidate-1",
        shared_frame_count: 9,
        high_iou_frame_count: 8,
        mean_iou_on_shared_frames: 1.1,
        reference_frame_coverage: 0.9,
        candidate_frame_coverage: 1,
      }],
      reference_segments_without_candidate: [],
      candidate_segments_without_reference: [],
      duplicate_review: [],
    },
  }), /between zero and one/u);
});

test("fails closed on unknown segment references", () => {
  assert.throws(() => buildSegmentAuditCsv({
    fps: 10,
    referenceSegments: [reference],
    candidateSegments: [candidate],
    audit: {
      correspondence_candidates: [],
      reference_segments_without_candidate: ["missing"],
      candidate_segments_without_reference: [],
      duplicate_review: [],
    },
  }), /unknown segment/u);
});

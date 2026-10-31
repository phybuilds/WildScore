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
  assert.match(csv, /correspondence_candidate/u);
  assert.match(csv, /reviewed_reference_without_candidate/u);
  assert.match(csv, /candidate_without_reviewed_reference/u);
  assert.match(csv, /possible_duplicate_review/u);
  assert.doesNotMatch(csv, /automatic_merge|confirmed_identity/iu);
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

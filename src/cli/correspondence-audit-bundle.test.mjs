import assert from "node:assert/strict";
import test from "node:test";

import { buildCorrespondenceAuditBundle } from "./correspondence-audit-bundle.mjs";

test("projects box-only evidence with explicit non-merge provenance", () => {
  const result = buildCorrespondenceAuditBundle({
    clipId: "clip-01",
    sourceRunId: "run-0123456789abcdef",
    fps: 10,
    width: 100,
    height: 80,
    candidateSegments: [{
      segment_id: "candidate-1",
      first_frame: 1,
      last_frame: 1,
      geometry: [{
        frame_index: 1,
        box: { left: 1, top: 2, right: 10, bottom: 20 },
        mask: { payload: "must-not-escape" },
        detection_confidence: 0.9,
      }],
    }],
    audit: {
      correspondence_candidates: [],
      reference_segments_without_candidate: ["ref-1"],
      candidate_segments_without_reference: ["candidate-1"],
      duplicate_review: [],
    },
  });
  assert.equal(result.provenance, "generic_sam_rerun_not_merged");
  const text = JSON.stringify(result);
  assert.ok(!text.includes("must-not-escape"));
  assert.ok(!text.includes("detection_confidence"));
});

test("fails closed when audit references an unknown candidate", () => {
  assert.throws(() => buildCorrespondenceAuditBundle({
    clipId: "clip-01",
    sourceRunId: "run-0123456789abcdef",
    fps: 10,
    width: 100,
    height: 80,
    candidateSegments: [],
    audit: {
      correspondence_candidates: [],
      reference_segments_without_candidate: [],
      candidate_segments_without_reference: ["missing"],
      duplicate_review: [],
    },
  }), /unknown candidate/u);
});

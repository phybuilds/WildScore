import assert from "node:assert/strict";
import test from "node:test";

import { validateCorrespondenceAuditBundle } from "./correspondence-audit-schema.ts";

function fixture() {
  return {
    schema_version: "wildscore-correspondence-audit-v1",
    clip_id: "clip-01",
    source_run_id: "run-0123456789abcdef",
    fps: 10,
    width: 100,
    height: 80,
    provenance: "generic_sam_rerun_not_merged",
    candidate_segments: [{
      segment_id: "candidate-1",
      first_frame: 1,
      last_frame: 2,
      geometry: [{ frame_index: 1, box: { left: 1, top: 2, right: 10, bottom: 20 } }],
    }],
    correspondence_candidates: [{
      reference_segment_id: "ref-1",
      candidate_segment_id: "candidate-1",
      shared_frame_count: 1,
      high_iou_frame_count: 1,
      high_iou_shared_frame_ratio: 1,
      mean_iou_on_shared_frames: 0.8,
      reference_frame_coverage: 0.5,
      candidate_frame_coverage: 1,
      reason_codes: ["shared_frames", "spatial_overlap"],
    }],
    reference_segments_without_candidate: ["ref-2"],
    candidate_segments_without_reference: [],
    duplicate_review: [],
  };
}

test("accepts box-only generic-rerun audit evidence", () => {
  assert.equal(validateCorrespondenceAuditBundle(fixture()).candidate_segments.length, 1);
});

test("rejects unknown candidates, duplicate IDs and out-of-bounds geometry", () => {
  const unknown = fixture();
  (unknown.candidate_segments_without_reference as string[]).push("missing");
  assert.throws(() => validateCorrespondenceAuditBundle(unknown), /unknown candidate/u);
  const duplicate = fixture();
  duplicate.candidate_segments.push(duplicate.candidate_segments[0]);
  assert.throws(() => validateCorrespondenceAuditBundle(duplicate), /segment is invalid/u);
  const outside = fixture();
  outside.candidate_segments[0].geometry[0].box.right = 101;
  assert.throws(() => validateCorrespondenceAuditBundle(outside), /geometry is invalid/u);
});

test("rejects invented provenance and merge-like reason codes", () => {
  const provenance = fixture();
  provenance.provenance = "reviewer_box";
  assert.throws(() => validateCorrespondenceAuditBundle(provenance), /top-level/u);
  const reason = fixture();
  reason.correspondence_candidates[0].reason_codes = ["confirmed_identity", "spatial_overlap"];
  assert.throws(() => validateCorrespondenceAuditBundle(reason), /match is invalid/u);
});

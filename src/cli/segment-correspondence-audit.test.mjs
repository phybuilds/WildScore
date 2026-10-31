import assert from "node:assert/strict";
import test from "node:test";

import { auditSegmentCorrespondence } from "./segment-correspondence-audit.mjs";

function segment(segmentId, frames, offset = 0) {
  return {
    segment_id: segmentId,
    first_frame: Math.min(...frames),
    last_frame: Math.max(...frames),
    geometry: frames.map((frame_index) => ({
      frame_index,
      box: { bottom: 10, left: offset, right: offset + 10, top: 0 },
    })),
  };
}

test("returns deterministic correspondence metrics without identity claims", () => {
  const references = [segment("ref-1", [0, 1, 2, 3])];
  const candidates = [
    segment("candidate-b", [0, 1, 2, 3]),
    segment("candidate-a", [0, 1, 2, 3]),
  ];
  const before = JSON.stringify({ references, candidates });
  const result = auditSegmentCorrespondence(references, candidates);

  assert.deepEqual(
    result.correspondence_candidates.map((item) => item.candidate_segment_id),
    ["candidate-a", "candidate-b"],
  );
  assert.equal(result.correspondence_candidates[0].reference_frame_coverage, 1);
  assert.equal(result.correspondence_candidates[0].candidate_frame_coverage, 1);
  assert.deepEqual(result.correspondence_candidates[0].reason_codes, [
    "shared_frames",
    "spatial_overlap",
  ]);
  assert.equal(JSON.stringify({ references, candidates }), before);
  assert.ok(!JSON.stringify(result).match(/confidence|merge|label/iu));
});

test("uses inclusive thresholds and reports unmatched segments", () => {
  const result = auditSegmentCorrespondence(
    [segment("ref-match", [0, 1, 2]), segment("ref-missed", [5, 6, 7])],
    [segment("candidate-match", [0, 1, 2]), segment("candidate-new", [5, 6, 7], 20)],
    { iouThreshold: 1, minimumSharedFrames: 3, minimumHighIouRatio: 1 },
  );
  assert.equal(result.correspondence_candidates.length, 1);
  assert.deepEqual(result.reference_segments_without_candidate, ["ref-missed"]);
  assert.deepEqual(result.candidate_segments_without_reference, ["candidate-new"]);
});

test("flags many-to-one and one-to-many relationships for review only", () => {
  const result = auditSegmentCorrespondence(
    [segment("ref-1", [0, 1, 2]), segment("ref-2", [0, 1, 2])],
    [segment("candidate-1", [0, 1, 2]), segment("candidate-2", [0, 1, 2])],
  );
  assert.deepEqual(result.fragmentation_review, [
    {
      reference_segment_id: "ref-1",
      candidate_segment_ids: ["candidate-1", "candidate-2"],
      reason_codes: ["multiple_candidate_segments_overlap_one_reference"],
    },
    {
      reference_segment_id: "ref-2",
      candidate_segment_ids: ["candidate-1", "candidate-2"],
      reason_codes: ["multiple_candidate_segments_overlap_one_reference"],
    },
  ]);
  assert.equal(result.duplicate_review.length, 2);
});

test("rejects unsafe, duplicate, malformed and out-of-bounds segments", () => {
  const valid = segment("valid", [0, 1, 2]);
  assert.throws(
    () => auditSegmentCorrespondence([valid, valid], []),
    /duplicate segment_id/u,
  );
  assert.throws(
    () => auditSegmentCorrespondence([{ ...valid, segment_id: "../unsafe" }], []),
    /segment_id/u,
  );
  assert.throws(
    () =>
      auditSegmentCorrespondence(
        [{ ...valid, geometry: [...valid.geometry, valid.geometry[0]] }],
        [],
      ),
    /duplicate frame_index/u,
  );
  assert.throws(
    () =>
      auditSegmentCorrespondence(
        [{ ...valid, geometry: [{ ...valid.geometry[0], frame_index: 4 }] }],
        [],
      ),
    /outside segment bounds/u,
  );
});

test("rejects unknown or unsafe configuration", () => {
  assert.throws(
    () => auditSegmentCorrespondence([], [], { unknown: true }),
    /unknown config key/u,
  );
  assert.throws(
    () => auditSegmentCorrespondence([], [], { minimumSharedFrames: 0 }),
    /minimumSharedFrames/u,
  );
  assert.throws(
    () => auditSegmentCorrespondence([], [], { minimumHighIouRatio: 2 }),
    /minimumHighIouRatio/u,
  );
});

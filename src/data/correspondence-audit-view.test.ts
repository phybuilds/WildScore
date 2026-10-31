import assert from "node:assert/strict";
import test from "node:test";

import { buildCorrespondenceReviewQueue } from "./correspondence-audit-view.ts";

test("builds a deterministic exception-only review queue without merge claims", () => {
  const queue = buildCorrespondenceReviewQueue({
    reference_segments_without_candidate: ["ref-2", "ref-1"],
    candidate_segments_without_reference: ["candidate-2"],
    duplicate_review: [{
      candidate_segment_id: "candidate-1",
      reference_segment_ids: ["ref-1", "ref-2"],
      reason_codes: ["one_candidate_segment_overlaps_multiple_references"],
    }],
  } as Parameters<typeof buildCorrespondenceReviewQueue>[0]);
  assert.equal(queue.length, 4);
  assert.deepEqual(queue.map((item) => item.id), [
    "candidate-unmatched:candidate-2",
    "possible-duplicate:candidate-1",
    "reference-missing:ref-1",
    "reference-missing:ref-2",
  ]);
  assert.equal(queue[0].focus_source, "generic_rerun");
  assert.equal(queue[2].focus_source, "saved_analysis");
  assert.match(queue[1].detail, /no merge was applied/u);
  assert.doesNotMatch(JSON.stringify(queue), /confirmed identity|automatic merge/iu);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  type RecoveryCandidateBundle,
  validateRecoveryCandidateBundle,
} from "./recovery-schema.ts";

function fixture(): RecoveryCandidateBundle {
  return {
    schema: "wildscore-recovery-candidates-v1",
    clip_id: "clip-01",
    processed_fps: 15,
    processed_frame_count: 308,
    width: 1920,
    height: 1080,
    candidates: [{
      candidate_id: "recovery-antelope-3",
      source_prompt: "antelope",
      source_object_id: "3",
      source_run_id: "run-1",
      suggested_label: "antelope",
      first_frame: 200,
      last_frame: 300,
      start_s: 13.3,
      end_s: 20,
      audit_classification: "additive_candidate",
      uncertainty_flags: ["cross_response_identity_unresolved"],
      geometry: [{
        frame_index: 200,
        object_id: "antelope:3",
        box: { left: 10, top: 20, right: 30, bottom: 40 },
        mask: { encoding: "one_bit", width: 2, height: 2, payload: "AA==" },
        detection_confidence: null,
      }],
    }],
    reviews: [],
    label_proposals: [],
    label_reviews: [],
    limitations: ["Human review required."],
  };
}

test("accepts a namespaced additive recovery candidate", () => {
  assert.equal(validateRecoveryCandidateBundle(fixture()).candidates.length, 1);
});

test("accepts one Meta label proposal per known candidate", () => {
  const value = fixture();
  value.label_proposals.push({
    candidate_id: "recovery-antelope-3",
    label_id: "antelope",
    visible_evidence: "Slender body and long legs.",
    uncertainty_reason: null,
    model: "muse-spark-1.3",
    source_run_id: "run-2",
    context_condition: "visible_evidence_only",
  });
  assert.equal(validateRecoveryCandidateBundle(value).label_proposals.length, 1);
  value.label_proposals.push(structuredClone(value.label_proposals[0]));
  assert.throws(() => validateRecoveryCandidateBundle(value), /must be unique/u);
});

test("rejects duplicate candidate IDs", () => {
  const value = fixture();
  value.candidates.push(structuredClone(value.candidates[0]));
  assert.throws(() => validateRecoveryCandidateBundle(value), /must be unique/u);
});

test("rejects non-additive tracks", () => {
  const valid = fixture();
  const value = {
    ...valid,
    candidates: [{ ...valid.candidates[0], audit_classification: "probable_duplicate" }],
  };
  assert.throws(() => validateRecoveryCandidateBundle(value), /invalid fields/u);
});

test("rejects geometry outside the processed clip", () => {
  const value = fixture();
  value.candidates[0].geometry[0].frame_index = 308;
  assert.throws(() => validateRecoveryCandidateBundle(value), /outside the processed clip/u);
});

test("accepts one stored review per known candidate", () => {
  const value = fixture();
  value.reviews.push({
    candidate_id: "recovery-antelope-3",
    decision: "accepted",
    reviewer: "local_reviewer",
    reviewed_at: null,
    correction_note: "Kept after local review.",
  });
  assert.equal(validateRecoveryCandidateBundle(value).reviews.length, 1);
  value.reviews.push(structuredClone(value.reviews[0]));
  assert.throws(() => validateRecoveryCandidateBundle(value), /must be unique/u);
});

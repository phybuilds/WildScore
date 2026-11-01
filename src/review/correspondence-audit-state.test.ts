import assert from "node:assert/strict";
import test from "node:test";

import type { CorrespondenceAuditBundle } from "../data/correspondence-audit-schema.ts";
import {
  correspondenceAuditReviewReducer,
  createInitialCorrespondenceAuditReviewState,
  reviewedCorrespondenceAuditCount,
} from "./correspondence-audit-state.ts";

const bundle = {
  schema_version: "wildscore-correspondence-audit-v1",
  clip_id: "clip-01",
  source_run_id: "generic-rerun-1",
  fps: 10,
  width: 1920,
  height: 1080,
  provenance: "generic_sam_rerun_not_merged",
  candidate_segments: [{
    segment_id: "rerun-1",
    first_frame: 10,
    last_frame: 11,
    geometry: [{
      frame_index: 10,
      box: { left: 10, top: 10, right: 20, bottom: 20 },
    }],
  }],
  correspondence_candidates: [],
  reference_segments_without_candidate: ["saved-1"],
  candidate_segments_without_reference: ["rerun-1"],
  duplicate_review: [],
} as CorrespondenceAuditBundle;

test("audit findings start pending and accept independent decisions", () => {
  const initial = createInitialCorrespondenceAuditReviewState(bundle);
  const next = correspondenceAuditReviewReducer(initial, {
    type: "decide",
    item_id: "candidate-unmatched:rerun-1",
    decision: "kept",
  });
  assert.equal(initial.decisions["candidate-unmatched:rerun-1"], "pending");
  assert.equal(next.decisions["candidate-unmatched:rerun-1"], "kept");
  assert.equal(reviewedCorrespondenceAuditCount(next), 1);
});

test("restore ignores stale item ids and invalid decisions", () => {
  const restored = correspondenceAuditReviewReducer(
    createInitialCorrespondenceAuditReviewState(bundle),
    {
      type: "restore",
      bundle,
      decisions: {
        "candidate-unmatched:rerun-1": "uncertain",
        stale: "kept",
        "reference-missing:saved-1": "merged",
      },
    },
  );
  assert.deepEqual(restored.decisions, {
    "candidate-unmatched:rerun-1": "uncertain",
    "reference-missing:saved-1": "pending",
  });
});

test("reset clears browser decisions", () => {
  const changed = correspondenceAuditReviewReducer(
    createInitialCorrespondenceAuditReviewState(bundle),
    {
      type: "decide",
      item_id: "reference-missing:saved-1",
      decision: "dismissed",
    },
  );
  const reset = correspondenceAuditReviewReducer(changed, { type: "reset", bundle });
  assert.equal(reset.decisions["reference-missing:saved-1"], "pending");
});

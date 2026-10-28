import assert from "node:assert/strict";
import test from "node:test";

import type { RecoveryCandidateBundle } from "../data/recovery-schema.ts";
import {
  createInitialRecoveryReviewState,
  recoveryReviewReducer,
  reviewedRecoveryCount,
} from "./recovery-state.ts";

const bundle = {
  schema: "wildscore-recovery-candidates-v1",
  clip_id: "clip-01",
  processed_fps: 15,
  processed_frame_count: 308,
  width: 1920,
  height: 1080,
  candidates: [{ candidate_id: "recovery-antelope-3" }],
  reviews: [],
  limitations: [],
} as unknown as RecoveryCandidateBundle;

test("candidate decisions are independent and start pending", () => {
  const initial = createInitialRecoveryReviewState(bundle);
  const next = recoveryReviewReducer(initial, {
    type: "decide",
    candidate_id: "recovery-antelope-3",
    decision: "accepted",
  });
  assert.equal(initial.decisions["recovery-antelope-3"], "pending");
  assert.equal(next.decisions["recovery-antelope-3"], "accepted");
  assert.equal(reviewedRecoveryCount(next), 1);
});

test("reset does not depend on event review state", () => {
  const changed = recoveryReviewReducer(createInitialRecoveryReviewState(bundle), {
    type: "decide",
    candidate_id: "recovery-antelope-3",
    decision: "rejected",
  });
  assert.equal(
    recoveryReviewReducer(changed, { type: "reset", bundle }).decisions["recovery-antelope-3"],
    "pending",
  );
});

test("restore accepts only current candidate IDs and valid decisions", () => {
  const restored = recoveryReviewReducer(createInitialRecoveryReviewState(bundle), {
    type: "restore",
    bundle,
    decisions: {
      "recovery-antelope-3": "uncertain",
      "unknown-candidate": "accepted",
      another: "not-a-decision",
    },
  });
  assert.deepEqual(restored.decisions, { "recovery-antelope-3": "uncertain" });
});

test("stored reviews override stale browser-local decisions", () => {
  const reviewedBundle = {
    ...bundle,
    reviews: [{ candidate_id: "recovery-antelope-3", decision: "accepted" }],
  } as unknown as RecoveryCandidateBundle;
  const restored = recoveryReviewReducer(createInitialRecoveryReviewState(reviewedBundle), {
    type: "restore",
    bundle: reviewedBundle,
    decisions: { "recovery-antelope-3": "rejected" },
  });
  assert.equal(restored.decisions["recovery-antelope-3"], "accepted");
});

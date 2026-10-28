import assert from "node:assert/strict";
import test from "node:test";

import type { RecoveryCandidateBundle } from "../data/recovery-schema.ts";
import type { RecoveryReviewState } from "../review/recovery-state.ts";
import { buildRecoveryCsv, RECOVERY_CSV_HEADER } from "./recovery-csv.ts";

const bundle = {
  clip_id: "clip-01",
  candidates: [{
    candidate_id: "recovery-antelope-3",
    source_prompt: "antelope",
    start_s: 14.2,
    end_s: 20.5,
  }],
  label_proposals: [{
    candidate_id: "recovery-antelope-3",
    label_id: "antelope",
    model: "muse-spark-1.3",
    context_condition: "visible_evidence_only",
    visible_evidence: "=unsafe evidence",
    uncertainty_reason: null,
  }],
} as unknown as RecoveryCandidateBundle;

const state = {
  decisions: { "recovery-antelope-3": "accepted" },
  label_decisions: {
    "recovery-antelope-3": { decision: "accepted", value: "antelope" },
  },
} as unknown as RecoveryReviewState;

test("exports recovery evidence separately from events", () => {
  const lines = buildRecoveryCsv(bundle, state).trimEnd().split("\n");
  assert.equal(lines[0], RECOVERY_CSV_HEADER.join(","));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"accepted"/u);
  assert.match(lines[1], /"muse-spark-1.3"/u);
  assert.doesNotMatch(lines[0], /event_kind/u);
});

test("neutralises editable evidence cells", () => {
  assert.match(buildRecoveryCsv(bundle, state), /"'=unsafe evidence"/u);
});

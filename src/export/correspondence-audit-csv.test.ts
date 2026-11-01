import assert from "node:assert/strict";
import test from "node:test";

import type { CorrespondenceAuditBundle } from "../data/correspondence-audit-schema.ts";
import type { CorrespondenceAuditReviewState } from "../review/correspondence-audit-state.ts";
import {
  buildCorrespondenceAuditCsv,
  CORRESPONDENCE_AUDIT_CSV_HEADER,
} from "./correspondence-audit-csv.ts";

const bundle = {
  schema_version: "wildscore-correspondence-audit-v1",
  clip_id: "clip-01",
  source_run_id: "generic-rerun-1",
  candidate_segments: [{ segment_id: "rerun-1" }],
  correspondence_candidates: [],
  reference_segments_without_candidate: [],
  candidate_segments_without_reference: ["rerun-1"],
  duplicate_review: [],
} as unknown as CorrespondenceAuditBundle;

const state = {
  decisions: { "candidate-unmatched:rerun-1": "kept" },
} as unknown as CorrespondenceAuditReviewState;

test("exports plain-language audit findings and decisions", () => {
  const lines = buildCorrespondenceAuditCsv(bundle, state).trimEnd().split("\n");
  assert.equal(lines[0], CORRESPONDENCE_AUDIT_CSV_HEADER.join(","));
  assert.match(lines[1], /generic rerun segment absent from reviewed analysis/u);
  assert.match(lines[1], /queue the box-only evidence for a targeted recovery run/u);
  assert.doesNotMatch(lines[0], /review_kind|mean_iou|confidence/u);
});

test("does not claim that kept audit evidence is merged or recovered", () => {
  const csv = buildCorrespondenceAuditCsv(bundle, state);
  assert.doesNotMatch(csv, /automatically merged|confirmed recovery/u);
});

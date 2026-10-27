import assert from "node:assert/strict";
import test from "node:test";

import type { WildScoreBundle } from "../data/bundle-schema.ts";
import { createInitialReviewState, reviewReducer } from "../review/review-state.ts";
import { buildEventCsv, EVENT_CSV_HEADER } from "./event-csv.ts";

const bundle = {
  schema_version: "0.1.0",
  clip: { clip_id: "clip-01" },
  run: { run_id: "run-1" },
  segments: [],
  events: [
    {
      event_id: "event-1",
      segment_id: "segment-1",
      event_kind: "appearance",
      start_s: 1,
      end_s: 1,
      boundary_evidence: "interior",
      uncertainty_flags: ["camera_motion_possible"],
      decision: "proposed",
      derivation_source: "sam_geometry",
      config_version: "v1",
    },
  ],
  label_proposals: [
    {
      segment_id: "segment-1",
      label_id: "baboon",
    },
  ],
  reviews: [],
} as unknown as WildScoreBundle;

test("uses the required header and retains rejected records", () => {
  const rejected = reviewReducer(createInitialReviewState(bundle), {
    type: "decide_event",
    event_id: "event-1",
    decision: "rejected",
    reviewer: "reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  const lines = buildEventCsv(bundle, rejected).trimEnd().split("\n");
  assert.equal(lines[0], EVENT_CSV_HEADER.join(","));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /"rejected"/u);
});

test("exports uncertain event reviews with their explanation", () => {
  const uncertain = reviewReducer(createInitialReviewState(bundle), {
    type: "decide_event",
    event_id: "event-1",
    decision: "uncertain",
    reviewer: "reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  const csv = buildEventCsv(bundle, uncertain);
  assert.match(csv, /"uncertain"/u);
  assert.match(csv, /Reviewer could not determine this event/u);
});

test("quotes fields and neutralises editable spreadsheet formulas", () => {
  const corrected = reviewReducer(createInitialReviewState(bundle), {
    type: "review_label",
    segment_id: "segment-1",
    value: "=HYPERLINK(\"bad\")",
    reviewer: "+reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
    correction_note: "@note,\ncontinued",
  });
  const csv = buildEventCsv(bundle, corrected);
  assert.match(csv, /"'=HYPERLINK\(""bad""\)"/u);
  assert.match(csv, /"'\+reviewer"/u);
  assert.match(csv, /"'@note,\ncontinued"/u);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { buildEventCues } from "../audio/cue-builder.ts";
import { validateBundle } from "../data/bundle-schema.ts";
import { buildEventCsv } from "../export/event-csv.ts";
import {
  createInitialReviewState,
  reviewReducer,
} from "../review/review-state.ts";

const DEMO_BUNDLE = new URL("../../web/public/demo/bundle.json", import.meta.url);

test(
  "rejecting an actual saved proposal updates audio and CSV while reset restores it",
  { skip: !existsSync(DEMO_BUNDLE) && "local sanitized demo bundle is unavailable" },
  () => {
    const bundle = validateBundle(
      JSON.parse(readFileSync(DEMO_BUNDLE, "utf8")) as unknown,
    );
    const initial = createInitialReviewState(bundle);
    const selected = bundle.events.find(
      (event) => initial.event_reviews[event.event_id]?.decision === "accepted",
    );
    assert.ok(selected, "the saved demo needs at least one accepted event");
    assert.ok(
      buildEventCues(bundle, initial).some((cue) => cue.event_id === selected.event_id),
      "the accepted event should initially be audible",
    );

    const rejected = reviewReducer(initial, {
      type: "decide_event",
      event_id: selected.event_id,
      decision: "rejected",
      reviewer: "local_reviewer",
      reviewed_at: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(
      !buildEventCues(bundle, rejected).some((cue) => cue.event_id === selected.event_id),
      "rejected evidence must be silent",
    );
    const exportedRow = buildEventCsv(bundle, rejected)
      .split("\n")
      .find((row) => row.includes(`"${selected.event_id}"`));
    assert.ok(exportedRow, "the rejected event must remain in the CSV");
    assert.match(
      exportedRow,
      /,"(?:accepted|proposed|rejected|uncertain)","rejected",/u,
    );

    const reset = reviewReducer(rejected, { type: "reset", bundle });
    assert.equal(reset.event_reviews[selected.event_id]?.decision, "accepted");
    assert.ok(
      buildEventCues(bundle, reset).some((cue) => cue.event_id === selected.event_id),
      "reset should restore the saved accepted cue",
    );
  },
);

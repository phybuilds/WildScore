import assert from "node:assert/strict";
import test from "node:test";

import {
  matchEvents,
  type PredictedEvent,
  type ReferenceEvent,
} from "./event-matcher.ts";

function reference(
  id: string,
  subjectId: string,
  onsetS: number,
  kind: ReferenceEvent["event_kind"] = "appearance",
  eligible = true,
): ReferenceEvent {
  return {
    reference_event_id: id,
    reference_subject_id: subjectId,
    event_kind: kind,
    onset_s: onsetS,
    eligible,
    uncertainty_notes: [],
  };
}

function prediction(
  id: string,
  segmentId: string,
  onsetS: number,
  kind: PredictedEvent["event_kind"] = "appearance",
): PredictedEvent {
  return { event_id: id, segment_id: segmentId, event_kind: kind, onset_s: onsetS };
}

test("matches compatible events at the inclusive one-second boundary", () => {
  const result = matchEvents({
    references: [reference("ref-1", "animal-1", 5)],
    predictions: [prediction("pred-1", "seg-1", 6)],
    segmentCorrespondence: { "seg-1": "animal-1" },
  });
  assert.equal(result.total.matched_predictions, 1);
  assert.equal(result.matches[0].onset_error_s, 1);
});

test("wrong event kinds and subject correspondence do not match", () => {
  const result = matchEvents({
    references: [reference("ref-1", "animal-1", 5)],
    predictions: [
      prediction("wrong-kind", "seg-1", 5, "disappearance"),
      prediction("wrong-subject", "seg-2", 5),
    ],
    segmentCorrespondence: { "seg-1": "animal-1", "seg-2": "animal-2" },
  });
  assert.equal(result.total.missed_events, 1);
  assert.deepEqual(result.false_alarm_event_ids, ["wrong-kind", "wrong-subject"]);
});

test("duplicate predictions remain false alarms", () => {
  const result = matchEvents({
    references: [reference("ref-1", "animal-1", 5)],
    predictions: [
      prediction("pred-near", "seg-1", 5.1),
      prediction("pred-duplicate", "seg-1", 5.2),
    ],
    segmentCorrespondence: { "seg-1": "animal-1" },
  });
  assert.equal(result.total.matched_predictions, 1);
  assert.equal(result.total.false_alarms, 1);
});

test("maximum matching reassigns an earlier prediction when needed", () => {
  const result = matchEvents({
    references: [
      reference("ref-early", "animal-1", 1),
      reference("ref-late", "animal-1", 2.8),
    ],
    predictions: [
      prediction("pred-flexible", "seg-1", 1.9),
      prediction("pred-early-only", "seg-1", 0.2),
    ],
    segmentCorrespondence: { "seg-1": "animal-1" },
  });
  assert.equal(result.total.matched_predictions, 2);
  assert.equal(result.total.missed_events, 0);
});

test("ineligible references are excluded rather than counted as misses", () => {
  const result = matchEvents({
    references: [reference("uncertain", "animal-1", 5, "appearance", false)],
    predictions: [prediction("pred-1", "seg-1", 5)],
    segmentCorrespondence: { "seg-1": "animal-1" },
  });
  assert.equal(result.total.reference_count, 0);
  assert.equal(result.total.missed_events, 0);
  assert.equal(result.total.false_alarms, 1);
});

test("empty inputs produce explicit zero counts", () => {
  const result = matchEvents({
    references: [],
    predictions: [],
    segmentCorrespondence: {},
  });
  assert.deepEqual(result.total, {
    reference_count: 0,
    matched_predictions: 0,
    missed_events: 0,
    false_alarms: 0,
  });
});

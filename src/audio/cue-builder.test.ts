import assert from "node:assert/strict";
import test from "node:test";

import type { CandidateEvent, WildScoreBundle } from "../data/bundle-schema.ts";
import {
  createInitialReviewState,
  reviewReducer,
} from "../review/review-state.ts";
import {
  batchSimultaneousCues,
  buildEventCues,
  segmentRootFrequency,
} from "./cue-builder.ts";

function event(
  eventId: string,
  eventKind: CandidateEvent["event_kind"],
  startS: number,
): CandidateEvent {
  return {
    event_id: eventId,
    segment_id: "segment-1",
    event_kind: eventKind,
    start_s: startS,
    end_s: startS,
    boundary_evidence: "interior",
    uncertainty_flags: [],
    decision: "proposed",
    derivation_source: "sam_geometry",
    config_version: "v1",
  };
}

function fixture(events: CandidateEvent[]): WildScoreBundle {
  return {
    schema_version: "0.1.0",
    clip: {
      clip_id: "clip-01",
      display_media: "clip.mp4",
      processed_duration_s: 10,
      processed_fps: 10,
      processed_frame_count: 100,
      width: 10,
      height: 10,
    },
    run: {},
    segments: [
      {
        segment_id: "segment-1",
        sam_object_id: "1",
        first_frame: 10,
        last_frame: 20,
        start_s: 1,
        end_s: 2,
        already_visible_at_start: false,
        still_visible_at_end: false,
        geometry: [
          {
            frame_index: 10,
            object_id: "1",
            box: { left: 0, top: 0, right: 2, bottom: 2 },
            mask: { encoding: "none", width: 10, height: 10, payload: "" },
            detection_confidence: null,
          },
          {
            frame_index: 20,
            object_id: "1",
            box: { left: 8, top: 0, right: 10, bottom: 2 },
            mask: { encoding: "none", width: 10, height: 10, payload: "" },
            detection_confidence: null,
          },
        ],
      },
    ],
    events,
    label_proposals: [],
    reviews: [],
    evaluation: { status: "test", held_out_clip_count: 0, limitations: [] },
  };
}

test("appearance rises and disappearance falls from a stable segment root", () => {
  const bundle = fixture([
    event("appearance-1", "appearance", 1),
    event("disappearance-1", "disappearance", 2),
  ]);
  const cues = buildEventCues(bundle, createInitialReviewState(bundle));
  assert.ok(cues[0].notes[0].frequency_hz < cues[0].notes[2].frequency_hz);
  assert.ok(cues[1].notes[0].frequency_hz > cues[1].notes[2].frequency_hz);
  assert.equal(cues[0].notes[0].oscillator_type, "triangle");
  assert.equal(cues[1].notes[0].oscillator_type, "sine");
  assert.ok(cues[0].notes[0].pan < 0);
  assert.ok(cues[1].notes[0].pan > 0);
  assert.ok(cues[1].notes[2].duration_s > cues[0].notes[2].duration_s);
  assert.equal(segmentRootFrequency("segment-1"), segmentRootFrequency("segment-1"));
});

test("accepted cues are stronger and rejected or uncertain events are silent", () => {
  const bundle = fixture([
    event("accepted-1", "appearance", 1),
    event("rejected-1", "disappearance", 2),
    event("uncertain-1", "appearance", 3),
  ]);
  let state = createInitialReviewState(bundle);
  state = reviewReducer(state, {
    type: "decide_event",
    event_id: "accepted-1",
    decision: "accepted",
    reviewer: "reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  state = reviewReducer(state, {
    type: "decide_event",
    event_id: "uncertain-1",
    decision: "uncertain",
    reviewer: "reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  state = reviewReducer(state, {
    type: "decide_event",
    event_id: "rejected-1",
    decision: "rejected",
    reviewer: "reviewer",
    reviewed_at: "2026-10-27T12:00:00.000Z",
  });
  const cues = buildEventCues(bundle, state);
  assert.deepEqual(cues.map((cue) => cue.event_id), ["accepted-1"]);
  assert.equal(cues[0].notes[0].gain, 0.1);
});

test("polyphony cap reports suppressed audio without removing source cues", () => {
  const events = Array.from({ length: 6 }, (_, index) =>
    event(`event-${index}`, "appearance", 1),
  );
  const bundle = fixture(events);
  const cues = buildEventCues(bundle, createInitialReviewState(bundle));
  const batches = batchSimultaneousCues(cues, 4);
  assert.equal(cues.length, 6);
  assert.equal(batches[0].audible.length, 4);
  assert.deepEqual(batches[0].suppressed_event_ids, ["event-4", "event-5"]);
});

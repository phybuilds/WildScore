import assert from "node:assert/strict";
import test from "node:test";

import type { EventCue } from "./cue-builder.ts";
import { planCueWindow } from "./scheduler.ts";

function cue(eventId: string, timeS: number): EventCue {
  return {
    event_id: eventId,
    segment_id: `segment-${eventId}`,
    time_s: timeS,
    event_kind: "appearance",
    review_status: "proposed",
    notes: [
      {
        offset_s: 0.1,
        duration_s: 0.12,
        frequency_hz: 220,
        gain: 0.055,
      },
    ],
  };
}

test("a forward seek never schedules cues before video.currentTime", () => {
  const plan = planCueWindow({
    cues: [cue("past", 2), cue("current", 8), cue("future", 8.2)],
    videoStartS: 8,
    videoEndS: 8.25,
    audioNowS: 20,
  });
  assert.deepEqual(
    plan.notes.map((note) => note.event_id),
    ["current", "future"],
  );
});

test("video offsets are translated onto the audio clock", () => {
  const plan = planCueWindow({
    cues: [cue("event", 5.2)],
    videoStartS: 5,
    videoEndS: 5.3,
    audioNowS: 100,
  });
  assert.equal(plan.notes[0].audio_start_s, 100.3);
});

test("voice caps report every event omitted from audio", () => {
  const cues = Array.from({ length: 6 }, (_, index) =>
    cue(`event-${index}`, 1),
  );
  const plan = planCueWindow({
    cues,
    videoStartS: 1,
    videoEndS: 1.1,
    audioNowS: 10,
    maxVoices: 4,
  });
  assert.equal(plan.notes.length, 4);
  assert.deepEqual(plan.suppressed_event_ids, ["event-4", "event-5"]);
});

test("invalid or empty time windows fail closed", () => {
  assert.throws(
    () =>
      planCueWindow({
        cues: [],
        videoStartS: 2,
        videoEndS: 2,
        audioNowS: 10,
      }),
    /finite, increasing times/u,
  );
});

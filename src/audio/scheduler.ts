import {
  batchSimultaneousCues,
  type CueNote,
  type EventCue,
} from "./cue-builder.ts";

export interface PlannedAudioNote extends CueNote {
  event_id: string;
  segment_id: string;
  audio_start_s: number;
}

export interface CueWindowPlan {
  video_start_s: number;
  video_end_s: number;
  notes: PlannedAudioNote[];
  suppressed_event_ids: string[];
}

export function planCueWindow({
  cues,
  videoStartS,
  videoEndS,
  audioNowS,
  maxVoices = 4,
}: {
  cues: EventCue[];
  videoStartS: number;
  videoEndS: number;
  audioNowS: number;
  maxVoices?: number;
}): CueWindowPlan {
  if (
    !Number.isFinite(videoStartS) ||
    !Number.isFinite(videoEndS) ||
    !Number.isFinite(audioNowS) ||
    videoStartS < 0 ||
    videoEndS <= videoStartS
  ) {
    throw new Error("Cue window must have finite, increasing times");
  }

  const windowCues = cues.filter(
    (cue) => cue.time_s >= videoStartS && cue.time_s < videoEndS,
  );
  const batches = batchSimultaneousCues(windowCues, maxVoices);
  const notes = batches.flatMap((batch) =>
    batch.audible.flatMap((cue) =>
      cue.notes.map((note) => ({
        ...note,
        event_id: cue.event_id,
        segment_id: cue.segment_id,
        audio_start_s: Number(
          (
            audioNowS +
            (cue.time_s - videoStartS) +
            note.offset_s
          ).toFixed(6),
        ),
      })),
    ),
  );

  return {
    video_start_s: videoStartS,
    video_end_s: videoEndS,
    notes,
    suppressed_event_ids: batches.flatMap(
      (batch) => batch.suppressed_event_ids,
    ),
  };
}

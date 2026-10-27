import type {
  CandidateEvent,
  ReviewDecision,
  WildScoreBundle,
} from "../data/bundle-schema";
import type { ReviewState } from "../review/review-state";

export interface CueNote {
  offset_s: number;
  duration_s: number;
  frequency_hz: number;
  gain: number;
}

export interface EventCue {
  event_id: string;
  segment_id: string;
  time_s: number;
  event_kind: CandidateEvent["event_kind"];
  review_status: Exclude<ReviewDecision, "rejected" | "uncertain">;
  notes: CueNote[];
}

export interface CueBatch {
  time_s: number;
  audible: EventCue[];
  suppressed_event_ids: string[];
}

const BASE_SCALE_HZ = [196, 220, 246.94, 261.63, 293.66, 329.63, 392];
const MOTIF_RATIOS = [1, 1.12246, 1.33484];

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function segmentRootFrequency(segmentId: string): number {
  return BASE_SCALE_HZ[stableStringHash(segmentId) % BASE_SCALE_HZ.length];
}

function motifForEvent(
  event: CandidateEvent,
  reviewStatus: Exclude<ReviewDecision, "rejected" | "uncertain">,
): CueNote[] {
  const root = segmentRootFrequency(event.segment_id);
  const ratios =
    event.event_kind === "appearance"
      ? MOTIF_RATIOS
      : [...MOTIF_RATIOS].reverse();
  const gain = reviewStatus === "accepted" ? 0.1 : 0.055;
  return ratios.map((ratio, index) => ({
    offset_s: index * 0.09,
    duration_s: 0.12,
    frequency_hz: Number((root * ratio).toFixed(2)),
    gain,
  }));
}

export function buildEventCues(
  bundle: WildScoreBundle,
  state: ReviewState,
): EventCue[] {
  return bundle.events.flatMap((event) => {
    const reviewStatus =
      state.event_reviews[event.event_id]?.decision ?? event.decision;
    if (reviewStatus === "rejected" || reviewStatus === "uncertain") return [];
    return [
      {
        event_id: event.event_id,
        segment_id: event.segment_id,
        time_s: event.start_s,
        event_kind: event.event_kind,
        review_status: reviewStatus,
        notes: motifForEvent(event, reviewStatus),
      },
    ];
  });
}

export function batchSimultaneousCues(
  cues: EventCue[],
  maxVoices = 4,
  simultaneousWindowS = 0.06,
): CueBatch[] {
  if (!Number.isInteger(maxVoices) || maxVoices < 1) {
    throw new Error("maxVoices must be a positive integer");
  }
  const ordered = [...cues].sort(
    (left, right) => left.time_s - right.time_s || left.event_id.localeCompare(right.event_id),
  );
  const batches: CueBatch[] = [];
  for (const cue of ordered) {
    const batch = batches.at(-1);
    if (!batch || cue.time_s - batch.time_s > simultaneousWindowS) {
      batches.push({ time_s: cue.time_s, audible: [cue], suppressed_event_ids: [] });
    } else if (batch.audible.length < maxVoices) {
      batch.audible.push(cue);
    } else {
      batch.suppressed_event_ids.push(cue.event_id);
    }
  }
  return batches;
}

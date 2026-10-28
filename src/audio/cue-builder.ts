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
  oscillator_type: "sine" | "triangle";
  pan: number;
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
const APPEARANCE_RATIOS = [1, 1.25, 1.5];
const DISAPPEARANCE_RATIOS = [1.25, 1, 0.75];

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
  bundle: WildScoreBundle,
  event: CandidateEvent,
  reviewStatus: Exclude<ReviewDecision, "rejected" | "uncertain">,
): CueNote[] {
  const root = segmentRootFrequency(event.segment_id);
  const segment = bundle.segments.find(
    (candidate) => candidate.segment_id === event.segment_id,
  );
  const orderedGeometry = [...(segment?.geometry ?? [])].sort(
    (left, right) => left.frame_index - right.frame_index,
  );
  const geometry =
    event.event_kind === "appearance"
      ? orderedGeometry[0]
      : orderedGeometry.at(-1);
  const boxCenterX = geometry
    ? (geometry.box.left + geometry.box.right) / 2
    : bundle.clip.width / 2;
  const normalizedPan =
    bundle.clip.width > 0 ? (boxCenterX / bundle.clip.width) * 2 - 1 : 0;
  const pan = Number(
    Math.max(-0.85, Math.min(0.85, normalizedPan)).toFixed(3),
  );
  const isAppearance = event.event_kind === "appearance";
  const ratios = isAppearance ? APPEARANCE_RATIOS : DISAPPEARANCE_RATIOS;
  const gain = reviewStatus === "accepted" ? 0.1 : 0.055;
  return ratios.map((ratio, index) => ({
    offset_s: index * (isAppearance ? 0.075 : 0.11),
    duration_s:
      isAppearance ? 0.1 : index === ratios.length - 1 ? 0.28 : 0.17,
    frequency_hz: Number((root * ratio).toFixed(2)),
    gain,
    oscillator_type: isAppearance ? "triangle" : "sine",
    pan,
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
        notes: motifForEvent(bundle, event, reviewStatus),
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

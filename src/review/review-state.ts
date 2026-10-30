import type {
  ReviewDecision,
  StoredReview,
  WildScoreBundle,
} from "../data/bundle-schema";

export interface EventReviewState {
  decision: ReviewDecision;
  reviewer: string | null;
  reviewed_at: string | null;
  correction_note: string;
}

export interface LabelReviewState {
  decision: ReviewDecision;
  original_value: string;
  new_value: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  correction_note: string;
}

export interface ReviewState {
  bundle_key: string;
  event_reviews: Record<string, EventReviewState>;
  label_reviews: Record<string, LabelReviewState>;
}

export type ReviewAction =
  | { type: "load"; bundle: WildScoreBundle }
  | { type: "restore"; bundle: WildScoreBundle; stored: unknown }
  | {
      type: "decide_event";
      event_id: string;
      decision: "accepted" | "rejected" | "uncertain";
      reviewer: string;
      reviewed_at: string;
    }
  | {
      type: "decide_events";
      event_ids: string[];
      decision: "accepted" | "rejected" | "uncertain";
      reviewer: string;
      reviewed_at: string;
    }
  | {
      type: "review_label";
      segment_id: string;
      value: string;
      reviewer: string;
      reviewed_at: string;
      correction_note: string;
    }
  | {
      type: "review_labels";
      segment_ids: string[];
      value: string;
      reviewer: string;
      reviewed_at: string;
      correction_note: string;
    }
  | { type: "reset"; bundle: WildScoreBundle };

export function bundleIdentityKey(bundle: WildScoreBundle): string {
  return JSON.stringify([
    bundle.schema_version,
    bundle.clip.clip_id,
    bundle.run.run_id ?? null,
    bundle.run.config_hash ?? null,
  ]);
}

function reviewBaselineHash(bundle: WildScoreBundle): string {
  const value = JSON.stringify([
    bundle.label_proposals.map((proposal) => [
      proposal.segment_id,
      proposal.label_id,
    ]),
    bundle.reviews.map((review) => [
      review.review_kind,
      review.segment_id ?? null,
      review.event_id ?? null,
      review.decision,
      review.original_value,
      review.new_value,
    ]),
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function bundleKey(bundle: WildScoreBundle): string {
  return JSON.stringify([bundleIdentityKey(bundle), reviewBaselineHash(bundle)]);
}

function storedLabelReviews(
  reviews: StoredReview[],
): Record<string, LabelReviewState> {
  const stored: Record<string, LabelReviewState> = {};
  for (const review of reviews) {
    if (review.review_kind !== "segment_label" || !review.segment_id) continue;
    stored[review.segment_id] = {
      decision: review.decision,
      original_value: review.original_value,
      new_value: review.new_value,
      reviewer: review.reviewer,
      reviewed_at: review.reviewed_at,
      correction_note: review.correction_note,
    };
  }
  return stored;
}

export function createInitialReviewState(bundle: WildScoreBundle): ReviewState {
  const eventReviews: Record<string, EventReviewState> = {};
  for (const event of bundle.events) {
    eventReviews[event.event_id] = {
      decision: event.decision,
      reviewer: null,
      reviewed_at: null,
      correction_note: "",
    };
  }
  const labelReviews: Record<string, LabelReviewState> = {};
  for (const proposal of bundle.label_proposals) {
    labelReviews[proposal.segment_id] = {
      decision: "proposed",
      original_value: proposal.label_id,
      new_value: null,
      reviewer: null,
      reviewed_at: null,
      correction_note: "",
    };
  }
  for (const segment of bundle.segments) {
    if (segment.segment_id in labelReviews) continue;
    labelReviews[segment.segment_id] = {
      decision: "proposed",
      original_value: "unlabelled animal",
      new_value: null,
      reviewer: null,
      reviewed_at: null,
      correction_note: "",
    };
  }
  Object.assign(labelReviews, storedLabelReviews(bundle.reviews));
  for (const review of bundle.reviews) {
    if (review.review_kind !== "event" || !review.event_id) continue;
    eventReviews[review.event_id] = {
      decision: review.decision,
      reviewer: review.reviewer,
      reviewed_at: review.reviewed_at,
      correction_note: review.correction_note,
    };
  }
  return {
    bundle_key: bundleKey(bundle),
    event_reviews: eventReviews,
    label_reviews: labelReviews,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortStringOrNull(value: unknown, maxLength: number): boolean {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

export function restoreReviewState(
  bundle: WildScoreBundle,
  stored: unknown,
): ReviewState {
  const initial = createInitialReviewState(bundle);
  if (!isRecord(stored) || stored.bundle_key !== initial.bundle_key) return initial;

  const eventReviews = { ...initial.event_reviews };
  if (isRecord(stored.event_reviews)) {
    for (const [eventId, value] of Object.entries(stored.event_reviews)) {
      if (!(eventId in eventReviews) || !isRecord(value)) continue;
      if (!["proposed", "accepted", "rejected", "uncertain"].includes(String(value.decision))) continue;
      if (!isShortStringOrNull(value.reviewer, 120)) continue;
      if (!isShortStringOrNull(value.reviewed_at, 80)) continue;
      if (typeof value.correction_note !== "string" || value.correction_note.length > 500) continue;
      eventReviews[eventId] = value as unknown as EventReviewState;
    }
  }

  const labelReviews = { ...initial.label_reviews };
  if (isRecord(stored.label_reviews)) {
    for (const [segmentId, value] of Object.entries(stored.label_reviews)) {
      if (!(segmentId in labelReviews) || !isRecord(value)) continue;
      if (!["proposed", "accepted", "rejected", "uncertain"].includes(String(value.decision))) continue;
      if (typeof value.original_value !== "string" || value.original_value.length > 240) continue;
      if (!isShortStringOrNull(value.new_value, 240)) continue;
      if (!isShortStringOrNull(value.reviewer, 120)) continue;
      if (!isShortStringOrNull(value.reviewed_at, 80)) continue;
      if (typeof value.correction_note !== "string" || value.correction_note.length > 500) continue;
      labelReviews[segmentId] = {
        ...(value as unknown as LabelReviewState),
        original_value: initial.label_reviews[segmentId].original_value,
      };
    }
  }

  return { ...initial, event_reviews: eventReviews, label_reviews: labelReviews };
}

export function reviewReducer(
  state: ReviewState,
  action: ReviewAction,
): ReviewState {
  if (action.type === "restore") {
    return restoreReviewState(action.bundle, action.stored);
  }
  if (action.type === "load" || action.type === "reset") {
    return createInitialReviewState(action.bundle);
  }
  if (action.type === "decide_event" || action.type === "decide_events") {
    const eventIds =
      action.type === "decide_event" ? [action.event_id] : action.event_ids;
    const eventReviews = { ...state.event_reviews };
    let changed = false;
    for (const eventId of new Set(eventIds)) {
      if (!(eventId in eventReviews)) continue;
      eventReviews[eventId] = {
        decision: action.decision,
        reviewer: action.reviewer,
        reviewed_at: action.reviewed_at,
        correction_note:
          action.decision === "uncertain"
            ? "Reviewer could not determine this event from the saved evidence."
            : "",
      };
      changed = true;
    }
    if (!changed) return state;
    return {
      ...state,
      event_reviews: eventReviews,
    };
  }
  const segmentIds =
    action.type === "review_label" ? [action.segment_id] : action.segment_ids;
  const labelReviews = { ...state.label_reviews };
  let changed = false;
  for (const segmentId of new Set(segmentIds)) {
    const existing = labelReviews[segmentId];
    if (!existing) continue;
    labelReviews[segmentId] = {
      decision: "accepted",
      original_value: existing.original_value,
      new_value: action.value === existing.original_value ? null : action.value,
      reviewer: action.reviewer,
      reviewed_at: action.reviewed_at,
      correction_note: action.correction_note,
    };
    changed = true;
  }
  if (!changed) return state;
  return {
    ...state,
    label_reviews: labelReviews,
  };
}

export function currentReviewedLabel(
  bundle: WildScoreBundle,
  state: ReviewState,
  segmentId: string,
): { label: string; source: "human" | "model" | "unlabelled" } {
  const review = state.label_reviews[segmentId];
  if (review?.decision === "accepted") {
    return {
      label: review.new_value ?? review.original_value,
      source: "human",
    };
  }
  const proposal = bundle.label_proposals.find(
    (item) => item.segment_id === segmentId,
  );
  if (proposal) return { label: proposal.label_id, source: "model" };
  return { label: "unlabelled animal", source: "unlabelled" };
}

export function reviewedEventCount(state: ReviewState): number {
  return Object.values(state.event_reviews).filter(
    (review) => review.decision !== "proposed",
  ).length;
}

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
  | {
      type: "decide_event";
      event_id: string;
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
  | { type: "reset"; bundle: WildScoreBundle };

export function bundleKey(bundle: WildScoreBundle): string {
  return JSON.stringify([
    bundle.schema_version,
    bundle.clip.clip_id,
    bundle.run.run_id ?? null,
    bundle.run.config_hash ?? null,
  ]);
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

export function reviewReducer(
  state: ReviewState,
  action: ReviewAction,
): ReviewState {
  if (action.type === "load" || action.type === "reset") {
    return createInitialReviewState(action.bundle);
  }
  if (action.type === "decide_event") {
    if (!(action.event_id in state.event_reviews)) return state;
    return {
      ...state,
      event_reviews: {
        ...state.event_reviews,
        [action.event_id]: {
          decision: action.decision,
          reviewer: action.reviewer,
          reviewed_at: action.reviewed_at,
          correction_note:
            action.decision === "uncertain"
              ? "Reviewer could not determine this event from the saved evidence."
              : "",
        },
      },
    };
  }
  const existing = state.label_reviews[action.segment_id];
  if (!existing) return state;
  return {
    ...state,
    label_reviews: {
      ...state.label_reviews,
      [action.segment_id]: {
        decision: "accepted",
        original_value: existing.original_value,
        new_value:
          action.value === existing.original_value ? null : action.value,
        reviewer: action.reviewer,
        reviewed_at: action.reviewed_at,
        correction_note: action.correction_note,
      },
    },
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

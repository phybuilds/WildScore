import type {
  HeldOutEvaluationResult,
  WildScoreBundle,
} from "../data/bundle-schema";
import type { RecoveryCandidateBundle } from "../data/recovery-schema";

export interface DevelopmentEvidenceSummary {
  eventProposalCount: number;
  acceptedEventCount: number;
  rejectedEventCount: number;
  uncertainEventCount: number;
  reviewedRecoveryTrackCount: number;
  reviewedRecoveryLabelCount: number;
  heldOutClipCount: number;
  heldOutResult: HeldOutEvaluationResult | null;
  models: string[];
  provider: string | null;
  samRuntimeMs: number | null;
  samFramesProcessed: number | null;
  limitations: string[];
}

function stringValues(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.values(value).filter((item): item is string => typeof item === "string");
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildDevelopmentEvidenceSummary(
  bundle: WildScoreBundle,
  recovery: RecoveryCandidateBundle,
): DevelopmentEvidenceSummary {
  const eventIds = new Set(bundle.events.map((event) => event.event_id));
  const storedEventReviews = bundle.reviews.filter(
    (review) =>
      review.review_kind === "event" &&
      typeof review.event_id === "string" &&
      eventIds.has(review.event_id),
  );
  const recoveryCandidateIds = new Set(
    recovery.candidates.map((candidate) => candidate.candidate_id),
  );

  return {
    eventProposalCount: bundle.events.length,
    acceptedEventCount: storedEventReviews.filter(
      (review) => review.decision === "accepted",
    ).length,
    rejectedEventCount: storedEventReviews.filter(
      (review) => review.decision === "rejected",
    ).length,
    uncertainEventCount: storedEventReviews.filter(
      (review) => review.decision === "uncertain",
    ).length,
    reviewedRecoveryTrackCount: recovery.reviews.filter((review) =>
      recoveryCandidateIds.has(review.candidate_id),
    ).length,
    reviewedRecoveryLabelCount: recovery.label_reviews.filter((review) =>
      recoveryCandidateIds.has(review.candidate_id),
    ).length,
    heldOutClipCount: bundle.evaluation.held_out_clip_count,
    heldOutResult: bundle.evaluation.held_out_result ?? null,
    models: stringValues(bundle.run.models),
    provider: typeof bundle.run.provider === "string" ? bundle.run.provider : null,
    samRuntimeMs: finiteNumber(bundle.run.sam_runtime_ms),
    samFramesProcessed: finiteNumber(bundle.run.sam_frames_processed),
    limitations: [
      bundle.evaluation.held_out_result
        ? "Development-clip proposal review remains separate from the bounded held-out result."
        : "Development-clip proposal review is not a held-out accuracy estimate.",
      "Proposal review cannot measure recall or count animals the model did not propose.",
      ...bundle.evaluation.limitations,
    ],
  };
}

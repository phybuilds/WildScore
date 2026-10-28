import type { WildScoreBundle } from "./bundle-schema";
import type { RecoveryCandidateBundle } from "./recovery-schema";

export function publicDemoBundle(bundle: WildScoreBundle): WildScoreBundle {
  const models =
    typeof bundle.run.models === "object" && bundle.run.models !== null
      ? bundle.run.models
      : {};
  return {
    ...bundle,
    run: {
      run_id: "hero-run-1",
      completion_state: bundle.run.completion_state,
      models,
      sam_prompt: bundle.run.sam_prompt,
      parser: bundle.run.parser,
      provider: bundle.run.provider,
      sam_runtime_ms: bundle.run.sam_runtime_ms,
      sam_frames_processed: bundle.run.sam_frames_processed,
      config_version: bundle.run.config_version,
    },
    label_proposals: bundle.label_proposals.map((proposal) => ({
      ...proposal,
      source_run_id: "label-run-1",
    })),
    reviews: bundle.reviews.map((review) => ({
      ...review,
      reviewer: "local_reviewer",
      reviewed_at: null,
    })),
  };
}

export function publicRecoveryBundle(
  bundle: RecoveryCandidateBundle,
): RecoveryCandidateBundle {
  return {
    ...bundle,
    candidates: bundle.candidates.map((candidate) => ({
      ...candidate,
      source_run_id: `targeted-${candidate.source_prompt}-run-1`,
    })),
    reviews: bundle.reviews.map((review) => ({
      ...review,
      reviewer: "local_reviewer",
      reviewed_at: null,
    })),
    label_proposals: bundle.label_proposals.map((proposal) => ({
      ...proposal,
      source_run_id: "recovery-label-run-1",
    })),
    label_reviews: bundle.label_reviews.map((review) => ({
      ...review,
      reviewer: "local_reviewer",
      reviewed_at: null,
    })),
  };
}

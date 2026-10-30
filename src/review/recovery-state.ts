import type { RecoveryCandidateBundle } from "../data/recovery-schema";

export type RecoveryDecision = "pending" | "accepted" | "rejected" | "uncertain";

export interface RecoveryReviewState {
  bundle_key: string;
  decisions: Record<string, RecoveryDecision>;
  label_decisions: Record<string, { decision: "pending" | "accepted" | "corrected" | "uncertain"; value: string | null }>;
}

export type RecoveryReviewAction =
  | { type: "load"; bundle: RecoveryCandidateBundle }
  | { type: "reset"; bundle: RecoveryCandidateBundle }
  | { type: "restore"; bundle: RecoveryCandidateBundle; decisions: unknown }
  | { type: "restore_labels"; bundle: RecoveryCandidateBundle; labels: unknown }
  | { type: "decide_label"; candidate_id: string; decision: "accepted" | "corrected" | "uncertain"; value: string | null }
  | {
      type: "decide";
      candidate_id: string;
      decision: Exclude<RecoveryDecision, "pending">;
    };

export function recoveryBundleKey(bundle: RecoveryCandidateBundle): string {
  return JSON.stringify([
    bundle.schema,
    bundle.clip_id,
    bundle.candidates.map((candidate) => candidate.candidate_id),
  ]);
}

export function createInitialRecoveryReviewState(
  bundle: RecoveryCandidateBundle,
): RecoveryReviewState {
  const decisions: Record<string, RecoveryDecision> = Object.fromEntries(
    bundle.candidates.map((candidate) => [candidate.candidate_id, "pending"]),
  );
  for (const review of bundle.reviews) decisions[review.candidate_id] = review.decision;
  const labelDecisions: RecoveryReviewState["label_decisions"] = Object.fromEntries(
    bundle.label_proposals.map((proposal) => [
      proposal.candidate_id,
      { decision: "pending" as const, value: null },
    ]),
  );
  for (const review of bundle.label_reviews) {
    labelDecisions[review.candidate_id] = {
      decision: review.decision,
      value: review.value,
    };
  }
  return {
    bundle_key: recoveryBundleKey(bundle),
    decisions,
    label_decisions: labelDecisions,
  };
}

export function recoveryReviewReducer(
  state: RecoveryReviewState,
  action: RecoveryReviewAction,
): RecoveryReviewState {
  if (action.type === "load") {
    return createInitialRecoveryReviewState(action.bundle);
  }
  if (action.type === "reset") {
    return {
      ...createInitialRecoveryReviewState(action.bundle),
      label_decisions: state.label_decisions,
    };
  }
  if (action.type === "restore") {
    const initial = createInitialRecoveryReviewState(action.bundle);
    if (
      typeof action.decisions !== "object" || action.decisions === null ||
      Array.isArray(action.decisions)
    ) {
      return initial;
    }
    const restored = { ...initial.decisions };
    for (const [candidateId, decision] of Object.entries(action.decisions)) {
      if (
        candidateId in restored && restored[candidateId] === "pending" &&
        ["pending", "accepted", "rejected", "uncertain"].includes(String(decision))
      ) {
        restored[candidateId] = decision as RecoveryDecision;
      }
    }
    return { ...initial, decisions: restored };
  }
  if (action.type === "restore_labels") {
    const initial = createInitialRecoveryReviewState(action.bundle);
    if (typeof action.labels !== "object" || action.labels === null || Array.isArray(action.labels)) return initial;
    const restored = { ...initial.label_decisions };
    for (const [candidateId, review] of Object.entries(action.labels)) {
      if (
        candidateId in restored && restored[candidateId].decision === "pending" &&
        typeof review === "object" && review !== null &&
        !Array.isArray(review) &&
        ["accepted", "corrected", "uncertain"].includes(String((review as { decision?: unknown }).decision)) &&
        ((review as { value?: unknown }).value === null || typeof (review as { value?: unknown }).value === "string")
      ) restored[candidateId] = review as typeof restored[string];
    }
    return { ...state, label_decisions: restored };
  }
  if (action.type === "decide_label") {
    if (!(action.candidate_id in state.label_decisions)) return state;
    return {
      ...state,
      label_decisions: {
        ...state.label_decisions,
        [action.candidate_id]: { decision: action.decision, value: action.value },
      },
    };
  }
  if (!(action.candidate_id in state.decisions)) return state;
  return {
    ...state,
    decisions: { ...state.decisions, [action.candidate_id]: action.decision },
  };
}

export function reviewedRecoveryLabelCount(state: RecoveryReviewState): number {
  return Object.values(state.label_decisions).filter((review) => review.decision !== "pending").length;
}

export function reviewedRecoveryCount(state: RecoveryReviewState): number {
  return Object.values(state.decisions).filter((decision) => decision !== "pending").length;
}

export function currentRecoveryLabel(
  bundle: RecoveryCandidateBundle,
  state: RecoveryReviewState,
  candidateId: string,
): { label: string; source: "human" | "model" | "unlabelled" } {
  const review = state.label_decisions[candidateId];
  if (
    review?.value &&
    (review.decision === "accepted" || review.decision === "corrected")
  ) {
    return { label: review.value, source: "human" };
  }
  const proposal = bundle.label_proposals.find(
    (item) => item.candidate_id === candidateId,
  );
  if (proposal) return { label: proposal.label_id, source: "model" };
  return { label: "unlabelled animal", source: "unlabelled" };
}

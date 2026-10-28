import type { RecoveryCandidateBundle } from "../data/recovery-schema";

export type RecoveryDecision = "pending" | "accepted" | "rejected" | "uncertain";

export interface RecoveryReviewState {
  bundle_key: string;
  decisions: Record<string, RecoveryDecision>;
}

export type RecoveryReviewAction =
  | { type: "load"; bundle: RecoveryCandidateBundle }
  | { type: "reset"; bundle: RecoveryCandidateBundle }
  | { type: "restore"; bundle: RecoveryCandidateBundle; decisions: unknown }
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
  return {
    bundle_key: recoveryBundleKey(bundle),
    decisions,
  };
}

export function recoveryReviewReducer(
  state: RecoveryReviewState,
  action: RecoveryReviewAction,
): RecoveryReviewState {
  if (action.type === "load" || action.type === "reset") {
    return createInitialRecoveryReviewState(action.bundle);
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
  if (!(action.candidate_id in state.decisions)) return state;
  return {
    ...state,
    decisions: { ...state.decisions, [action.candidate_id]: action.decision },
  };
}

export function reviewedRecoveryCount(state: RecoveryReviewState): number {
  return Object.values(state.decisions).filter((decision) => decision !== "pending").length;
}

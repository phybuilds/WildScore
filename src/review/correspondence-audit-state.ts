import type { CorrespondenceAuditBundle } from "../data/correspondence-audit-schema.ts";
import { buildCorrespondenceReviewQueue } from "../data/correspondence-audit-view.ts";

export type CorrespondenceAuditDecision =
  | "pending"
  | "kept"
  | "dismissed"
  | "uncertain";

export interface CorrespondenceAuditReviewState {
  bundle_key: string;
  decisions: Record<string, CorrespondenceAuditDecision>;
}

export type CorrespondenceAuditReviewAction =
  | { type: "load"; bundle: CorrespondenceAuditBundle }
  | { type: "reset"; bundle: CorrespondenceAuditBundle }
  | { type: "restore"; bundle: CorrespondenceAuditBundle; decisions: unknown }
  | {
      type: "decide";
      item_id: string;
      decision: Exclude<CorrespondenceAuditDecision, "pending">;
    };

export function correspondenceAuditBundleKey(
  bundle: CorrespondenceAuditBundle,
): string {
  return JSON.stringify([
    bundle.schema_version,
    bundle.clip_id,
    bundle.source_run_id,
    buildCorrespondenceReviewQueue(bundle).map((item) => item.id),
  ]);
}

export function createInitialCorrespondenceAuditReviewState(
  bundle: CorrespondenceAuditBundle,
): CorrespondenceAuditReviewState {
  return {
    bundle_key: correspondenceAuditBundleKey(bundle),
    decisions: Object.fromEntries(
      buildCorrespondenceReviewQueue(bundle).map((item) => [item.id, "pending"]),
    ),
  };
}

export function correspondenceAuditReviewReducer(
  state: CorrespondenceAuditReviewState,
  action: CorrespondenceAuditReviewAction,
): CorrespondenceAuditReviewState {
  if (action.type === "load" || action.type === "reset") {
    return createInitialCorrespondenceAuditReviewState(action.bundle);
  }
  if (action.type === "restore") {
    const initial = createInitialCorrespondenceAuditReviewState(action.bundle);
    if (
      typeof action.decisions !== "object" ||
      action.decisions === null ||
      Array.isArray(action.decisions)
    ) {
      return initial;
    }
    const decisions = { ...initial.decisions };
    for (const [itemId, decision] of Object.entries(action.decisions)) {
      if (
        itemId in decisions &&
        ["pending", "kept", "dismissed", "uncertain"].includes(String(decision))
      ) {
        decisions[itemId] = decision as CorrespondenceAuditDecision;
      }
    }
    return { ...initial, decisions };
  }
  if (!(action.item_id in state.decisions)) return state;
  return {
    ...state,
    decisions: { ...state.decisions, [action.item_id]: action.decision },
  };
}

export function reviewedCorrespondenceAuditCount(
  state: CorrespondenceAuditReviewState,
): number {
  return Object.values(state.decisions).filter((decision) => decision !== "pending")
    .length;
}

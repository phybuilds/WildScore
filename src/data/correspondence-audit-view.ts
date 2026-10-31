import type { CorrespondenceAuditBundle } from "./correspondence-audit-schema.ts";

export type CorrespondenceReviewItem = {
  id: string;
  kind: "reference_missing" | "candidate_unmatched" | "possible_duplicate";
  title: string;
  detail: string;
  focus_source: "saved_analysis" | "generic_rerun";
  focus_segment_id: string;
  related_segment_ids: string[];
};

export function buildCorrespondenceReviewQueue(
  bundle: CorrespondenceAuditBundle,
): CorrespondenceReviewItem[] {
  const items: CorrespondenceReviewItem[] = [];
  for (const id of bundle.reference_segments_without_candidate) {
    items.push({
      id: `reference-missing:${id}`,
      kind: "reference_missing",
      title: "Reviewed track not recovered",
      detail: "The generic rerun has no conservative geometry match.",
      focus_source: "saved_analysis",
      focus_segment_id: id,
      related_segment_ids: [],
    });
  }
  for (const id of bundle.candidate_segments_without_reference) {
    items.push({
      id: `candidate-unmatched:${id}`,
      kind: "candidate_unmatched",
      title: "Rerun track without reviewed match",
      detail: "Review this box before keeping it as additional evidence.",
      focus_source: "generic_rerun",
      focus_segment_id: id,
      related_segment_ids: [],
    });
  }
  for (const duplicate of bundle.duplicate_review) {
    items.push({
      id: `possible-duplicate:${duplicate.candidate_segment_id}`,
      kind: "possible_duplicate",
      title: "Possible duplicate relationship",
      detail: "One rerun track overlaps multiple reviewed tracks; no merge was applied.",
      focus_source: "generic_rerun",
      focus_segment_id: duplicate.candidate_segment_id,
      related_segment_ids: [...duplicate.reference_segment_ids],
    });
  }
  return items.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.focus_segment_id.localeCompare(right.focus_segment_id),
  );
}

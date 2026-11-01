import type { CorrespondenceAuditBundle } from "../data/correspondence-audit-schema.ts";
import { buildCorrespondenceReviewQueue } from "../data/correspondence-audit-view.ts";
import type { CorrespondenceAuditReviewState } from "../review/correspondence-audit-state.ts";

export const CORRESPONDENCE_AUDIT_CSV_HEADER = [
  "schema_version",
  "clip_id",
  "finding_id",
  "finding_type",
  "evidence_source",
  "focused_segment_id",
  "related_reviewed_segment_ids",
  "review_decision",
  "decision_meaning",
] as const;

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function findingType(kind: ReturnType<typeof buildCorrespondenceReviewQueue>[number]["kind"]): string {
  if (kind === "reference_missing") return "reviewed segment missing from generic rerun";
  if (kind === "candidate_unmatched") return "generic rerun segment absent from reviewed analysis";
  return "generic rerun segment overlaps multiple reviewed segments";
}

function decisionMeaning(
  kind: ReturnType<typeof buildCorrespondenceReviewQueue>[number]["kind"],
  decision: string,
): string {
  if (decision === "pending") return "not yet reviewed";
  if (decision === "uncertain") return "needs later expert review";
  if (decision === "dismissed") return "do not carry this audit finding forward";
  if (kind === "reference_missing") return "retain the reviewed segment; rerun absence does not invalidate it";
  if (kind === "candidate_unmatched") return "queue the box-only evidence for a targeted recovery run";
  return "retain for identity review without merging tracks";
}

export function buildCorrespondenceAuditCsv(
  bundle: CorrespondenceAuditBundle,
  state: CorrespondenceAuditReviewState,
): string {
  const rows = buildCorrespondenceReviewQueue(bundle).map((item) => {
    const decision = state.decisions[item.id] ?? "pending";
    return [
      "wildscore-generic-rerun-audit-export-v1",
      bundle.clip_id,
      item.id,
      findingType(item.kind),
      item.focus_source === "generic_rerun" ? "generic SAM rerun" : "reviewed saved analysis",
      item.focus_segment_id,
      item.related_segment_ids.join("|"),
      decision,
      decisionMeaning(item.kind, decision),
    ].map(csvCell).join(",");
  });
  return `${CORRESPONDENCE_AUDIT_CSV_HEADER.join(",")}\n${rows.join("\n")}\n`;
}

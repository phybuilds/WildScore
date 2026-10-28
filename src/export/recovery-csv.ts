import type { RecoveryCandidateBundle } from "../data/recovery-schema";
import type { RecoveryReviewState } from "../review/recovery-state";

export const RECOVERY_CSV_HEADER = [
  "schema_version",
  "clip_id",
  "candidate_id",
  "start_s",
  "end_s",
  "track_review_status",
  "source_prompt",
  "model_label_id",
  "label_review_status",
  "reviewed_label_id",
  "model",
  "context_condition",
  "visible_evidence",
  "uncertainty_reason",
] as const;

function safeEditableCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null | undefined, editable = false) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = editable ? safeEditableCell(text) : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildRecoveryCsv(
  bundle: RecoveryCandidateBundle,
  state: RecoveryReviewState,
): string {
  const rows = bundle.candidates.map((candidate) => {
    const proposal = bundle.label_proposals.find(
      (item) => item.candidate_id === candidate.candidate_id,
    );
    const labelReview = state.label_decisions[candidate.candidate_id];
    return [
      csvCell("wildscore-recovery-export-v1"),
      csvCell(bundle.clip_id),
      csvCell(candidate.candidate_id),
      csvCell(candidate.start_s),
      csvCell(candidate.end_s),
      csvCell(state.decisions[candidate.candidate_id] ?? "pending"),
      csvCell(candidate.source_prompt),
      csvCell(proposal?.label_id ?? ""),
      csvCell(labelReview?.decision ?? "pending"),
      csvCell(labelReview?.value ?? "", true),
      csvCell(proposal?.model ?? ""),
      csvCell(proposal?.context_condition ?? ""),
      csvCell(proposal?.visible_evidence ?? "", true),
      csvCell(proposal?.uncertainty_reason ?? "", true),
    ].join(",");
  });
  return `${RECOVERY_CSV_HEADER.join(",")}\n${rows.join("\n")}\n`;
}

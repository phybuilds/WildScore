import type { WildScoreBundle } from "../data/bundle-schema";
import {
  currentReviewedLabel,
  type ReviewState,
} from "../review/review-state.ts";

export const EVENT_CSV_HEADER = [
  "schema_version",
  "clip_id",
  "run_id",
  "event_id",
  "segment_id",
  "event_kind",
  "start_s",
  "end_s",
  "layer",
  "derivation_source",
  "boundary_evidence",
  "uncertainty_flags",
  "proposed_label_id",
  "current_label_id",
  "label_source",
  "label_review_status",
  "event_review_status",
  "reviewer",
  "reviewed_at",
  "correction_note",
  "config_version",
] as const;

function safeEditableCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null | undefined, editable = false) {
  const text = value === null || value === undefined ? "" : String(value);
  const safeText = editable ? safeEditableCell(text) : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function buildEventCsv(
  bundle: WildScoreBundle,
  state: ReviewState,
): string {
  const runId = typeof bundle.run.run_id === "string" ? bundle.run.run_id : "";
  const rows = bundle.events.map((event) => {
    const proposal = bundle.label_proposals.find(
      (item) => item.segment_id === event.segment_id,
    );
    const labelReview = state.label_reviews[event.segment_id];
    const eventReview = state.event_reviews[event.event_id];
    const currentLabel = currentReviewedLabel(bundle, state, event.segment_id);
    const reviewMetadata =
      eventReview?.decision !== "proposed" ? eventReview : labelReview;
    return [
      csvCell(bundle.schema_version),
      csvCell(bundle.clip.clip_id),
      csvCell(runId),
      csvCell(event.event_id),
      csvCell(event.segment_id),
      csvCell(event.event_kind),
      csvCell(event.start_s),
      csvCell(event.end_s),
      csvCell("event_proposal"),
      csvCell(event.derivation_source),
      csvCell(event.boundary_evidence),
      csvCell(event.uncertainty_flags.join("|")),
      csvCell(proposal?.label_id ?? ""),
      csvCell(currentLabel.label, true),
      csvCell(currentLabel.source),
      csvCell(labelReview?.decision ?? "proposed"),
      csvCell(eventReview?.decision ?? event.decision),
      csvCell(reviewMetadata?.reviewer ?? "", true),
      csvCell(reviewMetadata?.reviewed_at ?? ""),
      csvCell(reviewMetadata?.correction_note ?? "", true),
      csvCell(event.config_version),
    ].join(",");
  });
  return `${EVENT_CSV_HEADER.join(",")}\n${rows.join("\n")}\n`;
}

export type ReviewDecision =
  | "proposed"
  | "accepted"
  | "rejected"
  | "uncertain";

export interface GeometryRecord {
  frame_index: number;
  object_id: string;
  box: { left: number; top: number; right: number; bottom: number };
  mask: { encoding: string; width: number; height: number; payload: string };
  detection_confidence: number | null;
}

export interface PresenceSegment {
  segment_id: string;
  sam_object_id: string;
  first_frame: number;
  last_frame: number;
  start_s: number;
  end_s: number;
  already_visible_at_start: boolean;
  still_visible_at_end: boolean;
  geometry: GeometryRecord[];
}

export interface CandidateEvent {
  event_id: string;
  segment_id: string;
  event_kind: "appearance" | "disappearance";
  start_s: number;
  end_s: number;
  boundary_evidence: string;
  uncertainty_flags: string[];
  decision: ReviewDecision;
  derivation_source: string;
  config_version: string;
}

export interface LabelProposal {
  segment_id: string;
  label_id: string;
  visible_evidence: string;
  uncertainty_reason: string | null;
  model: string;
  source_run_id: string;
}

export interface StoredReview {
  review_kind: "segment_label" | "event";
  segment_id?: string;
  event_id?: string;
  decision: Exclude<ReviewDecision, "proposed">;
  original_value: string;
  new_value: string | null;
  reviewer: string;
  reviewed_at: string | null;
  correction_note: string;
}

export interface HeldOutEvaluationResult {
  source_title: string;
  source_url: string;
  source_credit: string;
  licence: string;
  reference_state: string;
  model: string;
  provider: string;
  processed_frames: number;
  matcher: string;
  tolerance_s: number;
  reference_event_count: number;
  matched_predictions: number;
  missed_events: number;
  false_alarms: number;
  sam_latency_ms: number;
  total_latency_ms: number;
  remote_file_deletion_confirmed: boolean;
  label_result?: HeldOutLabelResult | null;
}

export interface HeldOutLabelResult {
  reference_state: string;
  reference_label: string;
  proposed_label: string;
  matched_reference: boolean;
  model: string;
  provider: string;
  prompt_context: string;
  latency_ms: number;
}

export interface WildScoreBundle {
  schema_version: "0.1.0";
  clip: {
    clip_id: string;
    display_media: string;
    processed_duration_s: number;
    processed_fps: number;
    processed_frame_count: number;
    width: number;
    height: number;
  };
  run: Record<string, unknown>;
  segments: PresenceSegment[];
  label_proposals: LabelProposal[];
  events: CandidateEvent[];
  reviews: StoredReview[];
  evaluation: {
    status: string;
    held_out_clip_count: number;
    held_out_result?: HeldOutEvaluationResult | null;
    limitations: string[];
  };
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SAFE_MEDIA_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length <= 240)
  );
}

function isBoundedString(value: unknown, maximum = 500): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isHeldOutLabelResult(value: unknown): value is HeldOutLabelResult {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.reference_state, 120) &&
    isSafeId(value.reference_label) &&
    isSafeId(value.proposed_label) &&
    typeof value.matched_reference === "boolean" &&
    isBoundedString(value.model, 120) &&
    isBoundedString(value.provider, 120) &&
    isBoundedString(value.prompt_context, 200) &&
    isNonNegativeInteger(value.latency_ms)
  );
}

function isHeldOutEvaluationResult(value: unknown): value is HeldOutEvaluationResult {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.source_title, 160) &&
    isBoundedString(value.source_url, 500) &&
    value.source_url.startsWith("https://") &&
    isBoundedString(value.source_credit, 160) &&
    isBoundedString(value.licence, 200) &&
    isBoundedString(value.reference_state, 120) &&
    isBoundedString(value.model, 120) &&
    isBoundedString(value.provider, 120) &&
    isNonNegativeInteger(value.processed_frames) &&
    isBoundedString(value.matcher, 160) &&
    isFiniteNumber(value.tolerance_s) &&
    value.tolerance_s >= 0 &&
    isNonNegativeInteger(value.reference_event_count) &&
    isNonNegativeInteger(value.matched_predictions) &&
    isNonNegativeInteger(value.missed_events) &&
    isNonNegativeInteger(value.false_alarms) &&
    isNonNegativeInteger(value.sam_latency_ms) &&
    isNonNegativeInteger(value.total_latency_ms) &&
    typeof value.remote_file_deletion_confirmed === "boolean" &&
    (
      value.label_result === undefined ||
      value.label_result === null ||
      isHeldOutLabelResult(value.label_result)
    )
  );
}

function assertGeometry(value: unknown, index: number): asserts value is GeometryRecord {
  if (!isRecord(value)) throw new Error(`segments.geometry[${index}] is invalid`);
  const box = value.box;
  const mask = value.mask;
  if (
    !Number.isInteger(value.frame_index) ||
    !isSafeId(value.object_id) ||
    !isRecord(box) ||
    ![box.left, box.top, box.right, box.bottom].every(isFiniteNumber) ||
    !isRecord(mask) ||
    typeof mask.encoding !== "string" ||
    !Number.isInteger(mask.width) ||
    !Number.isInteger(mask.height) ||
    typeof mask.payload !== "string" ||
    mask.payload.length === 0 ||
    !(
      value.detection_confidence === null ||
      isFiniteNumber(value.detection_confidence)
    )
  ) {
    throw new Error(`segments.geometry[${index}] has invalid fields`);
  }
}

function assertSegment(value: unknown, index: number): asserts value is PresenceSegment {
  if (!isRecord(value)) throw new Error(`segments[${index}] is invalid`);
  if (
    !isSafeId(value.segment_id) ||
    !isSafeId(value.sam_object_id) ||
    !Number.isInteger(value.first_frame) ||
    !Number.isInteger(value.last_frame) ||
    !isFiniteNumber(value.start_s) ||
    !isFiniteNumber(value.end_s) ||
    typeof value.already_visible_at_start !== "boolean" ||
    typeof value.still_visible_at_end !== "boolean" ||
    !Array.isArray(value.geometry)
  ) {
    throw new Error(`segments[${index}] has invalid fields`);
  }
  value.geometry.forEach(assertGeometry);
}

function assertEvent(value: unknown, index: number): asserts value is CandidateEvent {
  if (!isRecord(value)) throw new Error(`events[${index}] is invalid`);
  if (
    !isSafeId(value.event_id) ||
    !isSafeId(value.segment_id) ||
    !["appearance", "disappearance"].includes(String(value.event_kind)) ||
    !isFiniteNumber(value.start_s) ||
    !isFiniteNumber(value.end_s) ||
    typeof value.boundary_evidence !== "string" ||
    !isStringArray(value.uncertainty_flags) ||
    !["proposed", "accepted", "rejected", "uncertain"].includes(
      String(value.decision),
    ) ||
    typeof value.derivation_source !== "string" ||
    typeof value.config_version !== "string"
  ) {
    throw new Error(`events[${index}] has invalid fields`);
  }
}

function assertLabelProposal(
  value: unknown,
  index: number,
): asserts value is LabelProposal {
  if (
    !isRecord(value) ||
    !isSafeId(value.segment_id) ||
    !isSafeId(value.label_id) ||
    !isBoundedString(value.visible_evidence) ||
    !(
      value.uncertainty_reason === null ||
      isBoundedString(value.uncertainty_reason)
    ) ||
    !isSafeId(value.model) ||
    !isSafeId(value.source_run_id)
  ) {
    throw new Error(`label_proposals[${index}] has invalid fields`);
  }
}

function assertReview(value: unknown, index: number): asserts value is StoredReview {
  if (!isRecord(value)) throw new Error(`reviews[${index}] is invalid`);
  const kindIsValid = ["segment_label", "event"].includes(
    String(value.review_kind),
  );
  const targetIsValid =
    (value.review_kind === "segment_label" && isSafeId(value.segment_id)) ||
    (value.review_kind === "event" && isSafeId(value.event_id));
  if (
    !kindIsValid ||
    !targetIsValid ||
    !["accepted", "rejected", "uncertain"].includes(String(value.decision)) ||
    !isBoundedString(value.original_value, 240) ||
    !(value.new_value === null || isBoundedString(value.new_value, 240)) ||
    !isBoundedString(value.reviewer, 120) ||
    !(value.reviewed_at === null || isBoundedString(value.reviewed_at, 80)) ||
    !isBoundedString(value.correction_note)
  ) {
    throw new Error(`reviews[${index}] has invalid fields`);
  }
}

export function validateBundle(value: unknown): WildScoreBundle {
  if (!isRecord(value) || value.schema_version !== "0.1.0") {
    throw new Error("Unsupported or missing WildScore bundle schema");
  }
  const clip = value.clip;
  const evaluation = value.evaluation;
  if (
    !isRecord(clip) ||
    !isSafeId(clip.clip_id) ||
    typeof clip.display_media !== "string" ||
    !SAFE_MEDIA_NAME.test(clip.display_media) ||
    !isFiniteNumber(clip.processed_duration_s) ||
    !isFiniteNumber(clip.processed_fps) ||
    !Number.isInteger(clip.processed_frame_count) ||
    !Number.isInteger(clip.width) ||
    !Number.isInteger(clip.height) ||
    !isRecord(value.run) ||
    !Array.isArray(value.segments) ||
    !Array.isArray(value.label_proposals) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.reviews) ||
    !isRecord(evaluation) ||
    typeof evaluation.status !== "string" ||
    !Number.isInteger(evaluation.held_out_clip_count) ||
    !(
      evaluation.held_out_result === undefined ||
      evaluation.held_out_result === null ||
      isHeldOutEvaluationResult(evaluation.held_out_result)
    ) ||
    !isStringArray(evaluation.limitations)
  ) {
    throw new Error("WildScore bundle has invalid top-level fields");
  }
  value.segments.forEach(assertSegment);
  value.events.forEach(assertEvent);
  value.label_proposals.forEach(assertLabelProposal);
  value.reviews.forEach(assertReview);
  return value as unknown as WildScoreBundle;
}

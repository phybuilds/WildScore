import type { GeometryRecord } from "./bundle-schema";

export type RecoveryPrompt = "antelope" | "hippopotamus";

export interface RecoveryCandidate {
  candidate_id: string;
  source_prompt: RecoveryPrompt;
  source_object_id: string;
  source_run_id: string;
  suggested_label: string;
  first_frame: number;
  last_frame: number;
  start_s: number;
  end_s: number;
  audit_classification: "additive_candidate";
  uncertainty_flags: string[];
  geometry: GeometryRecord[];
}

export interface StoredRecoveryReview {
  candidate_id: string;
  decision: "accepted" | "rejected" | "uncertain";
  reviewer: string;
  reviewed_at: string | null;
  correction_note: string;
}

export interface RecoveryLabelProposal {
  candidate_id: string;
  label_id: "baboon" | "warthog" | "hippopotamus" | "antelope" | "unknown";
  visible_evidence: string;
  uncertainty_reason: string | null;
  model: "muse-spark-1.3";
  source_run_id: string;
  context_condition: "visible_evidence_only";
}

export interface StoredRecoveryLabelReview {
  candidate_id: string;
  decision: "accepted" | "corrected" | "uncertain";
  value: string | null;
  reviewer: string;
  reviewed_at: string | null;
}

export interface RecoveryCandidateBundle {
  schema: "wildscore-recovery-candidates-v1";
  clip_id: string;
  processed_fps: number;
  processed_frame_count: number;
  width: number;
  height: number;
  candidates: RecoveryCandidate[];
  reviews: StoredRecoveryReview[];
  label_proposals: RecoveryLabelProposal[];
  label_reviews: StoredRecoveryLabelReview[];
  limitations: string[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function assertGeometry(value: unknown, label: string) {
  if (!isRecord(value) || !isRecord(value.box) || !isRecord(value.mask)) {
    throw new Error(`${label} is invalid`);
  }
  if (
    !Number.isInteger(value.frame_index) || !isSafeId(value.object_id) ||
    ![value.box.left, value.box.top, value.box.right, value.box.bottom].every(isFiniteNumber) ||
    typeof value.mask.encoding !== "string" || !Number.isInteger(value.mask.width) ||
    !Number.isInteger(value.mask.height) || typeof value.mask.payload !== "string" ||
    value.mask.payload.length === 0 ||
    !(value.detection_confidence === null || isFiniteNumber(value.detection_confidence))
  ) {
    throw new Error(`${label} has invalid fields`);
  }
}

function assertCandidate(value: unknown, index: number) {
  if (!isRecord(value)) throw new Error(`candidates[${index}] is invalid`);
  if (
    !isSafeId(value.candidate_id) ||
    !["antelope", "hippopotamus"].includes(String(value.source_prompt)) ||
    !isSafeId(value.source_object_id) || !isSafeId(value.source_run_id) ||
    !isSafeId(value.suggested_label) || !Number.isInteger(value.first_frame) ||
    !Number.isInteger(value.last_frame) || !isFiniteNumber(value.start_s) ||
    !isFiniteNumber(value.end_s) || value.audit_classification !== "additive_candidate" ||
    !Array.isArray(value.uncertainty_flags) ||
    !value.uncertainty_flags.every((item) => isSafeId(item)) ||
    !Array.isArray(value.geometry) || value.geometry.length === 0
  ) {
    throw new Error(`candidates[${index}] has invalid fields`);
  }
  value.geometry.forEach((geometry, geometryIndex) =>
    assertGeometry(geometry, `candidates[${index}].geometry[${geometryIndex}]`),
  );
}

export function validateRecoveryCandidateBundle(value: unknown): RecoveryCandidateBundle {
  if (!isRecord(value) || value.schema !== "wildscore-recovery-candidates-v1") {
    throw new Error("Unsupported or missing recovery-candidate schema");
  }
  if (
    !isSafeId(value.clip_id) || !isFiniteNumber(value.processed_fps) ||
    !Number.isInteger(value.processed_frame_count) || !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) || !Array.isArray(value.candidates) ||
    !Array.isArray(value.reviews) || !Array.isArray(value.label_proposals) ||
    !Array.isArray(value.label_reviews) ||
    !Array.isArray(value.limitations) ||
    !value.limitations.every((item) => typeof item === "string" && item.length <= 240)
  ) {
    throw new Error("Recovery-candidate bundle has invalid top-level fields");
  }
  const processedFrameCount = value.processed_frame_count as number;
  const width = value.width as number;
  const height = value.height as number;
  value.candidates.forEach(assertCandidate);
  for (const candidate of value.candidates) {
    if (
      candidate.first_frame < 0 || candidate.last_frame < candidate.first_frame ||
      candidate.last_frame >= processedFrameCount ||
      candidate.start_s < 0 || candidate.end_s < candidate.start_s
    ) {
      throw new Error("Recovery-candidate timing is outside the processed clip");
    }
    for (const geometry of candidate.geometry) {
      if (
        geometry.frame_index < 0 || geometry.frame_index >= processedFrameCount ||
        geometry.box.left < 0 || geometry.box.top < 0 ||
        geometry.box.right > width || geometry.box.bottom > height ||
        geometry.box.left >= geometry.box.right || geometry.box.top >= geometry.box.bottom
      ) {
        throw new Error("Recovery-candidate geometry is outside the processed clip");
      }
    }
  }
  const candidateIds = value.candidates.map((candidate) => candidate.candidate_id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Recovery-candidate IDs must be unique");
  }
  const candidateIdSet = new Set(candidateIds);
  const reviewIds = [];
  for (const review of value.reviews) {
    if (
      !isRecord(review) || !isSafeId(review.candidate_id) ||
      !candidateIdSet.has(review.candidate_id) ||
      !["accepted", "rejected", "uncertain"].includes(String(review.decision)) ||
      typeof review.reviewer !== "string" || review.reviewer.length > 120 ||
      !(review.reviewed_at === null ||
        (typeof review.reviewed_at === "string" && review.reviewed_at.length <= 80)) ||
      typeof review.correction_note !== "string" || review.correction_note.length > 500
    ) {
      throw new Error("Recovery-candidate review is invalid");
    }
    reviewIds.push(review.candidate_id);
  }
  if (new Set(reviewIds).size !== reviewIds.length) {
    throw new Error("Recovery-candidate reviews must be unique");
  }
  const proposalIds = [];
  for (const proposal of value.label_proposals) {
    if (
      !isRecord(proposal) || !isSafeId(proposal.candidate_id) ||
      !candidateIdSet.has(proposal.candidate_id) ||
      !["baboon", "warthog", "hippopotamus", "antelope", "unknown"].includes(
        String(proposal.label_id),
      ) || typeof proposal.visible_evidence !== "string" ||
      proposal.visible_evidence.length < 1 || proposal.visible_evidence.length > 300 ||
      !(proposal.uncertainty_reason === null ||
        (typeof proposal.uncertainty_reason === "string" &&
          proposal.uncertainty_reason.length <= 200)) ||
      proposal.model !== "muse-spark-1.3" || !isSafeId(proposal.source_run_id) ||
      proposal.context_condition !== "visible_evidence_only"
    ) {
      throw new Error("Recovery label proposal is invalid");
    }
    proposalIds.push(proposal.candidate_id);
  }
  if (new Set(proposalIds).size !== proposalIds.length) {
    throw new Error("Recovery label proposals must be unique");
  }
  const labelReviewIds = [];
  for (const review of value.label_reviews) {
    if (
      !isRecord(review) || !isSafeId(review.candidate_id) ||
      !candidateIdSet.has(review.candidate_id) ||
      !["accepted", "corrected", "uncertain"].includes(String(review.decision)) ||
      !(review.value === null || isSafeId(review.value)) ||
      typeof review.reviewer !== "string" || review.reviewer.length > 120 ||
      !(review.reviewed_at === null ||
        (typeof review.reviewed_at === "string" && review.reviewed_at.length <= 80))
    ) throw new Error("Recovery label review is invalid");
    labelReviewIds.push(review.candidate_id);
  }
  if (new Set(labelReviewIds).size !== labelReviewIds.length) {
    throw new Error("Recovery label reviews must be unique");
  }
  return value as unknown as RecoveryCandidateBundle;
}

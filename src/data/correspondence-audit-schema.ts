export interface AuditBoxGeometry {
  frame_index: number;
  box: { left: number; top: number; right: number; bottom: number };
}

export interface AuditCandidateSegment {
  segment_id: string;
  first_frame: number;
  last_frame: number;
  geometry: AuditBoxGeometry[];
}

export interface CorrespondenceCandidate {
  reference_segment_id: string;
  candidate_segment_id: string;
  shared_frame_count: number;
  high_iou_frame_count: number;
  high_iou_shared_frame_ratio: number;
  mean_iou_on_shared_frames: number;
  reference_frame_coverage: number;
  candidate_frame_coverage: number;
  reason_codes: ["shared_frames", "spatial_overlap"];
}

export interface CorrespondenceAuditBundle {
  schema_version: "wildscore-correspondence-audit-v1";
  clip_id: string;
  source_run_id: string;
  fps: number;
  width: number;
  height: number;
  provenance: "generic_sam_rerun_not_merged";
  candidate_segments: AuditCandidateSegment[];
  correspondence_candidates: CorrespondenceCandidate[];
  reference_segments_without_candidate: string[];
  candidate_segments_without_reference: string[];
  duplicate_review: Array<{
    candidate_segment_id: string;
    reference_segment_ids: string[];
    reason_codes: ["one_candidate_segment_overlaps_multiple_references"];
  }>;
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function ratio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function validateIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && new Set(value).size === value.length && value.every(safeId);
}

export function validateCorrespondenceAuditBundle(value: unknown): CorrespondenceAuditBundle {
  if (!record(value) ||
    value.schema_version !== "wildscore-correspondence-audit-v1" ||
    !safeId(value.clip_id) || !safeId(value.source_run_id) ||
    value.provenance !== "generic_sam_rerun_not_merged" ||
    typeof value.fps !== "number" || !Number.isFinite(value.fps) || value.fps <= 0 ||
    !Number.isInteger(value.width) || Number(value.width) <= 0 ||
    !Number.isInteger(value.height) || Number(value.height) <= 0 ||
    !Array.isArray(value.candidate_segments) ||
    !Array.isArray(value.correspondence_candidates) ||
    !validateIdArray(value.reference_segments_without_candidate) ||
    !validateIdArray(value.candidate_segments_without_reference) ||
    !Array.isArray(value.duplicate_review)) {
    throw new Error("Correspondence audit has invalid top-level fields.");
  }

  const candidateIds = new Set<string>();
  for (const candidate of value.candidate_segments) {
    if (!record(candidate) || !safeId(candidate.segment_id) || candidateIds.has(candidate.segment_id) ||
      !nonNegativeInteger(candidate.first_frame) || !nonNegativeInteger(candidate.last_frame) ||
      Number(candidate.first_frame) > Number(candidate.last_frame) || !Array.isArray(candidate.geometry) ||
      candidate.geometry.length === 0) throw new Error("Correspondence candidate segment is invalid.");
    candidateIds.add(candidate.segment_id);
    const frames = new Set<number>();
    for (const geometry of candidate.geometry) {
      if (!record(geometry) || !nonNegativeInteger(geometry.frame_index) ||
        Number(geometry.frame_index) < Number(candidate.first_frame) ||
        Number(geometry.frame_index) > Number(candidate.last_frame) ||
        frames.has(Number(geometry.frame_index)) || !record(geometry.box)) {
        throw new Error("Correspondence candidate geometry is invalid.");
      }
      frames.add(Number(geometry.frame_index));
      const { left, top, right, bottom } = geometry.box;
      if (![left, top, right, bottom].every((item) => typeof item === "number" && Number.isFinite(item)) ||
        Number(left) < 0 || Number(top) < 0 || Number(right) > Number(value.width) ||
        Number(bottom) > Number(value.height) || Number(left) >= Number(right) || Number(top) >= Number(bottom)) {
        throw new Error("Correspondence candidate geometry is invalid.");
      }
    }
  }
  if (!value.candidate_segments_without_reference.every((id) => candidateIds.has(id))) {
    throw new Error("Correspondence audit references an unknown candidate.");
  }
  for (const match of value.correspondence_candidates) {
    if (!record(match) || !safeId(match.reference_segment_id) ||
      !safeId(match.candidate_segment_id) || !candidateIds.has(match.candidate_segment_id) ||
      !nonNegativeInteger(match.shared_frame_count) || !nonNegativeInteger(match.high_iou_frame_count) ||
      !ratio(match.high_iou_shared_frame_ratio) || !ratio(match.mean_iou_on_shared_frames) ||
      !ratio(match.reference_frame_coverage) || !ratio(match.candidate_frame_coverage) ||
      JSON.stringify(match.reason_codes) !== JSON.stringify(["shared_frames", "spatial_overlap"])) {
      throw new Error("Correspondence match is invalid.");
    }
  }
  for (const duplicate of value.duplicate_review) {
    if (!record(duplicate) || !safeId(duplicate.candidate_segment_id) ||
      !candidateIds.has(duplicate.candidate_segment_id) || !validateIdArray(duplicate.reference_segment_ids) ||
      duplicate.reference_segment_ids.length < 2 ||
      JSON.stringify(duplicate.reason_codes) !== JSON.stringify(["one_candidate_segment_overlaps_multiple_references"])) {
      throw new Error("Correspondence duplicate review is invalid.");
    }
  }
  return value as unknown as CorrespondenceAuditBundle;
}

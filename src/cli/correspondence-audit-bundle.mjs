import { validateCorrespondenceAuditBundle } from "../data/correspondence-audit-schema.ts";

export function buildCorrespondenceAuditBundle({
  audit,
  candidateSegments,
  clipId,
  sourceRunId,
  fps,
  width,
  height,
}) {
  const bundle = {
    schema_version: "wildscore-correspondence-audit-v1",
    clip_id: clipId,
    source_run_id: sourceRunId,
    fps,
    width,
    height,
    provenance: "generic_sam_rerun_not_merged",
    candidate_segments: candidateSegments.map((segment) => ({
      segment_id: segment.segment_id,
      first_frame: segment.first_frame,
      last_frame: segment.last_frame,
      geometry: segment.geometry.map((geometry) => ({
        frame_index: geometry.frame_index,
        box: {
          left: geometry.box.left,
          top: geometry.box.top,
          right: geometry.box.right,
          bottom: geometry.box.bottom,
        },
      })),
    })),
    correspondence_candidates: audit.correspondence_candidates,
    reference_segments_without_candidate: audit.reference_segments_without_candidate,
    candidate_segments_without_reference: audit.candidate_segments_without_reference,
    duplicate_review: audit.duplicate_review,
  };
  return validateCorrespondenceAuditBundle(bundle);
}

function cell(value) {
  const text = String(value ?? "");
  const safe = /^[=+@-]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function segmentIndex(segments) {
  return new Map(segments.map((segment) => [segment.segment_id, segment]));
}

function seconds(frame, fps) {
  return Number((frame / fps).toFixed(3));
}

export function buildSegmentAuditCsv({ audit, referenceSegments, candidateSegments, fps }) {
  if (!audit || !Array.isArray(referenceSegments) || !Array.isArray(candidateSegments)) {
    throw new TypeError("audit and segment arrays are required.");
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("fps must be positive.");
  const references = segmentIndex(referenceSegments);
  const candidates = segmentIndex(candidateSegments);
  const rows = [[
    "review_kind",
    "reference_segment_id",
    "candidate_segment_id",
    "reference_start_s",
    "reference_end_s",
    "candidate_start_s",
    "candidate_end_s",
    "shared_frame_count",
    "high_iou_frame_count",
    "mean_iou_on_shared_frames",
    "reference_frame_coverage",
    "candidate_frame_coverage",
    "reason",
  ]];
  for (const match of audit.correspondence_candidates ?? []) {
    const reference = references.get(match.reference_segment_id);
    const candidate = candidates.get(match.candidate_segment_id);
    if (!reference || !candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "correspondence_candidate",
      match.reference_segment_id,
      match.candidate_segment_id,
      seconds(reference.first_frame, fps),
      seconds(reference.last_frame, fps),
      seconds(candidate.first_frame, fps),
      seconds(candidate.last_frame, fps),
      match.shared_frame_count,
      match.high_iou_frame_count,
      match.mean_iou_on_shared_frames,
      match.reference_frame_coverage,
      match.candidate_frame_coverage,
      "shared_frames|spatial_overlap",
    ]);
  }
  for (const id of audit.reference_segments_without_candidate ?? []) {
    const reference = references.get(id);
    if (!reference) throw new Error("audit references an unknown segment.");
    rows.push([
      "reviewed_reference_without_candidate",
      id,
      "",
      seconds(reference.first_frame, fps),
      seconds(reference.last_frame, fps),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "no_conservative_geometry_match",
    ]);
  }
  for (const id of audit.candidate_segments_without_reference ?? []) {
    const candidate = candidates.get(id);
    if (!candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "candidate_without_reviewed_reference",
      "",
      id,
      "",
      "",
      seconds(candidate.first_frame, fps),
      seconds(candidate.last_frame, fps),
      "",
      "",
      "",
      "",
      "",
      "no_conservative_geometry_match",
    ]);
  }
  for (const item of audit.duplicate_review ?? []) {
    const candidate = candidates.get(item.candidate_segment_id);
    if (!candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "possible_duplicate_review",
      item.reference_segment_ids.join("|"),
      item.candidate_segment_id,
      "",
      "",
      seconds(candidate.first_frame, fps),
      seconds(candidate.last_frame, fps),
      "",
      "",
      "",
      "",
      "",
      "one_candidate_segment_overlaps_multiple_references",
    ]);
  }
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}

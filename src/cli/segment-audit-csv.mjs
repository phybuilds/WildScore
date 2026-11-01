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

function percentage(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("audit proportions must be between zero and one.");
  }
  return `${(value * 100).toFixed(1)}%`;
}

export function buildSegmentAuditCsv({ audit, referenceSegments, candidateSegments, fps }) {
  if (!audit || !Array.isArray(referenceSegments) || !Array.isArray(candidateSegments)) {
    throw new TypeError("audit and segment arrays are required.");
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("fps must be positive.");
  const references = segmentIndex(referenceSegments);
  const candidates = segmentIndex(candidateSegments);
  const rows = [[
    "Review category",
    "Reviewed segment ID",
    "Generic rerun segment ID",
    "Reviewed segment start (seconds)",
    "Reviewed segment end (seconds)",
    "Generic rerun start (seconds)",
    "Generic rerun end (seconds)",
    "Frames where both segments are visible",
    "Shared frames with strong box overlap",
    "Average box overlap on shared frames",
    "Reviewed segment covered by rerun",
    "Rerun segment covered by reviewed segment",
    "Why this row needs review",
  ]];
  for (const match of audit.correspondence_candidates ?? []) {
    const reference = references.get(match.reference_segment_id);
    const candidate = candidates.get(match.candidate_segment_id);
    if (!reference || !candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "Similar time and position — review only",
      match.reference_segment_id,
      match.candidate_segment_id,
      seconds(reference.first_frame, fps),
      seconds(reference.last_frame, fps),
      seconds(candidate.first_frame, fps),
      seconds(candidate.last_frame, fps),
      match.shared_frame_count,
      match.high_iou_frame_count,
      percentage(match.mean_iou_on_shared_frames),
      percentage(match.reference_frame_coverage),
      percentage(match.candidate_frame_coverage),
      "Segments overlap in time and position; identity is not confirmed",
    ]);
  }
  for (const id of audit.reference_segments_without_candidate ?? []) {
    const reference = references.get(id);
    if (!reference) throw new Error("audit references an unknown segment.");
    rows.push([
      "Reviewed segment not present in generic rerun",
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
      "No conservative time-and-position correspondence was found",
    ]);
  }
  for (const id of audit.candidate_segments_without_reference ?? []) {
    const candidate = candidates.get(id);
    if (!candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "Generic rerun segment not present in reviewed set",
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
      "No conservative time-and-position correspondence was found",
    ]);
  }
  for (const item of audit.duplicate_review ?? []) {
    const candidate = candidates.get(item.candidate_segment_id);
    if (!candidate) throw new Error("audit references an unknown segment.");
    rows.push([
      "Possible spatial overlap — review only",
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
      "One generic rerun segment overlaps multiple reviewed segments; no identity link or merge was made",
    ]);
  }
  return `${rows.map((row) => row.map(cell).join(",")).join("\n")}\n`;
}

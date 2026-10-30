import type { PresenceSegment, WildScoreBundle } from "../data/bundle-schema";
import { currentReviewedLabel, type ReviewState } from "../review/review-state.ts";

export const TRACK_SUMMARY_CSV_HEADER = [
  "schema_version",
  "clip_id",
  "segment_id",
  "sam_object_id",
  "current_label_id",
  "label_source",
  "label_review_status",
  "first_frame",
  "last_frame",
  "observed_dwell_s",
  "geometry_samples",
  "path_length_px",
  "mean_centroid_motion_px_s",
  "peak_centroid_motion_px_s",
  "straightness_ratio",
  "mean_box_area_px2",
  "area_flicker_ratio",
  "quality_flags",
] as const;

function safeEditableCell(value: string): string {
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null, editable = false): string {
  const text = value === null ? "" : String(value);
  const safe = editable ? safeEditableCell(text) : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function rounded(value: number): number {
  return Number(value.toFixed(4));
}

export function trackMetrics(segment: PresenceSegment, fps: number) {
  const geometry = [...segment.geometry].sort((left, right) => left.frame_index - right.frame_index);
  const points = geometry.map((item) => ({
    frame: item.frame_index,
    x: (item.box.left + item.box.right) / 2,
    y: (item.box.top + item.box.bottom) / 2,
    area: Math.max(0, item.box.right - item.box.left) * Math.max(0, item.box.bottom - item.box.top),
  }));
  let pathLength = 0;
  let peakMotion = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    const seconds = (current.frame - previous.frame) / fps;
    pathLength += distance;
    if (seconds > 0) peakMotion = Math.max(peakMotion, distance / seconds);
  }
  const first = points[0];
  const last = points.at(-1);
  const displacement = first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0;
  const observedDwell = Math.max(0, segment.end_s - segment.start_s);
  const areas = points.map((point) => point.area);
  const meanArea = areas.length > 0
    ? areas.reduce((total, area) => total + area, 0) / areas.length
    : 0;
  const areaFlicker = meanArea > 0
    ? (Math.max(...areas) - Math.min(...areas)) / meanArea
    : 0;
  return {
    observed_dwell_s: rounded(observedDwell),
    geometry_samples: points.length,
    path_length_px: rounded(pathLength),
    mean_centroid_motion_px_s: rounded(observedDwell > 0 ? pathLength / observedDwell : 0),
    peak_centroid_motion_px_s: rounded(peakMotion),
    straightness_ratio: rounded(pathLength > 0 ? displacement / pathLength : 0),
    mean_box_area_px2: rounded(meanArea),
    area_flicker_ratio: rounded(areaFlicker),
  };
}

export function buildTrackSummaryCsv(bundle: WildScoreBundle, state: ReviewState): string {
  const rows = bundle.segments.map((segment) => {
    const label = currentReviewedLabel(bundle, state, segment.segment_id);
    const review = state.label_reviews[segment.segment_id];
    const metrics = trackMetrics(segment, bundle.clip.processed_fps);
    const flags = [...new Set(
      bundle.events
        .filter((event) => event.segment_id === segment.segment_id)
        .flatMap((event) => event.uncertainty_flags),
    )].sort();
    return [
      csvCell(bundle.schema_version),
      csvCell(bundle.clip.clip_id),
      csvCell(segment.segment_id),
      csvCell(segment.sam_object_id),
      csvCell(label.label, true),
      csvCell(label.source),
      csvCell(review?.decision ?? "proposed"),
      csvCell(segment.first_frame),
      csvCell(segment.last_frame),
      csvCell(metrics.observed_dwell_s),
      csvCell(metrics.geometry_samples),
      csvCell(metrics.path_length_px),
      csvCell(metrics.mean_centroid_motion_px_s),
      csvCell(metrics.peak_centroid_motion_px_s),
      csvCell(metrics.straightness_ratio),
      csvCell(metrics.mean_box_area_px2),
      csvCell(metrics.area_flicker_ratio),
      csvCell(flags.join("|")),
    ].join(",");
  });
  return `${TRACK_SUMMARY_CSV_HEADER.join(",")}\n${rows.join("\n")}\n`;
}

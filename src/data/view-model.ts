import type {
  CandidateEvent,
  GeometryRecord,
  PresenceSegment,
  WildScoreBundle,
} from "./bundle-schema";

export interface VisibleGeometry extends GeometryRecord {
  segment_id: string;
  sam_object_id: string;
}

export function frameAtTime(
  currentTime: number,
  fps: number,
  frameCount: number,
): number {
  if (fps <= 0 || frameCount <= 0) return 0;
  const framePosition = Math.max(0, currentTime) * fps;
  return Math.min(
    frameCount - 1,
    Math.max(0, Math.round(framePosition)),
  );
}

export function eventAnchorFrame(
  event: CandidateEvent,
  segment: PresenceSegment,
): number {
  return event.event_kind === "appearance"
    ? segment.first_frame
    : segment.last_frame;
}

export function eventAnchorTime(
  event: CandidateEvent,
  segment: PresenceSegment,
  fps: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0) return event.start_s;
  return eventAnchorFrame(event, segment) / fps;
}

export function segmentStartTime(segment: PresenceSegment, fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return segment.start_s;
  return segment.first_frame / fps;
}

export function geometryAnchorTime(
  geometry: Pick<GeometryRecord, "frame_index">[],
  fps: number,
  fallbackTime: number,
): number {
  if (!Number.isFinite(fps) || fps <= 0 || geometry.length === 0) {
    return fallbackTime;
  }
  const firstFrame = geometry.reduce(
    (earliest, record) => Math.min(earliest, record.frame_index),
    Number.POSITIVE_INFINITY,
  );
  return Number.isFinite(firstFrame) ? firstFrame / fps : fallbackTime;
}

export interface GeometryTrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  opacity: number;
}

export function geometryFadingTrail(
  geometry: Pick<GeometryRecord, "frame_index" | "box">[],
  currentFrame: number,
  tailFrameCount: number,
): GeometryTrailSegment[] {
  if (!Number.isInteger(currentFrame) || !Number.isInteger(tailFrameCount) || tailFrameCount < 1) {
    return [];
  }
  const recent = [...geometry]
    .filter(
      (record) =>
        record.frame_index <= currentFrame &&
        record.frame_index >= currentFrame - tailFrameCount,
    )
    .sort((left, right) => left.frame_index - right.frame_index);
  if (recent.at(-1)?.frame_index !== currentFrame) return [];

  let contiguousStart = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].frame_index - recent[index - 1].frame_index > 1) {
      contiguousStart = index;
    }
  }
  const points = recent.slice(contiguousStart).map(({ box }) => ({
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  }));
  return points.slice(1).map((point, index) => ({
    x1: points[index].x,
    y1: points[index].y,
    x2: point.x,
    y2: point.y,
    opacity: Number((0.12 + (0.76 * (index + 1)) / (points.length - 1)).toFixed(3)),
  }));
}

export function buildFrameGeometryIndex(
  segments: PresenceSegment[],
): Map<number, VisibleGeometry[]> {
  const index = new Map<number, VisibleGeometry[]>();
  for (const segment of segments) {
    for (const geometry of segment.geometry) {
      const records = index.get(geometry.frame_index) ?? [];
      records.push({
        ...geometry,
        segment_id: segment.segment_id,
        sam_object_id: segment.sam_object_id,
      });
      index.set(geometry.frame_index, records);
    }
  }
  return index;
}

export function currentSegmentLabel(
  bundle: WildScoreBundle,
  segmentId: string,
): { label: string; source: "human" | "model" | "unlabelled" } {
  const review = bundle.reviews.find(
    (item) =>
      item.review_kind === "segment_label" &&
      item.segment_id === segmentId &&
      item.decision === "accepted",
  );
  if (review) {
    return {
      label: review.new_value ?? review.original_value,
      source: "human",
    };
  }
  const proposal = bundle.label_proposals.find(
    (item) => item.segment_id === segmentId,
  );
  if (proposal) return { label: proposal.label_id, source: "model" };
  return { label: "unlabelled animal", source: "unlabelled" };
}

export function humanizeIdentifier(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) =>
    letter.toUpperCase(),
  );
}

export function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

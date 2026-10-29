export interface InclusiveMediaBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Point {
  x: number;
  y: number;
}

interface ContainedVideoDrag {
  mediaWidth: number;
  mediaHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  start: Point;
  end: Point;
}

export interface MissingAnimalAnnotation {
  schema: "wildscore-missing-animal-annotation-v1";
  clip_id: string;
  processed_fps: number;
  media_width: number;
  media_height: number;
  frame_index: number;
  timestamp_s: number;
  broad_label: string | null;
  prompt_kind: "box";
  box: InclusiveMediaBox;
}

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function containedVideoDragToMediaBox({
  mediaWidth,
  mediaHeight,
  viewportWidth,
  viewportHeight,
  start,
  end,
}: ContainedVideoDrag): InclusiveMediaBox {
  for (const [value, label] of [
    [viewportWidth, "viewportWidth"],
    [viewportHeight, "viewportHeight"],
  ] as const) requirePositive(value, label);
  requirePositiveInteger(mediaWidth, "mediaWidth");
  requirePositiveInteger(mediaHeight, "mediaHeight");
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new Error("Drag coordinates must be finite numbers.");
  }

  const scale = Math.min(viewportWidth / mediaWidth, viewportHeight / mediaHeight);
  const renderedWidth = mediaWidth * scale;
  const renderedHeight = mediaHeight * scale;
  const offsetX = (viewportWidth - renderedWidth) / 2;
  const offsetY = (viewportHeight - renderedHeight) / 2;
  const left = clamp(Math.min(start.x, end.x), offsetX, offsetX + renderedWidth);
  const right = clamp(Math.max(start.x, end.x), offsetX, offsetX + renderedWidth);
  const top = clamp(Math.min(start.y, end.y), offsetY, offsetY + renderedHeight);
  const bottom = clamp(Math.max(start.y, end.y), offsetY, offsetY + renderedHeight);
  if (right <= left || bottom <= top) {
    throw new Error("The drag must cover a visible area of the video.");
  }

  return {
    left: clamp(Math.floor((left - offsetX) / scale), 0, mediaWidth - 1),
    top: clamp(Math.floor((top - offsetY) / scale), 0, mediaHeight - 1),
    right: clamp(Math.ceil((right - offsetX) / scale) - 1, 0, mediaWidth - 1),
    bottom: clamp(Math.ceil((bottom - offsetY) / scale) - 1, 0, mediaHeight - 1),
  };
}

export function createMissingAnimalAnnotation({
  clipId,
  processedFps,
  mediaWidth,
  mediaHeight,
  frameIndex,
  timestampSeconds,
  broadLabel,
  box,
}: {
  clipId: string;
  processedFps: number;
  mediaWidth: number;
  mediaHeight: number;
  frameIndex: number;
  timestampSeconds: number;
  broadLabel?: string;
  box: InclusiveMediaBox;
}): MissingAnimalAnnotation {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u.test(clipId)) {
    throw new Error("clipId is invalid.");
  }
  requirePositive(processedFps, "processedFps");
  requirePositiveInteger(mediaWidth, "mediaWidth");
  requirePositiveInteger(mediaHeight, "mediaHeight");
  if (!Number.isInteger(frameIndex) || frameIndex < 0) {
    throw new Error("frameIndex must be a non-negative integer.");
  }
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    throw new Error("timestampSeconds must be non-negative and finite.");
  }
  const label = broadLabel?.trim() || null;
  if (label !== null && (label.length > 80 || /[\r\n]/u.test(label))) {
    throw new Error("broadLabel must be a single line of at most 80 characters.");
  }
  if (
    ![box.left, box.top, box.right, box.bottom].every(Number.isInteger) ||
    box.left < 0 || box.top < 0 || box.right < box.left || box.bottom < box.top
  ) {
    throw new Error("box must use non-negative inclusive integer coordinates.");
  }
  return {
    schema: "wildscore-missing-animal-annotation-v1",
    clip_id: clipId,
    processed_fps: processedFps,
    media_width: mediaWidth,
    media_height: mediaHeight,
    frame_index: frameIndex,
    timestamp_s: timestampSeconds,
    broad_label: label,
    prompt_kind: "box",
    box,
  };
}

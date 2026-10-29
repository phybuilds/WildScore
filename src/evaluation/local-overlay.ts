export interface LocalOverlayBox {
  object_id: string;
  box: { left: number; top: number; right: number; bottom: number };
}

export interface LocalOverlayFrame {
  frame_index: number;
  objects: LocalOverlayBox[];
}

export interface LocalEvaluationOverlay {
  schema: "wildscore-local-evaluation-overlay-v1";
  width: number;
  height: number;
  fps: number;
  frames: LocalOverlayFrame[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateLocalEvaluationOverlay(value: unknown): LocalEvaluationOverlay {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Evaluation overlay must be an object.");
  }
  const overlay = value as Partial<LocalEvaluationOverlay>;
  const width = Number(overlay.width);
  const height = Number(overlay.height);
  const fps = Number(overlay.fps);
  if (
    overlay.schema !== "wildscore-local-evaluation-overlay-v1" ||
    !Number.isInteger(width) || width <= 0 ||
    !Number.isInteger(height) || height <= 0 ||
    !isFiniteNumber(overlay.fps) || fps <= 0 ||
    !Array.isArray(overlay.frames)
  ) {
    throw new Error("Evaluation overlay has invalid metadata.");
  }
  let previousFrame = -1;
  for (const frame of overlay.frames) {
    if (
      !frame || typeof frame !== "object" ||
      !Number.isInteger(frame.frame_index) || frame.frame_index <= previousFrame ||
      !Array.isArray(frame.objects)
    ) {
      throw new Error("Evaluation overlay has invalid frame ordering.");
    }
    previousFrame = frame.frame_index;
    for (const object of frame.objects) {
      const box = object?.box;
      if (
        typeof object?.object_id !== "string" || object.object_id.length > 64 ||
        !box || ![box.left, box.top, box.right, box.bottom].every(isFiniteNumber) ||
        box.left < 0 || box.top < 0 ||
        box.right > width || box.bottom > height ||
        box.left >= box.right || box.top >= box.bottom
      ) {
        throw new Error("Evaluation overlay contains an invalid box.");
      }
    }
  }
  return overlay as LocalEvaluationOverlay;
}

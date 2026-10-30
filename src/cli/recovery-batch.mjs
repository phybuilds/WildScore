import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_BATCH_BYTES = 256 * 1024;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function validateRecoveryBatch(value, maxCalls) {
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 16) {
    throw new Error("--max-calls must be an integer from 1 to 16.");
  }
  if (
    !isRecord(value) ||
    value.schema !== "wildscore-missing-animal-report-batch-v1" ||
    typeof value.clip_id !== "string" ||
    !SAFE_ID.test(value.clip_id) ||
    !Array.isArray(value.annotations) ||
    value.annotations.length === 0
  ) {
    throw new Error("The recovery batch has an invalid schema or no annotations.");
  }
  if (value.annotations.length > maxCalls) {
    throw new Error(
      `The batch contains ${value.annotations.length} annotations, exceeding --max-calls=${maxCalls}.`,
    );
  }

  let expectedMedia = null;
  const unique = new Set();
  for (const annotation of value.annotations) {
    if (!isRecord(annotation) || annotation.schema !== "wildscore-missing-animal-annotation-v1") {
      throw new Error("A recovery annotation has an invalid schema.");
    }
    const box = annotation.box;
    if (
      annotation.clip_id !== value.clip_id ||
      annotation.prompt_kind !== "box" ||
      !isPositiveFinite(annotation.processed_fps) ||
      !isPositiveInteger(annotation.media_width) ||
      !isPositiveInteger(annotation.media_height) ||
      !Number.isInteger(annotation.frame_index) || annotation.frame_index < 0 ||
      typeof annotation.timestamp_s !== "number" ||
      !Number.isFinite(annotation.timestamp_s) || annotation.timestamp_s < 0 ||
      Math.abs(annotation.timestamp_s - annotation.frame_index / annotation.processed_fps) > 0.001 ||
      !(annotation.broad_label === null ||
        (typeof annotation.broad_label === "string" &&
          annotation.broad_label.length <= 80 && !/[\r\n]/u.test(annotation.broad_label))) ||
      !isRecord(box) ||
      ![box.left, box.top, box.right, box.bottom].every(Number.isInteger) ||
      box.left < 0 || box.top < 0 || box.right < box.left || box.bottom < box.top ||
      box.right >= annotation.media_width || box.bottom >= annotation.media_height
    ) {
      throw new Error("A recovery annotation is invalid or outside its media bounds.");
    }
    const media = [annotation.processed_fps, annotation.media_width, annotation.media_height].join(":");
    if (expectedMedia === null) expectedMedia = media;
    else if (media !== expectedMedia) {
      throw new Error("Recovery annotations use inconsistent media metadata.");
    }
    const identity = [annotation.frame_index, box.left, box.top, box.right, box.bottom].join(":");
    if (unique.has(identity)) throw new Error("The recovery batch contains a duplicate annotation.");
    unique.add(identity);
  }

  return {
    clipId: value.clip_id,
    annotationCount: value.annotations.length,
    maxCalls,
    model: "sam-3.1",
    promptKind: "box",
    broadLabelsExcludedFromPrompts: true,
  };
}

export async function loadRecoveryBatch(fileArgument, maxCalls) {
  const requested = path.resolve(fileArgument);
  const details = await lstat(requested);
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_BATCH_BYTES) {
    throw new Error("The recovery batch must be a regular JSON file no larger than 256 KiB.");
  }
  const resolved = await realpath(requested);
  return validateRecoveryBatch(JSON.parse(await readFile(resolved, "utf8")), maxCalls);
}

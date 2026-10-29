import type { MissingAnimalAnnotation } from "./missing-animal-annotation";

export interface MissingAnimalReportBatch {
  schema: "wildscore-missing-animal-report-batch-v1";
  clip_id: string;
  annotations: MissingAnimalAnnotation[];
}

function annotationKey(annotation: MissingAnimalAnnotation): string {
  const { left, top, right, bottom } = annotation.box;
  return [annotation.frame_index, left, top, right, bottom, annotation.broad_label ?? ""].join(":");
}

export function appendMissingAnimalAnnotation(
  annotations: MissingAnimalAnnotation[],
  annotation: MissingAnimalAnnotation,
): MissingAnimalAnnotation[] {
  if (annotations.some((item) => annotationKey(item) === annotationKey(annotation))) {
    return annotations;
  }
  return [...annotations, annotation].sort(
    (left, right) => left.frame_index - right.frame_index,
  );
}

export function restoreMissingAnimalAnnotations(
  value: unknown,
  clipId: string,
): MissingAnimalAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MissingAnimalAnnotation => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<MissingAnimalAnnotation>;
    const box = candidate.box;
    return candidate.schema === "wildscore-missing-animal-annotation-v1" &&
      candidate.clip_id === clipId &&
      Number.isInteger(candidate.frame_index) &&
      typeof candidate.timestamp_s === "number" &&
      Boolean(box) &&
      [box?.left, box?.top, box?.right, box?.bottom].every(Number.isInteger);
  });
}

export function buildMissingAnimalReportBatch(
  clipId: string,
  annotations: MissingAnimalAnnotation[],
): MissingAnimalReportBatch {
  return {
    schema: "wildscore-missing-animal-report-batch-v1",
    clip_id: clipId,
    annotations,
  };
}

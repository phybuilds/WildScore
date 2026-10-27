import {
  decodeMaskToRaster,
  parseVideoStream,
  recordsOfKind,
} from "@meta-sam/parser";

function recordKey(record) {
  return `${record.frame?.frameIndex}:${record.objectId}`;
}

function assertFiniteInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}

function chooseRepresentativeFrames(frameIndices) {
  if (frameIndices.length === 0) return [];
  const candidates = [
    frameIndices[0],
    frameIndices[Math.floor((frameIndices.length - 1) / 2)],
    frameIndices.at(-1),
  ];
  return [...new Set(candidates)];
}

export async function parseAndSummariseSamEvents(events, media) {
  const parsed = parseVideoStream(events);
  const result = await parsed.finalResult;

  if (result.outcome.status !== "completed") {
    throw new Error(`SAM stream did not complete: ${result.outcome.reason}`);
  }
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error("SAM output contained parser errors.");
  }

  const boxes = recordsOfKind(result.records, "box");
  const masks = recordsOfKind(result.records, "mask");
  const boxesByKey = new Map(boxes.map((box) => [recordKey(box), box]));
  if (boxes.length !== masks.length) {
    throw new Error("SAM output did not contain one mask for every box.");
  }

  const tracks = new Map();
  const frameObjects = new Map();
  for (const mask of masks) {
    const frameIndex = mask.frame?.frameIndex;
    assertFiniteInteger(frameIndex, "frame index");
    const box = boxesByKey.get(recordKey(mask));
    if (!box) throw new Error("SAM output contained a mask without a matching box.");
    if (
      box.left < 0 ||
      box.top < 0 ||
      box.right > media.width ||
      box.bottom > media.height ||
      box.left >= box.right ||
      box.top >= box.bottom
    ) {
      throw new Error("SAM returned a box outside the processed video bounds.");
    }

    const frames = tracks.get(mask.objectId) ?? [];
    frames.push(frameIndex);
    tracks.set(mask.objectId, frames);

    const objects = frameObjects.get(frameIndex) ?? [];
    objects.push({
      object_id: mask.objectId,
      box: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      },
      confidence: box.confidence ?? null,
      mask: {
        width: mask.mask.width,
        height: mask.mask.height,
        encoding: mask.mask.encoding,
      },
    });
    frameObjects.set(frameIndex, objects);
  }

  const frameIndices = [...frameObjects.keys()].sort((a, b) => a - b);
  const representativeFrames = chooseRepresentativeFrames(frameIndices).map(
    (frameIndex) => {
      const objects = frameObjects.get(frameIndex) ?? [];
      for (const object of objects) {
        const mask = masks.find(
          (candidate) =>
            candidate.frame?.frameIndex === frameIndex &&
            candidate.objectId === object.object_id,
        );
        if (!mask) throw new Error("Representative mask lookup failed.");
        const raster = decodeMaskToRaster(mask.mask);
        if (raster.length !== mask.mask.width * mask.mask.height) {
          throw new Error("Decoded SAM mask dimensions did not match its payload.");
        }
      }
      return { frame_index: frameIndex, objects };
    },
  );

  const trackSummaries = [...tracks.entries()]
    .map(([objectId, frames]) => {
      const sorted = [...new Set(frames)].sort((a, b) => a - b);
      return {
        object_id: objectId,
        first_frame: sorted[0],
        last_frame: sorted.at(-1),
        emitted_frame_count: sorted.length,
        first_time_seconds: sorted[0] / media.fps,
        last_time_seconds: sorted.at(-1) / media.fps,
      };
    })
    .sort((a, b) => a.first_frame - b.first_frame);

  return {
    parser: "@meta-sam/parser@0.1.0",
    outcome: result.outcome,
    prompt: media.prompt,
    processed_media: {
      width: media.width,
      height: media.height,
      fps: media.fps,
      frame_count: media.frameCount,
    },
    emitted_frame_count: frameIndices.length,
    first_emitted_frame: frameIndices[0] ?? null,
    last_emitted_frame: frameIndices.at(-1) ?? null,
    object_ids: [...tracks.keys()],
    track_count: tracks.size,
    box_count: boxes.length,
    mask_count: masks.length,
    tracks: trackSummaries,
    representative_frames: representativeFrames,
    diagnostics: result.diagnostics.map(({ severity, code, line }) => ({
      severity,
      code,
      line,
    })),
  };
}

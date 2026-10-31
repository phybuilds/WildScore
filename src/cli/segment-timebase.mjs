const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function validateFps(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value > 240) {
    throw new RangeError(`${name} must be a positive finite value at most 240.`);
  }
}

export function normalizeSegmentsToTimebase(segments, sourceFps, targetFps) {
  if (!Array.isArray(segments)) throw new TypeError("segments must be an array.");
  validateFps(sourceFps, "sourceFps");
  validateFps(targetFps, "targetFps");
  const ids = new Set();

  return segments.map((segment) => {
    if (
      segment === null ||
      typeof segment !== "object" ||
      !SAFE_ID.test(segment.segment_id ?? "") ||
      !Array.isArray(segment.geometry) ||
      segment.geometry.length === 0
    ) {
      throw new TypeError("segment is invalid.");
    }
    if (ids.has(segment.segment_id)) throw new RangeError("segment IDs must be unique.");
    ids.add(segment.segment_id);

    const byTargetFrame = new Map();
    for (const detection of segment.geometry) {
      if (!Number.isInteger(detection?.frame_index) || detection.frame_index < 0) {
        throw new TypeError("geometry frame is invalid.");
      }
      const targetFrame = Math.round((detection.frame_index / sourceFps) * targetFps);
      const targetTime = targetFrame / targetFps;
      const distance = Math.abs(detection.frame_index / sourceFps - targetTime);
      const existing = byTargetFrame.get(targetFrame);
      if (
        existing === undefined ||
        distance < existing.distance - 1e-12 ||
        (Math.abs(distance - existing.distance) <= 1e-12 &&
          detection.frame_index < existing.sourceFrame)
      ) {
        byTargetFrame.set(targetFrame, {
          detection,
          distance,
          sourceFrame: detection.frame_index,
        });
      }
    }
    const geometry = [...byTargetFrame.entries()]
      .sort(([left], [right]) => left - right)
      .map(([frame_index, value]) => ({ ...value.detection, frame_index }));
    if (geometry.length === 0) throw new RangeError("segment has no normalized geometry.");
    return {
      ...segment,
      first_frame: geometry[0].frame_index,
      last_frame: geometry.at(-1).frame_index,
      start_s: geometry[0].frame_index / targetFps,
      end_s: geometry.at(-1).frame_index / targetFps,
      geometry,
    };
  });
}

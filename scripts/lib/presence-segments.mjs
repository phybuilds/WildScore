function nearEdge(box, width, height, marginRatio) {
  const marginX = width * marginRatio;
  const marginY = height * marginRatio;
  return (
    box.left <= marginX ||
    box.top <= marginY ||
    box.right >= width - marginX ||
    box.bottom >= height - marginY
  );
}

function splitByGap(detections, gapToleranceFrames) {
  const ordered = [...detections].sort((a, b) => a.frame_index - b.frame_index);
  const groups = [];
  let current = [];
  for (const detection of ordered) {
    const previous = current.at(-1);
    if (
      previous &&
      detection.frame_index - previous.frame_index > gapToleranceFrames + 1
    ) {
      groups.push(current);
      current = [];
    }
    current.push(detection);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function derivePresenceSegments(detections, config) {
  const {
    fps,
    frameCount,
    width,
    height,
    edgeMarginRatio = 0.02,
    gapToleranceFrames = 0,
    cameraMotionPossible = false,
  } = config;
  if (!(fps > 0) || !Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error("Invalid timebase configuration.");
  }

  const byObject = new Map();
  for (const detection of detections) {
    const list = byObject.get(detection.object_id) ?? [];
    list.push(detection);
    byObject.set(detection.object_id, list);
  }

  const segments = [];
  const events = [];
  for (const [objectId, objectDetections] of byObject.entries()) {
    const groups = splitByGap(objectDetections, gapToleranceFrames);
    groups.forEach((geometry, index) => {
      const first = geometry[0];
      const last = geometry.at(-1);
      const segmentId = `seg-${objectId}-${index + 1}`;
      const alreadyVisibleAtStart = first.frame_index === 0;
      const stillVisibleAtEnd = last.frame_index === frameCount - 1;
      const hasEarlierSegment = index > 0;
      const hasLaterSegment = index < groups.length - 1;
      const baseUncertainty = cameraMotionPossible ? ["camera_motion_possible"] : [];

      segments.push({
        segment_id: segmentId,
        sam_object_id: String(objectId),
        first_frame: first.frame_index,
        last_frame: last.frame_index,
        start_s: first.frame_index / fps,
        end_s: last.frame_index / fps,
        already_visible_at_start: alreadyVisibleAtStart,
        still_visible_at_end: stillVisibleAtEnd,
        geometry,
      });

      if (!alreadyVisibleAtStart) {
        events.push({
          event_id: `${segmentId}:appearance`,
          segment_id: segmentId,
          event_kind: "appearance",
          start_s: first.frame_index / fps,
          end_s: first.frame_index / fps,
          boundary_evidence: nearEdge(
            first.box,
            width,
            height,
            edgeMarginRatio,
          )
            ? "edge"
            : "interior",
          uncertainty_flags: [
            ...baseUncertainty,
            ...(hasEarlierSegment
              ? ["possible_occlusion_or_detection_failure"]
              : []),
          ],
          decision: "proposed",
          derivation_source: "sam_geometry",
          config_version: "presence-v1",
        });
      }

      if (!stillVisibleAtEnd) {
        events.push({
          event_id: `${segmentId}:disappearance`,
          segment_id: segmentId,
          event_kind: "disappearance",
          start_s: last.frame_index / fps,
          end_s: last.frame_index / fps,
          boundary_evidence: nearEdge(
            last.box,
            width,
            height,
            edgeMarginRatio,
          )
            ? "edge"
            : "interior",
          uncertainty_flags: [
            ...baseUncertainty,
            ...(hasLaterSegment
              ? ["possible_occlusion_or_detection_failure"]
              : []),
          ],
          decision: "proposed",
          derivation_source: "sam_geometry",
          config_version: "presence-v1",
        });
      }
    });
  }

  return { segments, events };
}

export function boxIou(left, right) {
  const intersectionWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const intersectionHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = (left.right - left.left) * (left.bottom - left.top);
  const rightArea = (right.right - right.left) * (right.bottom - right.top);
  const union = leftArea + rightArea - intersection;
  return union > 0 ? intersection / union : 0;
}

export function compareTracks(target, candidate, iouThreshold = 0.5) {
  const candidateByFrame = new Map(
    candidate.geometry.map((detection) => [detection.frame_index, detection.box]),
  );
  const shared = target.geometry.flatMap((detection) => {
    const candidateBox = candidateByFrame.get(detection.frame_index);
    return candidateBox ? [boxIou(detection.box, candidateBox)] : [];
  });
  const highIouCount = shared.filter((iou) => iou >= iouThreshold).length;
  return {
    shared_frame_count: shared.length,
    high_iou_frame_count: highIouCount,
    high_iou_shared_frame_ratio: shared.length > 0 ? highIouCount / shared.length : 0,
    mean_iou_on_shared_frames:
      shared.length > 0 ? shared.reduce((sum, iou) => sum + iou, 0) / shared.length : 0,
  };
}

export function auditTargetTracks(baseTracks, targetTracks, config = {}) {
  const minimumSharedFrames = config.minimumSharedFrames ?? 5;
  const minimumHighIouRatio = config.minimumHighIouRatio ?? 0.6;
  const iouThreshold = config.iouThreshold ?? 0.5;
  return targetTracks.map((target) => {
    const comparisons = baseTracks.map((candidate) => ({
      base_track_id: candidate.track_id,
      ...compareTracks(target, candidate, iouThreshold),
    }));
    const rankedBest = comparisons.sort((a, b) =>
      b.high_iou_frame_count - a.high_iou_frame_count ||
      b.mean_iou_on_shared_frames - a.mean_iou_on_shared_frames,
    )[0] ?? null;
    const best = rankedBest?.shared_frame_count > 0 ? rankedBest : null;
    const duplicate = Boolean(
      best && best.shared_frame_count >= minimumSharedFrames &&
      best.high_iou_shared_frame_ratio >= minimumHighIouRatio,
    );
    return {
      target_track_id: target.track_id,
      classification: duplicate ? "probable_duplicate" : "additive_candidate",
      best_base_match: best,
    };
  });
}

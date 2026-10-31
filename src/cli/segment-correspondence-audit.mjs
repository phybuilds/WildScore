import { compareTracks } from "../../scripts/lib/track-overlap.mjs";

const DEFAULT_CONFIG = Object.freeze({
  iouThreshold: 0.5,
  minimumSharedFrames: 3,
  minimumHighIouRatio: 0.6,
});

const ALLOWED_CONFIG_KEYS = new Set([
  "iouThreshold",
  "minimumSharedFrames",
  "minimumHighIouRatio",
]);

const SAFE_SEGMENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function isSafeSegmentId(value) {
  return (
    typeof value === "string" &&
    SAFE_SEGMENT_ID.test(value)
  );
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateBox(box) {
  if (typeof box !== "object" || box === null || Array.isArray(box)) {
    throw new TypeError("invalid box");
  }
  const { left, right, top, bottom } = box;
  if (
    typeof left !== "number" ||
    typeof right !== "number" ||
    typeof top !== "number" ||
    typeof bottom !== "number"
  ) {
    throw new TypeError("invalid box coordinates");
  }
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(right) ||
    !Number.isFinite(top) ||
    !Number.isFinite(bottom)
  ) {
    throw new TypeError("invalid box coordinates");
  }
  if (!(left < right) || !(top < bottom)) {
    throw new RangeError("invalid box extents");
  }
}

function validateSegment(segment) {
  if (typeof segment !== "object" || segment === null || Array.isArray(segment)) {
    throw new TypeError("invalid segment");
  }
  if (!isSafeSegmentId(segment.segment_id)) {
    throw new TypeError("invalid segment_id");
  }
  if (!isNonNegativeSafeInteger(segment.first_frame)) {
    throw new TypeError("invalid first_frame");
  }
  if (!isNonNegativeSafeInteger(segment.last_frame)) {
    throw new TypeError("invalid last_frame");
  }
  if (segment.first_frame > segment.last_frame) {
    throw new RangeError("invalid segment bounds");
  }
  if (!Array.isArray(segment.geometry) || segment.geometry.length === 0) {
    throw new TypeError("invalid geometry");
  }
  const seen = new Set();
  for (const detection of segment.geometry) {
    if (typeof detection !== "object" || detection === null || Array.isArray(detection)) {
      throw new TypeError("invalid detection");
    }
    const frame = detection.frame_index;
    if (!isNonNegativeSafeInteger(frame)) {
      throw new TypeError("invalid frame_index");
    }
    if (frame < segment.first_frame || frame > segment.last_frame) {
      throw new RangeError("frame_index outside segment bounds");
    }
    if (seen.has(frame)) {
      throw new RangeError("duplicate frame_index");
    }
    seen.add(frame);
    validateBox(detection.box);
  }
}

function validateSegmentArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`invalid ${name}`);
  }
  const ids = new Set();
  for (const segment of value) {
    validateSegment(segment);
    if (ids.has(segment.segment_id)) {
      throw new RangeError(`duplicate segment_id in ${name}`);
    }
    ids.add(segment.segment_id);
  }
}

function resolveConfig(config) {
  if (config === undefined) {
    return {
      iouThreshold: DEFAULT_CONFIG.iouThreshold,
      minimumSharedFrames: DEFAULT_CONFIG.minimumSharedFrames,
      minimumHighIouRatio: DEFAULT_CONFIG.minimumHighIouRatio,
    };
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new TypeError("invalid config");
  }
  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      throw new RangeError(`unknown config key: ${key}`);
    }
  }
  const iouThreshold =
    Object.prototype.hasOwnProperty.call(config, "iouThreshold")
      ? config.iouThreshold
      : DEFAULT_CONFIG.iouThreshold;
  const minimumSharedFrames =
    Object.prototype.hasOwnProperty.call(config, "minimumSharedFrames")
      ? config.minimumSharedFrames
      : DEFAULT_CONFIG.minimumSharedFrames;
  const minimumHighIouRatio =
    Object.prototype.hasOwnProperty.call(config, "minimumHighIouRatio")
      ? config.minimumHighIouRatio
      : DEFAULT_CONFIG.minimumHighIouRatio;

  if (typeof iouThreshold !== "number" || !Number.isFinite(iouThreshold)) {
    throw new TypeError("invalid iouThreshold");
  }
  if (iouThreshold < 0 || iouThreshold > 1) {
    throw new RangeError("invalid iouThreshold");
  }
  if (!Number.isInteger(minimumSharedFrames)) {
    throw new TypeError("invalid minimumSharedFrames");
  }
  if (minimumSharedFrames < 1 || minimumSharedFrames > 1000) {
    throw new RangeError("invalid minimumSharedFrames");
  }
  if (typeof minimumHighIouRatio !== "number" || !Number.isFinite(minimumHighIouRatio)) {
    throw new TypeError("invalid minimumHighIouRatio");
  }
  if (minimumHighIouRatio < 0 || minimumHighIouRatio > 1) {
    throw new RangeError("invalid minimumHighIouRatio");
  }
  return { iouThreshold, minimumSharedFrames, minimumHighIouRatio };
}

function compareStringsAscending(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function auditSegmentCorrespondence(referenceSegments, candidateSegments, config) {
  validateSegmentArray(referenceSegments, "referenceSegments");
  validateSegmentArray(candidateSegments, "candidateSegments");
  const effective = resolveConfig(config);

  const correspondenceCandidates = [];
  for (const reference of referenceSegments) {
    for (const candidate of candidateSegments) {
      const overlap = compareTracks(reference, candidate, effective.iouThreshold);
      const referenceFrameCoverage =
        overlap.shared_frame_count / reference.geometry.length;
      const candidateFrameCoverage =
        overlap.shared_frame_count / candidate.geometry.length;
      if (
        overlap.shared_frame_count >= effective.minimumSharedFrames &&
        overlap.high_iou_shared_frame_ratio >= effective.minimumHighIouRatio
      ) {
        correspondenceCandidates.push({
          reference_segment_id: reference.segment_id,
          candidate_segment_id: candidate.segment_id,
          shared_frame_count: overlap.shared_frame_count,
          high_iou_frame_count: overlap.high_iou_frame_count,
          high_iou_shared_frame_ratio: overlap.high_iou_shared_frame_ratio,
          mean_iou_on_shared_frames: overlap.mean_iou_on_shared_frames,
          reference_frame_coverage: referenceFrameCoverage,
          candidate_frame_coverage: candidateFrameCoverage,
          reason_codes: ["shared_frames", "spatial_overlap"],
        });
      }
    }
  }

  correspondenceCandidates.sort((a, b) => {
    const byRef = compareStringsAscending(a.reference_segment_id, b.reference_segment_id);
    if (byRef !== 0) return byRef;
    if (b.high_iou_frame_count !== a.high_iou_frame_count) {
      return b.high_iou_frame_count - a.high_iou_frame_count;
    }
    if (b.mean_iou_on_shared_frames !== a.mean_iou_on_shared_frames) {
      return b.mean_iou_on_shared_frames - a.mean_iou_on_shared_frames;
    }
    return compareStringsAscending(a.candidate_segment_id, b.candidate_segment_id);
  });

  const referencesWith = new Set(
    correspondenceCandidates.map((item) => item.reference_segment_id),
  );
  const candidatesWith = new Set(
    correspondenceCandidates.map((item) => item.candidate_segment_id),
  );

  const referenceWithoutSet = new Set();
  for (const segment of referenceSegments) {
    if (!referencesWith.has(segment.segment_id)) {
      referenceWithoutSet.add(segment.segment_id);
    }
  }
  const candidateWithoutSet = new Set();
  for (const segment of candidateSegments) {
    if (!candidatesWith.has(segment.segment_id)) {
      candidateWithoutSet.add(segment.segment_id);
    }
  }
  const referenceSegmentsWithoutCandidate = [...referenceWithoutSet].sort(
    compareStringsAscending,
  );
  const candidateSegmentsWithoutReference = [...candidateWithoutSet].sort(
    compareStringsAscending,
  );

  const candidatesByReference = new Map();
  for (const item of correspondenceCandidates) {
    let set = candidatesByReference.get(item.reference_segment_id);
    if (!set) {
      set = new Set();
      candidatesByReference.set(item.reference_segment_id, set);
    }
    set.add(item.candidate_segment_id);
  }
  const fragmentationReview = [];
  for (const [referenceId, candidateIds] of candidatesByReference) {
    if (candidateIds.size >= 2) {
      fragmentationReview.push({
        reference_segment_id: referenceId,
        candidate_segment_ids: [...candidateIds].sort(compareStringsAscending),
        reason_codes: ["multiple_candidate_segments_overlap_one_reference"],
      });
    }
  }
  fragmentationReview.sort((a, b) =>
    compareStringsAscending(a.reference_segment_id, b.reference_segment_id),
  );

  const referencesByCandidate = new Map();
  for (const item of correspondenceCandidates) {
    let set = referencesByCandidate.get(item.candidate_segment_id);
    if (!set) {
      set = new Set();
      referencesByCandidate.set(item.candidate_segment_id, set);
    }
    set.add(item.reference_segment_id);
  }
  const duplicateReview = [];
  for (const [candidateId, referenceIds] of referencesByCandidate) {
    if (referenceIds.size >= 2) {
      duplicateReview.push({
        candidate_segment_id: candidateId,
        reference_segment_ids: [...referenceIds].sort(compareStringsAscending),
        reason_codes: ["one_candidate_segment_overlaps_multiple_references"],
      });
    }
  }
  duplicateReview.sort((a, b) =>
    compareStringsAscending(a.candidate_segment_id, b.candidate_segment_id),
  );

  return {
    config: {
      iouThreshold: effective.iouThreshold,
      minimumSharedFrames: effective.minimumSharedFrames,
      minimumHighIouRatio: effective.minimumHighIouRatio,
    },
    correspondence_candidates: correspondenceCandidates,
    reference_segments_without_candidate: referenceSegmentsWithoutCandidate,
    candidate_segments_without_reference: candidateSegmentsWithoutReference,
    fragmentation_review: fragmentationReview,
    duplicate_review: duplicateReview,
  };
}

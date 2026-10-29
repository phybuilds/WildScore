import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

import { derivePresenceSegments } from "./lib/presence-segments.mjs";

const RUNS_ROOT = path.resolve("private/model-runs");
const OUTPUT_ROOT = path.resolve("private/bundles/clip-01");
const EVENT_CONFIG = {
  edge_margin_ratio: 0.02,
  gap_tolerance_frames: 0,
  camera_motion_possible: true,
};

async function* eventsFromNdjson(filePath) {
  const content = await readFile(filePath, "utf8");
  for (const line of content.split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function latestSuccessfulRun() {
  const entries = (await readdir(RUNS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const runId of entries) {
    try {
      const runDirectory = path.join(RUNS_ROOT, runId);
      const summary = JSON.parse(
        await readFile(path.join(runDirectory, "sam-summary.json"), "utf8"),
      );
      if (summary.status === "completed") return { runId, runDirectory, summary };
    } catch {
      // Skip failed or incomplete directories.
    }
  }
  throw new Error("No completed model run was found.");
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function recordKey(record) {
  return `${record.frame?.frameIndex}:${record.objectId}`;
}

async function main() {
  const { runId, runDirectory, summary } = await latestSuccessfulRun();
  const parsed = parseVideoStream(
    eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")),
  );
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed" || result.diagnostics.length > 0) {
    throw new Error("Stored SAM output did not pass bundle validation.");
  }

  const boxes = recordsOfKind(result.records, "box");
  const masks = recordsOfKind(result.records, "mask");
  const masksByKey = new Map(masks.map((mask) => [recordKey(mask), mask]));
  const detections = boxes.map((box) => {
    const mask = masksByKey.get(recordKey(box));
    if (!mask) throw new Error("A SAM box has no corresponding mask.");
    return {
      frame_index: box.frame.frameIndex,
      object_id: box.objectId,
      box: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      },
      mask: {
        encoding: mask.mask.encoding,
        width: mask.mask.width,
        height: mask.mask.height,
        payload: mask.mask.payload,
      },
      detection_confidence: box.confidence ?? null,
    };
  });

  const media = summary.parser_summary.processed_media;
  const derived = derivePresenceSegments(detections, {
    fps: media.fps,
    frameCount: media.frame_count,
    width: media.width,
    height: media.height,
    edgeMarginRatio: EVENT_CONFIG.edge_margin_ratio,
    gapToleranceFrames: EVENT_CONFIG.gap_tolerance_frames,
    cameraMotionPossible: EVENT_CONFIG.camera_motion_possible,
  });

  const reviewedSegment = derived.segments.find(
    (segment) =>
      segment.sam_object_id === "6" &&
      segment.first_frame === 0 &&
      segment.last_frame === 143,
  );
  if (!reviewedSegment) {
    throw new Error("The human-reviewed segment was not found in derived output.");
  }
  const sparkSummary = JSON.parse(
    await readFile(
      path.join(runDirectory, "spark-evidence", "spark-summary.json"),
      "utf8",
    ),
  );
  if (sparkSummary.status !== "completed") {
    throw new Error("The stored Spark proposal is not complete.");
  }

  const bundle = {
    schema_version: "0.1.0",
    clip: {
      clip_id: "clip-01",
      display_media: "clip-01-sanitized-master.mp4",
      processed_duration_s: media.frame_count / media.fps,
      processed_fps: media.fps,
      processed_frame_count: media.frame_count,
      width: media.width,
      height: media.height,
    },
    run: {
      run_id: runId,
      completion_state: "completed",
      processed_media_sha256: summary.processed_media_sha256,
      models: {
        segmentation: "sam-3.1",
        label_evidence: "muse-spark-1.3",
      },
      sam_prompt: "animal",
      parser: summary.parser_summary.parser,
      provider: "Meta Model API",
      data_mode: "standard; not contributor",
      sam_runtime_ms: summary.sam_latency_ms,
      sam_frames_processed: summary.usage?.video_frames_processed ?? null,
      sam_estimated_cost_usd: summary.estimated_cost_usd_at_documented_rate,
      config_version: "presence-v1",
      config_hash: hashJson(EVENT_CONFIG),
    },
    segments: derived.segments,
    label_proposals: [
      {
        segment_id: reviewedSegment.segment_id,
        label_id: sparkSummary.validated_proposal.label_id,
        visible_evidence: sparkSummary.validated_proposal.visible_evidence,
        uncertainty_reason: sparkSummary.validated_proposal.uncertainty_reason,
        model: "muse-spark-1.3",
        source_run_id: runId,
      },
    ],
    events: derived.events,
    reviews: [
      {
        review_kind: "segment_label",
        segment_id: reviewedSegment.segment_id,
        decision: "accepted",
        original_value: sparkSummary.validated_proposal.label_id,
        new_value: "olive_baboon",
        reviewer: "founder",
        reviewed_at: null,
        correction_note: "Accepted broad baboon proposal and refined species.",
      },
    ],
    evaluation: {
      status: "one_clip_held_out_evaluation",
      held_out_clip_count: 1,
      held_out_result: {
        source_title: "Wolf on Trail Camera",
        source_url:
          "https://commons.wikimedia.org/wiki/File:Wolf_on_Trail_Camera.webm",
        source_credit: "USFWS Mountain-Prairie",
        licence: "Public domain; U.S. Fish and Wildlife Service work",
        reference_state: "frozen_before_model_output",
        model: "sam-3.1",
        provider: "Meta Model API",
        processed_frames: 100,
        matcher: "frozen one-to-one event matcher",
        tolerance_s: 1,
        reference_event_count: 2,
        matched_predictions: 2,
        missed_events: 0,
        false_alarms: 0,
        sam_latency_ms: 6185,
        total_latency_ms: 12517,
        remote_file_deletion_confirmed: true,
        label_result: {
          reference_state: "frozen_before_model_output",
          reference_label: "wolf",
          proposed_label: "wolf",
          matched_reference: true,
          model: "muse-spark-1.3",
          provider: "Meta Model API",
          prompt_context: "image only; no location or source title",
          latency_ms: 2459,
        },
      },
      limitations: [
        "The held-out result covers one ten-second, static, uncrowded wolf clip with two eligible boundary events.",
        "It does not establish general event, tracking or species-label accuracy.",
        "Crowded scene may exceed the model's tracking capacity.",
        "Camera panning can create or obscure apparent boundary events.",
      ],
    },
  };

  await mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  await chmod(OUTPUT_ROOT, 0o700);
  const outputPath = path.join(OUTPUT_ROOT, "bundle.json");
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log(
    `Private bundle validated: ${bundle.segments.length} segments, ${bundle.events.length} candidate events, ${bundle.label_proposals.length} label proposal.`,
  );
}

await main();

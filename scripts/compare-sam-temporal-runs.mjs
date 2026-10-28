import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

import { derivePresenceSegments } from "./lib/presence-segments.mjs";

const BASELINE_ROOT = path.resolve("private/model-runs");
const EXPERIMENT_ROOT = path.resolve("private/model-experiments/sam-temporal-15fps");
const OUTPUT_PATH = path.resolve("private/evaluation/sam-temporal-10-vs-15.json");

async function* eventsFromNdjson(filePath) {
  for (const line of (await readFile(filePath, "utf8")).split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function latestCompletedRun(root, expectedFps) {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  for (const runId of entries) {
    try {
      const runDirectory = path.join(root, runId);
      const summary = JSON.parse(await readFile(path.join(runDirectory, "sam-summary.json"), "utf8"));
      if (summary.status === "completed" && summary.parser_summary?.processed_media?.fps === expectedFps) {
        return { runId, runDirectory, summary };
      }
    } catch {
      // Ignore failed and incomplete runs.
    }
  }
  throw new Error(`No completed ${expectedFps} fps SAM run was found.`);
}

async function metrics(root, fps) {
  const { runId, runDirectory, summary } = await latestCompletedRun(root, fps);
  const parsed = parseVideoStream(eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")));
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed" || result.diagnostics.some((item) => item.severity === "error")) {
    throw new Error(`Stored ${fps} fps SAM output failed parser validation.`);
  }
  const boxes = recordsOfKind(result.records, "box");
  const media = summary.parser_summary.processed_media;
  const detections = boxes.map((box) => ({
    frame_index: box.frame.frameIndex,
    object_id: box.objectId,
    box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
  }));
  const derived = derivePresenceSegments(detections, {
    fps: media.fps, frameCount: media.frame_count, width: media.width, height: media.height,
    edgeMarginRatio: 0.02, gapToleranceFrames: 0, cameraMotionPossible: true,
  });
  const segmentCounts = new Map();
  for (const segment of derived.segments) {
    segmentCounts.set(segment.sam_object_id, (segmentCounts.get(segment.sam_object_id) ?? 0) + 1);
  }
  const short = (maximumFrames) => derived.segments.filter(
    (segment) => segment.last_frame - segment.first_frame + 1 <= maximumFrames,
  ).length;
  return {
    run_id: runId,
    fps,
    frame_count: media.frame_count,
    emitted_frame_count: summary.parser_summary.emitted_frame_count,
    object_id_count: summary.parser_summary.track_count,
    box_count: summary.parser_summary.box_count,
    segment_count: derived.segments.length,
    one_frame_segment_count: short(1),
    one_or_two_frame_segment_count: short(2),
    fragmented_object_id_count: [...segmentCounts.values()].filter((count) => count > 1).length,
    fragmentation_extra_segment_count: derived.segments.length - segmentCounts.size,
    candidate_event_count: derived.events.length,
    sam_latency_ms: summary.sam_latency_ms,
    provider_reported_frames: summary.usage?.video_frames_processed ?? null,
    stored_cost_estimate_usd: summary.estimated_cost_usd_at_documented_rate ?? null,
  };
}

const baseline = await metrics(BASELINE_ROOT, 10);
const experiment = await metrics(EXPERIMENT_ROOT, 15);
const report = {
  status: "completed",
  comparison_kind: "development_temporal_sampling_experiment",
  baseline,
  experiment,
  deltas_experiment_minus_baseline: Object.fromEntries(
    ["frame_count", "emitted_frame_count", "object_id_count", "box_count", "segment_count",
      "one_frame_segment_count", "one_or_two_frame_segment_count", "fragmented_object_id_count",
      "fragmentation_extra_segment_count", "candidate_event_count", "sam_latency_ms"]
      .map((key) => [key, experiment[key] - baseline[key]]),
  ),
  interpretation_limits: [
    "Lower fragmentation is preferable, but these aggregate metrics do not measure animal-level accuracy.",
    "Object identifiers are response-local and must not be compared across runs as identities.",
    "The same object-cap and crowded-scene constraints apply at both frame rates.",
    "Known missed animals and overlay alignment still require visual review.",
    "Stored cost estimates preserve the original run calculation and are not a newly verified current price.",
  ],
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
console.log("Private 10 fps versus 15 fps SAM comparison saved.");

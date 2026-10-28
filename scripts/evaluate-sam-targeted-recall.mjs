import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

const ROOT = path.resolve("private/model-experiments");
const OUTPUT_PATH = path.resolve("private/evaluation/sam-targeted-recall.json");
const FRAME_INDICES = [225, 270, 300];
const HIPPO_REGION = { left: 850, top: 630, right: 1120, bottom: 850 };

async function* eventsFromNdjson(filePath) {
  for (const line of (await readFile(filePath, "utf8")).split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function latestRun(relativeRoot, prompt) {
  const root = path.join(ROOT, relativeRoot);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  for (const runId of entries) {
    try {
      const runDirectory = path.join(root, runId);
      const summary = JSON.parse(await readFile(path.join(runDirectory, "sam-summary.json"), "utf8"));
      if (summary.status === "completed" && summary.prompt === prompt) {
        return { runId, runDirectory, summary };
      }
    } catch {
      // Ignore failed and incomplete runs.
    }
  }
  throw new Error(`No completed '${prompt}' run was found.`);
}

function intersects(box, region) {
  return box.right > region.left && box.left < region.right &&
    box.bottom > region.top && box.top < region.bottom;
}

async function inspect(relativeRoot, prompt) {
  const { runId, runDirectory, summary } = await latestRun(relativeRoot, prompt);
  const parsed = parseVideoStream(eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")));
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed") throw new Error(`Stored '${prompt}' output was incomplete.`);
  const boxes = recordsOfKind(result.records, "box");
  return {
    run_id: runId,
    prompt,
    track_count: summary.parser_summary.track_count,
    total_box_count: boxes.length,
    sam_latency_ms: summary.sam_latency_ms,
    provider_reported_frames: summary.usage?.video_frames_processed ?? null,
    frames: FRAME_INDICES.map((frameIndex) => {
      const frameBoxes = boxes.filter((box) => box.frame.frameIndex === frameIndex);
      return {
        frame_index: frameIndex,
        time_seconds: frameIndex / 15,
        box_count: frameBoxes.length,
        hippo_region_box_count: frameBoxes.filter((box) => intersects(box, HIPPO_REGION)).length,
      };
    }),
  };
}

const animal = await inspect("sam-temporal-15fps", "animal");
const antelope = await inspect("sam-targeted-recall/antelope", "antelope");
const hippopotamus = await inspect("sam-targeted-recall/hippopotamus", "hippopotamus");
const report = {
  status: "completed",
  comparison_kind: "development_targeted_recall_gate",
  animal,
  antelope,
  hippopotamus,
  automated_gate: {
    antelope_more_boxes_on_all_reviewed_frames: antelope.frames.every(
      (frame, index) => frame.box_count > animal.frames[index].box_count,
    ),
    two_hippo_region_boxes_at_18_seconds:
      hippopotamus.frames.find((frame) => frame.frame_index === 270)?.hippo_region_box_count >= 2,
  },
  interpretation_limits: [
    "Prompt-specific object IDs are response-local and cannot be treated as shared identities.",
    "Box counts and a coarse hippo region are diagnostic checks, not precision or recall metrics.",
    "A human visual check is required before any merge or demo change.",
    "Overlapping prompt-specific tracks must be deduplicated before they can be combined.",
  ],
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
console.log("Private targeted-recall comparison saved.");

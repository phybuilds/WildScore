import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

import { auditTargetTracks } from "./lib/track-overlap.mjs";

const ROOT = path.resolve("private/model-experiments");
const OUTPUT_PATH = path.resolve("private/evaluation/sam-concept-merge-audit.json");
const CONFIG = { iouThreshold: 0.5, minimumSharedFrames: 5, minimumHighIouRatio: 0.6 };

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
        return { runId, runDirectory };
      }
    } catch {
      // Ignore incomplete runs.
    }
  }
  throw new Error(`No completed '${prompt}' run was found.`);
}

async function tracks(relativeRoot, prompt) {
  const { runId, runDirectory } = await latestRun(relativeRoot, prompt);
  const parsed = parseVideoStream(eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")));
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed") throw new Error(`Stored '${prompt}' output was incomplete.`);
  const grouped = new Map();
  for (const box of recordsOfKind(result.records, "box")) {
    const geometry = grouped.get(box.objectId) ?? [];
    geometry.push({
      frame_index: box.frame.frameIndex,
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    });
    grouped.set(box.objectId, geometry);
  }
  return {
    run_id: runId,
    prompt,
    tracks: [...grouped].map(([objectId, geometry]) => ({
      track_id: `${prompt}:${objectId}`,
      geometry,
    })),
  };
}

const base = await tracks("sam-temporal-15fps", "animal");
const targeted = await Promise.all([
  tracks("sam-targeted-recall/antelope", "antelope"),
  tracks("sam-targeted-recall/hippopotamus", "hippopotamus"),
]);
const prompts = targeted.map((source) => {
  const audit = auditTargetTracks(base.tracks, source.tracks, CONFIG);
  return {
    prompt: source.prompt,
    run_id: source.run_id,
    track_count: source.tracks.length,
    probable_duplicate_count: audit.filter((item) => item.classification === "probable_duplicate").length,
    additive_candidate_count: audit.filter((item) => item.classification === "additive_candidate").length,
    tracks: audit,
  };
});
const report = {
  status: "completed",
  audit_kind: "cross_prompt_geometry_overlap",
  config: CONFIG,
  base: { prompt: base.prompt, run_id: base.run_id, track_count: base.tracks.length },
  prompts,
  decision: "audit_only_no_automatic_merge",
  limitations: [
    "IoU overlap can identify likely duplicates but cannot establish cross-response identity.",
    "An additive candidate can still be a fragmented continuation of another track.",
    "The hippopotamus pass did not detect two simultaneous hippos at the reviewed frame.",
    "Human review is required before targeted tracks become saved evidence.",
  ],
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await chmod(OUTPUT_PATH, 0o600);
console.log("Private cross-prompt merge audit saved; no tracks were merged.");

import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

const execFileAsync = promisify(execFile);
const allowedArguments = new Set([
  "--prompt=animal", "--prompt=antelope", "--prompt=baboon", "--prompt=hippo", "--prompt=hippopotamus",
]);
if (process.argv.length > 3 || process.argv.slice(2).some((argument) => !allowedArguments.has(argument))) {
  throw new Error(
    "Usage: node scripts/render-sam-diagnostic-frames.mjs [--prompt=animal|antelope|baboon|hippo|hippopotamus]",
  );
}
const PROMPT = process.argv[2]?.split("=")[1] ?? "animal";
const RUNS_ROOT = path.resolve(
  PROMPT === "animal"
    ? "private/model-experiments/sam-temporal-15fps"
    : `private/model-experiments/sam-targeted-recall/${PROMPT}`,
);
const MEDIA_PATH = path.resolve("private/derived/clip-01-analysis-15fps.mp4");
const OUTPUT_ROOT = path.resolve("private/evaluation/sam-15fps-diagnostics", PROMPT);
const FRAME_INDICES = [225, 270, 300];

async function* eventsFromNdjson(filePath) {
  for (const line of (await readFile(filePath, "utf8")).split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

async function latestCompletedRun() {
  const entries = (await readdir(RUNS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse();
  for (const runId of entries) {
    try {
      const runDirectory = path.join(RUNS_ROOT, runId);
      const summary = JSON.parse(await readFile(path.join(runDirectory, "sam-summary.json"), "utf8"));
      if (
        summary.status === "completed" && summary.prompt === PROMPT &&
        summary.parser_summary?.processed_media?.fps === 15
      ) {
        return runDirectory;
      }
    } catch {
      // Ignore incomplete runs.
    }
  }
  throw new Error(`No completed 15 fps '${PROMPT}' experiment was found.`);
}

const runDirectory = await latestCompletedRun();
const parsed = parseVideoStream(eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")));
const result = await parsed.finalResult;
if (result.outcome.status !== "completed") throw new Error("Stored SAM output was incomplete.");
const boxes = recordsOfKind(result.records, "box");
await mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });

for (const frameIndex of FRAME_INDICES) {
  const frameBoxes = boxes.filter((box) => box.frame.frameIndex === frameIndex);
  const filters = [`select=eq(n\\,${frameIndex})`];
  for (const box of frameBoxes) {
    filters.push(
      `drawbox=x=${box.left}:y=${box.top}:w=${box.right - box.left}:h=${box.bottom - box.top}:color=yellow@0.9:t=2`,
    );
  }
  const outputPath = path.join(OUTPUT_ROOT, `frame-${frameIndex}.png`);
  await execFileAsync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", MEDIA_PATH,
    "-vf", filters.join(","), "-frames:v", "1", "-y", outputPath,
  ], { timeout: 60000, maxBuffer: 1024 * 1024 });
  await chmod(outputPath, 0o600);
  console.log(
    `Rendered '${PROMPT}' frame ${frameIndex} (${(frameIndex / 15).toFixed(1)}s) with ${frameBoxes.length} boxes.`,
  );
}

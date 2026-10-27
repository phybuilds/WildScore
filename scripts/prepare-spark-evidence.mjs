import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

const execFileAsync = promisify(execFile);
const RUNS_ROOT = path.resolve("private/model-runs");
const VIDEO_PATH = path.resolve("private/derived/clip-01-analysis-10fps.mp4");
const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 360;

async function latestSuccessfulRun() {
  const entries = (await readdir(RUNS_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of entries) {
    try {
      const summary = JSON.parse(
        await readFile(path.join(RUNS_ROOT, name, "sam-summary.json"), "utf8"),
      );
      if (summary.status === "completed") return { name, summary };
    } catch {
      // Ignore incomplete run directories and continue to the next candidate.
    }
  }
  throw new Error("No completed SAM run was found.");
}

async function* eventsFromNdjson(filePath) {
  const content = await readFile(filePath, "utf8");
  for (const line of content.split("\n")) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function area(box) {
  return (box.right - box.left) * (box.bottom - box.top);
}

function chooseLargestPerThird(boxes) {
  const ordered = [...boxes].sort(
    (a, b) => a.frame.frameIndex - b.frame.frameIndex,
  );
  const groups = [[], [], []];
  ordered.forEach((box, index) => {
    groups[Math.min(2, Math.floor((index * 3) / ordered.length))].push(box);
  });
  return groups.map((group) =>
    group.reduce((best, candidate) =>
      best === null || area(candidate) > area(best) ? candidate : best,
    null),
  );
}

function contiguousSegments(boxesByObject) {
  const segments = [];
  for (const [objectId, objectBoxes] of boxesByObject.entries()) {
    const ordered = [...objectBoxes].sort(
      (a, b) => a.frame.frameIndex - b.frame.frameIndex,
    );
    let current = [];
    for (const box of ordered) {
      const previous = current.at(-1);
      if (previous && box.frame.frameIndex !== previous.frame.frameIndex + 1) {
        segments.push({ objectId, boxes: current });
        current = [];
      }
      current.push(box);
    }
    if (current.length > 0) segments.push({ objectId, boxes: current });
  }
  return segments;
}

function cropWithContext(box, width, height) {
  const boxWidth = box.right - box.left;
  const boxHeight = box.bottom - box.top;
  const marginX = Math.max(24, Math.round(boxWidth * 0.25));
  const marginY = Math.max(24, Math.round(boxHeight * 0.25));
  const left = Math.max(0, box.left - marginX);
  const top = Math.max(0, box.top - marginY);
  const right = Math.min(width, box.right + marginX);
  const bottom = Math.min(height, box.bottom + marginY);
  return { left, top, width: right - left, height: bottom - top };
}

async function main() {
  const { name, summary } = await latestSuccessfulRun();
  const runDirectory = path.join(RUNS_ROOT, name);
  const parsed = parseVideoStream(
    eventsFromNdjson(path.join(runDirectory, "sam-events.ndjson")),
  );
  const result = await parsed.finalResult;
  if (result.outcome.status !== "completed") {
    throw new Error("Stored SAM stream was incomplete.");
  }

  const boxes = recordsOfKind(result.records, "box");
  const boxesByObject = new Map();
  for (const box of boxes) {
    const list = boxesByObject.get(box.objectId) ?? [];
    list.push(box);
    boxesByObject.set(box.objectId, list);
  }
  const selectedSegment = contiguousSegments(boxesByObject)
    .filter((segment) => segment.boxes.length >= 3)
    .sort((a, b) => b.boxes.length - a.boxes.length)[0];
  if (!selectedSegment) throw new Error("No usable SAM presence segment was found.");
  const { objectId, boxes: selectedTrack } = selectedSegment;

  const media = summary.parser_summary.processed_media;
  const selectedBoxes = chooseLargestPerThird(selectedTrack);
  if (selectedBoxes.some((box) => box === null)) {
    throw new Error("Could not choose three representative boxes.");
  }

  const evidenceDirectory = path.join(runDirectory, "spark-evidence");
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await chmod(evidenceDirectory, 0o700);

  const panels = [];
  for (const [index, box] of selectedBoxes.entries()) {
    const frameIndex = box.frame.frameIndex;
    const crop = cropWithContext(box, media.width, media.height);
    const panelPath = path.join(evidenceDirectory, `panel-${index + 1}.png`);
    const filter = [
      `select=eq(n\\,${frameIndex})`,
      `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}`,
      `scale=${PANEL_WIDTH}:${PANEL_HEIGHT}:force_original_aspect_ratio=decrease`,
      `pad=${PANEL_WIDTH}:${PANEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=white`,
    ].join(",");
    await execFileAsync(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        VIDEO_PATH,
        "-vf",
        filter,
        "-frames:v",
        "1",
        "-y",
        panelPath,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    await chmod(panelPath, 0o600);
    panels.push({
      panel: index + 1,
      frame_index: frameIndex,
      time_seconds: frameIndex / media.fps,
      source_box: {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      },
      crop,
    });
  }

  const contactSheetPath = path.join(evidenceDirectory, "contact-sheet.png");
  await execFileAsync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path.join(evidenceDirectory, "panel-1.png"),
      "-i",
      path.join(evidenceDirectory, "panel-2.png"),
      "-i",
      path.join(evidenceDirectory, "panel-3.png"),
      "-filter_complex",
      "[0:v][1:v][2:v]hstack=inputs=3",
      "-frames:v",
      "1",
      "-y",
      contactSheetPath,
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  await chmod(contactSheetPath, 0o600);

  await writeFile(
    path.join(evidenceDirectory, "evidence.json"),
    `${JSON.stringify(
      {
        source_run: name,
        sam_object_id: objectId,
        selection_rule:
          "Longest gap-free SAM presence segment; largest visible box in each third of that segment.",
        segment: {
          first_frame: selectedTrack[0].frame.frameIndex,
          last_frame: selectedTrack.at(-1).frame.frameIndex,
          emitted_frame_count: selectedTrack.length,
        },
        panels,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log("Private three-panel Spark evidence sheet created from a real SAM track.");
}

await main();

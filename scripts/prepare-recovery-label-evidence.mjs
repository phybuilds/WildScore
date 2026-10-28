import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BUNDLE_PATH = path.resolve(
  "private/bundles/clip-01/recovery-candidates-reviewed.json",
);
const VIDEO_PATH = path.resolve("private/derived/clip-01-analysis-15fps.mp4");
const OUTPUT_ROOT = path.resolve("private/label-review/recovery-evidence");
const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 360;

function area(box) {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

function representativeGeometry(geometry) {
  const ordered = [...geometry].sort((a, b) => a.frame_index - b.frame_index);
  const groups = [[], [], []];
  ordered.forEach((record, index) => {
    groups[Math.min(2, Math.floor((index * 3) / ordered.length))].push(record);
  });
  return groups.map((group) =>
    group.reduce(
      (best, record) => (best === null || area(record.box) > area(best.box) ? record : best),
      null,
    ),
  );
}

function cropWithContext(box, width, height) {
  const boxWidth = Math.max(1, box.right - box.left);
  const boxHeight = Math.max(1, box.bottom - box.top);
  const marginX = Math.max(32, boxWidth * 0.5);
  const marginY = Math.max(32, boxHeight * 0.5);
  const left = Math.max(0, Math.floor(box.left - marginX));
  const top = Math.max(0, Math.floor(box.top - marginY));
  const right = Math.min(width, Math.ceil(box.right + marginX));
  const bottom = Math.min(height, Math.ceil(box.bottom + marginY));
  return {
    left,
    top,
    width: Math.max(2, right - left),
    height: Math.max(2, bottom - top),
  };
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function renderPanel(frameIndex, crop, panelPath) {
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
}

async function main() {
  const bundle = JSON.parse(await readFile(BUNDLE_PATH, "utf8"));
  const acceptedIds = new Set(
    bundle.reviews
      .filter((review) => review.decision === "accepted")
      .map((review) => review.candidate_id),
  );
  const accepted = bundle.candidates.filter((candidate) =>
    acceptedIds.has(candidate.candidate_id),
  );
  if (accepted.length === 0 || accepted.length !== acceptedIds.size) {
    throw new Error("Accepted recovery reviews do not match the candidate bundle.");
  }

  await mkdir(OUTPUT_ROOT, { recursive: true, mode: 0o700 });
  await chmod(OUTPUT_ROOT, 0o700);
  const queue = [];

  for (const candidate of accepted) {
    const selected = representativeGeometry(candidate.geometry);
    if (selected.some((record) => record === null)) {
      throw new Error(`${candidate.candidate_id} has insufficient geometry.`);
    }
    const directory = path.join(OUTPUT_ROOT, candidate.candidate_id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const panels = [];

    for (const [index, record] of selected.entries()) {
      const crop = cropWithContext(record.box, bundle.width, bundle.height);
      const panelPath = path.join(directory, `panel-${index + 1}.png`);
      await renderPanel(record.frame_index, crop, panelPath);
      panels.push({
        panel: index + 1,
        frame_index: record.frame_index,
        time_seconds: record.frame_index / bundle.processed_fps,
        source_box: record.box,
        crop,
      });
    }

    const contactSheetPath = path.join(directory, "contact-sheet.png");
    await execFileAsync(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path.join(directory, "panel-1.png"),
        "-i",
        path.join(directory, "panel-2.png"),
        "-i",
        path.join(directory, "panel-3.png"),
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

    const evidence = {
      schema: "wildscore-private-recovery-label-evidence-v1",
      clip_id: bundle.clip_id,
      candidate_id: candidate.candidate_id,
      source_prompt: candidate.source_prompt,
      source_prompt_is_not_a_confirmed_label: true,
      selection_rule:
        "Largest visible box in each temporal third of the accepted recovery track.",
      panels,
    };
    await writePrivateJson(path.join(directory, "evidence.json"), evidence);
    queue.push({
      candidate_id: candidate.candidate_id,
      status: "awaiting_meta_proposal",
      evidence_directory: path.relative(path.resolve("private"), directory),
      source_prompt: candidate.source_prompt,
      source_prompt_is_not_a_confirmed_label: true,
    });
  }

  await writePrivateJson(
    path.join(OUTPUT_ROOT, "queue.json"),
    {
      schema: "wildscore-private-recovery-label-queue-v1",
      clip_id: bundle.clip_id,
      model_policy: "Meta models only",
      items: queue,
    },
  );
  console.log(`Prepared ${queue.length} private recovery label evidence sheets.`);
}

await main();

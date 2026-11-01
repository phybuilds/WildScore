import { copyFile, chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { RUN_ID_PATTERN } from "./run-preparation.mjs";

const defaultFs = { copyFile, chmod, mkdir, readFile, rename, unlink, writeFile };
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function validLabelProposal(proposal, segmentIds) {
  return proposal && typeof proposal === "object" &&
    segmentIds.has(proposal.segment_id) && SAFE_ID.test(proposal.segment_id) &&
    typeof proposal.label_id === "string" && SAFE_ID.test(proposal.label_id) &&
    typeof proposal.visible_evidence === "string" && proposal.visible_evidence.length >= 1 &&
    proposal.visible_evidence.length <= 500 &&
    (proposal.uncertainty_reason === null ||
      (typeof proposal.uncertainty_reason === "string" && proposal.uncertainty_reason.length <= 500)) &&
    proposal.model === "muse-spark-1.3" &&
    typeof proposal.source_run_id === "string" && SAFE_ID.test(proposal.source_run_id);
}

async function readJson(fs, filePath) {
  return JSON.parse(String(await fs.readFile(filePath, "utf8")));
}

async function removeOwnedFile(fs, filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function atomicJsonWrite(fs, targetPath, value) {
  const tempPath = `${targetPath}.tmp`;
  await removeOwnedFile(fs, tempPath);
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, targetPath);
    await fs.chmod(targetPath, 0o600);
  } finally {
    await removeOwnedFile(fs, tempPath);
  }
}

export async function buildPrivateRunBundle(options = {}) {
  const {
    repositoryRoot = process.cwd(),
    runId,
    labelProposals = [],
    fs = defaultFs,
  } = options;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error("Bundle stage received an invalid run ID.");
  }
  if (!Array.isArray(labelProposals)) {
    throw new Error("Bundle stage received invalid label proposals.");
  }

  const runsRoot = path.resolve(repositoryRoot, "private", "runs");
  const runDir = path.resolve(runsRoot, runId);
  if (path.dirname(runDir) !== runsRoot) {
    throw new Error("Bundle stage received an invalid run directory.");
  }
  const [manifest, sam, eventStage] = await Promise.all([
    readJson(fs, path.join(runDir, "run.json")),
    readJson(fs, path.join(runDir, "sam", "result.json")),
    readJson(fs, path.join(runDir, "events", "result.json")),
  ]);
  if (
    manifest?.runId !== runId ||
    sam?.runId !== runId ||
    eventStage?.runId !== runId ||
    manifest?.derivative?.fps !== 15 ||
    !Number.isInteger(manifest?.derivative?.width) ||
    !Number.isInteger(manifest?.derivative?.height) ||
    !Number.isFinite(manifest?.derivative?.durationSeconds) ||
    !Array.isArray(eventStage?.segments) ||
    !Array.isArray(eventStage?.events)
  ) {
    throw new Error("Bundle stage could not validate its private checkpoints.");
  }

  const segmentIds = new Set(eventStage.segments.map((segment) => segment.segment_id));
  const safeLabels = labelProposals.filter(
    (proposal) => validLabelProposal(proposal, segmentIds) && proposal.source_run_id === runId,
  );
  if (safeLabels.length !== labelProposals.length) {
    throw new Error("Bundle stage received a label for an unknown segment.");
  }

  const frameCount = sam?.summary?.processed_media?.frame_count;
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error("Bundle stage is missing the processed frame count.");
  }
  const bundle = {
    schema_version: "0.1.0",
    clip: {
      clip_id: runId,
      display_media: "analysis.mp4",
      processed_duration_s: manifest.derivative.durationSeconds,
      processed_fps: manifest.derivative.fps,
      processed_frame_count: frameCount,
      width: manifest.derivative.width,
      height: manifest.derivative.height,
    },
    run: {
      run_id: runId,
      completion_state: safeLabels.length > 0 ? "labelled" : "geometry_only",
      models: {
        segmentation: "sam-3.1",
        label_evidence: safeLabels.length > 0 ? "muse-spark-1.3" : null,
      },
      sam_prompt: "animal",
      provider: "Meta Model API",
      config_version: `sam-events-v${eventStage.schemaVersion}`,
    },
    segments: eventStage.segments,
    label_proposals: safeLabels,
    events: eventStage.events,
    reviews: [],
    evaluation: {
      status: "not_evaluated",
      held_out_clip_count: 0,
      limitations: [
        "This run has not been evaluated against a frozen reference.",
        "Tracks and event boundaries are machine proposals that require human review.",
      ],
    },
  };
  const recovery = {
    schema: "wildscore-recovery-candidates-v1",
    clip_id: runId,
    processed_fps: manifest.derivative.fps,
    processed_frame_count: frameCount,
    width: manifest.derivative.width,
    height: manifest.derivative.height,
    candidates: [],
    reviews: [],
    label_proposals: [],
    label_reviews: [],
    limitations: ["No targeted recovery pass has been run for this analysis."],
  };

  const outputDir = path.join(runDir, "bundle");
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await fs.chmod(outputDir, 0o700);
  await fs.copyFile(path.join(runDir, "analysis.mp4"), path.join(outputDir, "analysis.mp4"));
  await fs.chmod(path.join(outputDir, "analysis.mp4"), 0o600);
  await atomicJsonWrite(fs, path.join(outputDir, "bundle.json"), bundle);
  await atomicJsonWrite(fs, path.join(outputDir, "recovery-candidates.json"), recovery);
  return { bundle, outputDir, recovery };
}

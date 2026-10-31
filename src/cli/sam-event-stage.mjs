import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { parseVideoStream, recordsOfKind } from "@meta-sam/parser";

import { derivePresenceSegments } from "../../scripts/lib/presence-segments.mjs";
import { executeMetaSamRun } from "./meta-sam-run.mjs";
import { RUN_ID_PATTERN } from "./run-preparation.mjs";

export const SAM_EVENT_STAGE_SCHEMA_VERSION = 1;
export const SAM_EVENT_CONFIG = Object.freeze({
  camera_motion_possible: true,
  edge_margin_ratio: 0.02,
  gap_tolerance_frames: 0,
});

const defaultFs = { chmod, mkdir, readFile, rename, unlink, writeFile };

export class SamEventStageError extends Error {
  constructor() {
    super("SAM event stage failed validation.");
    this.name = "SamEventStageError";
  }
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function removeOwnedFile(fsPromises, filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function* storedEvents(filePath) {
  const lines = readline.createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim() !== "") yield JSON.parse(line);
  }
}

async function defaultParseStoredEvents(filePath) {
  return parseVideoStream(storedEvents(filePath)).finalResult;
}

function recordKey(record) {
  return `${record.frame?.frameIndex}:${record.objectId}`;
}

function buildDetections(parsed) {
  if (
    parsed?.outcome?.status !== "completed" ||
    parsed?.diagnostics?.some((diagnostic) => diagnostic.severity === "error")
  ) {
    throw new SamEventStageError();
  }
  const boxes = recordsOfKind(parsed.records, "box");
  const masks = recordsOfKind(parsed.records, "mask");
  const masksByKey = new Map(masks.map((mask) => [recordKey(mask), mask]));
  if (boxes.length !== masks.length) throw new SamEventStageError();
  return boxes.map((box) => {
    const mask = masksByKey.get(recordKey(box));
    if (!mask) throw new SamEventStageError();
    return {
      box: { bottom: box.bottom, left: box.left, right: box.right, top: box.top },
      detection_confidence: box.confidence ?? null,
      frame_index: box.frame.frameIndex,
      mask: {
        encoding: mask.mask.encoding,
        height: mask.mask.height,
        payload: mask.mask.payload,
        width: mask.mask.width,
      },
      object_id: String(box.objectId),
    };
  });
}

function validExisting(value, checkpoint, configHash) {
  return (
    value?.schemaVersion === SAM_EVENT_STAGE_SCHEMA_VERSION &&
    value?.runId === checkpoint.runId &&
    value?.sourceRawEventsSha256 === checkpoint.rawEventsSha256 &&
    value?.configHash === configHash &&
    Array.isArray(value?.segments) &&
    Array.isArray(value?.events)
  );
}

export async function executeSamEventStage(options = {}) {
  const {
    repositoryRoot = process.cwd(),
    runId,
    fs: fsPromises = defaultFs,
    verifySamRun = executeMetaSamRun,
    parseStoredEvents = defaultParseStoredEvents,
    derive = derivePresenceSegments,
  } = options;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new SamEventStageError();
  }

  let verified;
  try {
    verified = await verifySamRun({
      repositoryRoot,
      runId,
      apiKey: undefined,
      fetch: async () => {
        throw new Error("network is disabled during the event stage");
      },
    });
  } catch {
    throw new SamEventStageError();
  }
  const { checkpoint, runDir } = verified;
  const configHash = hashJson(SAM_EVENT_CONFIG);
  const outputDir = path.join(runDir, "events");
  const outputPath = path.join(outputDir, "result.json");
  try {
    const existing = JSON.parse(String(await fsPromises.readFile(outputPath, "utf8")));
    if (!validExisting(existing, checkpoint, configHash)) throw new SamEventStageError();
    return { checkpoint: existing, reused: true, runDir };
  } catch (error) {
    if (error instanceof SamEventStageError) throw error;
    if (error?.code !== "ENOENT") throw new SamEventStageError();
  }

  let parsed;
  try {
    parsed = await parseStoredEvents(path.join(runDir, "sam", "events.jsonl"));
  } catch {
    throw new SamEventStageError();
  }
  const detections = buildDetections(parsed);
  const media = checkpoint.summary?.processed_media;
  if (
    !Number.isInteger(media?.frame_count) ||
    !(media?.fps > 0) ||
    !Number.isInteger(media?.width) ||
    !Number.isInteger(media?.height)
  ) {
    throw new SamEventStageError();
  }
  const derived = derive(detections, {
    cameraMotionPossible: SAM_EVENT_CONFIG.camera_motion_possible,
    edgeMarginRatio: SAM_EVENT_CONFIG.edge_margin_ratio,
    fps: media.fps,
    frameCount: media.frame_count,
    gapToleranceFrames: SAM_EVENT_CONFIG.gap_tolerance_frames,
    height: media.height,
    width: media.width,
  });
  const completed = {
    config: SAM_EVENT_CONFIG,
    configHash,
    events: derived.events,
    runId,
    schemaVersion: SAM_EVENT_STAGE_SCHEMA_VERSION,
    segments: derived.segments,
    sourceRawEventsSha256: checkpoint.rawEventsSha256,
  };

  await fsPromises.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await fsPromises.chmod(outputDir, 0o700);
  const tempPath = `${outputPath}.tmp`;
  await removeOwnedFile(fsPromises, tempPath);
  try {
    await fsPromises.writeFile(tempPath, `${JSON.stringify(completed, null, 2)}\n`, {
      mode: 0o600,
    });
    await fsPromises.chmod(tempPath, 0o600);
    await fsPromises.rename(tempPath, outputPath);
    await fsPromises.chmod(outputPath, 0o600);
  } finally {
    await removeOwnedFile(fsPromises, tempPath);
  }
  return { checkpoint: completed, reused: false, runDir };
}

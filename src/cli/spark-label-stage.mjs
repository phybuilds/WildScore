import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { RUN_ID_PATTERN } from "./run-preparation.mjs";

export const META_SPARK_MODEL = "muse-spark-1.3";
export const META_SPARK_URL = "https://api.meta.ai/v1/responses";
const execFileAsync = promisify(execFile);
const defaultFs = { chmod, mkdir, readFile, rename, unlink, writeFile };
const LABEL_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;

function extractOutputText(response) {
  const pieces = [];
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        pieces.push(content.text);
      }
    }
  }
  return pieces.join("\n").trim();
}

export function validateSparkProposal(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !value || typeof value !== "object" ||
    typeof value.label_id !== "string" || !LABEL_PATTERN.test(value.label_id) ||
    typeof value.visible_evidence !== "string" || value.visible_evidence.length < 1 ||
    value.visible_evidence.length > 300 ||
    !(value.uncertainty_reason === null ||
      (typeof value.uncertainty_reason === "string" && value.uncertainty_reason.length <= 200))
  ) return null;
  return {
    label_id: value.label_id,
    visible_evidence: value.visible_evidence,
    uncertainty_reason: value.uncertainty_reason,
  };
}

function representativeGeometry(segment) {
  const ordered = [...segment.geometry].sort((a, b) => a.frame_index - b.frame_index);
  if (ordered.length < 3) return null;
  return [ordered[0], ordered[Math.floor((ordered.length - 1) / 2)], ordered.at(-1)];
}

function cropWithContext(box, width, height) {
  const marginX = Math.max(24, Math.round((box.right - box.left) * 0.35));
  const marginY = Math.max(24, Math.round((box.bottom - box.top) * 0.35));
  const left = Math.max(0, Math.floor(box.left - marginX));
  const top = Math.max(0, Math.floor(box.top - marginY));
  const right = Math.min(width, Math.ceil(box.right + marginX));
  const bottom = Math.min(height, Math.ceil(box.bottom + marginY));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

async function defaultBuildEvidence({ runDir, segment, media }) {
  const selected = representativeGeometry(segment);
  if (!selected) throw new Error("Track has fewer than three geometry samples.");
  const evidenceDir = path.join(runDir, "spark", "evidence", segment.segment_id);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  const panelPaths = [];
  for (const [index, geometry] of selected.entries()) {
    const crop = cropWithContext(geometry.box, media.width, media.height);
    const panelPath = path.join(evidenceDir, `panel-${index + 1}.png`);
    const filter = [
      `select=eq(n\\,${geometry.frame_index})`,
      `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}`,
      "scale=480:360:force_original_aspect_ratio=decrease",
      "pad=480:360:(ow-iw)/2:(oh-ih)/2:color=white",
    ].join(",");
    await execFileAsync("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", path.join(runDir, "analysis.mp4"),
      "-vf", filter, "-frames:v", "1", "-y", panelPath,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    await chmod(panelPath, 0o600);
    panelPaths.push(panelPath);
  }
  const contactSheetPath = path.join(evidenceDir, "contact-sheet.png");
  await execFileAsync("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-i", panelPaths[0], "-i", panelPaths[1], "-i", panelPaths[2],
    "-filter_complex", "[0:v][1:v][2:v]hstack=inputs=3",
    "-frames:v", "1", "-y", contactSheetPath,
  ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  await chmod(contactSheetPath, 0o600);
  return readFile(contactSheetPath);
}

async function defaultRequest({ apiKey, image, fetch: fetchImpl }) {
  const prompt = [
    "These are three timestamp-ordered crops from one proposed wildlife track.",
    "Identify only what is visibly supported; do not use location, filename, or assumed context.",
    "Use a short lowercase snake_case label_id, or unknown when the species or broad animal group is unclear.",
    "Do not return a confidence score or claim individual identity.",
    'Return JSON only: {"label_id":"unknown","visible_evidence":"short visible evidence","uncertainty_reason":"reason or null"}.',
  ].join(" ");
  const response = await fetchImpl(META_SPARK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: META_SPARK_MODEL,
      store: false,
      reasoning: { effort: "minimal" },
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: "wildscore_visible_label",
          strict: true,
          schema: {
            type: "object",
            properties: {
              label_id: { type: "string", maxLength: 64 },
              visible_evidence: { type: "string", maxLength: 300 },
              uncertainty_reason: { anyOf: [{ type: "string", maxLength: 200 }, { type: "null" }] },
            },
            required: ["label_id", "visible_evidence", "uncertainty_reason"],
            additionalProperties: false,
          },
        },
      },
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: `data:image/png;base64,${image.toString("base64")}` },
        ],
      }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { payload = null; }
  return { ok: response.ok, status: response.status, payload };
}

async function removeOwnedFile(fs, filePath) {
  try { await fs.unlink(filePath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function atomicWrite(fs, filePath, value) {
  const temp = `${filePath}.tmp`;
  await removeOwnedFile(fs, temp);
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, filePath);
    await fs.chmod(filePath, 0o600);
  } finally { await removeOwnedFile(fs, temp); }
}

export async function executeSparkLabelStage(options = {}) {
  const {
    repositoryRoot = process.cwd(), runId, apiKey, maxCalls = 4,
    fs = defaultFs, fetch: fetchImpl = globalThis.fetch,
    buildEvidence = defaultBuildEvidence, request = defaultRequest,
  } = options;
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) throw new Error("Spark stage received an invalid run ID.");
  if (typeof apiKey !== "string" || apiKey.trim() === "" || apiKey !== apiKey.trim()) throw new Error("Spark stage requires MODEL_API_KEY.");
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 16) throw new Error("Spark stage requires maxCalls from 1 to 16.");
  const runDir = path.join(path.resolve(repositoryRoot, "private", "runs"), runId);
  const resultPath = path.join(runDir, "spark", "result.json");
  try {
    const existing = JSON.parse(String(await fs.readFile(resultPath, "utf8")));
    if (
      existing?.runId !== runId || existing?.model !== META_SPARK_MODEL ||
      existing?.maxCalls !== maxCalls || !Array.isArray(existing?.labelProposals)
    ) {
      throw new Error("invalid");
    }
    return { checkpoint: existing, reused: true, runDir };
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("Spark stage found an invalid checkpoint.");
  }
  const [manifest, eventStage] = await Promise.all([
    readFile(path.join(runDir, "run.json"), "utf8").then(JSON.parse),
    readFile(path.join(runDir, "events", "result.json"), "utf8").then(JSON.parse),
  ]);
  if (manifest?.runId !== runId || eventStage?.runId !== runId || !Array.isArray(eventStage?.segments)) {
    throw new Error("Spark stage could not validate its private checkpoints.");
  }
  const media = {
    width: manifest.derivative.width,
    height: manifest.derivative.height,
    fps: manifest.derivative.fps,
  };
  const selected = [...eventStage.segments]
    .filter((segment) => Array.isArray(segment.geometry) && segment.geometry.length >= 3)
    .sort((a, b) => b.geometry.length - a.geometry.length || a.segment_id.localeCompare(b.segment_id))
    .slice(0, maxCalls);
  const sparkDir = path.join(runDir, "spark");
  await fs.mkdir(sparkDir, { recursive: true, mode: 0o700 });
  await fs.chmod(sparkDir, 0o700);
  const attempts = [];
  const labelProposals = [];
  for (const segment of selected) {
    try {
      const image = await buildEvidence({ runDir, segment, media });
      const response = await request({ apiKey, image, fetch: fetchImpl });
      const proposal = response.ok && response.payload?.status === "completed"
        ? validateSparkProposal(extractOutputText(response.payload))
        : null;
      attempts.push({ segment_id: segment.segment_id, status: response.status ?? null, valid: proposal !== null });
      if (proposal) labelProposals.push({
        segment_id: segment.segment_id,
        ...proposal,
        model: META_SPARK_MODEL,
        source_run_id: runId,
      });
    } catch {
      attempts.push({ segment_id: segment.segment_id, status: null, valid: false });
    }
  }
  const checkpoint = {
    runId,
    schemaVersion: 1,
    model: META_SPARK_MODEL,
    maxCalls,
    promptContext: "visible_evidence_only_no_location_or_filename",
    attemptedSegments: selected.length,
    attempts,
    labelProposals,
  };
  await atomicWrite(fs, resultPath, checkpoint);
  return { checkpoint, reused: false, runDir };
}

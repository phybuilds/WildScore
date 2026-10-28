import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseAndSummariseSamEvents } from "./lib/sam-output.mjs";
import { resolveSamRunConfig } from "./lib/sam-run-config.mjs";

const execFileAsync = promisify(execFile);
const API_BASE = "https://api.meta.ai/v1";
const runConfig = resolveSamRunConfig(process.argv.slice(2));
const {
  clipId: CLIP_ID,
  analysisFps: ANALYSIS_FPS,
  prompt: PROMPT,
  mediaFileName: MEDIA_FILE_NAME,
  runPurpose: RUN_PURPOSE,
} = runConfig;
const MEDIA_PATH = path.resolve("private/derived", MEDIA_FILE_NAME);
const MEDIA_ROOT = path.resolve("private/derived");
const RUNS_ROOT = path.resolve(runConfig.runsRoot);
const SAM_MODEL = "sam-3.1";
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_DURATION_SECONDS = 60;
const MAX_FRAMES = 15000;
const key = process.env.MODEL_API_KEY;

class SafeApiError extends Error {
  constructor(stage, status, details) {
    super(`${stage} failed with HTTP ${status}.`);
    this.name = "SafeApiError";
    this.stage = stage;
    this.status = status;
    this.details = details;
  }
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function probeMedia(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_frames",
      "-show_entries",
      "stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration",
      "-of",
      "json",
      filePath,
    ],
    { timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const payload = JSON.parse(stdout);
  const stream = payload.streams?.[0];
  const [numerator, denominator] = String(stream?.avg_frame_rate ?? "0/1")
    .split("/")
    .map(Number);
  const media = {
    codec: stream?.codec_name,
    width: Number(stream?.width),
    height: Number(stream?.height),
    fps: numerator / denominator,
    frameCount: Number(stream?.nb_read_frames),
    durationSeconds: Number(payload.format?.duration),
  };

  if (
    media.codec !== "h264" ||
    !Number.isFinite(media.fps) ||
    media.fps <= 0 ||
    !Number.isInteger(media.frameCount) ||
    media.frameCount <= 0 ||
    media.frameCount > MAX_FRAMES ||
    !Number.isFinite(media.durationSeconds) ||
    media.durationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new Error("Processed media failed the bounded technical preflight.");
  }
  return media;
}

async function readErrorDetails(response) {
  const body = (await response.text()).slice(0, 16000);
  try {
    const parsed = JSON.parse(body);
    return {
      code: parsed?.error?.code ?? null,
      type: parsed?.error?.type ?? null,
      message: parsed?.error?.message ?? "Unspecified API error.",
    };
  } catch {
    return { code: null, type: null, message: "Non-JSON API error." };
  }
}

async function uploadMedia(filePath) {
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", "3600");
  form.append(
    "file",
    new Blob([bytes], { type: "video/mp4" }),
    MEDIA_FILE_NAME,
  );

  const response = await fetch(`${API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    throw new SafeApiError("upload", response.status, await readErrorDetails(response));
  }
  return response.json();
}

async function* readSseEvents(response, outputPath, state) {
  const handle = await open(outputPath, "w", 0o600);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function* drain(final = false) {
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = final ? "" : (parts.pop() ?? "");
    for (const part of parts) {
      const data = part
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      await handle.write(`${JSON.stringify(event)}\n`);
      if (event.type === "response.completed") state.completed = event;
      yield event;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for await (const event of drain()) yield event;
    }
    buffer += decoder.decode();
    buffer += "\n\n";
    for await (const event of drain(true)) yield event;
  } finally {
    await handle.close();
  }
}

async function runSam(fileId, rawEventsPath, media) {
  const response = await fetch(`${API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: SAM_MODEL,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: PROMPT },
            { type: "input_video", file_id: fileId },
          ],
        },
      ],
      stream: true,
      metadata: {
        include_confidence: "true",
        mask_encoding: "one_bit",
      },
    }),
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) {
    throw new SafeApiError("sam", response.status, await readErrorDetails(response));
  }

  const state = { completed: null };
  const summary = await parseAndSummariseSamEvents(
    readSseEvents(response, rawEventsPath, state),
    { ...media, prompt: PROMPT },
  );
  return { summary, terminalEvent: state.completed };
}

async function deleteRemoteFile(fileId) {
  const response = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30000),
  });
  return response.ok;
}

async function saveJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function main() {
  if (typeof key !== "string" || key.trim().length < 12) {
    throw new Error("MODEL_API_KEY is unavailable.");
  }
  if (!MEDIA_PATH.startsWith(`${MEDIA_ROOT}${path.sep}`)) {
    throw new Error("Media path escaped the approved private directory.");
  }

  const mediaStat = await stat(MEDIA_PATH);
  if (!mediaStat.isFile() || mediaStat.size > MAX_BYTES) {
    throw new Error("Processed media failed the bounded file preflight.");
  }

  const media = await probeMedia(MEDIA_PATH);
  if (media.fps !== ANALYSIS_FPS) {
    throw new Error("Processed media frame rate did not match the requested experiment.");
  }
  const runDirectory = path.join(RUNS_ROOT, safeTimestamp());
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await chmod(runDirectory, 0o700);

  const startedAt = Date.now();
  let remoteFileId = null;

  try {
    console.log("Preflight passed. Uploading the sanitized analysis derivative.");
    const uploadStartedAt = Date.now();
    const uploaded = await uploadMedia(MEDIA_PATH);
    remoteFileId = uploaded.id;
    if (typeof remoteFileId !== "string" || !remoteFileId.startsWith("file-")) {
      throw new Error("Meta returned an invalid file identifier.");
    }
    await saveJson(path.join(runDirectory, "upload.json"), uploaded);
    console.log(`Upload completed. Running SAM 3.1 with concept prompt '${PROMPT}'.`);

    const samStartedAt = Date.now();
    const { summary, terminalEvent } = await runSam(
      remoteFileId,
      path.join(runDirectory, "sam-events.ndjson"),
      media,
    );
    const samEndedAt = Date.now();
    const usage = terminalEvent?.response?.usage ?? null;
    const framesProcessed = usage?.video_frames_processed ?? null;
    const estimatedCostUsd =
      Number.isFinite(framesProcessed) ? (framesProcessed * 0.2) / 1000 : null;

    await saveJson(path.join(runDirectory, "sam-summary.json"), {
      status: "completed",
      clip_id: CLIP_ID,
      run_purpose: RUN_PURPOSE,
      analysis_fps: ANALYSIS_FPS,
      provider: "Meta Model API",
      data_mode: "standard model; not contributor mode",
      model: SAM_MODEL,
      prompt: PROMPT,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(samEndedAt).toISOString(),
      upload_latency_ms: samStartedAt - uploadStartedAt,
      sam_latency_ms: samEndedAt - samStartedAt,
      total_latency_ms: samEndedAt - startedAt,
      usage,
      estimated_cost_usd_at_documented_rate: estimatedCostUsd,
      processed_media_sha256: await sha256(MEDIA_PATH),
      parser_summary: summary,
    });
    console.log("SAM response completed and parsed. Private validation artifacts were saved.");
  } catch (error) {
    const safeError = {
      status: "failed",
      stage: error instanceof SafeApiError ? error.stage : "local",
      http_status: error instanceof SafeApiError ? error.status : null,
      details: error instanceof SafeApiError ? error.details : { message: error.message },
      occurred_at: new Date().toISOString(),
    };
    await saveJson(path.join(runDirectory, "error.json"), safeError);
    console.error("Feasibility run failed. Details were saved privately without printing credentials.");
    process.exitCode = 1;
  } finally {
    if (remoteFileId) {
      let deletionConfirmed = false;
      try {
        deletionConfirmed = await deleteRemoteFile(remoteFileId);
      } catch {
        deletionConfirmed = false;
      }
      await saveJson(path.join(runDirectory, "remote-cleanup.json"), {
        remote_file_deletion_confirmed: deletionConfirmed,
        checked_at: new Date().toISOString(),
      });
      console.log(
        deletionConfirmed
          ? "Remote file deletion confirmed."
          : "Remote file deletion was not confirmed; see the private cleanup record.",
      );
    }
  }
}

await main();

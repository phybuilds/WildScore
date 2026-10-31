import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export const PREPARATION_SCHEMA_VERSION = 1;
export const PREPARATION_FPS = 15;
export const PREPARATION_VIDEO_CODEC = "libx264";
export const PREPARATION_PIXEL_FORMAT = "yuv420p";
export const PREPARATION_MAX_WIDTH = 3840;
export const PREPARATION_MAX_HEIGHT = 2160;
export const PREPARATION_FFMPEG_TIMEOUT_MS = 300_000;
export const PREPARATION_FFPROBE_TIMEOUT_MS = 10_000;
export const PREPARATION_MAX_BUFFER_BYTES = 1024 * 1024;
export const PREPARATION_MAX_SOURCE_BYTES = 500 * 1024 * 1024;
export const PREPARATION_MODELS = ["sam-3.1", "muse-spark-1.3"];
export const RUN_ID_PATTERN = /^run-[0-9a-f]{16}$/u;

const SENSITIVE_METADATA_PATTERN =
  /(location|gps|latitude|longitude|creation|device|make|model|software)/iu;

function defaultRunner(tool, args, opts) {
  return spawnSync(tool, args, opts);
}

const defaultFs = { chmod, mkdir, readFile, rename, stat, unlink, writeFile };

export function buildPreparationConfig(maxSeconds) {
  return {
    fps: PREPARATION_FPS,
    maxSeconds,
    pixelFormat: PREPARATION_PIXEL_FORMAT,
    videoCodec: PREPARATION_VIDEO_CODEC,
  };
}

export function preparationConfigString(config) {
  return [
    `wildscore-run-preparation/v${PREPARATION_SCHEMA_VERSION}`,
    `fps=${config.fps}`,
    `videoCodec=${config.videoCodec}`,
    `pixelFormat=${config.pixelFormat}`,
    `maxSeconds=${config.maxSeconds}`,
  ].join(";");
}

function parseFrameRate(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string" || raw.trim() === "") return NaN;
  const text = raw.trim();
  if (text.includes("/")) {
    const [numeratorText, denominatorText] = text.split("/", 2);
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return NaN;
    }
    return numerator / denominator;
  }
  return Number(text);
}

async function hashFileStreaming(filePath, openStream) {
  const digest = createHash("sha256");
  let byteCount = 0;
  const stream = openStream(filePath);
  try {
    for await (const chunk of stream) {
      digest.update(chunk);
      byteCount += chunk.length;
    }
  } catch (error) {
    try {
      stream.destroy?.();
    } catch {
      // Ignore cleanup errors; the original read failure is reported below.
    }
    throw error;
  }
  return { hex: digest.digest("hex"), byteCount };
}

function ffmpegArgs(sourcePath, tempOutputPath) {
  return [
    "-nostdin",
    "-v",
    "error",
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    `fps=${PREPARATION_FPS}`,
    "-c:v",
    PREPARATION_VIDEO_CODEC,
    "-pix_fmt",
    PREPARATION_PIXEL_FORMAT,
    "-map_metadata",
    "-1",
    "-map_chapters",
    "-1",
    "-movflags",
    "+faststart",
    "-n",
    tempOutputPath,
  ];
}

function ffprobeArgs(targetPath) {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", targetPath];
}

function parseDerivativeProbe(payload) {
  const streams = Array.isArray(payload?.streams) ? payload.streams : null;
  if (!streams) {
    throw new Error("Preparation failed: ffprobe returned no stream metadata.");
  }
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream?.codec_type === "audio");
  if (videoStreams.length !== 1) {
    throw new Error(
      `Preparation failed: expected exactly one video stream, found ${videoStreams.length}.`,
    );
  }
  if (audioStreams.length !== 0) {
    throw new Error("Preparation failed: derivative must not contain an audio stream.");
  }
  const video = videoStreams[0];
  const codec = String(video?.codec_name ?? "").toLowerCase();
  if (codec !== "h264") {
    throw new Error("Preparation failed: derivative must use a single H.264 video stream.");
  }
  const fps = parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  if (!Number.isFinite(fps) || Math.abs(fps - PREPARATION_FPS) > 0.01) {
    throw new Error("Preparation failed: derivative must be 15 fps.");
  }
  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Preparation failed: derivative dimensions are missing or invalid.");
  }
  if (width > PREPARATION_MAX_WIDTH || height > PREPARATION_MAX_HEIGHT) {
    throw new Error(
      `Preparation failed: dimensions ${width}x${height} exceed the ${PREPARATION_MAX_WIDTH}x${PREPARATION_MAX_HEIGHT} limit.`,
    );
  }
  return { codec: "h264", fps: PREPARATION_FPS, width, height, streams };
}

function validateDerivativePayload(payload, maxSeconds) {
  const base = parseDerivativeProbe(payload);
  const duration = Number(payload?.format?.duration ?? base.streams[0]?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Preparation failed: derivative duration is missing or invalid.");
  }
  if (duration > maxSeconds) {
    throw new Error(
      `Preparation failed: duration ${duration}s exceeds the --max-seconds limit of ${maxSeconds}s.`,
    );
  }
  const tags = payload?.format?.tags;
  const keys = tags && typeof tags === "object" ? Object.keys(tags) : [];
  const sensitive = keys.filter((key) => SENSITIVE_METADATA_PATTERN.test(key));
  if (sensitive.length > 0) {
    throw new Error("Preparation failed: derivative retained a sensitive metadata key.");
  }
  return { codec: base.codec, fps: base.fps, width: base.width, height: base.height, duration };
}

async function pathExists(fsPromises, filePath) {
  try {
    return (await fsPromises.stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertAllowedManifestShape(manifest) {
  const topKeys = Object.keys(manifest ?? {}).sort();
  const expectedTop = ["derivative", "models", "preparation", "runId", "schemaVersion", "source", "stages"].sort();
  if (JSON.stringify(topKeys) !== JSON.stringify(expectedTop)) {
    throw new Error("Preparation failed: existing manifest is invalid.");
  }
  if (manifest.schemaVersion !== PREPARATION_SCHEMA_VERSION) {
    throw new Error("Preparation failed: existing manifest is invalid.");
  }
  if (
    !RUN_ID_PATTERN.test(manifest.runId) ||
    !Number.isInteger(manifest?.source?.byteCount) ||
    !/^[0-9a-f]{64}$/u.test(manifest?.source?.sha256 ?? "") ||
    !/^[0-9a-f]{64}$/u.test(manifest?.derivative?.sha256 ?? "") ||
    manifest?.derivative?.codec !== "h264" ||
    manifest?.derivative?.fps !== PREPARATION_FPS ||
    !Number.isInteger(manifest?.derivative?.width) ||
    !Number.isInteger(manifest?.derivative?.height) ||
    !Number.isFinite(manifest?.derivative?.durationSeconds)
  ) {
    throw new Error("Preparation failed: existing manifest is invalid.");
  }
}

function manifestsMatchConfig(manifest, config) {
  return (
    manifest?.preparation &&
    manifest.preparation.fps === config.fps &&
    manifest.preparation.videoCodec === config.videoCodec &&
    manifest.preparation.pixelFormat === config.pixelFormat &&
    manifest.preparation.maxSeconds === config.maxSeconds
  );
}

async function probeDerivative(runner, targetPath, maxSeconds) {
  let payload;
  try {
    const result = await runner("ffprobe", ffprobeArgs(targetPath), {
      encoding: "utf8",
      timeout: PREPARATION_FFPROBE_TIMEOUT_MS,
      maxBuffer: PREPARATION_MAX_BUFFER_BYTES,
    });
    if (!result || result.status !== 0 || result.error) {
      throw new Error("Preparation failed: ffprobe could not read the derivative.");
    }
    payload = JSON.parse(String(result.stdout ?? ""));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Preparation failed: ffprobe returned invalid metadata.");
    }
    throw error;
  }
  return validateDerivativePayload(payload, maxSeconds);
}

async function removeOwnedTemp(fsPromises, filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function prepareAnalysisRun(options = {}) {
  const {
    videoPath,
    maxSeconds = 30,
    repositoryRoot = process.cwd(),
    fs: fsPromises = defaultFs,
    openStream = createReadStream,
    runner = defaultRunner,
    log = console.log,
  } = options;

  if (typeof videoPath !== "string" || videoPath.trim() === "") {
    throw new Error("analyse requires a local video file path.");
  }
  if (!Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 120) {
    throw new Error("--max-seconds must be an integer from 1 to 120.");
  }

  const config = buildPreparationConfig(maxSeconds);
  const configString = preparationConfigString(config);

  const sourceStat = await fsPromises.stat(videoPath);
  const sourceByteCount = sourceStat?.size;
  if (!sourceStat?.isFile?.() || !Number.isInteger(sourceByteCount)) {
    throw new Error("Preparation failed: source size is unavailable.");
  }
  if (sourceByteCount > PREPARATION_MAX_SOURCE_BYTES) {
    throw new Error("Preparation failed: source file exceeds the 500 MiB limit.");
  }

  const sourceHash = await hashFileStreaming(videoPath, openStream);
  if (sourceHash.byteCount !== sourceByteCount) {
    throw new Error("Preparation failed: source changed during preparation.");
  }
  const runId = `run-${createHash("sha256")
    .update(sourceHash.hex, "utf8")
    .update(configString, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error("Preparation failed: computed run ID is invalid.");
  }

  const runsRoot = path.join(repositoryRoot, "private", "runs");
  const runDir = path.join(runsRoot, runId);
  if (runDir !== path.join(runsRoot, path.basename(runDir)) || !RUN_ID_PATTERN.test(path.basename(runDir))) {
    throw new Error("Preparation failed: computed run directory is invalid.");
  }
  await fsPromises.mkdir(runDir, { recursive: true, mode: 0o700 });
  await fsPromises.chmod(runDir, 0o700);

  const derivativePath = path.join(runDir, "analysis.mp4");
  const manifestPath = path.join(runDir, "run.json");
  const hasDerivative = await pathExists(fsPromises, derivativePath);
  const hasManifest = await pathExists(fsPromises, manifestPath);

  if (hasDerivative && hasManifest) {
    let manifest;
    try {
      manifest = JSON.parse(String(await fsPromises.readFile(manifestPath, "utf8")));
    } catch {
      throw new Error("Preparation failed: existing manifest is invalid.");
    }
    assertAllowedManifestShape(manifest);
    if (manifest.runId !== runId) {
      throw new Error("Preparation failed: existing manifest is invalid.");
    }
    if (!manifestsMatchConfig(manifest, config)) {
      throw new Error("Preparation failed: existing preparation configuration mismatch.");
    }
    if (manifest?.source?.byteCount !== sourceByteCount || manifest?.source?.sha256 !== sourceHash.hex) {
      throw new Error("Preparation failed: existing preparation source mismatch.");
    }
    if (
      !Array.isArray(manifest?.models) ||
      manifest.models.length !== 2 ||
      manifest.models[0] !== "sam-3.1" ||
      manifest.models[1] !== "muse-spark-1.3"
    ) {
      throw new Error("Preparation failed: existing manifest is invalid.");
    }
    if (
      manifest?.stages?.preparation !== "completed" ||
      manifest?.stages?.sam !== "pending" ||
      manifest?.stages?.spark !== "pending" ||
      manifest?.stages?.bundle !== "pending"
    ) {
      throw new Error("Preparation failed: existing manifest is invalid.");
    }
    const derivativeHash = await hashFileStreaming(derivativePath, openStream);
    if (derivativeHash.hex !== manifest?.derivative?.sha256) {
      throw new Error("Preparation failed: existing derivative mismatch.");
    }
    const technical = await probeDerivative(runner, derivativePath, maxSeconds);
    if (
      technical.codec !== manifest.derivative.codec ||
      technical.fps !== manifest.derivative.fps ||
      technical.width !== manifest.derivative.width ||
      technical.height !== manifest.derivative.height ||
      technical.duration !== manifest.derivative.durationSeconds
    ) {
      throw new Error("Preparation failed: existing derivative metadata mismatch.");
    }
    const relativeDir = path.relative(repositoryRoot, runDir);
    log(`Run ID: ${manifest.runId}`);
    log(`Run directory: ${relativeDir}`);
    log(
      `Derivative: ${manifest.derivative.codec} ${manifest.derivative.width}x${manifest.derivative.height} at ${manifest.derivative.fps} fps, duration ${manifest.derivative.durationSeconds}s.`,
    );
    log("Preparation reused.");
    log("No API key was read and no model call was made.");
    return { runId: manifest.runId, runDir, reused: true };
  }
  if (hasDerivative || hasManifest) {
    throw new Error("Preparation failed: existing preparation is incomplete.");
  }

  const tempDerivativePath = path.join(runDir, "analysis.tmp.mp4");
  await removeOwnedTemp(fsPromises, tempDerivativePath);
  let technical;
  let derivativeHash;
  try {
    const ffmpegResult = await runner("ffmpeg", ffmpegArgs(videoPath, tempDerivativePath), {
      encoding: "utf8",
      timeout: PREPARATION_FFMPEG_TIMEOUT_MS,
      maxBuffer: PREPARATION_MAX_BUFFER_BYTES,
    });
    if (!ffmpegResult || ffmpegResult.status !== 0 || ffmpegResult.error) {
      throw new Error("Preparation failed: ffmpeg could not prepare this input.");
    }
    await fsPromises.chmod(tempDerivativePath, 0o600);
    technical = await probeDerivative(runner, tempDerivativePath, maxSeconds);
    derivativeHash = await hashFileStreaming(tempDerivativePath, openStream);
    await fsPromises.rename(tempDerivativePath, derivativePath);
    await fsPromises.chmod(derivativePath, 0o600);
  } finally {
    await removeOwnedTemp(fsPromises, tempDerivativePath);
  }

  const manifest = {
    derivative: {
      codec: technical.codec,
      durationSeconds: technical.duration,
      fps: technical.fps,
      height: technical.height,
      sha256: derivativeHash.hex,
      width: technical.width,
    },
    models: [...PREPARATION_MODELS],
    preparation: {
      fps: config.fps,
      maxSeconds: config.maxSeconds,
      pixelFormat: config.pixelFormat,
      videoCodec: config.videoCodec,
    },
    runId,
    schemaVersion: PREPARATION_SCHEMA_VERSION,
    source: { byteCount: sourceByteCount, sha256: sourceHash.hex },
    stages: { bundle: "pending", preparation: "completed", sam: "pending", spark: "pending" },
  };

  const tempManifestPath = path.join(runDir, "run.json.tmp");
  await fsPromises.writeFile(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  await fsPromises.chmod(tempManifestPath, 0o600);
  await fsPromises.rename(tempManifestPath, manifestPath);
  await fsPromises.chmod(manifestPath, 0o600);

  const relativeDir = path.relative(repositoryRoot, runDir);
  log(`Run ID: ${runId}`);
  log(`Run directory: ${relativeDir}`);
  log(
    `Derivative: ${technical.codec} ${technical.width}x${technical.height} at ${technical.fps} fps, duration ${technical.duration}s.`,
  );
  log("Preparation created.");
  log("No API key was read and no model call was made.");
  return { runId, runDir, reused: false };
}

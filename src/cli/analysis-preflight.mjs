import { spawnSync } from "node:child_process";
import path from "node:path";
import { lstat, realpath, stat } from "node:fs/promises";

export const ANALYSIS_PLANNED_MODELS = ["sam-3.1", "muse-spark-1.3"];
export const ANALYSIS_MAX_WIDTH = 3840;
export const ANALYSIS_MAX_HEIGHT = 2160;
export const ANALYSIS_MAX_FPS = 60;
export const ANALYSIS_FFPROBE_TIMEOUT_MS = 10_000;
export const ANALYSIS_MAX_SOURCE_BYTES = 500 * 1024 * 1024;

function isUrlLike(value) {
  const text = String(value).trim();
  if (text.includes("://")) return true;
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(text);
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

function ffprobeArgs(targetPath) {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", targetPath];
}

function defaultRunner(tool, args, opts) {
  return spawnSync(tool, args, opts);
}

export async function runAnalysisPreflight(options = {}) {
  const {
    videoPath,
    maxSeconds = 30,
    maxCalls = 8,
    fs = { lstat, stat, realpath },
    runner = defaultRunner,
    log = console.log,
  } = options;

  if (typeof videoPath !== "string" || videoPath.trim() === "") {
    throw new Error("analyse requires a local video file path.");
  }
  if (isUrlLike(videoPath)) {
    throw new Error("analyse accepts only a local file path, not a URL or network input.");
  }

  let linkStats;
  try {
    linkStats = await fs.lstat(videoPath);
  } catch {
    throw new Error(`Local video not found: ${path.basename(videoPath)}.`);
  }
  if (typeof linkStats?.isSymbolicLink === "function" && linkStats.isSymbolicLink()) {
    throw new Error("analyse rejects symlinked input; provide the real local file.");
  }

  let stats;
  try {
    stats = await fs.stat(videoPath);
  } catch {
    throw new Error(`Local video not found: ${path.basename(videoPath)}.`);
  }
  if (!stats?.isFile?.()) {
    throw new Error("analyse accepts only an existing local regular file, not a directory.");
  }
  if (typeof stats?.size === "number" && stats.size > ANALYSIS_MAX_SOURCE_BYTES) {
    throw new Error("analyse failed: source file exceeds the 500 MiB limit.");
  }

  let resolvedPath;
  let parentRealPath;
  try {
    resolvedPath = await fs.realpath(videoPath);
    parentRealPath = await fs.realpath(path.dirname(videoPath));
  } catch {
    throw new Error(`Local video not found: ${path.basename(videoPath)}.`);
  }
  if (path.dirname(resolvedPath) !== parentRealPath) {
    throw new Error("analyse rejects input that resolves outside its real parent directory.");
  }

  let probe;
  try {
    const result = await runner("ffprobe", ffprobeArgs(videoPath), {
      encoding: "utf8",
      timeout: ANALYSIS_FFPROBE_TIMEOUT_MS,
    });
    if (!result || result.status !== 0) {
      throw new Error("ffprobe reported an error for this input.");
    }
    probe = JSON.parse(String(result.stdout ?? ""));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("analyse failed: ffprobe returned invalid metadata.");
    }
    if (error instanceof Error && /ffprobe|timed out|metadata/iu.test(error.message)) {
      throw error;
    }
    throw new Error("analyse failed: ffprobe could not read this input.");
  }

  const formatName = String(probe?.format?.format_name ?? "");
  if (/m3u8|\bhls\b|dash|mpd|playlist/iu.test(formatName)) {
    throw new Error("analyse rejects playlists and network input; provide a single local file.");
  }

  const streams = Array.isArray(probe?.streams) ? probe.streams : null;
  if (!streams) {
    throw new Error("analyse failed: ffprobe returned no stream metadata.");
  }
  const videoStreams = streams.filter((stream) => stream?.codec_type === "video");
  if (videoStreams.length !== 1) {
    throw new Error(`analyse failed: expected exactly one video stream, found ${videoStreams.length}.`);
  }
  const video = videoStreams[0];

  const duration = Number(probe?.format?.duration ?? video?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("analyse failed: video duration is missing or invalid.");
  }
  if (duration > maxSeconds) {
    throw new Error(
      `analyse failed: duration ${duration}s exceeds the --max-seconds limit of ${maxSeconds}s.`,
    );
  }

  const width = Number(video?.width);
  const height = Number(video?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("analyse failed: video dimensions are missing or invalid.");
  }
  if (width > ANALYSIS_MAX_WIDTH || height > ANALYSIS_MAX_HEIGHT) {
    throw new Error(
      `analyse failed: dimensions ${width}x${height} exceed the ${ANALYSIS_MAX_WIDTH}x${ANALYSIS_MAX_HEIGHT} limit.`,
    );
  }

  const frameRate = parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate);
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new Error("analyse failed: video frame rate is missing or invalid.");
  }
  if (frameRate > ANALYSIS_MAX_FPS) {
    throw new Error(
      `analyse failed: frame rate ${frameRate} fps exceeds the ${ANALYSIS_MAX_FPS} fps limit.`,
    );
  }

  const basename = path.basename(videoPath);
  log(`Analyse preflight passed for ${basename}.`);
  log(
    `Duration: ${duration}s (limit ${maxSeconds}s); dimensions: ${width}x${height}; frame rate: ${frameRate} fps.`,
  );
  log(`Planned models: ${ANALYSIS_PLANNED_MODELS.join(", ")}; maximum calls: ${maxCalls}.`);
  log("No API key was loaded and no model call was made.");
  return 0;
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
if (process.argv.length !== 3 || process.argv[2] !== "--fps=15") {
  throw new Error("Usage: node scripts/prepare-analysis-derivative.mjs --fps=15");
}

const PRIVATE_ROOT = path.resolve("private");
const INPUT_PATH = path.resolve("private/derived/clip-01-sanitized-master.mp4");
const OUTPUT_PATH = path.resolve("private/derived/clip-01-analysis-15fps.mp4");
const PROVENANCE_PATH = path.resolve("private/derived/clip-01-analysis-15fps.json");
const MAX_SOURCE_BYTES = 500 * 1024 * 1024;

function assertPrivate(filePath) {
  if (!filePath.startsWith(`${PRIVATE_ROOT}${path.sep}`)) {
    throw new Error("A media path escaped the approved private directory.");
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function probe(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration,tags",
    "-of", "json", filePath,
  ], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const payload = JSON.parse(stdout);
  const stream = payload.streams?.[0];
  const [numerator, denominator] = String(stream?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    codec: stream?.codec_name,
    width: Number(stream?.width),
    height: Number(stream?.height),
    fps: numerator / denominator,
    frame_count: Number(stream?.nb_read_frames),
    duration_seconds: Number(payload.format?.duration),
    metadata_keys: Object.keys(payload.format?.tags ?? {}).sort(),
  };
}

function validate(media) {
  if (
    media.codec !== "h264" || media.width !== 1920 || media.height !== 1080 ||
    media.fps !== 15 || !Number.isInteger(media.frame_count) ||
    media.frame_count < 300 || media.frame_count > 330 ||
    !Number.isFinite(media.duration_seconds) || media.duration_seconds > 60
  ) {
    throw new Error("The 15 fps derivative failed its bounded technical preflight.");
  }
  const sensitiveKeys = media.metadata_keys.filter((key) =>
    /(location|gps|latitude|longitude|creation|device|make|model|software)/i.test(key),
  );
  if (sensitiveKeys.length > 0) {
    throw new Error("The 15 fps derivative retained a sensitive metadata key.");
  }
}

for (const filePath of [INPUT_PATH, OUTPUT_PATH, PROVENANCE_PATH]) assertPrivate(filePath);
const sourceStat = await stat(INPUT_PATH);
if (!sourceStat.isFile() || sourceStat.size > MAX_SOURCE_BYTES) {
  throw new Error("The sanitized source failed its bounded file preflight.");
}
await mkdir(path.dirname(OUTPUT_PATH), { recursive: true, mode: 0o700 });

let existing = false;
try {
  existing = (await stat(OUTPUT_PATH)).isFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (!existing) {
  await execFileAsync("ffmpeg", [
    "-nostdin", "-v", "error", "-i", INPUT_PATH,
    "-map", "0:v:0", "-an", "-vf", "fps=15",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-pix_fmt", "yuv420p", "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "+faststart", "-n", OUTPUT_PATH,
  ], { timeout: 300000, maxBuffer: 1024 * 1024 });
}

await chmod(OUTPUT_PATH, 0o600);
const media = await probe(OUTPUT_PATH);
validate(media);
const provenance = {
  status: existing ? "validated_existing" : "created",
  source_kind: "sanitized_master",
  output_kind: "analysis_derivative",
  analysis_fps: 15,
  metadata_policy: "all source metadata and chapters removed",
  source_sha256: await sha256(INPUT_PATH),
  output_sha256: await sha256(OUTPUT_PATH),
  media,
};
await writeFile(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 });
await chmod(PROVENANCE_PATH, 0o600);
console.log(`15 fps derivative ${existing ? "validated" : "created"}; sensitive metadata keys: 0.`);

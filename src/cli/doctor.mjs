import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DOCTOR_TOOL_TIMEOUT_MS = 10_000;
export const DOCTOR_VERSION_LINE_MAX = 300;

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function toTriple(version) {
  const clean = String(version).trim().replace(/^v/iu, "");
  const parts = clean.split(".").map((part) => Number(part));
  if (parts.length === 0 || parts.length > 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    return null;
  }
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareTriples(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function satisfiesComparator(versionTriple, operator, targetTriple) {
  const order = compareTriples(versionTriple, targetTriple);
  if (operator === ">=") return order >= 0;
  if (operator === "<=") return order <= 0;
  if (operator === ">") return order > 0;
  if (operator === "<") return order < 0;
  return order === 0;
}

export function satisfiesNodeRange(version, range) {
  const triple = toTriple(version);
  if (!triple || typeof range !== "string" || range.trim() === "") return false;
  const alternatives = range.split("||").map((part) => part.trim()).filter(Boolean);
  if (alternatives.length === 0) return false;
  return alternatives.some((alternative) => {
    const comparators = alternative.split(/\s+/u).filter(Boolean);
    if (comparators.length === 0) return false;
    return comparators.every((comparator) => {
      const match = /^(>=|<=|>|<|=|v)?(\d+(?:\.\d+){0,2})$/u.exec(comparator.trim());
      if (!match) return false;
      const operator = match[1] === undefined || match[1] === "v" ? "=" : match[1];
      const target = toTriple(match[2]);
      if (!target) return false;
      if (operator === "=") {
        const specified = match[2].split(".").length;
        return triple.slice(0, specified).every((n, i) => n === target[i]);
      }
      return satisfiesComparator(triple, operator, target);
    });
  });
}

export function checkNodeVersion(currentVersion, enginesRange) {
  if (typeof enginesRange !== "string" || enginesRange.trim() === "") {
    return { ok: false, message: "No supported Node version range is declared in package.json." };
  }
  if (satisfiesNodeRange(currentVersion, enginesRange)) {
    return { ok: true, message: `Node ${currentVersion} satisfies required range ${enginesRange}.` };
  }
  return {
    ok: false,
    message: `Node ${currentVersion} does not satisfy required range ${enginesRange}.`,
  };
}

export function hasModelApiKey(env) {
  return typeof env?.MODEL_API_KEY === "string" && env.MODEL_API_KEY !== "";
}

function firstLine(text) {
  const line = String(text).split("\n", 1)[0].trim();
  return line.slice(0, DOCTOR_VERSION_LINE_MAX);
}

export function getToolVersionLine(tool, runner = spawnSync) {
  try {
    const result = runner(tool, ["-version"], {
      timeout: DOCTOR_TOOL_TIMEOUT_MS,
      encoding: "utf8",
    });
    if (!result || result.status !== 0) return { ok: false, line: null };
    const line = firstLine(result.stdout ?? "");
    if (!line) return { ok: false, line: null };
    return { ok: true, line };
  } catch {
    return { ok: false, line: null };
  }
}

export function collectDoctorReport({ nodeCheck, ffmpeg, ffprobe, keyPresent }) {
  const lines = [nodeCheck.message];
  lines.push(ffmpeg.ok ? `ffmpeg: ${ffmpeg.line}` : "ffmpeg: not found. Install ffmpeg to use analyse preflight.");
  lines.push(ffprobe.ok ? `ffprobe: ${ffprobe.line}` : "ffprobe: not found. Install ffprobe to use analyse preflight.");
  lines.push(
    keyPresent
      ? "MODEL_API_KEY: present."
      : "MODEL_API_KEY: missing (warning: dry-run and demo do not require it).",
  );
  const ok = nodeCheck.ok && ffmpeg.ok && ffprobe.ok;
  return { ok, lines };
}

export async function readEnginesRange(packageJsonPath) {
  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw)?.engines?.node;
}

export async function runDoctor(options = {}) {
  const {
    packageJsonPath = path.join(REPOSITORY_ROOT, "package.json"),
    env = process.env,
    runner = spawnSync,
    log = console.log,
  } = options;
  let enginesRange = "";
  try {
    enginesRange = await readEnginesRange(packageJsonPath);
  } catch {
    enginesRange = "";
  }
  const nodeCheck = checkNodeVersion(process.version, enginesRange);
  const ffmpeg = getToolVersionLine("ffmpeg", runner);
  const ffprobe = getToolVersionLine("ffprobe", runner);
  const report = collectDoctorReport({
    nodeCheck,
    ffmpeg,
    ffprobe,
    keyPresent: hasModelApiKey(env),
  });
  for (const line of report.lines) log(line);
  return report.ok ? 0 : 1;
}

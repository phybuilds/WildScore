import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareAnalysisRun } from "./run-preparation.mjs";

function probePayload(tags = {}) {
  return JSON.stringify({
    format: { duration: "12.5", tags },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "15/1",
        duration: "12.5",
      },
    ],
  });
}

async function fixture(t) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "wildscore-prepare-test-"));
  const videoPath = path.join(repositoryRoot, "private-source-name.mov");
  await writeFile(videoPath, Buffer.from("private source bytes"), { mode: 0o600 });
  t.after(async () => rm(repositoryRoot, { recursive: true, force: true }));
  return { repositoryRoot, videoPath };
}

function successfulRunner(calls, tags = {}) {
  return async (tool, args, options) => {
    calls.push({ tool, args, options });
    assert.equal("shell" in options, false);
    if (tool === "ffmpeg") {
      const outputPath = args.at(-1);
      assert.match(outputPath, /analysis\.tmp\.mp4$/u);
      await writeFile(outputPath, Buffer.from("sanitized derivative"), { mode: 0o600 });
      return { status: 0, stdout: "", stderr: "" };
    }
    assert.equal(tool, "ffprobe");
    return { status: 0, stdout: probePayload(tags), stderr: "" };
  };
}

test("creates a private content-addressed preparation without source identity", async (t) => {
  const { repositoryRoot, videoPath } = await fixture(t);
  const calls = [];
  const lines = [];
  const result = await prepareAnalysisRun({
    videoPath,
    repositoryRoot,
    runner: successfulRunner(calls),
    log: (line) => lines.push(line),
  });

  assert.match(result.runId, /^run-[0-9a-f]{16}$/u);
  assert.equal(result.reused, false);
  assert.deepEqual(calls.map((call) => call.tool), ["ffmpeg", "ffprobe"]);
  assert.ok(calls[0].args.includes("-map_metadata"));
  assert.ok(calls[0].args.includes("-map_chapters"));
  assert.ok(calls[0].args.includes("-an"));
  assert.equal(calls[0].options.timeout, 300_000);

  const manifestPath = path.join(result.runDir, "run.json");
  const derivativePath = path.join(result.runDir, "analysis.mp4");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.runId, result.runId);
  assert.deepEqual(manifest.models, ["sam-3.1", "muse-spark-1.3"]);
  assert.deepEqual(manifest.stages, {
    bundle: "pending",
    preparation: "completed",
    sam: "pending",
    spark: "pending",
  });
  assert.equal(manifestText.includes("private-source-name"), false);
  assert.equal(manifestText.includes(repositoryRoot), false);
  assert.equal(lines.join("\n").includes(videoPath), false);
  assert.match(lines.at(-1), /No API key was read and no model call was made/u);
  assert.equal((await stat(result.runDir)).mode & 0o777, 0o700);
  assert.equal((await stat(manifestPath)).mode & 0o777, 0o600);
  assert.equal((await stat(derivativePath)).mode & 0o777, 0o600);

  const reuseCalls = [];
  const reused = await prepareAnalysisRun({
    videoPath,
    repositoryRoot,
    runner: successfulRunner(reuseCalls),
    log: () => {},
  });
  assert.equal(reused.reused, true);
  assert.deepEqual(reuseCalls.map((call) => call.tool), ["ffprobe"]);

  await writeFile(derivativePath, Buffer.from("tampered"));
  await assert.rejects(
    () => prepareAnalysisRun({
      videoPath,
      repositoryRoot,
      runner: successfulRunner([]),
      log: () => {},
    }),
    /derivative mismatch/u,
  );
});

test("fails closed on sensitive derivative metadata and removes its temporary output", async (t) => {
  const { repositoryRoot, videoPath } = await fixture(t);
  await assert.rejects(
    () => prepareAnalysisRun({
      videoPath,
      repositoryRoot,
      runner: successfulRunner([], { location: "redacted" }),
      log: () => {},
    }),
    /sensitive metadata/u,
  );
  const runsRoot = path.join(repositoryRoot, "private", "runs");
  const runNames = await readdir(runsRoot);
  assert.equal(runNames.length, 1);
  const runDir = path.join(runsRoot, runNames[0]);
  await assert.rejects(() => stat(path.join(runDir, "analysis.tmp.mp4")), /ENOENT/u);
  await assert.rejects(() => stat(path.join(runDir, "analysis.mp4")), /ENOENT/u);
});
